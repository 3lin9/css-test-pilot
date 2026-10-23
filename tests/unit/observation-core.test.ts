import { describe, expect, test } from 'vitest'
import {
  fingerprintMatches,
  observationStateHash,
  stableHash,
  type ElementFingerprint,
  type UIObservation,
} from '../../packages/observation-core/src'

describe('observation-core', () => {
  test('stableHash 不受对象键顺序影响', () => {
    expect(stableHash({ b: 2, a: 1 })).toBe(stableHash({ a: 1, b: 2 }))
  })

  test('状态 hash 只包含可复现页面状态，不包含截图和时间', () => {
    const base: UIObservation = {
      target: 'web',
      route: '/checkout',
      semanticTree: '- button "提交订单"',
      interactiveElements: [],
      observedAt: '2026-01-01T00:00:00.000Z',
      stateHash: '',
    }
    const first = observationStateHash({
      ...base,
      screenshot: Buffer.from('first'),
    })
    const second = observationStateHash({
      ...base,
      observedAt: '2026-01-02T00:00:00.000Z',
      screenshot: Buffer.from('second'),
    })
    expect(first).toBe(second)
  })

  test('指纹要求稳定身份字段一致，允许边界框小幅漂移', () => {
    const expected: ElementFingerprint = {
      role: 'button',
      name: '提交订单',
      testId: 'submit',
      stableAttributes: { type: 'submit' },
      ancestorPath: ['main', 'form'],
      box: { x: 10, y: 20, width: 100, height: 40 },
    }
    expect(
      fingerprintMatches(expected, {
        ...expected,
        box: { x: 12, y: 18, width: 101, height: 40 },
      }),
    ).toBe(true)
    expect(fingerprintMatches(expected, { ...expected, name: '删除订单' })).toBe(false)
  })
})
