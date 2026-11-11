import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { createShotNamer } from '@testpilot/native'
import {
  buildRunSummary,
  caseStatusFromErrorCode,
  nativeCodeFromMessage,
  type CaseResult,
  type CaseStatus,
  type ConsoleEntry,
  type NetworkEntry,
  type RunSummary,
  type StepResult,
} from '@testpilot/core'

/** 头注释元数据:evidence 链(测试点 ID + 视角),ingest 时写入 case 元数据 */
export interface NativeCaseHeader {
  testPointId?: string
  perspective?: string
}

const HEADER_HEAD_CHARS = 4000

/** 解析脚本文件头注释(`// 测试点: <ID>` + `// 视角: charter:*`) */
export async function readNativeCaseHeader(file: string): Promise<NativeCaseHeader> {
  const source = await readFile(file, 'utf8').catch(() => '')
  const head = source.slice(0, HEADER_HEAD_CHARS)
  return {
    testPointId: /^\s*\/\/\s*测试点[:：]\s*(\S+)/m.exec(head)?.[1],
    perspective: /^\s*\/\/\s*视角[:：]\s*(\S+)/m.exec(head)?.[1],
  }
}

// ---- Playwright JSON reporter 结构(官方 schema 子集) ----

interface PwAttachment {
  name?: string
  path?: string
  /** buffer 形式 attach 时 JSON reporter 内联正文(如 fixtures.ts 的 console/network JSON) */
  body?: string
  contentType?: string
}

interface PwResult {
  status?: string
  duration?: number
  error?: { message?: string }
  errors?: Array<{ message?: string }>
  attachments?: PwAttachment[]
}

interface PwTest {
  projectName?: string
  status?: 'expected' | 'unexpected' | 'flaky' | 'skipped'
  results?: PwResult[]
}

interface PwSpec {
  title?: string
  file?: string
  tests?: PwTest[]
}

interface PwSuite {
  file?: string
  suites?: PwSuite[]
  specs?: PwSpec[]
}

interface PwReport {
  suites?: PwSuite[]
}

// ---- node:test TAP 输出结构(内置 reporter,Node 版本无关) ----

interface TapEntry {
  indent: number
  name: string
  ok: boolean
  yaml: Record<string, string | boolean | number>
}

export interface NativeIngestInput {
  runId: string
  startedAt: Date
  finishedAt?: Date
  /** 项目根:用于把报告里的源文件路径相对化与解析头注释 */
  root: string
  /** 参与运行的脚本(绝对或相对 root);用于读取头注释元数据 */
  files: readonly string[]
  /** Playwright `--reporter=json` 的输出文件 */
  playwrightJsonPath?: string
  /** `.testpilot/artifacts/shots/<runId>`。只保留 passed/failed 的截图 */
  shotsDir?: string
  /** run 目录下的 traces/。失败用例的 trace.zip 复制进来,trace 字段改写为相对 run 目录路径 */
  tracesDir?: string
  /** run 目录下的 videos/。失败用例的 video(playwright.config 开 use.video 后才有)复制进来,改写为相对路径 */
  videosDir?: string
  /**
   * node:test 的 TAP 原文。file 为脚本绝对路径。
   * text 为内存中的 stdout;path 仅供直接喂解析器的测试使用,运行时不落盘。
   */
  nodeTestTaps?: ReadonlyArray<{ text?: string; path?: string; target: 'miniapp' | 'api'; file: string }>
}

/**
 * 把原生框架的结构化输出归一成与 YAML run 完全相同的 RunSummary(写 result.json 的形态)。
 * 报告、跨 run 汇总、history 零改动复用。
 */
