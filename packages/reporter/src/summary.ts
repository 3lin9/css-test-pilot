import type { RunSummary } from '@testpilot/core'

/** 报告用的摘要视图 */
export interface ReportSummaryView {
  runId: string
  status: string
  durationMs: number
  cases: { passed: number; failed: number }
  steps: { total: number; passed: number; failed: number; skipped: number }
}

export function toSummaryView(summary: RunSummary): ReportSummaryView {
  return {
    runId: summary.runId,
    status: summary.status,
    durationMs: summary.durationMs,
    cases: { passed: summary.totals.passed, failed: summary.totals.failed },
    steps: {
      total: summary.totals.steps,
      passed: summary.totals.stepsPassed,
      failed: summary.totals.stepsFailed,
      skipped: summary.totals.stepsSkipped,
    },
  }
}
