import { describe, expect, test, vi } from 'vitest'
import { TestPilotError } from '@testpilot/core'
import type { Browser, BrowserContext } from 'playwright'
import { errors } from 'playwright'
import { PlaywrightAdapter } from './page'

describe('PlaywrightAdapter 错误码', () => {
  function adapterWithPage(page: Record<string, unknown>): PlaywrightAdapter {
    const context = {
      setDefaultTimeout: vi.fn(),
      newPage: vi.fn(async () => page),
      close: vi.fn(),
    } as unknown as BrowserContext
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(),
    } as unknown as Browser
    return new PlaywrightAdapter({ browser })
  }

  async function errorOf(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
      () => null,
      (e) => e,
    )
  }

  test('click 元素等不到(playwright TimeoutError)→ ELEMENT_NOT_FOUND', async () => {
    const page = {
      locator: vi.fn(() => ({
        click: vi.fn(async () => {
          throw new errors.TimeoutError('Timeout 30000ms exceeded.')
        }),
      })),
    }
    const adapter = adapterWithPage(page)
    const err = await errorOf(adapter.click({ css: '.missing' }))
    expect(err).toBeInstanceOf(TestPilotError)
    expect((err as TestPilotError).code).toBe('ELEMENT_NOT_FOUND')
  })

  test('assert 文本不匹配 → ASSERTION_FAILED(消息原文不变)', async () => {
    vi.useFakeTimers()
    try {
      const page = {
        locator: vi.fn(() => ({
          waitFor: vi.fn(async () => undefined),
          innerText: vi.fn(async () => '订单号 12345 已创建'),
        })),
      }
      const adapter = adapterWithPage(page)
      const pending = errorOf(adapter.assert({ css: '.order-id' }, '已发货'))
      await vi.advanceTimersByTimeAsync(11_000)
      const err = await pending
      expect(err).toBeInstanceOf(TestPilotError)
      expect((err as TestPilotError).code).toBe('ASSERTION_FAILED')
      expect((err as Error).message).toContain('等待 10000ms):期望包含 "已发货"')
    } finally {
      vi.useRealTimers()
    }
  })

  test('navigate goto 超时 → STEP_TIMEOUT', async () => {
    const page = {
      goto: vi.fn(async () => {
        throw new errors.TimeoutError('Timeout 30000ms exceeded.')
      }),
    }
    const adapter = adapterWithPage(page)
    const err = await errorOf(adapter.navigate('https://slow.test/page'))
    expect(err).toBeInstanceOf(TestPilotError)
    expect((err as TestPilotError).code).toBe('STEP_TIMEOUT')
  })

  test('navigate goto 网络错误 → ENVIRONMENT_UNAVAILABLE', async () => {
    const page = {
      goto: vi.fn(async () => {
        throw new Error('net::ERR_CONNECTION_REFUSED at https://down.test')
      }),
    }
    const adapter = adapterWithPage(page)
    const err = await errorOf(adapter.navigate('https://down.test'))
    expect(err).toBeInstanceOf(TestPilotError)
    expect((err as TestPilotError).code).toBe('ENVIRONMENT_UNAVAILABLE')
  })

  test('无效 locator 保持普通 Error(用例编写错误,不带码)', async () => {
    const adapter = adapterWithPage({})
    const err = await errorOf(adapter.click({} as never))
    expect(err).not.toBeInstanceOf(TestPilotError)
    expect((err as Error).message).toContain('无效的 locator')
  })
})