export async function buildNativeRunSummary(input: NativeIngestInput): Promise<RunSummary> {
  const finishedAt = input.finishedAt ?? new Date()
  const headers = new Map<string, Promise<NativeCaseHeader>>()
  const headerFor = (file: string | undefined): Promise<NativeCaseHeader> => {
    const key = file ? resolve(file) : ''
    if (!key) return Promise.resolve({})
    const cached = headers.get(key)
    if (cached) return cached
    const pending = readNativeCaseHeader(key)
    headers.set(key, pending)
    return pending
  }
  const fileOf = (source: string | undefined): string =>
    source ? (isAbsolute(source) ? source : resolve(input.root, source)) : ''
  const relOf = (abs: string): string => relative(input.root, abs) || abs

  const cases: CaseResult[] = []
  if (input.playwrightJsonPath) {
    cases.push(...(await parsePlaywright(input.playwrightJsonPath, input.root, fileOf, relOf, headerFor)))
  }
  for (const item of input.nodeTestTaps ?? []) {
    cases.push(...(await parseNodeTestTap(item, item.file, item.target, input.root, fileOf, relOf, headerFor)))
  }
  await bindShots(cases, { shotsDir: input.shotsDir, runId: input.runId, root: input.root })
  await bindTraces(cases, { tracesDir: input.tracesDir })
  await bindVideos(cases, { videosDir: input.videosDir })
  // 原生框架不提供用例级绝对时间,统一填 run 级起止
  const startedIso = input.startedAt.toISOString()
  const finishedIso = finishedAt.toISOString()
  const normalized = cases.map((item) => ({
    ...item,
    startedAt: item.startedAt || startedIso,
    finishedAt: item.finishedAt || finishedIso,
  }))
  return buildRunSummary(input.runId, input.startedAt, normalized, { finishedAt })
}

async function parsePlaywright(
  reportPath: string,
  root: string,
  fileOf: (source: string | undefined) => string,
  relOf: (abs: string) => string,
  headerFor: (file: string) => Promise<NativeCaseHeader>,
): Promise<CaseResult[]> {
  const source = await readFile(reportPath, 'utf8').catch(() => '')
  if (!source.trim()) return []
  let report: PwReport
  try {
    report = JSON.parse(source) as PwReport
  } catch {
    // 解析失败的输出原文保留在 run 目录(playwright.json),这里不硬卡
    return []
  }

  const cases: CaseResult[] = []
  const walk = async (suites: PwSuite[] | undefined): Promise<void> => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        const test = spec.tests?.[spec.tests.length - 1]
        if (!test) continue
        // 重试时取最后一次结果
        const result = test.results?.[test.results.length - 1]
        const abs = fileOf(spec.file ?? suite.file)
        const header = abs ? await headerFor(abs) : {}

        const joinedErrors = (result?.errors ?? [])
          .map((item) => item.message)
          .filter(Boolean)
          .join('\n')
        const message = result?.error?.message ?? (joinedErrors || undefined)
        const pwStatus = test.status ?? 'unexpected'
        const rawStatus: CaseStatus =
          pwStatus === 'skipped' ? 'skipped' : pwStatus === 'unexpected' ? 'failed' : 'passed'
        const errorCode = rawStatus === 'failed' ? nativeCodeFromMessage(message) : undefined
        const status =
          errorCode !== undefined ? caseStatusFromErrorCode(errorCode) : rawStatus
        const caseId = header.testPointId ?? basename(abs || 'unknown').replace(/\.\w+$/, '')
        const title = spec.title ?? caseId

        const step: StepResult = {
          index: 1,
          target: 'web',
          action: 'test',
          status: status === 'skipped' ? 'skipped' : 'failed',
          durationMs: result?.duration ?? 0,
          error: message,
          errorCode,
        }
        if (status === 'passed') step.status = 'passed'

        const item: CaseResult = {
          caseId,
          caseName: title,
          file: abs ? relOf(abs) : (spec.file ?? ''),
          rowId: test.projectName ? `${test.projectName}:${title}` : title,
          rowIndex: 0,
          status,
          steps: [step],
          startedAt: '',
          finishedAt: '',
          durationMs: result?.duration ?? 0,
          ...(message && status === 'failed' ? { error: message } : {}),
          ...(errorCode ? { errorCode } : {}),
        }
        if (status === 'passed' && pwStatus === 'flaky') {
          item.warnings = ['Playwright 报告 flaky(重试后通过)']
        }
        for (const attachment of result?.attachments ?? []) {
          if (
            attachment.name === 'screenshot' &&
            attachment.path &&
            (status === 'passed' || status === 'failed')
          ) {
            step.screenshot = attachment.path
          }
          if (attachment.name === 'trace' && attachment.path) item.trace = attachment.path
          if (attachment.name === 'video' && attachment.path) item.video = attachment.path
          // fixtures.ts 的观测附件:JSON 数组,归一进 case 级 consoleLog / networkLog
          if (attachment.name === 'testpilot-console' && attachment.body) {
            item.consoleLog = parseObservationList(attachment.body, consoleEntryFrom)
          }
          if (attachment.name === 'testpilot-network' && attachment.body) {
            item.networkLog = parseObservationList(attachment.body, networkEntryFrom)
          }
        }
        cases.push(item)
      }
      await walk(suite.suites)
    }
  }
  await walk(report.suites)
  return cases
}

