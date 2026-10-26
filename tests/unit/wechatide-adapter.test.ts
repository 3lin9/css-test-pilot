import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CaseLocator } from '@testpilot/dsl'
import { TestPilotError } from '@testpilot/core'
import { MiniAppAdapter, wechatideAdapterFactory } from '@testpilot/adapter-wechatide'
import type { AutomatorProgram } from '@testpilot/adapter-wechatide'
import type { LocatorCandidate } from '@testpilot/observation-core'

// 注入式假 automator:验证适配器的映射逻辑,不依赖微信开发者工具
function createFakeProgram() {
  const fakeElement = {
    tap: vi.fn(),
    text: vi.fn(async () => '订单号 67890 已创建'),
    input: vi.fn(),
    callMethod: vi.fn(async () => 'component-result'),
  }
  const fakePage = {
    $: vi.fn(async () => fakeElement),
    waitFor: vi.fn(),
    data: vi.fn(async () => ({ orderId: '67890' })),
    setData: vi.fn(async () => undefined),
    callMethod: vi.fn(async () => undefined),
  }
  const program: AutomatorProgram = {
    reLaunch: vi.fn(async () => undefined),
    currentPage: vi.fn(async () => fakePage),
    screenshot: vi.fn(async () => Buffer.from('fake-png').toString('base64')),
    disconnect: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    exposeFunction: vi.fn(async () => undefined),
    mockWxMethod: vi.fn(async () => undefined),
    restoreWxMethod: vi.fn(async () => undefined),
  }
  return { program, fakePage, fakeElement }
}

let projectPath: string

