import { describe, expect, test, vi } from 'vitest'
import type { Browser, BrowserContext, Page, Request } from 'playwright'
import { PlaywrightAdapter } from '../../packages/adapter-playwright/src'

describe('PlaywrightAdapter request capture', () => {
  test('注册并移除同一个 request listener', async () => {
    const listeners = new Set<(request: Request) => void>()
    const page = {
      on: vi.fn((_event: string, listener: (request: Request) => void) => {
        listeners.add(listener)
      }),
      off: vi.fn((_event: string, listener: (request: Request) => void) => {
        listeners.delete(listener)
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
    expect(listeners.size).toBe(1)
    for (const listener of listeners) {
      listener({
        method: () => 'POST',
        url: () => 'https://example.test/api/orders',
      } as Request)
    }

    await expect(adapter.stopRequestCapture()).resolves.toEqual([
      { method: 'POST', url: 'https://example.test/api/orders' },
    ])
    expect(listeners.size).toBe(0)
    expect(page.off).toHaveBeenCalledWith('request', expect.any(Function))
  })
})
