import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import type { AdapterFactory, TestAdapter } from '@testpilot/adapter-core'
import { discoverCases, discoverIntent } from '@testpilot/sdk'

describe('SDK Discover 安全边界', () => {
  test('只执行 navigate/observe/probe，不执行 click；副作用后的步骤延后到 Rehearse', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-discover-'))
    await mkdir(join(root, 'tests/e2e/cases'), { recursive: true })
    await writeFile(
      join(root, 'tests/e2e/cases/discover.yaml'),
      `id: discover-safe
name: 只读发现
steps:
  - target: web
    action: navigate
    url: /checkout
  - target: web
    action: click
    locator: { testId: submit }
  - target: web
    action: assert
    locator: { testId: result }
    expected: success
`,
      'utf8',
    )
    const click = vi.fn()
    const probe = vi.fn(async (candidate) => ({
      candidate,
      matchedCount: 1,
      unique: true,
      visible: true,
      enabled: true,
      editable: false,
      covered: false,
      actionable: true,
      stateHash: '/checkout',
      fingerprint: candidate.fingerprint,
    }))
    const adapter: TestAdapter = {
      target: 'web',
      launch: vi.fn(async () => undefined),
      navigate: vi.fn(async () => undefined),
      click,
      input: vi.fn(async () => undefined),
      select: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
      assert: vi.fn(async () => undefined),
      extract: vi.fn(async () => ''),
      screenshot: vi.fn(async () => Buffer.from('png')),
      close: vi.fn(async () => undefined),
      probe,
      observe: vi.fn(async () => ({
        target: 'web',
        route: '/checkout',
        semanticTree: '- button "提交"',
        screenshot: Buffer.from('png'),
        interactiveElements: [],
        observedAt: new Date().toISOString(),
        stateHash: '/checkout',
      })),
      waitForStable: vi.fn(async () => ({
        stable: true,
        durationMs: 1,
        samples: 2,
        stateHash: '/checkout',
      })),
    }
    const factory: AdapterFactory = { target: 'web', create: async () => adapter }

    const result = await discoverCases({ root, adapters: [factory] })

    expect(click).not.toHaveBeenCalled()
    expect(probe).toHaveBeenCalledTimes(1)
    expect(result.cases[0]?.probes[0]?.result?.actionable).toBe(true)
    expect(result.cases[0]?.probes[1]?.skippedReason).toContain('Rehearse')
    expect(result.cases[0]?.snapshots[0]?.screenshot).toMatch(/\.png$/)
  })

  test('意图定位缓存每次复用先 probe，失效后重新 observe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-intent-cache-'))
    let currentSelector = '#submit-v1'
    const observe = vi.fn(async () => {
      const candidate = {
        locator: { css: currentSelector },
        strategy: 'css' as const,
        score: 80,
        description: '提交订单',
        fingerprint: {
          name: '提交订单',
          stableAttributes: { id: currentSelector.slice(1) },
          ancestorPath: [],
        },
      }
      return {
        target: 'miniapp' as const,
        route: '/pages/checkout/index',
        semanticTree: '- button "提交订单"',
        interactiveElements: [
          {
            index: 0,
            name: '提交订单',
            visible: true,
            enabled: true,
            editable: false,
            fingerprint: candidate.fingerprint,
            candidates: [candidate],
          },
        ],
        observedAt: new Date().toISOString(),
        stateHash: currentSelector,
      }
    })
    const adapter: TestAdapter = {
      target: 'miniapp',
      launch: vi.fn(async () => undefined),
      navigate: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      input: vi.fn(async () => undefined),
      select: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
      assert: vi.fn(async () => undefined),
      extract: vi.fn(async () => ''),
      screenshot: vi.fn(async () => Buffer.from('png')),
      close: vi.fn(async () => undefined),
      observe,
      probe: vi.fn(async (candidate) => {
        const actionable = candidate.locator.css === currentSelector
        return {
          candidate,
          matchedCount: actionable ? 1 : 0,
          unique: actionable,
          visible: actionable,
          enabled: true,
          editable: false,
          covered: false,
          actionable,
          stateHash: currentSelector,
          fingerprint: actionable ? candidate.fingerprint : undefined,
        }
      }),
      waitForStable: vi.fn(async () => ({
        stable: true,
        durationMs: 1,
        samples: 2,
        stateHash: currentSelector,
      })),
    }
    const factory: AdapterFactory = { target: 'miniapp', create: async () => adapter }
    const options = {
      root,
      target: 'miniapp' as const,
      url: '/pages/checkout/index',
      intent: '提交订单',
      adapters: [factory],
    }

    expect((await discoverIntent(options)).source).toBe('observation')
    expect((await discoverIntent(options)).source).toBe('cache')
    expect(observe).toHaveBeenCalledTimes(1)

    currentSelector = '#submit-v2'
    const refreshed = await discoverIntent(options)
    expect(refreshed.source).toBe('observation')
    expect(refreshed.invalidatedCache).toBe(true)
    expect(refreshed.candidate.locator).toEqual({ css: '#submit-v2' })
    expect(observe).toHaveBeenCalledTimes(2)
  })
})