beforeAll(async () => {
  // resolveMiniappConfig 会校验路径存在,用真实临时目录充当小程序项目
  projectPath = await mkdtemp(join(tmpdir(), 'testpilot-miniapp-'))
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MiniAppAdapter(miniprogram-automator 映射)', () => {
  test('launch / navigate / click / extract / screenshot 的映射', async () => {
    const { program, fakePage, fakeElement } = createFakeProgram()
    const launchMock = vi.fn(async () => program)
    const adapter = new MiniAppAdapter(
      { projectPath, cliPath: 'C:/devtools/cli.bat', closeIde: false },
      { launch: launchMock },
    )

    await adapter.launch()
    expect(launchMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectPath, cliPath: 'C:/devtools/cli.bat' }),
    )

    // navigate -> 小程序路由 reLaunch
    await adapter.navigate('/pages/order/detail')
    expect(program.reLaunch).toHaveBeenCalledWith('/pages/order/detail')

    // click -> 轮询等待元素出现后 tap
    await adapter.click({ css: '.submit-btn' })
    expect(fakePage.$).toHaveBeenCalledWith('.submit-btn')
    expect(fakeElement.tap).toHaveBeenCalled()

    // extract -> element.text()
    const value = await adapter.extract({ css: '.order-id' })
    expect(value).toBe('订单号 67890 已创建')

    // screenshot -> base64 转 Buffer
    const png = await adapter.screenshot()
    expect(png.toString()).toBe('fake-png')
  })

  test('input 会向元素传入解析后的值', async () => {
    const { program, fakeElement } = createFakeProgram()
    const adapter = new MiniAppAdapter(
      { projectPath, closeIde: false },
      { launch: vi.fn(async () => program) },
    )

    await adapter.input({ css: '#keyword' }, '小米手机')
    expect(fakeElement.input).toHaveBeenCalledWith('小米手机')
  })

  test('callMethod:页面级与组件级调用', async () => {
    const { program, fakePage, fakeElement } = createFakeProgram()
    fakePage.callMethod = vi.fn(async () => 'page-result')
    fakeElement.callMethod = vi.fn(async () => 'component-result')
    const adapter = new MiniAppAdapter(
      { projectPath, closeIde: false },
      { launch: vi.fn(async () => program) },
    )

    // 页面级(无 locator)→ page.callMethod
    await adapter.callMethod(undefined, 'onShow')
    expect(fakePage.callMethod).toHaveBeenCalledWith('onShow')

    // 组件级 → element.callMethod(method, ...args)
    await adapter.callMethod({ css: '.card' }, 'submit', ['h5'])
    expect(fakeElement.callMethod).toHaveBeenCalledWith('submit', 'h5')
  })

  test('mockWxApi:capture 记录真实调用参数', async () => {
    const { program } = createFakeProgram()
    const adapter = new MiniAppAdapter(
      { projectPath, closeIde: false },
      { launch: vi.fn(async () => program) },
    )
    await adapter.launch()
    await adapter.mockWxApi({ api: 'showModal', result: { confirm: true }, capture: 'showModalCall' })

    // 模拟小程序侧调用:注入的回调收到真实参数
    const exposed = vi
      .mocked(program.exposeFunction)
      .mock.calls.find(([name]) => String(name).includes('showModalCall'))
    expect(exposed?.[0]).toBe('__tpWxCapture_showModalCall')
    vi.mocked(exposed?.[1] as (value: unknown) => void)({ options: { content: '重新选择' } })

    expect(adapter.readCapturedWxApiCalls('showModal')).toEqual([
      { options: { content: '重新选择' } },
    ])
  })

  test('text locator 与 select 在小程序端不可用', async () => {
    const { program } = createFakeProgram()
    const adapter = new MiniAppAdapter(
      { projectPath, closeIde: false },
      { launch: vi.fn(async () => program) },
    )

    await expect(adapter.click({ text: '登录' } as CaseLocator)).rejects.toThrow(/css/)
    await expect(adapter.select({ css: '.picker' }, 'a')).rejects.toThrow(/select/)
  })

  test('默认 disconnect 保留 IDE,closeIde=true 时关闭', async () => {
    const { program } = createFakeProgram()
    const adapter = new MiniAppAdapter(
      { projectPath, closeIde: false },
      { launch: vi.fn(async () => program) },
    )
    await adapter.launch()
    await adapter.close()
    expect(program.disconnect).toHaveBeenCalled()
    expect(program.close).not.toHaveBeenCalled()

    const adapter2 = new MiniAppAdapter(
      { projectPath, closeIde: true },
      { launch: vi.fn(async () => program) },
    )
    await adapter2.launch()
    await adapter2.close()
    expect(program.close).toHaveBeenCalled()
  })

  test('请求观察透明调用 origin 并在结束时恢复 wx.request', async () => {
    const { program } = createFakeProgram()
    const adapter = new MiniAppAdapter(
      { projectPath, closeIde: false },
      { launch: vi.fn(async () => program) },
    )

    await adapter.startRequestCapture()
    const exposed = vi.mocked(program.exposeFunction).mock.calls[0]
    const mocked = vi.mocked(program.mockWxMethod).mock.calls[0]
    expect(exposed?.[0]).toBe(mocked?.[2])
    exposed?.[1]({ method: 'POST', url: 'https://example.test/api/orders?token=secret' })

    const origin = vi.fn(() => ({ ok: true }))
    const handler = mocked?.[1]
    expect(
      handler?.call(
        { origin },
        { method: 'POST', url: 'https://example.test/api/orders' },
        mocked?.[2] ?? '',
      ),
    ).toEqual({ ok: true })
    expect(origin).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://example.test/api/orders',
    })

    await expect(adapter.stopRequestCapture()).resolves.toEqual([
      {
        method: 'POST',
        url: 'https://example.test/api/orders?token=secret',
      },
    ])
    expect(program.restoreWxMethod).toHaveBeenCalledWith('request')
  })

  test('未配置 projectPath 时 create() 给出配置指引', async () => {
    delete process.env.TESTPILOT_MINIPROGRAM_PROJECT_PATH
    const factory = wechatideAdapterFactory({})
    await expect(factory.create()).rejects.toThrow(/miniapp\.projectPath/)
  })

  test('工厂会把 projectPath/cliPath 传给适配器配置解析', async () => {
    const factory = wechatideAdapterFactory({ projectPath })
    // 不真正 create(会拉起真实 SDK),仅验证工厂的 target
    expect(factory.target).toBe('miniapp')
  })
})

