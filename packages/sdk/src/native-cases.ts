import { createWriteStream, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { RUNS_DIR, SHOTS_DIR, exitCodeForRunStatus, type RunSummary } from '@testpilot/core'
import { buildNativeRunSummary } from '@testpilot/reporter'
import { shotHookPath } from '@testpilot/native'
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
  /** 命令超过时限被终止(避免挂死拖住整个 run/server) */
  timedOut?: boolean
}

export interface NativeSpawnOutput {
  /** Web:把 JSON reporter 的 stdout 写到这个文件 */
  stdoutPath?: string
  /** 小程序 / API:把 TAP 留在返回值里,不写文件 */
  captureStdout?: boolean
  /** 小程序钩子把截图写到这个目录 */
  shotsDir?: string
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

/**
 * 把已发现的脚本按端分组,生成该端框架自己的启动命令。node:test 逐文件 spawn(单文件隔离,崩溃不拖垮其他文件)。
 * Web 端用业务项目本地 @playwright/test 的 cli.js 直接以 node 启动(不经 npx 的 shell 包装:
 * Windows 下 shell 模式既会在路径含空格时断参,也无法安全转义用例路径里的 shell 元字符)。
 * resolvePlaywrightCli 只在有 web 用例时才调用:纯 api/miniapp 项目不要求安装 Playwright。
 */
export function planNativeCommands(
  files: readonly string[],
  nodeExec = process.execPath,
  resolvePlaywrightCli: () => string = () => resolvePlaywrightCliFor(process.cwd()),
): NativeCommand[] {
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
        command: nodeExec,
        args: [resolvePlaywrightCli(), 'test', ...group],
      })
      continue
    }
    for (const file of group) {
      commands.push({
        target,
        files: [file],
        command: nodeExec,
        args: ['--test', ...(file.endsWith('.ts') ? ['--experimental-strip-types'] : []), file],
      })
    }
  }
  return commands
}

/**
 * 定位业务项目本地安装的 @playwright/test CLI(cli.js,与包主入口同目录)。
 * 未安装时抛错并给出安装指引 —— 刻意不回退到 npx(shell 包装下用例路径无法安全转义)。
 */
export function resolvePlaywrightCliFor(cwd: string): string {
  try {
    const entry = createRequire(join(cwd, 'package.json')).resolve('@playwright/test')
    const cli = join(dirname(entry), 'cli.js')
    if (existsSync(cli)) return cli
  } catch {
    // 未安装 @playwright/test,落到下方统一报错
  }
  throw new Error('未找到 @playwright/test;请先在业务项目安装:npm i -D @playwright/test')
}

/** Windows 上 node --import 只接受 file URL,不接受盘符路径(路径由 @testpilot/native 按自身位置解析) */
const SHOT_HOOK = shotHookPath()

