import { describe, expect, test, vi } from 'vitest'
import type { Browser, BrowserContext, Page, Request } from 'playwright'
import { PlaywrightAdapter } from '../../packages/adapter-playwright/src'

describe('PlaywrightAdapter request capture', () => {
  test('注册并移除同一个 request listener', async () => {
    const listeners = new Map<string, Set<(request: Request) => void>>()
    const page = {
      on: vi.fn((event: string, listener: (request: Request) => void) => {
        const current = listeners.get(event) ?? new Set()
        current.add(listener)
        listeners.set(event, current)
      }),
      off: vi.fn((event: string, listener: (request: Request) => void) => {
        listeners.get(event)?.delete(listener)
      }),
    } as unknown as Page
    const context = {
      setDefaultTimeout: vi.fn(),
      newPage: vi.fn(async () => page),
      close: vi.fn(),
    } as unknown as BrowserContext
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(),
    } as unknown as Browser
    const adapter = new PlaywrightAdapter({ browser })

    await adapter.startRequestCapture()
    // 一个常驻观察 listener + 一个本次断言 capture listener
    expect(listeners.get('request')?.size).toBe(2)
    for (const listener of listeners.get('request') ?? []) {
      listener({
        method: () => 'POST',
        url: () => 'https://example.test/api/orders',
      } as Request)
    }

    await expect(adapter.stopRequestCapture()).resolves.toEqual([
      { method: 'POST', url: 'https://example.test/api/orders' },
    ])
    expect(listeners.get('request')?.size).toBe(1)
    expect(page.off).toHaveBeenCalledWith('request', expect.any(Function))
  })
})