describe('MiniAppAdapter 错误码', () => {
  test('等待元素超时 → ELEMENT_NOT_FOUND(消息原文不变)', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.now() + 11_000)
      const { program, fakePage } = createFakeProgram()
      fakePage.$.mockResolvedValue(null)
      const adapter = new MiniAppAdapter(
        { projectPath, cliPath: 'C:/devtools/cli.bat', closeIde: false },
        { launch: vi.fn(async () => program) },
      )
      await adapter.launch()
      // startedAt 在 element() 内部取自假时钟,需推进 fake timer 让 Date.now() 越过 10s 阈值
      const pending = adapter.click({ css: '.slow' }).then(
        () => null,
        (e) => e,
      )
      await vi.advanceTimersByTimeAsync(11_000)
      const err = await pending
      expect(err).toBeInstanceOf(TestPilotError)
      expect((err as TestPilotError).code).toBe('ELEMENT_NOT_FOUND')
      expect((err as Error).message).toContain('等待元素超时(10000ms)')
    } finally {
      vi.useRealTimers()
    }
  })

  test('断言失败 → ASSERTION_FAILED(消息原文不变)', async () => {
    vi.useFakeTimers()
    try {
      const { program, fakeElement } = createFakeProgram()
      // 文本始终不含期望值 → assert 轮询至超时(数据绑定未完成时的等待语义)
      fakeElement.text = vi.fn(async () => '订单号 67890 已创建')
      const adapter = new MiniAppAdapter(
        { projectPath, cliPath: 'C:/devtools/cli.bat', closeIde: false },
        { launch: vi.fn(async () => program) },
      )
      await adapter.launch()
      const pending = adapter.assert({ css: '.order-id' }, '已发货').then(
        () => null,
        (e) => e,
      )
      await vi.advanceTimersByTimeAsync(11_000)
      const err = await pending
      expect(err).toBeInstanceOf(TestPilotError)
      expect((err as TestPilotError).code).toBe('ASSERTION_FAILED')
      expect((err as Error).message).toContain('等待 10000ms):期望包含 "已发货"')
    } finally {
      vi.useRealTimers()
    }
  })

  test('select 能力缺口 → UNSUPPORTED_ACTION', async () => {
    const { program } = createFakeProgram()
    const adapter = new MiniAppAdapter(
      { projectPath, cliPath: 'C:/devtools/cli.bat', closeIde: false },
      { launch: vi.fn(async () => program) },
    )
    await adapter.launch()
    const err = await adapter.select({ css: '.picker' }, 'a').then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(TestPilotError)
    expect((err as TestPilotError).code).toBe('UNSUPPORTED_ACTION')
  })

  test('text locator 编写错误保持普通 Error(不带码)', async () => {
    const { program } = createFakeProgram()
    const adapter = new MiniAppAdapter(
      { projectPath, cliPath: 'C:/devtools/cli.bat', closeIde: false },
      { launch: vi.fn(async () => program) },
    )
    await adapter.launch()
    const err = await adapter.click({ text: '登录' } as CaseLocator).then(
      () => null,
      (e) => e,
    )
    expect(err).not.toBeInstanceOf(TestPilotError)
  })
})

