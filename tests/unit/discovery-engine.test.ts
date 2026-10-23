import { describe, expect, test, vi } from 'vitest'
import type { TestAdapter } from '@testpilot/adapter-core'
import type { LocatorCandidate, UIObservation } from '@testpilot/observation-core'
import {
  MemoryLocatorCache,
  resolveLocator,
} from '../../packages/discovery-engine/src'

const cached: LocatorCandidate = {
  locator: { css: '.old-submit' },
  strategy: 'css',
  score: 40,
  description: '提交订单',
  fingerprint: {
    role: 'button',
    name: '提交订单',
    stableAttributes: {},
    ancestorPath: ['main', 'form'],
  },
}

const fresh: LocatorCandidate = {
  locator: { testId: 'submit-order' },
  strategy: 'testId',
  score: 100,
  description: '提交订单',
  fingerprint: {
    role: 'button',
    name: '提交订单',
    testId: 'submit-order',
    stableAttributes: {},
    ancestorPath: ['main', 'form'],
  },
}

function observation(): UIObservation {
  return {
    target: 'web',
    route: '/checkout',
    semanticTree: '- button "提交订单"',
    screenshot: Buffer.from('png'),
    interactiveElements: [
      {
        index: 0,
        role: 'button',
        name: '提交订单',
        text: '提交订单',
        testId: 'submit-order',
        visible: true,
        enabled: true,
        editable: false,
        fingerprint: fresh.fingerprint,
        candidates: [fresh],
      },
    ],
    observedAt: new Date().toISOString(),
    stateHash: 'state-new',
  }
}

describe('discovery-engine locator cache', () => {
  test('缓存 probe 通过时直接复用，不重新 observe', async () => {
    const cache = new MemoryLocatorCache()
    await cache.set('web:/checkout:提交订单', {
      candidate: cached,
      route: '/checkout',
      intent: '提交订单',
      updatedAt: new Date().toISOString(),
    })
    const adapter = {
      target: 'web',
      probe: vi.fn(async () => ({
        candidate: cached,
        matchedCount: 1,
        unique: true,
        visible: true,
        enabled: true,
        editable: false,
        covered: false,
        actionable: true,
        stateHash: 'state-old',
        fingerprint: cached.fingerprint,
      })),
      observe: vi.fn(),
    } as unknown as TestAdapter

    const result = await resolveLocator(adapter, cache, '/checkout', '提交订单')
    expect(result.source).toBe('cache')
    expect(result.candidate).toEqual(cached)
    expect(adapter.observe).not.toHaveBeenCalled()
  })

  test('缓存失效后重新观察、probe 新候选并覆盖缓存', async () => {
    const cache = new MemoryLocatorCache()
    const key = 'web:/checkout:提交订单'
    await cache.set(key, {
      candidate: cached,
      route: '/checkout',
      intent: '提交订单',
      updatedAt: new Date().toISOString(),
    })
    const adapter = {
      target: 'web',
      probe: vi.fn(async (candidate: LocatorCandidate) => ({
        candidate,
        matchedCount: candidate === cached ? 0 : 1,
        unique: candidate !== cached,
        visible: candidate !== cached,
        enabled: true,
        editable: false,
        covered: false,
        actionable: candidate !== cached,
        stateHash: 'state-new',
        fingerprint: candidate === cached ? undefined : fresh.fingerprint,
      })),
      observe: vi.fn(async () => observation()),
    } as unknown as TestAdapter

    const result = await resolveLocator(adapter, cache, '/checkout', '提交订单')
    expect(result.source).toBe('observation')
    expect(result.candidate).toEqual(fresh)
    expect((await cache.get(key))?.candidate).toEqual(fresh)
  })
})