/** ingest 时:Web 开 JSON reporter、每条用例截图与失败 trace;小程序注入截图钩子。node:test 的 tap 仍是默认 reporter。 */
function withReporterArgs(command: NativeCommand, ingest: boolean): NativeCommand {
  if (!ingest) return command
  if (command.target === 'web') {
    // --trace=retain-on-failure:失败用例自动带 trace.zip(时间线/DOM 快照回放/网络/控制台),
    // ingest 复制进 run 目录 traces/,report --trace 一键回放。
    return { ...command, args: [...command.args, '--reporter=json', '--screenshot=on', '--trace=retain-on-failure'] }
  }
  if (command.target === 'miniapp') {
    return { ...command, args: ['--import', SHOT_HOOK, ...command.args] }
  }
  return command
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
    await mkdir(join(root, SHOTS_DIR, runId), { recursive: true })
  }

  const shotsDir = runId ? join(root, SHOTS_DIR, runId) : undefined

  const spawnImpl = options.spawnImpl ?? defaultSpawn
  // 只要有 web 用例才解析 Playwright CLI(从项目根的业务依赖解析);
  // 注入 spawnImpl(测试/编排)时不做真实解析,避免对执行环境的不必要依赖
  const playwrightCli = options.spawnImpl
    ? () => '<playwright-cli>'
    : () => resolvePlaywrightCliFor(root)
  const playwrightJsonPath = runDir ? join(runDir, 'playwright.json') : undefined
  const nodeTestTaps: Array<{ text: string; target: 'miniapp' | 'api'; file: string }> = []
  let exitCode = 0
  for (const base of planNativeCommands(files, process.execPath, playwrightCli)) {
    if (options.signal?.aborted) break
    const command = withReporterArgs(base, runDir !== undefined)
    // Web 仍把 JSON reporter 的 stdout 落到 playwright.json。小程序和 API 的 TAP 只留在内存里。
    const captured = await spawnImpl(
      command,
      root,
      {
        stdoutPath: runDir && command.target === 'web' ? playwrightJsonPath : undefined,
        captureStdout: Boolean(runDir) && command.target !== 'web',
        shotsDir: command.target === 'miniapp' ? shotsDir : undefined,
      },
      options.signal,
    )
    if (runDir && command.target !== 'web') {
      nodeTestTaps.push({ text: captured.stdout, target: command.target, file: command.files[0]! })
    }
    if (captured.timedOut) {
      console.error(`命令超时被终止(${Math.round(NATIVE_COMMAND_TIMEOUT_MS / 1000)}s):${command.target} ${command.files.join(', ')}`)
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
    shotsDir,
    tracesDir: runDir ? join(runDir, 'traces') : undefined,
    videosDir: runDir ? join(runDir, 'videos') : undefined,
  })
  await writeFile(join(runDir, 'result.json'), JSON.stringify(summary, null, 2), 'utf8')
  // 三态退出码契约(failed/inconclusive → 1,blocked → 2)唯一实现见 @testpilot/core
  exitCode = exitCodeForRunStatus(summary.status)
  return { files, status: summary.status, exitCode, runId, runDir, summary }
}

/** 单个框架命令的时限(挂死的浏览器/runner 不应拖住整个 run 与 server 退出);可用环境变量覆盖 */
const NATIVE_COMMAND_TIMEOUT_MS = Number(process.env.TESTPILOT_NATIVE_TIMEOUT_MS ?? 10 * 60_000)

/** 杀掉整棵进程树:abort/超时时只 SIGTERM 直接子进程会留下孤儿浏览器(cmd 包装下更是整树存活) */
function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    // POSIX 端子进程以 detached 独立进程组启动,负 pid 杀整组
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // 进程组已退出
    }
  }
}

function defaultSpawn(
  _command: NativeCommand,
  cwd: string,
  output?: NativeSpawnOutput,
  signal?: AbortSignal,
): Promise<NativeProcessResult> {
  return new Promise((resolvePromise) => {
    const chunks: Buffer[] = []
    const capture = Boolean(output?.stdoutPath) || Boolean(output?.captureStdout)
    const file = output?.stdoutPath ? createWriteStream(output.stdoutPath) : undefined
    // 写文件流失败(被占用/权限/杀毒扫描)不能击穿进程:丢输出但不丢运行
    let streamBroken = false
    file?.on('error', () => {
      streamBroken = true
    })

    const child = spawn(_command.command, _command.args, {
      cwd,
      stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
      // 一律不走 shell:命令与参数都是我们构造的绝对路径,shell 包装既可能断参也无法安全转义
      shell: false,
      signal,
      // POSIX 独立进程组:abort/超时可整组击杀;Windows 用 taskkill /T 杀树
      detached: process.platform !== 'win32',
      env: output?.shotsDir
        ? { ...process.env, TESTPILOT_SHOTS_DIR: output.shotsDir }
        : process.env,
    })

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid) killProcessTree(child.pid)
    }, NATIVE_COMMAND_TIMEOUT_MS)
    if (typeof timer.unref === 'function') timer.unref()
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        if (child.pid) killProcessTree(child.pid)
      },
      { once: true },
    )

    const settle = (code: number) => {
      clearTimeout(timer)
      file?.end()
      resolvePromise({
        code,
        stdout: Buffer.concat(chunks).toString('utf8'),
        ...(timedOut ? { timedOut: true } : {}),
      })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (!streamBroken) file?.write(chunk)
      if (output?.captureStdout) chunks.push(chunk)
    })
    child.once('error', (err) => {
      console.error(`启动命令失败(${_command.target}):${err.message}`)
      settle(1)
    })
    child.once('exit', (code) => {
      settle(code ?? 1)
    })
  })
}

export function isYamlCasePath(file: string): boolean {
  return /\.ya?ml$/i.test(file)
}
