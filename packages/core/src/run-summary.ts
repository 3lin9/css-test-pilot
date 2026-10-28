import type { CaseResult, RunSummary } from './types'

/**
 * 汇总用例结果为 RunSummary;cancelled 表示因取消信号提前结束。
 * YAML 引擎与原生 ingest 共用同一聚合规则,避免口径漂移。
 */
export function buildRunSummary(
  runId: string,
  startedAt: Date,
  cases: CaseResult[],
  options: { cancelled?: boolean; templates?: number; finishedAt?: Date } = {},
): RunSummary {
  const finishedAt = options.finishedAt ?? new Date()
  const totals = {
    templates: options.templates ?? new Set(cases.map((item) => item.caseId)).size,
    cases: cases.length,
    passed: cases.filter((item) => item.status === 'passed').length,
    failed: cases.filter((item) => item.status === 'failed').length,
    skipped: cases.filter((item) => item.status === 'skipped').length,
    ...(cases.some((item) => item.status === 'blocked') ? { blocked: cases.filter((item) => item.status === 'blocked').length } : {}),
    ...(cases.some((item) => item.status === 'inconclusive')
      ? { inconclusive: cases.filter((item) => item.status === 'inconclusive').length }
      : {}),
    warnings: 0,
    steps: 0,
    stepsPassed: 0,
    stepsFailed: 0,
    stepsSkipped: 0,
    stepsWarning: 0,
  }
  for (const item of cases) {
    for (const step of item.steps) {
      totals.steps++
      if (step.status === 'passed') totals.stepsPassed++
      else if (step.status === 'failed') totals.stepsFailed++
      else if (step.status === 'skipped') totals.stepsSkipped++
      else {
        totals.stepsWarning++
        totals.warnings++
      }
    }
  }

  return {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    // run 状态按三桶优先级推导:产品失败 > 证据不足 > 环境阻塞 > 通过 > 跳过
    status:
      totals.failed > 0
        ? 'failed'
        : (totals.inconclusive ?? 0) > 0
          ? 'inconclusive'
          : (totals.blocked ?? 0) > 0
            ? 'blocked'
            : totals.passed > 0 || totals.cases === 0
              ? 'passed'
              : 'skipped',
    ...(options.cancelled ? { cancelled: true } : {}),
    cases,
    totals,
  }
}
