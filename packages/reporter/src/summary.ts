import type { RunSummary } from '@testpilot/core'

/** 报告用的摘要视图 */
export interface ReportSummaryView {
  runId: string
  status: string
  durationMs: number
  cases: { templates: number; passed: number; failed: number; skipped: number; warnings: number }
  steps: { total: number; passed: number; failed: number; skipped: number; warning: number }
}

export function toSummaryView(summary: RunSummary): ReportSummaryView {
  return {
    runId: summary.runId,
    status: summary.status,
    durationMs: summary.durationMs,
    cases: {
      templates: summary.totals.templates ?? summary.totals.cases,
      passed: summary.totals.passed,
      failed: summary.totals.failed,
      skipped: summary.totals.skipped ?? 0,
      warnings: summary.totals.warnings ?? 0,
    },
    steps: {
      total: summary.totals.steps,
      passed: summary.totals.stepsPassed,
      failed: summary.totals.stepsFailed,
      skipped: summary.totals.stepsSkipped,
      warning: summary.totals.stepsWarning ?? 0,
    },
  }
}
