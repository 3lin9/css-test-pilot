import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { RESULT_FILE, type CaseResult, type RunSummary } from '@testpilot/core'
import type { TestCase } from '@testpilot/dsl'
import { ArtifactManager } from '../artifacts'
import { EventBus, ndjsonSubscriber, type RunEventSubscriber } from '../events'
import { allocateRunId, ensureRunDir } from '../lifecycle'
import type { AdapterResolver } from './adapter-resolver'
import { ExecutionEngine } from './execution-engine'
import { buildRunSummary } from './result-collector'

export interface TestCaseInput {
  data: TestCase
  file: string
  templateId?: string
  rowId?: string
  rowIndex?: number
  initialVariables?: Record<string, string>
  missingDependencies?: string[]
}

export interface TestRunnerOptions {
  resolver: AdapterResolver
  /** 运行产物根目录,默认 <cwd>/.testpilot/artifacts/runs */
  runsRoot?: string
  /** 外部指定的 runId(如 Control Plane 先行落库);缺省时按 yyyymmdd-NNN 自动分配 */
  runId?: string
  /** 额外的事件订阅者(CLI 控制台输出) */
  onEvent?: RunEventSubscriber
  /** 取消信号:abort 后当前用例执行完即停止,未开始的用例不再执行 */
  signal?: AbortSignal
  /** accountRef -> 凭据原文;用例声明 accountRef 时注入为 ${account.*} 变量 */
  accounts?: Record<string, string>
}

/** 编排一次运行:分配 runId -> 逐用例执行 -> 汇总写盘 -> 关闭 adapter */
export class TestRunner {
  private readonly resolver: AdapterResolver
  private readonly runsRoot: string
  private readonly customRunId: string | undefined
  private readonly extraSubscriber: RunEventSubscriber | undefined
  private readonly signal: AbortSignal | undefined
  private readonly accounts: Record<string, string> | undefined

  constructor(options: TestRunnerOptions) {
    this.resolver = options.resolver
    this.runsRoot = resolve(options.runsRoot ?? join(process.cwd(), '.testpilot', 'artifacts', 'runs'))
    this.customRunId = options.runId
    this.extraSubscriber = options.onEvent
    this.signal = options.signal
    this.accounts = options.accounts
  }

  async run(cases: readonly TestCaseInput[]): Promise<RunSummary> {
    const startedAt = new Date()
    const runId = this.customRunId ?? (await allocateRunId(this.runsRoot))
    const runDir = await ensureRunDir(this.runsRoot, runId)
    const artifacts = new ArtifactManager(runDir)
    await artifacts.prepare()

    const bus = new EventBus()
    bus.subscribe(ndjsonSubscriber(join(runDir, 'events.ndjson')))
    if (this.extraSubscriber) bus.subscribe(this.extraSubscriber)

    await bus.emit({ type: 'run-started', runId, totalCases: cases.length, ts: startedAt.toISOString() })
    await artifacts.logger.info(`run ${runId} started with ${cases.length} case(s)`)

    const engine = new ExecutionEngine()
    const results: CaseResult[] = []
    for (const item of cases) {
      if (this.signal?.aborted) {
        await artifacts.logger.info(`run ${runId} cancelled before case ${item.data.id}`)
        break
      }
      results.push(
        await engine.runCase(item.data, {
          runId,
          file: item.file,
          templateId: item.templateId ?? item.data.id,
          rowId: item.rowId ?? 'default',
          rowIndex: item.rowIndex ?? 0,
          initialVariables: item.initialVariables ?? {},
          missingDependencies: item.missingDependencies ?? [],
          artifacts,
          bus,
          resolver: this.resolver,
          accounts: this.accounts,
        }),
      )
    }
    // 取消请求可能在最后一个用例执行期间到达,循环内不一定检查到
    const cancelled = this.signal?.aborted === true

    await this.resolver.closeAll()
    const templates = new Set(cases.map((item) => item.templateId ?? item.data.id)).size
    const summary = buildRunSummary(runId, startedAt, results, { cancelled, templates })
    await bus.emit({
      type: 'run-finished',
      runId,
      status: summary.status,
      totals: { cases: summary.totals.cases, passed: summary.totals.passed, failed: summary.totals.failed },
      ts: new Date().toISOString(),
    })
    await artifacts.logger.info(`run ${runId} finished: ${summary.status}`)

    await writeFile(join(runDir, RESULT_FILE), JSON.stringify(summary, null, 2), 'utf8')
    return summary
  }
}