/**
 * 解析单份 node:test TAP 输出为一个脚本的用例列表。
 * 结构(实测 Node 22):`ok/not ok N - name` + 缩进 YAML 块(---/...),嵌套每层 4 空格;
 * type: 'test' 是用例、'suite' 是 describe(失败冒泡,不重复计)。
 */
export async function parseNodeTestTap(
  source: { text?: string; path?: string },
  sourceFile: string,
  target: 'miniapp' | 'api',
  root: string,
  fileOf: (source: string | undefined) => string,
  relOf: (abs: string) => string,
  headerFor: (file: string) => Promise<NativeCaseHeader>,
): Promise<CaseResult[]> {
  const text = source.text ?? (source.path ? await readFile(source.path, 'utf8').catch(() => '') : '')
  if (!text.trim()) return []
  const entries = parseTapEntries(text).filter((entry) => entry.yaml.type === 'test')
  if (entries.length === 0) return []

  // 每个 case 层级:顶层裸 test 在 0,describe 全包时在 4——取最浅层的 test 事件
  const minIndent = Math.min(...entries.map((entry) => entry.indent))
  const abs = fileOf(sourceFile)
  const header = abs ? await headerFor(abs) : {}
  const caseId = header.testPointId ?? basename(abs || 'unknown').replace(/\.\w+$/, '')

  return entries
    .filter((entry) => entry.indent === minIndent)
    .map((entry) => {
      const message = typeof entry.yaml.error === 'string' ? entry.yaml.error : undefined
      const errorCode = !entry.ok ? nativeCodeFromMessage(message) : undefined
      const skipped = entry.ok && entry.yaml.skip !== undefined && entry.yaml.skip !== false
      const status: CaseStatus = entry.ok
        ? skipped
          ? 'skipped'
          : 'passed'
        : errorCode !== undefined
          ? caseStatusFromErrorCode(errorCode)
          : 'failed'
      const durationMs = typeof entry.yaml.duration_ms === 'number' ? entry.yaml.duration_ms : 0
      return {
        caseId,
        caseName: caseId,
        file: abs ? relOf(abs) : sourceFile,
        rowId: entry.name,
        rowIndex: 0,
        status,
        steps: [
          {
            index: 1,
            target,
            action: 'test',
            status: status === 'passed' ? 'passed' : status === 'skipped' ? 'skipped' : 'failed',
            durationMs,
            error: message,
            errorCode,
          } satisfies StepResult,
        ],
        startedAt: '',
        finishedAt: '',
        durationMs,
        ...(message && !entry.ok ? { error: message } : {}),
        ...(errorCode ? { errorCode } : {}),
      } satisfies CaseResult
    })
}

