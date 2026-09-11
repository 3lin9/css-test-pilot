import { readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import {
  RUNS_DIR,
  RESULT_FILE,
  type RunSummary,
  type TestpilotConfig,
} from '@testpilot/core'
import type { TestCase } from '@testpilot/dsl'
import {
  AdapterResolver,
  TestRunner,
  allocateRunId as engineAllocateRunId,
  type RunEvent,
  type RunEventSubscriber,
} from '@testpilot/execution-engine'
import { playwrightAdapterFactory } from '@testpilot/adapter-playwright'
import { wechatideAdapterFactory } from '@testpilot/adapter-wechatide'
import { apiAdapterFactory } from '@testpilot/adapter-api'
import type { AdapterFactory } from '@testpilot/adapter-core'
import { collectCases, type CaseInfo } from './cases'
import { loadProjectConfig, resolveRoot, type ProjectOptions } from './project'

export interface RunOptions extends ProjectOptions {
  /** 用例文件或目录,默认按 testpilot.yaml 的 casesDir */
  paths?: readonly string[]
  /** 按标签过滤用例 */
  tag?: string
  /** 外部指定的 runId(Control Plane 先行落库时使用);缺省时自动分配 */
  runId?: string
  /** 运行事件订阅(进度回调 / Server 持久化) */
  onEvent?: RunEventSubscriber
  /** 取消信号:abort 后当前用例执行完即停止,未开始的用例不再执行 */
  signal?: AbortSignal
  /** 覆盖默认 adapter 注入(playwright + wechatide + api);测试与自定义运行环境使用 */
  adapters?: readonly AdapterFactory[]
  /** accountRef -> 凭据原文;Case 声明 accountRef 时注入为 ${account.*} 变量(值可为 JSON) */
  accounts?: Record<string, string>
}

export interface RunResult {
  summary: RunSummary
  /** 收集到但校验未通过、未执行的用例 */
  invalid: CaseInfo[]
  /** 被 --tag 过滤掉的用例数 */
  tagFiltered: number
  /** Case 声明了 accountRef 但 accounts 未提供对应条目的引用(仍会执行,${account.*} 保持字面量) */
  missingAccounts: string[]
}

export class RunError extends Error {
  readonly code: 'ENO_CASES' | 'EINVALID_CASES' | 'ENO_CONFIG'

  constructor(code: RunError['code'], message: string) {
    super(message)
    this.name = 'RunError'
    this.code = code
  }
}

/** V0.1 默认 adapter 组合:Playwright(Web)+ WeChatIDE(小程序)+ API(HTTP),按项目配置注册 */
export function createDefaultAdapters(config: TestpilotConfig): AdapterFactory[] {
  return [
    playwrightAdapterFactory({ baseUrl: config.web?.baseUrl }),
    wechatideAdapterFactory({
      projectPath: config.miniapp?.projectPath,
      cliPath: config.miniapp?.cliPath,
    }),
    apiAdapterFactory({ baseUrl: config.api?.baseUrl, timeoutMs: config.api?.timeoutMs }),
  ]
}

/** 按 yyyymmdd-NNN 规则分配下一个 runId(与引擎落盘目录一致;Control Plane 先行落库时使用) */
export async function allocateRunId(options: ProjectOptions = {}): Promise<string> {
  const base = runsRoot(options.root)
  return engineAllocateRunId(base)
}

/**
 * 执行一次运行:加载配置 -> 收集校验用例 -> TestRunner 编排执行。
 * 这是 CLI / Server / Agent 统一的运行入口。
 */
export async function runCases(options: RunOptions = {}): Promise<RunResult> {
  const root = resolveRoot(options.root)
  const config = await loadProjectConfig(root)

  // 输入路径相对项目根目录展开;未提供时按配置的 casesDir
  const inputs =
    options.paths && options.paths.length > 0
      ? options.paths.map((input) => (isAbsolute(input) ? input : join(root, input)))
      : [join(root, config.casesDir)]

  const cases = await collectCases(inputs, { root })
  if (cases.length === 0) {
    throw new RunError('ENO_CASES', `未找到用例文件(查找:${inputs.join(', ')})`)
  }

  const invalid = cases.filter((item) => !item.valid)
  const runnable = cases.filter(
    (item) =>
      item.valid &&
      item.case &&
      (!options.tag || (item.case.tags ?? []).includes(options.tag)),
  )
  const tagFiltered = cases.length - invalid.length - runnable.length

  if (runnable.length === 0) {
    throw new RunError(
      'EINVALID_CASES',
      invalid.length > 0 ? '所有用例校验失败,无可执行用例' : '没有匹配的用例',
    )
  }

  const factories = options.adapters ?? createDefaultAdapters(config)
  const resolver = new AdapterResolver()
  for (const factory of factories) resolver.register(factory)

  // 声明了 accountRef 但运行方未提供凭据的引用:不阻塞执行,返回给调用方告警
  const missingAccounts = [
    ...new Set(
      runnable
        .map((item) => item.case?.accountRef)
        .filter((ref): ref is string => !!ref && options.accounts?.[ref] === undefined),
    ),
  ]

  const runner = new TestRunner({
    resolver,
    runsRoot: join(root, RUNS_DIR),
    runId: options.runId,
    onEvent: options.onEvent,
    signal: options.signal,
    accounts: options.accounts,
  })
  const summary = await runner.run(
    runnable.map((item): { data: TestCase; file: string } => ({ data: item.case!, file: item.file })),
  )
  return { summary, invalid, tagFiltered, missingAccounts }
}

export interface RunMeta {
  runId: string
  /** run 产物目录(绝对路径) */
  dir: string
  /** result.json 缺失时为 unknown(运行中或异常中断) */
  status: RunSummary['status'] | 'unknown'
  cancelled?: boolean
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  totals?: RunSummary['totals']
}

function runsRoot(root?: string): string {
  return join(resolveRoot(root), RUNS_DIR)
}

/** 列出历史运行,按 runId 倒序(最近的在前) */
export async function listRuns(options: ProjectOptions = {}): Promise<RunMeta[]> {
  const base = runsRoot(options.root)
  const entries = await readdir(base).catch(() => [] as string[])
  const metas: RunMeta[] = []
  for (const entry of entries.filter((name) => /^\d{8}-\d{3}$/.test(name)).sort().reverse()) {
    metas.push({ ...(await readRunMeta(base, entry)), runId: entry, dir: join(base, entry) })
  }
  return metas
}

/** 最近一次运行 ID;没有任何运行记录时返回 undefined */
export async function latestRunId(options: ProjectOptions = {}): Promise<string | undefined> {
  const runs = await listRuns(options)
  return runs[0]?.runId
}

/** 读取一次运行的汇总结果(result.json);文件缺失时抛错 */
export async function getRun(runId: string, options: ProjectOptions = {}): Promise<RunSummary> {
  const base = runsRoot(options.root)
  const file = join(base, runId, RESULT_FILE)
  try {
    return JSON.parse(await readFile(file, 'utf8')) as RunSummary
  } catch {
    throw new RunError('ENO_CASES', `读取运行结果失败:${file}(运行未完成或 runId 不存在)`)
  }
}

/** 读取一次运行的完整事件流(events.ndjson) */
export async function getRunEvents(runId: string, options: ProjectOptions = {}): Promise<RunEvent[]> {
  const file = join(runsRoot(options.root), runId, 'events.ndjson')
  const source = await readFile(file, 'utf8').catch(() => '')
  return source
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RunEvent)
}

async function readRunMeta(base: string, runId: string): Promise<Omit<RunMeta, 'runId' | 'dir'>> {
  try {
    const summary = JSON.parse(
      await readFile(join(base, runId, RESULT_FILE), 'utf8'),
    ) as RunSummary
    return {
      status: summary.status,
      cancelled: summary.cancelled,
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      durationMs: summary.durationMs,
      totals: summary.totals,
    }
  } catch {
    return { status: 'unknown' }
  }
}
