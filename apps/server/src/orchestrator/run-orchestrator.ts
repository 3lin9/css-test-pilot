import { runNativeCases, type NativeSpawn } from '@testpilot/sdk'
import type { Db } from '../db'
import { updateRun } from '../repositories/run-repo'
import type { ProjectRow } from '../services/project-service'

interface ActiveRun {
  controller: AbortController
  projectId: number
  promise: Promise<void>
}

export interface OrchestratorOptions {
  /** 注入自定义 spawn(测试);缺省真实 spawn 各端框架命令 */
  spawnImpl?: NativeSpawn
}

/**
 * Run 编排器:执行路径固定为 run-service -> @testpilot/sdk -> 各端原生 runner(ingest 归一)。
 * 同一项目同时只允许一个活动运行,不做复杂调度。
 */
export class RunOrchestrator {
  private readonly active = new Map<string, ActiveRun>()

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

  /** 启动一次运行(后台执行);调用方负责先把 run 行写入 running 状态并分配 runId */
  start(
    runId: string,
    project: ProjectRow,
    options: { paths?: string[]; signal?: AbortSignal },
  ): void {
    const controller = new AbortController()
    // 外部取消信号(如进程退出)联动到本次运行
    options.signal?.addEventListener('abort', () => controller.abort(), { once: true })

    const promise = (async () => {
      try {
        const result = await runNativeCases({
          root: project.rootPath ?? undefined,
          runId,
          paths: options.paths,
          ingest: true,
          signal: controller.signal,
          spawnImpl: this.options.spawnImpl,
        })
        if (controller.signal.aborted) {
          // 取消优先于结果:被取消的运行即使部分完成也标记 cancelled
          await updateRun(this.db, runId, {
            status: 'cancelled',
            finishedAt: new Date().toISOString(),
            message: '运行中被取消',
          })
          return
        }
        await updateRun(this.db, runId, {
          status: result.summary?.status ?? (result.exitCode === 0 ? 'passed' : 'failed'),
          finishedAt: new Date().toISOString(),
          durationMs: result.summary?.durationMs,
          totalsJson: result.summary ? JSON.stringify(result.summary.totals) : null,
          message: null,
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
}