/** 成功和失败各留一张图;其它状态删掉钩子可能已经写下的文件。 */
async function bindShots(
  cases: CaseResult[],
  opts: { shotsDir?: string; runId: string; root: string },
): Promise<void> {
  if (!opts.shotsDir) return
  await mkdir(opts.shotsDir, { recursive: true })
  const namer = createShotNamer()
  for (const item of cases) {
    if (item.status === 'skipped') continue
    const fileName = namer(item.file, item.rowId ?? item.caseName)
    const dest = join(opts.shotsDir, fileName)
    const step = item.steps[0]
    const keep = item.status === 'passed' || item.status === 'failed'
    if (!keep) {
      if (step) delete step.screenshot
      await rm(dest, { force: true })
      continue
    }
    const source = step?.screenshot
    if (source && !source.replace(/\\/g, '/').startsWith('shots/')) {
      const from = isAbsolute(source) ? source : resolve(opts.root, source)
      if (from !== dest && (await fileExists(from))) await copyFile(from, dest)
    }
    if (step && (await fileExists(dest))) step.screenshot = `shots/${opts.runId}/${fileName}`
    else if (step?.screenshot) delete step.screenshot
  }
}

async function fileExists(file: string): Promise<boolean> {
  const info = await stat(file).catch(() => undefined)
  return Boolean(info?.isFile())
}

/**
 * 失败用例的 trace.zip 复制进 run 目录 traces/(Playwright 原生放在 test-results/,重跑会清空)。
 * 复制后 trace 字段改写为相对 run 目录路径;文件缺失(未失败/被清理)时去掉引用,不留死链。
 */
async function bindTraces(
  cases: CaseResult[],
  opts: { tracesDir?: string },
): Promise<void> {
  if (!opts.tracesDir) return
  await mkdir(opts.tracesDir, { recursive: true })
  const namer = createArtifactNamer()
  for (const item of cases) {
    const source = item.trace
    if (!source) continue
    const dest = join(opts.tracesDir, namer(item.file, item.rowId ?? item.caseName, 'zip'))
    const from = isAbsolute(source) ? source : resolve(source)
    if (from !== dest && (await fileExists(from))) {
      await copyFile(from, dest)
      item.trace = `traces/${basename(dest)}`
    } else {
      delete item.trace
    }
  }
}

/**
 * 失败用例的 video 复制进 run 目录 videos/(同样防 test-results/ 重跑清空)。
 * video 由业务项目 playwright.config 的 use.video='retain-on-failure' 开启,不开则无附件、零成本。
 */
async function bindVideos(
  cases: CaseResult[],
  opts: { videosDir?: string },
): Promise<void> {
  if (!opts.videosDir) return
  await mkdir(opts.videosDir, { recursive: true })
  const namer = createArtifactNamer()
  for (const item of cases) {
    const source = item.video
    if (!source) continue
    const from = isAbsolute(source) ? source : resolve(source)
    const ext = extname(from).slice(1) || 'webm'
    const dest = join(opts.videosDir, namer(item.file, item.rowId ?? item.caseName, ext))
    if (from !== dest && (await fileExists(from))) {
      await copyFile(from, dest)
      item.video = `videos/${basename(dest)}`
    } else {
      delete item.video
    }
  }
}

/**
 * run 目录内不重名的产物命名:脚本名--数据行(--序号).<ext>,
 * 同类产物之间防冲突;traces/videos 各用一份实例,计数互不干扰。
 */
