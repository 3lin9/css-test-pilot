import { caseStatusFromErrorCode, nativeCodeFromMessage } from '@testpilot/core'
import { blocked, inconclusive, NATIVE_CODE_PREFIX } from '@testpilot/native'
import { expect, test } from 'vitest'

test('blocked 抛 ENVIRONMENT_UNAVAILABLE,ingest 可从 message 提取错误码', () => {
  const error = blocked('staging 不可达')
  expect(error.code).toBe('ENVIRONMENT_UNAVAILABLE')
  expect(error.message).toContain(`${NATIVE_CODE_PREFIX}ENVIRONMENT_UNAVAILABLE] staging 不可达`)
  expect(nativeCodeFromMessage(error.message)).toBe('ENVIRONMENT_UNAVAILABLE')
  expect(caseStatusFromErrorCode(nativeCodeFromMessage(error.message))).toBe('blocked')
})

test('inconclusive 抛 PREREQ_VARIABLE_MISSING → inconclusive', () => {
  const error = inconclusive('登录前置失败,断言未真正执行')
  expect(error.code).toBe('PREREQ_VARIABLE_MISSING')
  expect(nativeCodeFromMessage(error.message)).toBe('PREREQ_VARIABLE_MISSING')
  expect(caseStatusFromErrorCode(nativeCodeFromMessage(error.message))).toBe('inconclusive')
})

test('无标记的失败按宁红勿漏归 product → failed', () => {
  expect(nativeCodeFromMessage('TypeError: x is not a function')).toBeUndefined()
  expect(caseStatusFromErrorCode(undefined)).toBe('failed')
})
