import type { CaseStatus } from './types'

/** 三态判定:product=产品问题 / infra=环境与前置(blocked) / unverified=规则本轮没测到(inconclusive) */
export type Verdict = 'product' | 'infra' | 'unverified'

// product 桶(ASSERTION_FAILED/REQUEST_COUNT_MISMATCH/STATUS_MISMATCH/ELEMENT_NOT_FOUND/STEP_TIMEOUT)
// 不建集合:凡未列入 INFRA/unverified 的码一律默认 product(宁红勿漏)
/** infra 桶:环境/前置问题 → blocked(非产品回归) */
const INFRA_CODES: ReadonlySet<string> = new Set([
  'ENVIRONMENT_UNAVAILABLE',
  'ADAPTER_NOT_FOUND',
  'UNSUPPORTED_ACTION',
  'FIXTURE_MISSING',
  'ACCOUNT_UNAVAILABLE',
  'CONFIG_MISSING',
])

/**
 * 错误码 → verdict。未列入的码(含 undefined,如历史 run 或意外异常)
 * 一律归 product:宁红勿漏。
 */
export function verdictFromErrorCode(code: string | undefined): Verdict {
  if (code !== undefined && INFRA_CODES.has(code)) return 'infra'
  return 'product'
}

/** 错误码 → case 状态(product→failed / infra→blocked / unverified→inconclusive) */
export function caseStatusFromErrorCode(code: string | undefined): Extract<CaseStatus, 'failed' | 'blocked' | 'inconclusive'> {
  const verdict = verdictFromErrorCode(code)
  if (verdict === 'infra') return 'blocked'
  if (code === 'PREREQ_VARIABLE_MISSING') return 'inconclusive'
  return 'failed'
}