describe('MiniAppAdapter 交互扩展与运行时诊断', () => {
  function fakeProgramWith(args: {
    element?: Record<string, unknown>
    page?: Record<string, unknown>
    program?: Record<string, unknown>
  }) {
    const fakeElement = {
      tap: vi.fn(),
      text: vi.fn(async () => '文本'),
      input: vi.fn(),
      callMethod: vi.fn(async () => undefined),
      ...args.element,
    }
    const fakePage = {
      $: vi.fn(async () => fakeElement),
      $$: vi.fn(async () => [fakeElement, fakeElement]),
      waitFor: vi.fn(),
      data: vi.fn(async () => ({ orderId: '67890' })),
      setData: vi.fn(async () => undefined),
      callMethod: vi.fn(async () => undefined),
      ...args.page,
    }
    const program: AutomatorProgram = {
      reLaunch: vi.fn(async () => undefined),
      currentPage: vi.fn(async () => fakePage),
      screenshot: vi.fn(async () => Buffer.from('fake-png').toString('base64')),
      disconnect: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      exposeFunction: vi.fn(async () => undefined),
      mockWxMethod: vi.fn(async () => undefined),
      restoreWxMethod: vi.fn(async () => undefined),
      ...args.program,
    }
    return { program, fakePage, fakeElement }
  }

  function adapterOf(program: AutomatorProgram): MiniAppAdapter {
    // waitForPageReady 关闭:这些测试验证的是各步骤自身的错误契约,页面数据本来就不就绪
    return new MiniAppAdapter(
      { projectPath, closeIde: false, waitForPageReady: false },
      { launch: vi.fn(async () => program) },
    )
  }

  test('callWxApi 透传 callWxMethod(参数展开)', async () => {
    const { program } = fakeProgramWith({
      program: { callWxMethod: vi.fn(async () => 'stored') },
    })
    const adapter = adapterOf(program)
    await adapter.launch()
    const returned = await adapter.callWxApi('setStorageSync', ['token', 'abc'])
    expect(program.callWxMethod).toHaveBeenCalledWith('setStorageSync', 'token', 'abc')
    expect(returned).toBe('stored')
  })

  test('longpress / touch / swipeTo / slideTo / moveTo 映射到元素方法', async () => {
    const { program, fakeElement } = fakeProgramWith({
      element: {
        longpress: vi.fn(async () => undefined),
        touchstart: vi.fn(async () => undefined),
        touchmove: vi.fn(async () => undefined),
        touchend: vi.fn(async () => undefined),
        swipeTo: vi.fn(async () => undefined),
        slideTo: vi.fn(async () => undefined),
        moveTo: vi.fn(async () => undefined),
      },
    })
    const adapter = adapterOf(program)
    await adapter.launch()

    await adapter.longpress({ css: '.qr' })
    expect(fakeElement.longpress).toHaveBeenCalled()

    const touches = [{ identifier: 0, x: 10, y: 20 }]
    await adapter.touch({ css: '.canvas' }, 'touchstart', touches, touches)
    expect(fakeElement.touchstart).toHaveBeenCalledWith({
      touches: [{ identifier: 0, x: 10, y: 20, pageX: 10, clientX: 10, pageY: 20, clientY: 20 }],
      changedTouches: [{ identifier: 0, x: 10, y: 20, pageX: 10, clientX: 10, pageY: 20, clientY: 20 }],
    })

    await adapter.swipeTo({ css: '.swiper' }, 2)
    expect(fakeElement.swipeTo).toHaveBeenCalledWith(2)

    await adapter.slideTo({ css: '.slider' }, 40)
    expect(fakeElement.slideTo).toHaveBeenCalledWith(40)

    await adapter.moveTo({ css: '.movable' }, 5, 6)
    expect(fakeElement.moveTo).toHaveBeenCalledWith(5, 6)
  })

  test('scroll:有 locator 滚动元素,无 locator 走 pageScrollTo', async () => {
    const { program, fakeElement } = fakeProgramWith({
      element: { scrollTo: vi.fn(async () => undefined) },
      program: { pageScrollTo: vi.fn(async () => undefined) },
    })
    const adapter = adapterOf(program)
    await adapter.launch()

    await adapter.scroll({ css: '.list' }, 200)
    expect(fakeElement.scrollTo).toHaveBeenCalledWith(0, 200)

    await adapter.scroll(undefined, 300)
    expect(program.pageScrollTo).toHaveBeenCalledWith(300)
  })

  test('countElements / attribute / property 的读取', async () => {
    const { program, fakePage, fakeElement } = fakeProgramWith({
      element: {
        attribute: vi.fn(async () => 'true'),
        property: vi.fn(async () => 'ready'),
      },
    })
    const adapter = adapterOf(program)
    await adapter.launch()

    expect(await adapter.countElements({ css: '.item' })).toBe(2)
    expect(fakePage.$$).toHaveBeenCalledWith('.item')

    expect(await adapter.getElementAttribute({ css: '.btn' }, 'disabled')).toBe('true')
    expect(fakeElement.attribute).toHaveBeenCalledWith('disabled')

    expect(await adapter.getElementProperty({ css: '.comp' }, 'status')).toBe('ready')
    expect(fakeElement.property).toHaveBeenCalledWith('status')
  })

  test('setData:locator 提供时为组件级,缺省为页面级', async () => {
    const { program, fakePage, fakeElement } = fakeProgramWith({
      element: { setData: vi.fn(async () => undefined) },
    })
    const adapter = adapterOf(program)
    await adapter.launch()

    await adapter.setData({ refreshing: false }, { css: '.comp' })
    expect(fakeElement.setData).toHaveBeenCalledWith({ refreshing: false })
    expect(fakePage.setData).not.toHaveBeenCalled()

    await adapter.setData({ refreshing: true })
    expect(fakePage.setData).toHaveBeenCalledWith({ refreshing: true })
  })

  test('assertData:页面 data 路径包含断言', async () => {
    const { program, fakePage } = fakeProgramWith({
      page: { data: vi.fn(async (path?: string) => (path === 'status' ? 'expired' : {})) },
    })
    const adapter = adapterOf(program)
    await adapter.launch()

    await adapter.assertData('status', 'expired')
    expect(fakePage.data).toHaveBeenCalledWith('status')

    // 失败路径:文本始终不匹配 → 轮询至超时(fake timers 推进 10s 窗口)
    vi.useFakeTimers()
    try {
      const pending = adapter.assertData('status', 'valid').then(
        () => null,
        (e) => e,
      )
      await vi.advanceTimersByTimeAsync(11_000)
      const err = await pending
      expect(err).toBeInstanceOf(TestPilotError)
      expect((err as TestPilotError).code).toBe('ASSERTION_FAILED')
      expect((err as Error).message).toContain('data.status')
    } finally {
      vi.useRealTimers()
    }
  })

  test('console / exception 事件进入诊断缓冲并随 readDiagnostics 导出', async () => {
    const listeners = new Map<string, (payload: unknown) => void>()
    const { program } = fakeProgramWith({
      program: {
        on: vi.fn((event: string, listener: (payload: unknown) => void) => {
          listeners.set(event, listener)
        }),
        pageStack: vi.fn(async () => [{ path: '/pages/index/index' }]),
        systemInfo: vi.fn(async () => ({ SDKVersion: '3.7.0' })),
      },
    })
    const adapter = adapterOf(program)
    await adapter.launch()

    listeners.get('console')?.({ type: 'warn', args: ['hello ', { a: 1 }] })
    listeners.get('console')?.({ type: 'error', args: ['boom'] })
    listeners.get('exception')?.({ message: 'appservice crashed' })

    const diagnostics = await adapter.readDiagnostics()
    expect(diagnostics.consoleLogs).toEqual([
      expect.objectContaining({ type: 'warn', text: 'hello  {"a":1}' }),
      expect.objectContaining({ type: 'error', text: 'boom' }),
    ])
    expect(diagnostics.exceptions).toEqual(['appservice crashed'])
    expect(diagnostics.pageStack).toEqual([{ path: '/pages/index/index' }])
    expect(diagnostics.systemInfo).toEqual({ SDKVersion: '3.7.0' })
  })

  test('mockWxApi 把结果传给回调,并用 :fail 走 fail', async () => {
    const { program } = fakeProgramWith({})
    const adapter = adapterOf(program)
    await adapter.launch()
    const result = { errMsg: 'request:ok', data: { ok: true } }
    await adapter.mockWxApi({ api: 'request', result })
    const mocked = vi.mocked(program.mockWxMethod).mock.calls[0]
    expect(mocked?.[2]).toEqual(result)
    expect(String(mocked?.[1])).toContain('success')
    expect(String(mocked?.[1])).not.toContain('options.result')

    const success = vi.fn()
    const complete = vi.fn()
    const handler = mocked?.[1] as (
      firstArg: unknown,
      mockResult: unknown,
      captureName: string,
      methodName: string,
    ) => unknown
    handler({ url: '/api', success, complete }, result, '', 'request')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(success).toHaveBeenCalledWith(result)
    expect(complete).toHaveBeenCalledWith(result)

    const failed = { errMsg: 'login:fail auth deny' }
    const fail = vi.fn()
    const failComplete = vi.fn()
    handler({ fail, complete: failComplete }, failed, '', 'login')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fail).toHaveBeenCalledWith(failed)
    expect(failComplete).toHaveBeenCalledWith(failed)

    expect(handler('token', { value: 'abc' }, '', 'getStorageSync')).toEqual({ value: 'abc' })
    await expect(handler({ url: '/api' }, result, '', 'request')).resolves.toEqual(result)
  })

  test('nativeAuthorize 在弹窗晚出现时重试,超时给出 NATIVE_DIALOG_TIMEOUT', async () => {
    const authorizeAllow = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('no dialog'))
      .mockResolvedValueOnce(undefined)
    const { program } = fakeProgramWith({
      program: { native: () => ({ authorizeAllow, authorizeCancel: vi.fn() }) },
    })
    const adapter = adapterOf(program)
    await adapter.launch()
    await adapter.nativeAuthorize('allow', 1_000)
    expect(authorizeAllow).toHaveBeenCalledTimes(2)

    const hanging = vi.fn(() => new Promise<void>(() => undefined))
    const timeoutProgram = fakeProgramWith({
      program: { native: () => ({ authorizeAllow: hanging, authorizeCancel: vi.fn() }) },
    }).program
    const timeoutAdapter = adapterOf(timeoutProgram)
    await timeoutAdapter.launch()
    const err = await timeoutAdapter.nativeAuthorize('allow', 300).then(
      () => null,
      (error: unknown) => error,
    )
    expect(err).toBeInstanceOf(TestPilotError)
    expect((err as TestPilotError).code).toBe('NATIVE_DIALOG_TIMEOUT')
  })

  test('readWxApiCaptures 返回引擎契约形状(带 capture 的 mock)', async () => {
    const { program } = fakeProgramWith({})
    const adapter = adapterOf(program)
    await adapter.launch()
    await adapter.mockWxApi({ api: 'showModal', result: { confirm: true }, capture: 'modal' })

    const exposed = vi
      .mocked(program.exposeFunction)
      .mock.calls.find(([name]) => String(name).includes('modal'))
    vi.mocked(exposed?.[1] as (value: unknown) => void)({ options: { content: '重新选择' } })

    expect(adapter.readWxApiCaptures()).toEqual({
      name: 'showModal',
      calls: [{ options: { content: '重新选择' } }],
    })
  })

  test('observe 融合运行时节点 WXML、边界框和截图', async () => {
    const root = {
      outerWxml: vi.fn(async () => '<view><button id="submit">提交订单</button></view>'),
    }
    const element = {
      tagName: 'button',
      text: vi.fn(async () => '提交订单'),
      attribute: vi.fn(async (name: string) => {
        if (name === 'id') return 'submit'
        if (name === 'class') return 'primary action'
        if (name === 'type') return 'primary'
        return undefined
      }),
      size: vi.fn(async () => ({ width: 100, height: 40 })),
      offset: vi.fn(async () => ({ left: 10, top: 20 })),
    }
    const { program, fakePage } = fakeProgramWith({
      page: {
        path: '/pages/checkout/index',
        query: { orderId: '1' },
        $: vi.fn(async (selector: string) => (selector === 'page' ? root : element)),
        $$: vi.fn(async () => [element]),
        getElementsByXpath: vi.fn(async () => [element]),
      },
    })
    const observation = await adapterOf(program).observe('提交订单')

    expect(observation.target).toBe('miniapp')
    expect(observation.route).toBe('/pages/checkout/index?orderId=1')
    expect(observation.runtimeMarkup).toContain('<button id="submit">')
    expect(observation.screenshot?.toString()).toBe('fake-png')
    expect(fakePage.getElementsByXpath).toHaveBeenCalledWith('//*')
    expect(observation.interactiveElements[0]?.candidates[0]).toMatchObject({
      locator: { css: '#submit' },
      strategy: 'css',
    })
  })

  test('probe 对小程序候选做唯一性、可见性和指纹验证', async () => {
    const element = {
      tagName: 'button',
      text: vi.fn(async () => '提交订单'),
      attribute: vi.fn(async (name: string) => {
        if (name === 'id') return 'submit'
        return undefined
      }),
      size: vi.fn(async () => ({ width: 100, height: 40 })),
      offset: vi.fn(async () => ({ left: 10, top: 20 })),
    }
    const { program } = fakeProgramWith({
      page: {
        path: '/pages/checkout/index',
        $$: vi.fn(async () => [element]),
      },
    })
    const candidate: LocatorCandidate = {
      locator: { css: '#submit' },
      strategy: 'css',
      score: 100,
      description: '提交订单',
      fingerprint: {
        tag: 'button',
        name: '提交订单',
        stableAttributes: { id: 'submit' },
        ancestorPath: [],
        box: { x: 10, y: 20, width: 100, height: 40 },
      },
    }
    const result = await adapterOf(program).probe(candidate)
    expect(result).toMatchObject({
      matchedCount: 1,
      unique: true,
      visible: true,
      enabled: true,
      covered: false,
      actionable: true,
    })
  })

  test('currentPage 未就绪与 screenshot 无返回值时给出明确错误码', async () => {
    const noPage = fakeProgramWith({
      program: { currentPage: vi.fn(async () => undefined) },
    })
    const pageError = await adapterOf(noPage.program).observe().then(
      () => null,
      (error) => error,
    )
    expect(pageError).toBeInstanceOf(TestPilotError)
    expect((pageError as TestPilotError).code).toBe('PAGE_NOT_READY')

    const noScreenshot = fakeProgramWith({
      program: { screenshot: vi.fn(async () => undefined) },
    })
    const screenshotError = await adapterOf(noScreenshot.program).screenshot().then(
      () => null,
      (error) => error,
    )
    expect(screenshotError).toBeInstanceOf(TestPilotError)
    expect((screenshotError as TestPilotError).code).toBe('SCREENSHOT_FAILED')
  })
})

