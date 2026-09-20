import { TestPilotClient } from '@testpilot/sdk'
import { AnalysisAgent } from './agents/analysis-agent'
import { PlannerAgent } from './agents/planner-agent'
import type { AgentEventHandler, AgentJobInput, AgentJobResult } from './types'

export interface TestPilotAIOptions {
  /** 业务项目根目录(绝对路径);与 Server project.rootPath 一致 */
  root: string
  client?: TestPilotClient
  onEvent?: AgentEventHandler
}

/**
 * TestPilot AI —— 两层 Agent 门面:
 *
 * ```text
 * TestPilot AI
 *        │
 * ┌──────┴──────┐
 * │             │
 * Planner     Analysis
 * 规划测试任务   分析测试结果
 * │             │
 * └──────┬──────┘
 *        ↓
 * TestPilot Skill
 *        ↓
 * TestPilot SDK
 *        ↓
 * Execution Engine
 * ```
 *
 * 不直连 Playwright / WeChatIDE;Case 写入业务工作区,团队 Index 仍需 push + sync-metadata。
 */
export class TestPilotAI {
  private readonly client: TestPilotClient
  private readonly onEvent: AgentEventHandler
  private readonly planner: PlannerAgent
  private readonly analysis: AnalysisAgent

  constructor(options: TestPilotAIOptions) {
    this.client = options.client ?? new TestPilotClient({ root: options.root })
    this.onEvent = options.onEvent ?? (() => undefined)
    this.planner = new PlannerAgent(this.client)
    this.analysis = new AnalysisAgent(this.client)
  }

  /** 完整编排:Planner → (可选 run) → Analysis */
  async run(input: AgentJobInput): Promise<AgentJobResult> {
    const emit: AgentEventHandler = (event) => this.onEvent(event)
    const ctx = { emit, signal: input.signal }
    const nextStepsBase = [
      '在业务项目中补齐真实 locator / 断言(Evidence-first)',
      'git add + commit 新 Case',
      'git push 后由 CI 执行 npx csspilot sync-metadata',
      'Web Case Index 才会出现该用例(Server 不是 Case 的 Source of Truth)',
    ]

    emit({
      type: 'job-started',
      ts: iso(),
      message: 'TestPilot AI 开始编排(Planner + Analysis)',
      data: {
        root: this.client.root,
        runAfterCreate: !!input.runAfterCreate,
        agents: ['planner', 'analysis'],
      },
    })

    try {
      if (input.signal?.aborted) {
        return cancelledResult(nextStepsBase)
      }

      const planned = await this.planner.plan(
        {
          prompt: input.prompt,
          overwrite: input.overwrite,
          file: input.file,
          runAfterCreate: input.runAfterCreate,
        },
        ctx,
      )

      if (planned.status === 'cancelled' || input.signal?.aborted) {
        emit({ type: 'job-finished', ts: iso(), message: '任务已取消', data: { status: 'cancelled' } })
        return cancelledResult(nextStepsBase)
      }

      if (planned.status === 'failed' && !planned.runId) {
        emit({
          type: 'job-finished',
          ts: iso(),
          message: planned.message,
          data: { status: 'failed', agent: 'planner' },
        })
        return {
          status: 'failed',
          caseFile: planned.caseFile,
          caseId: planned.caseId,
          message: planned.message,
          nextSteps: nextStepsBase,
        }
      }

      const analysis = planned.runId
        ? await this.analysis.analyze(
            {
              runId: planned.runId,
              caseFile: planned.caseFile,
              caseId: planned.caseId,
              isDraft: planned.fromYamlBlock === false,
            },
            ctx,
          )
        : AnalysisAgent.skipped(planned.caseFile)

      if (!planned.runId) {
        emit({
          type: 'step',
          ts: iso(),
          message: analysis.summary,
          data: { agent: 'analysis', verdict: analysis.verdict },
        })
      }

      // 草稿未跑时,Analysis 建议合并进 nextSteps
      const nextSteps = mergeUnique(nextStepsBase, analysis.suggestions)

      // cancelled 已在上方提前返回,这里只剩 passed/failed
      const status: AgentJobResult['status'] = planned.status

      const message = `${planned.message}。${analysis.summary}`

      emit({
        type: 'job-finished',
        ts: iso(),
        message,
        data: {
          status,
          caseFile: planned.caseFile,
          caseId: planned.caseId,
          runId: planned.runId,
          verdict: analysis.verdict,
        },
      })

      return {
        status,
        caseFile: planned.caseFile,
        caseId: planned.caseId,
        runId: planned.runId,
        message,
        nextSteps,
        analysis,
      }
    } catch (err) {
      if (isCancelled(err) || input.signal?.aborted) {
        emit({ type: 'job-finished', ts: iso(), message: '任务已取消', data: { status: 'cancelled' } })
        return cancelledResult(nextStepsBase)
      }
      const message = err instanceof Error ? err.message : String(err)
      emit({ type: 'error', ts: iso(), message })
      emit({ type: 'job-finished', ts: iso(), message, data: { status: 'failed' } })
      return { status: 'failed', message, nextSteps: nextStepsBase }
    }
  }
}

/** @deprecated 使用 TestPilotAI;保留别名兼容 Server / 既有调用 */
export class TestPilotAgent extends TestPilotAI {}
export type TestPilotAgentOptions = TestPilotAIOptions

function iso(): string {
  return new Date().toISOString()
}

function isCancelled(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    ('cancelled' in err || (err as { name?: string }).name === 'AbortError')
  )
}

function cancelledResult(nextSteps: string[]): AgentJobResult {
  return { status: 'cancelled', message: 'Agent 任务已取消', nextSteps }
}

function mergeUnique(base: string[], extra: string[]): string[] {
  const seen = new Set(base)
  const out = [...base]
  for (const item of extra) {
    if (!seen.has(item)) {
      seen.add(item)
      out.push(item)
    }
  }
  return out
}