function createArtifactNamer(): (scriptFile: string, rowId: string, ext: string) => string {
  // 控制字符范围是文件名清洗的必要部分(Windows 文件名合法字符表)
  // eslint-disable-next-line no-control-regex
  const INVALID = /[<>:"/\\|?*\u0000-\u001f]/g
  const counts = new Map<string, number>()
  return (scriptFile, rowId, ext) => {
    const base = basename(scriptFile).replace(/\.[^.]+$/, '')
    const raw = `${base}--${rowId}`.replace(INVALID, '_').slice(0, 140)
    const n = (counts.get(raw) ?? 0) + 1
    counts.set(raw, n)
    const stem = n === 1 ? raw : `${raw}--${n}`
    return `${stem}.${ext.replace(/^\./, '')}`
  }
}

const OBSERVATION_LIMIT = 200

/**
 * JSON reporter 的 buffer 附件 body 恒为 base64(fixtures.ts 传 string 也会被内部转 Buffer)。
 * 明文 JSON(首字符 [ { 空白)直接用;base64 先解码——两种形态都吃,坏数据交 parseObservationList 兜底。
 */
function decodeAttachmentBody(body: string): string {
  if (/^[\s[{]/.test(body)) return body
  try {
    return Buffer.from(body, 'base64').toString('utf8')
  } catch {
    return body
  }
}

/** fixtures.ts 的观测附件是 JSON 数组;逐条归一,坏数据整条跳过,不因观测数据让 ingest 失败。 */
function parseObservationList<T>(
  body: string,
  from: (raw: unknown) => T | undefined,
): T[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeAttachmentBody(body))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const list: T[] = []
  for (const raw of parsed.slice(0, OBSERVATION_LIMIT)) {
    const entry = from(raw)
    if (entry) list.push(entry)
  }
  return list
}

function consoleEntryFrom(raw: unknown): ConsoleEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as { level?: unknown; text?: unknown }
  if (typeof record.text !== 'string') return undefined
  return {
    level: typeof record.level === 'string' ? record.level.slice(0, 40) : 'log',
    text: record.text.slice(0, 500),
  }
}

function networkEntryFrom(raw: unknown): NetworkEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as { method?: unknown; url?: unknown; status?: unknown; durationMs?: unknown }
  if (typeof record.url !== 'string') return undefined
  return {
    method: typeof record.method === 'string' ? record.method.slice(0, 16) : 'GET',
    url: record.url.slice(0, 500),
    status: typeof record.status === 'number' ? record.status : 0,
    ...(typeof record.durationMs === 'number' && record.durationMs >= 0
      ? { durationMs: Math.round(record.durationMs) }
      : {}),
  }
}

function parseTapEntries(text: string): TapEntry[] {
  const lines = text.split(/\r?\n/)
  const entries: TapEntry[] = []
  for (let i = 0; i < lines.length; i++) {
    // `ok/not ok N - name`;前面的 `# Subtest: name` 注释不作为权威来源
    const match = /^(\s*)(not ok|ok) \d+ - (.+)$/.exec(lines[i] ?? '')
    if (!match) continue
    const indent = match[1]!.length
    const ok = match[2] === 'ok'
    const yaml: Record<string, string | boolean | number> = {}
    if ((lines[i + 1] ?? '').trim() === '---') {
      i += 2
      let blockKey: string | undefined
      while (i < lines.length && (lines[i] ?? '').trim() !== '...') {
        const raw = lines[i] ?? ''
        const kv = /^ {2}([A-Za-z_]+): ?(.*)$/.exec(raw.slice(indent))
        if (kv) {
          blockKey = kv[1]!
          const value = kv[2]!.trim()
          if (value === '|-' || value === '|' || value === '|+') {
            yaml[blockKey] = '' // 多行块,后续更深层缩进的行聚合进来
          } else if (value !== '') {
            yaml[blockKey] = parseTapScalar(value)
            blockKey = undefined
          }
        } else if (blockKey !== undefined && raw.trim() !== '') {
          yaml[blockKey] = `${yaml[blockKey] === '' ? '' : `${yaml[blockKey]}\n`}${raw.trim()}`
        }
        i++
      }
    }
    entries.push({ indent, name: match[3]!.trim(), ok, yaml })
  }
  return entries
}

function parseTapScalar(value: string): string | boolean | number {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'")
  }
  const num = Number(value)
  return Number.isNaN(num) ? value : num
}