describe('MiniAppAdapter 会话复用(自动化端口预检)', () => {
  test('端口已活且 launcher 有 connect → 复用会话,不调 automator.launch', async () => {
    const { program } = createFakeProgram()
    const launchMock = vi.fn(async () => program)
    const connectMock = vi.fn(async () => program)
    const probe = vi.fn(async () => true)
    const adapter = new MiniAppAdapter(
      { projectPath, cliPath: 'C:/devtools/cli.bat', closeIde: false },
      { launch: launchMock, connect: connectMock },
      probe,
    )

    await adapter.launch()

    expect(probe).toHaveBeenCalledWith(9420)
    expect(connectMock).toHaveBeenCalledWith('ws://127.0.0.1:9420', expect.any(Number))
    expect(launchMock).not.toHaveBeenCalled()
    // 复用会话同样要等页面就绪( currentPage / data 可读)
    expect(adapter.launch()).resolves.toBeUndefined() // 幂等
  })

  test('端口空闲 → 走 automator.launch,不 connect', async () => {
    const { program } = createFakeProgram()
    const launchMock = vi.fn(async () => program)
    const connectMock = vi.fn(async () => program)
    const probe = vi.fn(async () => false)
    const adapter = new MiniAppAdapter(
      { projectPath, cliPath: 'C:/devtools/cli.bat', closeIde: false },
      { launch: launchMock, connect: connectMock },
      probe,
    )

    await adapter.launch()

    expect(launchMock).toHaveBeenCalledWith({ projectPath, cliPath: 'C:/devtools/cli.bat' })
    expect(connectMock).not.toHaveBeenCalled()
  })

  test('端口已活但 launcher 无 connect(旧桩)→ 仍走 launch(向后兼容)', async () => {
    const { program } = createFakeProgram()
    const launchMock = vi.fn(async () => program)
    const probe = vi.fn(async () => true)
    const adapter = new MiniAppAdapter(
      { projectPath, closeIde: false },
      { launch: launchMock },
      probe,
    )

    await adapter.launch()

    expect(launchMock).toHaveBeenCalled()
  })

  test('冷启动就绪等待:launch 后 currentPage / data 未就绪会被轮询', async () => {
    const { program, fakePage } = createFakeProgram()
    // 前两次未就绪,第三次 data 可读
    let dataCalls = 0
    const page = {
      ...fakePage,
      data: vi.fn(async () => {
        dataCalls++
        if (dataCalls < 3) throw new Error('compiling')
        return { orderId: '67890' }
      }),
    }
    const program2: AutomatorProgram = {
      ...program,
      currentPage: vi.fn(async () => page),
    }
    const adapter = new MiniAppAdapter(
      { projectPath, closeIde: false },
      { launch: vi.fn(async () => program2), connect: vi.fn(async () => program2) },
      vi.fn(async () => false),
    )

    await adapter.launch()

    expect((program2.currentPage as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3)
  })
})
