import { createWriteStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { RUNS_DIR, type RunSummary } from '@testpilot/core'
import { buildNativeRunSummary } from '@testpilot/reporter'
import { resolveRoot, type ProjectOptions } from './project'
import { allocateRunId } from './runs'

/** 用例正文使用的执行端。每个端只跑自己的测试框架。 */
export type NativeTarget = 'web' | 'miniapp' | 'api'

export const NATIVE_CASE_DIRS: Record<NativeTarget, string> = {
  web: 'tests/e2e/web',
  miniapp: 'tests/e2e/miniapp',
  api: 'tests/e2e/api',
}

const TARGETS: readonly NativeTarget[] = ['api', 'web', 'miniapp']

const FILE_PATTERN: Record<NativeTarget, RegExp> = {
  web: /\.spec\.(?:[cm]?js|ts)$/,
  miniapp: /\.test\.(?:[cm]?js|ts)$/,
  api: /\.test\.(?:[cm]?js|ts)$/,
}

export interface NativeCommand {
  target: NativeTarget
  files: string[]
  command: string
  args: string[]
  shell: boolean
}

export interface NativeRunResult {
  files: string[]
  /** 未启用 ingest 时只有 passed/failed;启用后为归一汇总的 run 状态 */
  status: 'passed' | 'failed' | 'blocked' | 'inconclusive' | 'skipped'
  exitCode: number
  /** 启用 ingest 时返回:runId / run 目录(绝对路径) / 归一汇总(已写 result.json) */
  runId?: string
  runDir?: string
  summary?: RunSummary
}

export interface NativeProcessResult {
  code: number
  /** node:test 的 TAP 原文;调用方归一进 result.json,不写 *.tap */
  stdout: string
}

export interface NativeSpawnOutput {
  /** Web:把 JSON reporter 的 stdout 写到这个文件 */
  stdoutPath?: string
  /** 小程序 / API:把 TAP 留在返回值里,不写文件 */
  captureStdout?: boolean
}

export type NativeSpawn = (
  command: NativeCommand,
  cwd: string,
  output?: NativeSpawnOutput,
  signal?: AbortSignal,
) => Promise<NativeProcessResult>

/** 按路径判断脚本属于哪个端;不在三个目录里、或扩展名不对时返回 undefined。 */
export function targetForNativeFile(file: string): NativeTarget | undefined {
  const normalized = file.replace(/\\/g, '/')
  for (const target of TARGETS) {
    const dir = `/${NATIVE_CASE_DIRS[target]}/`
    const marker = normalized.startsWith(`${NATIVE_CASE_DIRS[target]}/`) || normalized.includes(dir)
    if (marker && FILE_PATTERN[target].test(normalized)) return target
  }
  return undefined
}

/** 把已发现的脚本按端分组,生成该端框架自己的启动命令。node:test 逐文件 spawn(单文件隔离,崩溃不拖垮其他文件)。 */
export function planNativeCommands(files: readonly string[], nodeExec = process.execPath): NativeCommand[] {
  const groups = new Map<NativeTarget, string[]>()
  for (const file of files) {
    const target = targetForNativeFile(file)
    if (!target) continue
    const list = groups.get(target) ?? []
    list.push(file)
    groups.set(target, list)
  }

  const commands: NativeCommand[] = []
  for (const target of TARGETS) {
    const group = groups.get(target)
    if (!group) continue
    if (target === 'web') {
      commands.push({
        target,
        files: group,
        command: 'npx',
        args: ['playwright', 'test', ...group],
        shell: process.platform === 'win32',
      })
      continue
    }
    for (const file of group) {
      commands.push({
        target,
        files: [file],
        command: nodeExec,
        args: ['--test', ...(file.endsWith('.ts') ? ['--experimental-strip-types'] : []), file],
        shell: false,
      })
    }
  }
  return commands
}

/** ingest 时给 web 指定 JSON reporter;node:test 的 tap 是默认 reporter,无需参数 */
function withReporterArgs(command: NativeCommand, ingest: boolean): NativeCommand {
  if (!ingest || command.target !== 'web') return command
  return { ...command, args: [...command.args, '--reporter=json'] }
}

/** 收集原生脚本。paths 为空时扫描三个约定目录;目录会递归展开。 */
export async function collectNativeCases(paths: readonly string[] = [], options: ProjectOptions = {}): Promise<string[]> {
  const root = resolveRoot(options.root)
  const inputs = paths.length > 0 ? paths.map((file) => resolve(root, file)) : TARGETS.map((target) => join(root, NATIVE_CASE_DIRS[target]))
  const files: string[] = []
  for (const input of inputs) {
    files.push(...(await collectPath(input)))
  }
  return [...new Set(files)].filter((file) => targetForNativeFile(relative(root, file)) !== undefined).sort()
}

async function collectPath(input: string): Promise<string[]> {
  const info = await readdir(input, { withFileTypes: true }).catch(() => undefined)
  if (!info) {
    // 显式文件路径:文件必须真实存在(不存在的 .test.ts 文件名不能算可执行用例)
    if (!isNativeFile(input)) return []
    return (await stat(input).then(() => true).catch(() => false)) ? [input] : []
  }
  const found: string[] = []
  for (const entry of info) {
    const full = join(input, entry.name)
    if (entry.isDirectory()) found.push(...(await collectPath(full)))
    else if (isNativeFile(full)) found.push(full)
  }
  return found
}

function isNativeFile(file: string): boolean {
  return targetForNativeFile(file) !== undefined || FILE_PATTERN.web.test(file) || FILE_PATTERN.miniapp.test(file)
}

/**
 * 把脚本交给对应框架执行,不经过 YAML 步骤翻译。
 * Web 使用项目里的 Playwright Test;小程序和 API 使用 node:test,脚本内自行 import 官方库。
 * 启用 ingest 时:分配 runId,各端结构化输出落 run 目录,归一成 result.json(与 YAML run 同形态),
 * 退出码按三态契约(failed/inconclusive → 1,blocked → 2)。
 */
export async function runNativeCases(
  options: ProjectOptions & {
    paths?: readonly string[]
    spawnImpl?: NativeSpawn
    ingest?: boolean
    /** 外部指定 runId(Server 先行落库时使用);缺省时自动分配 */
    runId?: string
    /** 取消信号:abort 后当前框架命令被终止,后续命令不再启动 */
    signal?: AbortSignal
  } = {},
): Promise<NativeRunResult> {
  const root = resolveRoot(options.root)
  const files = await collectNativeCases(options.paths, { root })
  if (files.length === 0) return { files, status: 'passed', exitCode: 0 }

  const startedAt = new Date()
  let runId: string | undefined
  let runDir: string | undefined
  if (options.ingest) {
    runId = options.runId ?? (await allocateRunId({ root }))
    runDir = join(root, RUNS_DIR, runId)
    await mkdir(runDir, { recursive: true })
  }

  const spawnImpl = options.spawnImpl ?? defaultSpawn
  const playwrightJsonPath = runDir ? join(runDir, 'playwright.json') : undefined
  const nodeTestTaps: Array<{ text: string; target: 'miniapp' | 'api'; file: string }> = []
  let exitCode = 0
  for (const base of planNativeCommands(files)) {
    if (options.signal?.aborted) break
    const command = withReporterArgs(base, runDir !== undefined)
    // Web 仍把 JSON reporter 的 stdout 落到 playwright.json。小程序和 API 的 TAP 只留在内存里。
    const captured = await spawnImpl(
      command,
      root,
      {
        stdoutPath: runDir && command.target === 'web' ? playwrightJsonPath : undefined,
        captureStdout: Boolean(runDir) && command.target !== 'web',
      },
      options.signal,
    )
    if (runDir && command.target !== 'web') {
      nodeTestTaps.push({ text: captured.stdout, target: command.target, file: command.files[0]! })
    }
    if (captured.code !== 0) exitCode = captured.code
  }

  if (!runDir || !runId) {
    return { files, status: exitCode === 0 ? 'passed' : 'failed', exitCode }
  }

  const summary = await buildNativeRunSummary({
    runId,
    startedAt,
    root,
    files,
    // 输出文件缺失(端失败未产出)时 ingest 内部按空归一,不硬卡
    playwrightJsonPath,
    nodeTestTaps,
  })
  await writeFile(join(runDir, 'result.json'), JSON.stringify(summary, null, 2), 'utf8')
  // 三态退出码契约:failed/inconclusive → 1,blocked → 2(与 run.ts 的 exitCodeForSummary 对齐)
  exitCode = summary.status === 'failed' || summary.status === 'inconclusive' ? 1 : summary.status === 'blocked' ? 2 : 0
  return { files, status: summary.status, exitCode, runId, runDir, summary }
}

function defaultSpawn(
  _command: NativeCommand,
  cwd: string,
  output?: NativeSpawnOutput,
  signal?: AbortSignal,
): Promise<NativeProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const file = output?.stdoutPath ? createWriteStream(output.stdoutPath) : undefined
    const chunks: Buffer[] = []
    const capture = Boolean(output?.stdoutPath) || Boolean(output?.captureStdout)
    const child = spawn(_command.command, _command.args, {
      cwd,
      stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
      shell: _command.shell,
      signal,
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      file?.write(chunk)
      if (output?.captureStdout) chunks.push(chunk)
    })
    child.once('error', (err) => {
      file?.end()
      reject(err)
    })
    child.once('exit', (code) => {
      file?.end()
      resolvePromise({ code: code ?? 1, stdout: Buffer.concat(chunks).toString('utf8') })
    })
  })
}

export function isYamlCasePath(file: string): boolean {
  return /\.ya?ml$/i.test(file)
}
