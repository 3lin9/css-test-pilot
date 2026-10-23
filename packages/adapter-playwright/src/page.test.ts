import { describe, expect, test, vi } from 'vitest'
import { TestPilotError } from '@testpilot/core'
import type { Browser, BrowserContext } from 'playwright'
import { errors } from 'playwright'
import { PlaywrightAdapter } from './page'
import type { LocatorCandidate } from '@testpilot/observation-core'

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
    const count = vi.fn(async () => {
      throw new Error('正常执行不应在 Playwright action 前做即时 probe')
    })
    const page = {
      locator: vi.fn(() => ({
        count,
        click: vi.fn(async () => {
          throw new errors.TimeoutError('Timeout 30000ms exceeded.')
        }),
      })),
      url: vi.fn(() => 'https://test.local'),
    }
    const adapter = adapterWithPage(page)
    const err = await errorOf(adapter.click({ css: '.missing' }))
    expect(err).toBeInstanceOf(TestPilotError)
    expect((err as TestPilotError).code).toBe('ELEMENT_NOT_FOUND')
    expect(count).not.toHaveBeenCalled()
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

describe('PlaywrightAdapter 交互扩展', () => {
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

  test('longpress 以按住 600ms 的 click 近似', async () => {
    const click = vi.fn(async () => undefined)
    const page = {
      locator: vi.fn(() => ({
        click,
      })),
      url: vi.fn(() => 'https://test.local'),
    }
    const adapter = adapterWithPage(page)
    await adapter.longpress({ css: '.press-me' })
    expect(click).toHaveBeenCalledWith({ delay: 600 })
  })

  test('countElements 返回匹配元素数;getElementAttribute 读取属性', async () => {
    const page = {
      locator: vi.fn(() => ({
        count: vi.fn(async () => 2),
        getAttribute: vi.fn(async () => 'true'),
      })),
    }
    const adapter = adapterWithPage(page)
    expect(await adapter.countElements({ css: '.row' })).toBe(2)
    expect(await adapter.getElementAttribute({ css: '.btn' }, 'disabled')).toBe('true')
  })

  test('语义 locator 映射到 Playwright getBy*', async () => {
    const target = { count: vi.fn(async () => 1) }
    const page = {
      getByTestId: vi.fn(() => target),
      getByRole: vi.fn(() => target),
      getByLabel: vi.fn(() => target),
      getByPlaceholder: vi.fn(() => target),
    }
    const adapter = adapterWithPage(page)

    await adapter.countElements({ testId: 'submit' })
    await adapter.countElements({ role: 'button', name: '提交订单' })
    await adapter.countElements({ label: '手机号' })
    await adapter.countElements({ placeholder: '请输入验证码' })

    expect(page.getByTestId).toHaveBeenCalledWith('submit')
    expect(page.getByRole).toHaveBeenCalledWith('button', { name: '提交订单', exact: true })
    expect(page.getByLabel).toHaveBeenCalledWith('手机号', { exact: true })
    expect(page.getByPlaceholder).toHaveBeenCalledWith('请输入验证码', { exact: true })
  })
})

describe('PlaywrightAdapter 自主观察', () => {
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

  test('observe 使用 AI aria snapshot 并生成高优先级 testId 候选', async () => {
    const page = {
      ariaSnapshot: vi.fn(async () => '- button "提交订单" [ref=e1]'),
      url: vi.fn(() => 'https://shop.test/checkout'),
      title: vi.fn(async () => '结算'),
      screenshot: vi.fn(async () => Buffer.from('png')),
      evaluate: vi.fn(async () => [
        {
          tag: 'button',
          role: 'button',
          name: '提交订单',
          text: '提交订单',
          testId: 'submit-order',
          visible: true,
          enabled: true,
          editable: false,
          covered: false,
          box: { x: 1, y: 2, width: 100, height: 40 },
          stableAttributes: { type: 'submit' },
          ancestorPath: ['main', 'form'],
        },
      ]),
    }
    const observation = await adapterWithPage(page).observe('提交订单')

    expect(page.ariaSnapshot).toHaveBeenCalledWith({ mode: 'ai', boxes: true })
    expect(observation.route).toBe('https://shop.test/checkout')
    expect(observation.stateHash).toMatch(/^[a-f0-9]{64}$/)
    expect(observation.interactiveElements[0]?.candidates[0]).toMatchObject({
      strategy: 'testId',
      locator: { testId: 'submit-order' },
    })
  })

  test('probe 校验唯一、可见、启用、无遮挡和元素指纹', async () => {
    const locator = {
      count: vi.fn(async () => 1),
      isVisible: vi.fn(async () => true),
      isEnabled: vi.fn(async () => true),
      isEditable: vi.fn(async () => false),
      evaluate: vi.fn(async () => ({
        tag: 'button',
        role: 'button',
        name: '提交订单',
        testId: 'submit-order',
        stableAttributes: { type: 'submit' },
        ancestorPath: ['main', 'form'],
        box: { x: 1, y: 2, width: 100, height: 40 },
        covered: false,
      })),
    }
    const page = {
      getByTestId: vi.fn(() => locator),
      ariaSnapshot: vi.fn(async () => '- button "提交订单"'),
      url: vi.fn(() => 'https://shop.test/checkout'),
      title: vi.fn(async () => '结算'),
      evaluate: vi.fn(async () => []),
    }
    const candidate: LocatorCandidate = {
      locator: { testId: 'submit-order' },
      strategy: 'testId',
      score: 100,
      description: '提交订单',
      fingerprint: {
        role: 'button',
        name: '提交订单',
        testId: 'submit-order',
        tag: 'button',
        stableAttributes: { type: 'submit' },
        ancestorPath: ['main', 'form'],
        box: { x: 1, y: 2, width: 100, height: 40 },
      },
    }
    const result = await adapterWithPage(page).probe(candidate)

    expect(result).toMatchObject({
      matchedCount: 1,
      unique: true,
      visible: true,
      enabled: true,
      covered: false,
      actionable: true,
    })
  })
})
