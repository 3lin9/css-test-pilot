import { expect, test } from 'vitest'
import type { RunSummary } from '@testpilot/core'
import { buildSuggestions, classify } from './agents/analysis-agent'

function summaryOf(status: RunSummary['status']): RunSummary {
  return {
    runId: 'r1',
    status,
    cancelled: false,
    totals: {
      cases: 1,
      passed: 0,
      failed: 0,
      blocked: status === 'blocked' ? 1 : undefined,
      inconclusive: status === 'inconclusive' ? 1 : undefined,
      steps: 1,
      stepsPassed: 0,
      stepsFailed: 1,
      stepsSkipped: 0,
    },
    cases: [],
    startedAt: '2026-10-19T00:00:00Z',
    finishedAt: '2026-10-19T00:00:01Z',
    durationMs: 1000,
  }
}

// 三态语义贯通 agent 消费面:环境问题归 env-issue,「没测到」不得被翻译回产品 bug(评审 F4)
test('blocked run → env-issue(环境与前置,给环境排查建议)', () => {
  const verdict = classify(summaryOf('blocked'), [])
  expect(verdict).toBe('env-issue')
  const tips = buildSuggestions(verdict, { runId: 'r1' }, [])
  expect(tips.join(' ')).toContain('doctor')
})

test('inconclusive run → unverified,不建议按产品 bug 报告', () => {
  const verdict = classify(summaryOf('inconclusive'), [])
  expect(verdict).toBe('unverified')
  const tips = buildSuggestions(verdict, { runId: 'r1' }, [])
  expect(tips.join(' ')).toContain('没测到')
  expect(tips.join(' ')).not.toContain('产品 bug')
})
