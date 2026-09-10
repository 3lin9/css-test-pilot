import type { CaseResult, RunSummary } from '@testpilot/core'

/** 汇总用例结果为 RunSummary */
export function buildRunSummary(runId: string, startedAt: Date, cases: CaseResult[]): RunSummary {
  const finishedAt = new Date()
  const totals = {
    cases: cases.length,
    passed: cases.filter((item) => item.status === 'passed').length,
    failed: cases.filter((item) => item.status === 'failed').length,
    steps: 0,
    stepsPassed: 0,
    stepsFailed: 0,
    stepsSkipped: 0,
  }
  for (const item of cases) {
    for (const step of item.steps) {
      totals.steps++
      if (step.status === 'passed') totals.stepsPassed++
      else if (step.status === 'failed') totals.stepsFailed++
      else totals.stepsSkipped++
    }
  }

  return {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    status: totals.failed > 0 ? 'failed' : 'passed',
    cases,
    totals,
  }
}
