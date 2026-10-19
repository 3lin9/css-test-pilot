import { expect, test } from 'vitest'
import { exitCodeForSummary } from './run'

// 计划契约:failed|inconclusive → 1(黄/红),blocked → 2(环境问题不污染产品缺陷统计),其余 → 0
test('exitCodeForSummary:passed/skipped → 0', () => {
  expect(exitCodeForSummary('passed')).toBe(0)
  expect(exitCodeForSummary('skipped')).toBe(0)
})

test('exitCodeForSummary:failed/inconclusive → 1', () => {
  expect(exitCodeForSummary('failed')).toBe(1)
  expect(exitCodeForSummary('inconclusive')).toBe(1)
})

test('exitCodeForSummary:blocked → 2', () => {
  expect(exitCodeForSummary('blocked')).toBe(2)
})
