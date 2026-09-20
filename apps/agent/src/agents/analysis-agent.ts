import type { RunSummary } from '@testpilot/core'
import type { TestPilotClient } from '@testpilot/sdk'
import { loadSkillContext } from '../skill/load-skill'
import { getReportTool, getRunTool } from '../tools'
import type { AgentToolContext, AnalysisReport } from '../types'

export interface AnalysisInput {
  runId: string
  /** Planner 写入的 Case,用于结论里点名 */
  caseFile?: string
  caseId?: string
  /** Planner 生成的占位草稿(非 yaml 代码块) */
  isDraft?: boolean
}

/**
 * Analysis Agent —— 分析测试结果:
 * 读 Skill 分析约定 → get_run / get_report → 归因与建议
 * 不修改 Case、不盲目重跑(遵循 analyze-result 工作流)。
 */
export class AnalysisAgent {
  constructor(private readonly client: TestPilotClient) {}

  async analyze(input: AnalysisInput, ctx: AgentToolContext): Promise<AnalysisReport> {
    ctx.emit({
      type: 'step',
      ts: iso(),
      message: 'Analysis Agent:分析测试结果',
      data: { agent: 'analysis', runId: input.runId },
    })

    await loadSkillContext(this.client.root, ctx)

    const summary = await getRunTool(this.client, ctx, input.runId)
    const report = await getReportTool(this.client, ctx, input.runId).catch(() => undefined)

    const failedCases = summary.cases.filter((item) => item.status === 'failed')
    const failedSteps = failedCases.flatMap((item) =>
      item.steps
        .filter((step) => step.status === 'failed')
        .map((step) => ({
          caseId: item.caseId,
          index: step.index,
          target: step.target,
          action: step.action,
          error: step.error,
          screenshot: step.screenshot,
        })),
    )

    const verdict = classify(summary, failedSteps, input.isDraft)
    const suggestions = buildSuggestions(verdict, input, failedSteps)
    const text = buildSummaryText(summary, verdict, failedSteps, input)

    ctx.emit({
      type: 'step',
      ts: iso(),
      message: text,
      data: {
        agent: 'analysis',
        verdict,
        failedStepCount: failedSteps.length,
        reportHtml: report?.html,
      },
    })

    return {
      runId: input.runId,
      verdict,
      summary: text,
      failedSteps,
      suggestions,
      reportHtml: report?.html,
      reportJson: report?.json,
      totals: summary.totals,
      status: summary.cancelled ? 'cancelled' : summary.status,
    }
  }

  /** 无 run 时的轻量说明(仅规划落盘、未执行) */
  static skipped(caseFile?: string): AnalysisReport {
    return {
      verdict: 'not-run',
      summary: caseFile
        ? `未执行运行:Case 已写入 ${caseFile}。补齐 locator 后再 run,或由 Analysis Agent 分析失败证据。`
        : '未执行运行,Analysis Agent 跳过。',
      failedSteps: [],
      suggestions: [
        '按页面/代码证据补齐 locator 与断言',
        'npx csspilot validate && npx csspilot run',
        '失败后再触发 Analysis(或勾选写入后立即 run)',
      ],
    }
  }
}

type FailedStep = AnalysisReport['failedSteps'][number]

function classify(
  summary: RunSummary,
  failedSteps: FailedStep[],
  isDraft?: boolean,
): AnalysisReport['verdict'] {
  if (summary.cancelled) return 'cancelled'
  if (summary.status === 'passed') return 'passed'
  if (isDraft) return 'draft-placeholder'
  const errors = failedSteps.map((step) => (step.error ?? '').toLowerCase()).join(' ')
  if (/timeout|timed out/.test(errors)) return 'timeout'
  if (/not found|locator|selector|no node|element/.test(errors)) return 'case-issue'
  if (/assert|expected|to contain|mismatch/.test(errors)) return 'case-issue'
  if (/adapter|devtools|browser|chromium|wechat/.test(errors)) return 'env-issue'
  return 'product-bug-or-unknown'
}

function buildSuggestions(
  verdict: AnalysisReport['verdict'],
  input: AnalysisInput,
  failedSteps: FailedStep[],
): string[] {
  const tips: string[] = []
  switch (verdict) {
    case 'passed':
      tips.push('结果通过:commit Case 后 push,CI sync-metadata 进入团队 Index')
      break
    case 'draft-placeholder':
    case 'case-issue':
      tips.push('优先视为 Case 问题:按截图/页面补 locator,改 Case 后 validate → run')
      tips.push('不要在未看 Evidence 时盲目重跑')
      break
    case 'env-issue':
      tips.push('检查 Adapter/环境:Playwright 浏览器、微信开发者工具、.env baseUrl')
      tips.push('npx csspilot doctor')
      break
    case 'timeout':
      tips.push('加大 wait / 确认页面已就绪;排除环境过慢')
      break
    case 'cancelled':
      tips.push('任务已取消,可重新提交 Agent Job')
      break
    default:
      tips.push('对照 report 中失败步骤的 screenshot / logs,区分产品 bug 与 Case 问题')
      tips.push('若为产品 bug:停止改 Case,带着证据报告')
  }
  if (input.caseFile) tips.push(`相关 Case 文件:${input.caseFile}`)
  if (failedSteps[0]?.screenshot) tips.push(`首张失败截图:${failedSteps[0].screenshot}`)
  tips.push('git push 后由 CI 执行 npx csspilot sync-metadata')
  return tips
}

function buildSummaryText(
  summary: RunSummary,
  verdict: AnalysisReport['verdict'],
  failedSteps: FailedStep[],
  input: AnalysisInput,
): string {
  const head = `Analysis: run ${summary.runId} → ${summary.status}(判定:${verdict})`
  if (failedSteps.length === 0) {
    return `${head};用例 ✓${summary.totals.passed}。${input.caseId ? `Case ${input.caseId}` : ''}`.trim()
  }
  const first = failedSteps[0]!
  return `${head};失败 ${failedSteps.length} 步,首个 ${first.caseId}#${first.index} ${first.target}/${first.action}${first.error ? ` — ${first.error}` : ''}`
}

function iso(): string {
  return new Date().toISOString()
}
