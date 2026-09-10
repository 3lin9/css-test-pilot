import type { AdapterFactory } from '@testpilot/adapter-core'
import type { RunEvent } from '@testpilot/sdk'
import type { Db } from '../db'
import { insertRunEvent, updateRun } from '../repositories/run-repo'
import { clientFor, type ProjectRow } from '../services/project-service'

interface ActiveRun {
  controller: AbortController
  projectId: number
  promise: Promise<void>
}

export interface OrchestratorOptions {
  /** 注入自定义 adapter(测试);缺省用 SDK 默认组合(playwright + wechatide) */
  adapters?: readonly AdapterFactory[]
}

/**
 * V0.1 Run 编排器:执行路径固定为 run-service -> @testpilot/sdk -> Execution Engine。
 * 同一项目同时只允许一个活动运行,不做复杂调度。
 */
export class RunOrchestrator {
  private readonly active = new Map<string, ActiveRun>()
  private readonly seq = new Map<string, number>()

  constructor(
    private readonly db: Db,
    private readonly options: OrchestratorOptions = {},
  ) {}

  isProjectBusy(projectId: number): boolean {
    for (const run of this.active.values()) {
      if (run.projectId === projectId) return true
    }
    return false
  }

  isRunning(runId: string): boolean {
    return this.active.has(runId)
  }

  /** 启动一次运行(后台执行);调用方负责先把 run 行写入 running 状态 */
  start(
    runId: string,
    project: ProjectRow,
    options: { paths?: string[]; tag?: string },
  ): void {
    const controller = new AbortController()
    const client = clientFor(project)
    this.seq.set(runId, 0)

    const promise = (async () => {
      try {
        const { summary, invalid, tagFiltered } = await client.runCases({
          runId,
          paths: options.paths,
          tag: options.tag,
          signal: controller.signal,
          adapters: this.options.adapters,
          onEvent: (event: RunEvent) => this.persistEvent(runId, event),
        })
        await updateRun(this.db, runId, {
          status: summary.cancelled ? 'cancelled' : summary.status,
          finishedAt: summary.finishedAt,
          durationMs: summary.durationMs,
          totalsJson: JSON.stringify(summary.totals),
          message:
            invalid.length > 0 || tagFiltered > 0
              ? `${invalid.length} 个校验失败跳过,${tagFiltered} 个被 tag 过滤`
              : null,
        })
      } catch (err) {
        await updateRun(this.db, runId, {
          status: controller.signal.aborted ? 'cancelled' : 'failed',
          finishedAt: new Date().toISOString(),
          message: err instanceof Error ? err.message : String(err),
        })
      } finally {
        this.active.delete(runId)
      }
    })()

    this.active.set(runId, { controller, projectId: project.id, promise })
  }

  /** 取消运行;返回是否确实有活动运行被取消 */
  cancel(runId: string): boolean {
    const running = this.active.get(runId)
    if (!running) return false
    running.controller.abort()
    return true
  }

  /** 等待指定运行结束(测试与优雅退出用) */
  async wait(runId: string): Promise<void> {
    await this.active.get(runId)?.promise
  }

  async waitAll(): Promise<void> {
    await Promise.all([...this.active.values()].map((run) => run.promise))
  }

  private async persistEvent(runId: string, event: RunEvent): Promise<void> {
    const next = (this.seq.get(runId) ?? 0) + 1
    this.seq.set(runId, next)
    await insertRunEvent(this.db, {
      runId,
      seq: next,
      type: event.type,
      payloadJson: JSON.stringify(event),
      ts: event.ts,
    })
  }
}
