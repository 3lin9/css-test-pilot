import { describe, expect, it } from 'vitest'
import { caseStatusFromErrorCode, verdictFromErrorCode } from '@testpilot/core'

describe('verdictFromErrorCode', () => {
  it('product 桶', () => {
    for (const code of ['ASSERTION_FAILED', 'REQUEST_COUNT_MISMATCH', 'STATUS_MISMATCH', 'ELEMENT_NOT_FOUND', 'STEP_TIMEOUT']) {
      expect(verdictFromErrorCode(code)).toBe('product')
    }
  })
  it('infra 桶(含现有码)', () => {
    for (const code of ['ENVIRONMENT_UNAVAILABLE', 'ADAPTER_NOT_FOUND', 'UNSUPPORTED_ACTION', 'FIXTURE_MISSING', 'ACCOUNT_UNAVAILABLE', 'CONFIG_MISSING', 'NATIVE_DIALOG_TIMEOUT', 'PAGE_READY_TIMEOUT']) {
      expect(verdictFromErrorCode(code)).toBe('infra')
    }
  })
  it('unverified 桶(PREREQ_VARIABLE_MISSING:断言"失败"实为"没测到")', () => {
    expect(verdictFromErrorCode('PREREQ_VARIABLE_MISSING')).toBe('unverified')
  })
  it('未知 code 与 undefined 默认 product(宁红勿漏)', () => {
    expect(verdictFromErrorCode('SOMETHING_NEW')).toBe('product')
    expect(verdictFromErrorCode(undefined)).toBe('product')
  })
})

describe('caseStatusFromErrorCode', () => {
  it('product→failed / infra→blocked / unverified→inconclusive', () => {
    expect(caseStatusFromErrorCode('ASSERTION_FAILED')).toBe('failed')
    expect(caseStatusFromErrorCode('ADAPTER_NOT_FOUND')).toBe('blocked')
    expect(caseStatusFromErrorCode('PREREQ_VARIABLE_MISSING')).toBe('inconclusive')
    expect(caseStatusFromErrorCode(undefined)).toBe('failed')
  })
})
