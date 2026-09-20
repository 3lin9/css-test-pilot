import { TestPilotAI, type AgentEvent } from '@testpilot/agent'
import type { Db } from '../db'
import { insertAgentJobEvent, updateAgentJob } from '../repositories/agent-job-repo'
import type { ProjectRow } from '../services/project-service'

interface ActiveJob {
  controller: AbortController
  projectId: number
  promise: Promise<void>
}

/**
 * Agent Job 编排:在 project.rootPath 上跑 TestPilot AI(Planner + Analysis)。
 * 与 RunOrchestrator 同级;同一项目同时只允许一个 Agent Job。
 */
export class AgentOrchestrator {
  private readonly active = new Map<string, ActiveJob>()
  private readonly seq = new Map<string, number>()

  constructor(private readonly db: Db) {}

  isProjectBusy(projectId: number): boolean {
    for (const job of this.active.values()) {
      if (job.projectId === projectId) return true
    }
    return false
  }

  isRunning(jobId: string): boolean {
    return this.active.has(jobId)
  }

  start(
    jobId: string,
    project: ProjectRow,
    options: {
      prompt: string
      runAfterCreate?: boolean
      overwrite?: boolean
      file?: string
    },
  ): void {
    if (!project.rootPath) {
      void updateAgentJob(this.db, jobId, {
        status: 'failed',
        message: `项目 ${project.name} 未配置本地根目录,无法在工作区生成 Case`,
        finishedAt: new Date().toISOString(),
      })
      return
    }

    const controller = new AbortController()
    this.seq.set(jobId, 0)
    const root = project.rootPath

    const promise = (async () => {
      try {
        await updateAgentJob(this.db, jobId, { status: 'running' })
        const ai = new TestPilotAI({
          root,
          onEvent: (event: AgentEvent) => this.persistEvent(jobId, event),
        })
        const result = await ai.run({
          prompt: options.prompt,
          runAfterCreate: options.runAfterCreate,
          overwrite: options.overwrite,
          file: options.file,
          signal: controller.signal,
        })
        await updateAgentJob(this.db, jobId, {
          status: result.status,
          caseFile: result.caseFile ?? null,
          caseId: result.caseId ?? null,
          runId: result.runId ?? null,
          message: result.message,
          nextStepsJson: JSON.stringify(result.nextSteps),
          finishedAt: new Date().toISOString(),
        })
      } catch (err) {
        await updateAgentJob(this.db, jobId, {
          status: controller.signal.aborted ? 'cancelled' : 'failed',
          message: err instanceof Error ? err.message : String(err),
          finishedAt: new Date().toISOString(),
        })
      } finally {
        this.active.delete(jobId)
      }
    })()

    this.active.set(jobId, { controller, projectId: project.id, promise })
  }

  cancel(jobId: string): boolean {
    const running = this.active.get(jobId)
    if (!running) return false
    running.controller.abort()
    return true
  }

  async wait(jobId: string): Promise<void> {
    await this.active.get(jobId)?.promise
  }

  async waitAll(): Promise<void> {
    await Promise.all([...this.active.values()].map((job) => job.promise))
  }

  private persistEvent(jobId: string, event: AgentEvent): void {
    const next = (this.seq.get(jobId) ?? 0) + 1
    this.seq.set(jobId, next)
    void insertAgentJobEvent(this.db, {
      jobId,
      seq: next,
      type: event.type,
      payloadJson: JSON.stringify(event),
      ts: event.ts,
    })
  }
}
