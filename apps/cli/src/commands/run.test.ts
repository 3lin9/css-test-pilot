import { expect, test } from 'vitest'
import { exitCodeForRunStatus } from '@testpilot/core'

// 计划契约:failed|inconclusive → 1(黄/红),blocked → 2(环境问题不污染产品缺陷统计),其余 → 0
test('exitCodeForRunStatus:passed/skipped → 0', () => {
  expect(exitCodeForRunStatus('passed')).toBe(0)
  expect(exitCodeForRunStatus('skipped')).toBe(0)
})

test('exitCodeForRunStatus:failed/inconclusive → 1', () => {
  expect(exitCodeForRunStatus('failed')).toBe(1)
  expect(exitCodeForRunStatus('inconclusive')).toBe(1)
})

test('exitCodeForRunStatus:blocked → 2', () => {
  expect(exitCodeForRunStatus('blocked')).toBe(2)
})
