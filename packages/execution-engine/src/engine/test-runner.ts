import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { RESULT_FILE, type RunSummary } from '@testpilot/core'
import type { TestCase } from '@testpilot/dsl'
import { ArtifactManager } from '../artifacts'
import { EventBus, ndjsonSubscriber, type RunEventSubscriber } from '../events'
import { allocateRunId, ensureRunDir } from '../lifecycle'
import { runSequential } from '../scheduler'
import type { AdapterResolver } from './adapter-resolver'
import { ExecutionEngine } from './execution-engine'
import { buildRunSummary } from './result-collector'

export interface TestCaseInput {
  data: TestCase
  file: string
}

export interface TestRunnerOptions {
  resolver: AdapterResolver
  /** 运行产物根目录,默认 <cwd>/.testpilot/artifacts/runs */
  runsRoot?: string
  /** 额外的事件订阅者(CLI 控制台输出) */
  onEvent?: RunEventSubscriber
}

/** 编排一次运行:分配 runId -> 逐用例执行 -> 汇总写盘 -> 关闭 adapter */
export class TestRunner {
  private readonly resolver: AdapterResolver
  private readonly runsRoot: string
  private readonly extraSubscriber: RunEventSubscriber | undefined

  constructor(options: TestRunnerOptions) {
    this.resolver = options.resolver
    this.runsRoot = resolve(options.runsRoot ?? join(process.cwd(), '.testpilot', 'artifacts', 'runs'))
    this.extraSubscriber = options.onEvent
  }

  async run(cases: readonly TestCaseInput[]): Promise<RunSummary> {
    const startedAt = new Date()
    const runId = await allocateRunId(this.runsRoot)
    const runDir = await ensureRunDir(this.runsRoot, runId)
    const artifacts = new ArtifactManager(runDir)
    await artifacts.prepare()

    const bus = new EventBus()
    bus.subscribe(ndjsonSubscriber(join(runDir, 'events.ndjson')))
    if (this.extraSubscriber) bus.subscribe(this.extraSubscriber)

    await bus.emit({ type: 'run-started', runId, totalCases: cases.length, ts: startedAt.toISOString() })
    await artifacts.logger.info(`run ${runId} started with ${cases.length} case(s)`)

    const engine = new ExecutionEngine()
    const results = await runSequential(cases, (item) =>
      engine.runCase(item.data, {
        runId,
        file: item.file,
        artifacts,
        bus,
        resolver: this.resolver,
      }),
    )

    await this.resolver.closeAll()
    const summary = buildRunSummary(runId, startedAt, results)
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
