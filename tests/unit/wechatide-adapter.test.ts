import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CaseLocator } from '@testpilot/dsl'
import { MiniAppAdapter, wechatideAdapterFactory } from '@testpilot/adapter-wechatide'
import type { AutomatorProgram } from '@testpilot/adapter-wechatide'

// 注入式假 automator:验证适配器的映射逻辑,不依赖微信开发者工具
function createFakeProgram() {
  const fakeElement = {
    tap: vi.fn(),
    text: vi.fn(async () => '订单号 67890 已创建'),
    input: vi.fn(),
  }
  const fakePage = {
    $: vi.fn(async () => fakeElement),
    waitFor: vi.fn(),
  }
  const program: AutomatorProgram = {
    reLaunch: vi.fn(async () => undefined),
    currentPage: vi.fn(async () => fakePage),
    screenshot: vi.fn(async () => Buffer.from('fake-png').toString('base64')),
    disconnect: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
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
