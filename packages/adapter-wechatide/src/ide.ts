import automator from 'miniprogram-automator'
import { TestPilotError } from '@testpilot/core'
import { spawn } from 'node:child_process'
import net from 'node:net'
import type { CaseLocator, StepTarget } from '@testpilot/dsl'
import type {
  CapturedRequest,
  ConsoleLogEntry,
  RuntimeDiagnostics,
  TestAdapter,
} from '@testpilot/adapter-core'
import type { MiniappAdapterConfig } from './project'

/** 与 miniprogram-automator 运行时结构对应的最小类型(仅用到的能力) */
interface AutomatorElement {
  tap(): Promise<void>
  longpress(): Promise<void>
  text(): Promise<string>
  input(value: string): Promise<void>
  trigger(type: string, detail?: Record<string, unknown>): Promise<void>
  callMethod(method: string, ...args: unknown[]): Promise<unknown>
  touchstart(options?: { touches?: unknown[]; changedTouches?: unknown[] }): Promise<void>
  touchmove(options?: { touches?: unknown[]; changedTouches?: unknown[] }): Promise<void>
  touchend(options?: { touches?: unknown[]; changedTouches?: unknown[] }): Promise<void>
  attribute(name: string): Promise<unknown>
  property(name: string): Promise<unknown>
  setData(data: Record<string, unknown>): Promise<void>
  scrollTo(scrollTop: number): Promise<void>
  swipeTo(index: number): Promise<void>
  slideTo(value: number): Promise<void>
  moveTo(x: number, y: number): Promise<void>
}

interface AutomatorPage {
  $(selector: string): Promise<AutomatorElement | null>
  $$(selector: string): Promise<AutomatorElement[]>
  waitFor(selectorOrMs: string | number): Promise<unknown>
  data(path?: string): Promise<unknown>
  setData(data: Record<string, unknown>): Promise<void>
  callMethod(method: string, ...args: unknown[]): Promise<unknown>
}

export interface AutomatorProgram {
  reLaunch(url: string): Promise<unknown>
  currentPage(): Promise<AutomatorPage>
  screenshot(): Promise<string>
  disconnect(): Promise<void>
  close(): Promise<void>
  exposeFunction(name: string, callback: (value: unknown) => void): Promise<void>
  mockWxMethod(
    method: string,
    implementation: (
      this: { origin(options: unknown): unknown },
      options: Record<string, unknown>,
      exposedName: string,
    ) => unknown,
    exposedName?: string,
  ): Promise<void>
  restoreWxMethod(method: string): Promise<void>
  /** 以下为可选能力:旧版本 SDK / 测试桩可能未提供 */
  callWxMethod?(method: string, ...args: unknown[]): Promise<unknown>
  pageScrollTo?(scrollTop: number): Promise<void>
  pageStack?(): Promise<Array<Record<string, unknown>>>
  systemInfo?(): Promise<Record<string, unknown>>
  on?(event: string, listener: (payload: unknown) => void): void
}

/** 启动器抽象:便于测试注入假实现(默认绑定 miniprogram-automator SDK) */
export interface AutomatorLauncher {
  launch(options: { projectPath: string; cliPath?: string }): Promise<AutomatorProgram>
}

const AUTO_PORT_FALLBACK_WAIT_MS = 90_000
const NAVIGATE_RETRY_WINDOW_MS = 45_000
const ELEMENT_WAIT_MS = 10_000
/** assert / extract 对元素文本的轮询窗口(数据绑定未完成时等待内容出现) */
const TEXT_WAIT_MS = 10_000
/** navigate 后等待页面就绪(编译 + 首屏 data 可读)的窗口 */
const PAGE_READY_WAIT_MS = 30_000
/** 模拟器重编译 / IDE 重启会断开自动化 ws 连接 */
const CONNECTION_LOST = /connection closed|not connected/i
/** 运行时诊断(console / exception)的环形缓冲上限 */
const DIAGNOSTICS_BUFFER_MAX = 200
/** 单条 console 取证文本的截断长度 */
const CONSOLE_TEXT_LIMIT = 500

export const automatorLauncher: AutomatorLauncher = {
  launch: async (options) => {
    try {
      return (await automator.launch(options)) as unknown as AutomatorProgram
    } catch (launchError) {
      // Node 20.12+ 禁止 spawn 直接执行 .bat(需 shell:true),automator 内部未处理;
      // 降级:自行以 shell 拉起 `cli auto`,等自动化端口就绪后改走 connect
      if (!options.cliPath) throw launchError
      const port = Number(process.env.TESTPILOT_MINIPROGRAM_AUTO_PORT) || 9420
      await startCliAuto(options.cliPath, options.projectPath, port)
      return await connectWithRetry(`ws://127.0.0.1:${port}`, AUTO_PORT_FALLBACK_WAIT_MS)
    }
  },
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** console 参数序列化为取证文本(不可序列化对象退化为 String) */
function serializeConsoleArg(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** 页面 data 值转断言文本(对象 JSON 化,便于包含断言) */
function stringifyDataValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** 建立自动化 ws 连接;IDE 冷启动 / 编译期间端口未就绪时持续重试 */
async function connectWithRetry(wsEndpoint: string, timeoutMs: number): Promise<AutomatorProgram> {
  const startedAt = Date.now()
  let lastError: unknown
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return (await automator.connect({ wsEndpoint })) as unknown as AutomatorProgram
    } catch (err) {
      lastError = err
      await delay(1_000)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** 以 shell 拉起 `cli auto`(兼容 .bat),自动化端口就绪或 cli 正常退出即返回 */
function startCliAuto(cliPath: string, projectPath: string, port: number): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    // shell:true 下 Node 不做参数转义,路径含空格需自行加引号
    const quote = (value: string) => (/\s/.test(value) ? `"${value}"` : value)
    const args = ['auto', '--project', projectPath, '--auto-port', String(port)].map(quote)
    const child = spawn(`"${cliPath}"`, args, { shell: process.platform === 'win32' })
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    child.once('error', (err) => rejectPromise(new TestPilotError('ENVIRONMENT_UNAVAILABLE', `拉起开发者工具 cli 失败:${err.message}`)))
    child.once('exit', (code) => {
      if (code === 0) {
        resolvePromise()
      } else {
        rejectPromise(new TestPilotError('ENVIRONMENT_UNAVAILABLE', `cli auto 退出码 ${code}:${output.slice(-400)}`))
      }
    })

    const startedAt = Date.now()
    const poll = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.destroy()
        resolvePromise()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - startedAt > AUTO_PORT_FALLBACK_WAIT_MS) {
          rejectPromise(new TestPilotError('ENVIRONMENT_UNAVAILABLE', `等待开发者工具自动化端口 ${port} 超时;请确认:1) 工具已登录 2) 设置->安全设置->服务端口已开启`))
        } else {
          setTimeout(poll, 500)
        }
      })
    }
    poll()
  })
}

/**
 * 小程序端适配器:基于微信开发者工具自动化 SDK(miniprogram-automator)。
 * navigate 对应小程序路由(reLaunch),locator 仅支持 css(class/id)。
 */
export class MiniAppAdapter implements TestAdapter {
  readonly target: StepTarget = 'miniapp'
  private program: AutomatorProgram | undefined
  private requestCapture:
    | { program: AutomatorProgram; exposedName: string; requests: CapturedRequest[] }
    | undefined
  /** console / exception 环形缓冲(失败取证的数据源);重连后继续累积 */
  private readonly consoleLogs: ConsoleLogEntry[] = []
  private readonly exceptions: string[] = []
  private diagnosticsAttachedTo: AutomatorProgram | undefined

  constructor(
    private readonly config: MiniappAdapterConfig,
    private readonly launcher: AutomatorLauncher = automatorLauncher,
  ) {}

  /** 拉起开发者工具并建立自动化连接;需幂等 */
  async launch(): Promise<void> {
    if (this.program) return
    const launchOptions: { projectPath: string; cliPath?: string } = {
      projectPath: this.config.projectPath,
    }
    if (this.config.cliPath) launchOptions.cliPath = this.config.cliPath
    this.program = await this.launcher.launch(launchOptions)
    this.attachDiagnostics(this.program)
  }

  async navigate(url: string): Promise<void> {
    // 冷启动 / 代码变更会触发模拟器重编译并断开连接,在时间窗口内重连 + 重试
    const startedAt = Date.now()
    let lastError: unknown
    while (Date.now() - startedAt < NAVIGATE_RETRY_WINDOW_MS) {
      try {
        await this.runWithReconnect(async () => {
          await (await this.getProgram()).reLaunch(url)
        })
        // reLaunch 被接受 ≠ 页面就绪:等待编译完成、页面 data 可读(就绪信号)
        await this.waitForPageReady()
        return
      } catch (err) {
        lastError = err
        await delay(3_000)
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  /** 等待页面就绪:模拟器编译期间 currentPage / data 会失败或挂起,轮询至可响应 */
  private async waitForPageReady(timeoutMs = PAGE_READY_WAIT_MS): Promise<void> {
    const startedAt = Date.now()
    for (;;) {
      const page = await (await this.getProgram()).currentPage()
      const data = await page.data().catch(() => undefined)
      if (data !== undefined && data !== null) return
      if (Date.now() - startedAt > timeoutMs) {
        throw new TestPilotError(
          'PAGE_READY_TIMEOUT',
          `等待页面就绪超时(${timeoutMs}ms):模拟器可能仍在编译,或项目未被信任`,
        )
      }
      await delay(300)
    }
  }

  async click(locator: CaseLocator): Promise<void> {
    await this.runWithReconnect(async () => (await this.element(locator)).tap())
  }

  async input(locator: CaseLocator, value: string): Promise<void> {
    await this.runWithReconnect(async () => (await this.element(locator)).input(value))
  }

  async select(): Promise<void> {
    throw new TestPilotError('UNSUPPORTED_ACTION', '小程序端暂不支持 select(picker 交互),请改用 click 完成选择')
  }

  async wait(locator: CaseLocator | undefined, timeoutMs: number | undefined): Promise<void> {
    await this.runWithReconnect(async () => {
      const page = await (await this.getProgram()).currentPage()
      if (locator) {
        await page.waitFor(this.cssSelector(locator))
        return
      }
      await page.waitFor(timeoutMs ?? 1_000)
    })
  }

  async assert(locator: CaseLocator, expected: string): Promise<void> {
    await this.runWithReconnect(async () => {
      const element = await this.element(locator)
      const wanted = expected.trim()
      // 数据绑定未完成时文本可能为空/陈旧:轮询直到包含期望内容或超时
      const startedAt = Date.now()
      for (;;) {
        const actual = (await element.text()).trim()
        if (actual.includes(wanted)) return
        if (Date.now() - startedAt > TEXT_WAIT_MS) {
          throw new TestPilotError(
            'ASSERTION_FAILED',
            `断言失败(等待 ${TEXT_WAIT_MS}ms):期望包含 "${wanted}",实际为 "${actual.slice(0, 200)}"`,
          )
        }
        await delay(300)
      }
    })
  }

  async extract(locator: CaseLocator): Promise<string> {
    return this.runWithReconnect(async () => {
      const element = await this.element(locator)
      const startedAt = Date.now()
      // 数据绑定未完成时文本可能为空:轮询直到出现内容或超时(超时后返回当前文本,可能是合法空值)
      for (;;) {
        const text = (await element.text()).trim()
        if (text.length > 0 || Date.now() - startedAt > TEXT_WAIT_MS) return text
        await delay(300)
      }
    })
  }

  /** 调用 Page / 组件方法;不传 locator 时为页面级调用(Page 实例方法) */
  async callMethod(
    locator: CaseLocator | undefined,
    methodName: string,
    args: readonly unknown[] = [],
  ): Promise<unknown> {
    return this.runWithReconnect(async () => {
      if (locator) {
        const element = await this.element(locator)
        return element.callMethod(methodName, ...args)
      }
      const page = await (await this.getProgram()).currentPage()
      return page.callMethod(methodName, ...args)
    })
  }

  // ---- miniapp 深度测试(V0.2)----

  private wxMock: { api: string; captured: Array<Record<string, unknown>> } | undefined

  /** mock 任意 wx.* API:拦截调用并返回 mock 值;capture 记录真实调用参数(最近调用在前) */
  async mockWxApi(options: {
    api: string
    result?: Record<string, unknown>
    capture?: string
  }): Promise<void> {
    if (this.wxMock?.api === options.api) await this.restoreWxMock()
    const program = await this.getProgram()
    const captured: Array<Record<string, unknown>> = []
    this.wxMock = { api: options.api, captured }
    const callbackName = options.capture ? `__tpWxCapture_${options.capture}` : undefined
    if (callbackName) {
      await program.exposeFunction(callbackName, (payload: unknown) => {
        if (payload !== null && typeof payload === 'object') {
          captured.push(payload as Record<string, unknown>)
        }
      })
    }
    await program.mockWxMethod(
      options.api,
      function (this: { origin(o: unknown): unknown }, invokeOptions: Record<string, unknown>, cbName: string) {
        const callbacks = globalThis as unknown as Record<
          string,
          ((value: unknown) => void) | undefined
        >
        callbacks[cbName]?.({ options: invokeOptions })
        return options.result ?? this.origin(invokeOptions)
      },
      callbackName,
    )
  }

  /** 读取 mock 期间捕获的调用参数(引擎在带 capture 的 mockWxApi step 后调用;最近调用在前) */
  readWxApiCaptures(): { name: string; calls: Array<Record<string, unknown>> } | undefined {
    if (!this.wxMock) return undefined
    return { name: this.wxMock.api, calls: [...this.wxMock.captured].reverse() }
  }

  /** @deprecated 引擎已改用 readWxApiCaptures();保留按 API 名读取的旧入口 */
  readCapturedWxApiCalls(api: string): Array<Record<string, unknown>> {
    return this.wxMock?.api === api ? [...this.wxMock.captured].reverse() : []
  }

  /** 恢复 mock 的 wx API(用例结束由引擎调用) */
  async restoreWxMock(): Promise<void> {
    const mock = this.wxMock
    if (!mock) return
    this.wxMock = undefined
    if (!this.program) return
    await this.program.restoreWxMethod(mock.api).catch(() => undefined)
  }

  /** 触发组件事件(trigger;detail 作为 e.detail 注入,空 detail 即"用户拒绝/取消"类分支) */
  async trigger(locator: CaseLocator, eventType: string, detail?: Record<string, unknown>): Promise<void> {
    await this.runWithReconnect(async () => {
      const element = await this.element(locator)
      await element.trigger(eventType, detail)
    })
  }

  /** 读取页面 data(点号路径,缺省为整个 data 对象) */
  async getData(dataPath?: string): Promise<unknown> {
    return this.runWithReconnect(async () => {
      const page = await (await this.getProgram()).currentPage()
      return page.data(dataPath)
    })
  }

  /** 写入 data 补丁(setData 驱动 onShow/onPullDownRefresh 等真实链路);locator 提供时为组件级 */
  async setData(patch: Record<string, unknown>, locator?: CaseLocator): Promise<void> {
    await this.runWithReconnect(async () => {
      if (locator) {
        await (await this.element(locator)).setData(patch)
        return
      }
      const page = await (await this.getProgram()).currentPage()
      await page.setData(patch)
    })
  }

  /** 断言页面 data 路径的值包含 expected(数据绑定未完成时轮询等待) */
  async assertData(dataPath: string, expected: string): Promise<void> {
    await this.runWithReconnect(async () => {
      const page = await (await this.getProgram()).currentPage()
      const wanted = expected.trim()
      const startedAt = Date.now()
      for (;;) {
        const actual = stringifyDataValue(await page.data(dataPath))
        if (actual.includes(wanted)) return
        if (Date.now() - startedAt > TEXT_WAIT_MS) {
          throw new TestPilotError(
            'ASSERTION_FAILED',
            `页面 data 断言失败(等待 ${TEXT_WAIT_MS}ms):data.${dataPath} 期望包含 "${wanted}",实际为 "${actual.slice(0, 200)}"`,
          )
        }
        await delay(300)
      }
    })
  }

  // ---- miniapp 交互扩展(对照官方 automator Element / MiniProgram API)----

  /** 长按元素 */
  async longpress(locator: CaseLocator): Promise<void> {
    await this.runWithReconnect(async () => (await this.element(locator)).longpress())
  }

  /** 主动调用 wx.* API(如 setStorageSync / clearStorageSync 造前置状态) */
  async callWxApi(api: string, args: readonly unknown[] = []): Promise<unknown> {
    return this.runWithReconnect(async () => {
      const program = await this.getProgram()
      if (typeof program.callWxMethod !== 'function') {
        throw new TestPilotError(
          'UNSUPPORTED_ACTION',
          '当前 miniprogram-automator 不支持 callWxMethod,请升级微信开发者工具后重试',
        )
      }
      return program.callWxMethod(api, ...args)
    })
  }

  /** 派发触摸事件(touchstart / touchmove / touchend) */
  async touch(
    locator: CaseLocator,
    phase: string,
    touches: ReadonlyArray<Record<string, unknown>>,
    changedTouches: ReadonlyArray<Record<string, unknown>>,
  ): Promise<void> {
    await this.runWithReconnect(async () => {
      const element = await this.element(locator)
      const options = { touches: [...touches], changedTouches: [...changedTouches] }
      if (phase === 'touchstart') await element.touchstart(options)
      else if (phase === 'touchmove') await element.touchmove(options)
      else if (phase === 'touchend') await element.touchend(options)
      else throw new TestPilotError('UNSUPPORTED_ACTION', `未知触摸阶段:${phase}`)
    })
  }

  /** 滚动:locator 提供时滚动 scroll-view 元素,缺省滚动页面 */
  async scroll(locator: CaseLocator | undefined, scrollTop: number): Promise<void> {
    await this.runWithReconnect(async () => {
      if (locator) {
        await (await this.element(locator)).scrollTo(scrollTop)
        return
      }
      const program = await this.getProgram()
      if (typeof program.pageScrollTo !== 'function') {
        throw new TestPilotError(
          'UNSUPPORTED_ACTION',
          '当前 miniprogram-automator 不支持 pageScrollTo,请升级微信开发者工具后重试',
        )
      }
      await program.pageScrollTo(scrollTop)
    })
  }

  /** swiper 切换到指定页 */
  async swipeTo(locator: CaseLocator, index: number): Promise<void> {
    await this.runWithReconnect(async () => (await this.element(locator)).swipeTo(index))
  }

  /** slider 滑到指定值 */
  async slideTo(locator: CaseLocator, value: number): Promise<void> {
    await this.runWithReconnect(async () => (await this.element(locator)).slideTo(value))
  }

  /** movable-view 移动到指定坐标 */
  async moveTo(locator: CaseLocator, x: number, y: number): Promise<void> {
    await this.runWithReconnect(async () => (await this.element(locator)).moveTo(x, y))
  }

  /** 统计匹配元素数量(单次读取;存在性/计数断言的重试语义由引擎负责) */
  async countElements(locator: CaseLocator): Promise<number> {
    return this.runWithReconnect(async () => {
      const page = await (await this.getProgram()).currentPage()
      const elements = await page.$$(this.cssSelector(locator))
      return elements.length
    })
  }

  /** 读取元素 attribute(不存在时为 undefined/null) */
  async getElementAttribute(locator: CaseLocator, name: string): Promise<unknown> {
    return this.runWithReconnect(async () => (await this.element(locator)).attribute(name))
  }

  /** 读取元素 property(miniapp 自定义组件实例属性) */
  async getElementProperty(locator: CaseLocator, name: string): Promise<unknown> {
    return this.runWithReconnect(async () => (await this.element(locator)).property(name))
  }

  /** 导出运行时诊断:console 尾部 / 异常 / 页面栈 / systemInfo(失败取证由引擎落盘) */
  async readDiagnostics(): Promise<RuntimeDiagnostics> {
    const program = this.program
    const pageStack = (await program?.pageStack?.().catch(() => undefined)) as
      | RuntimeDiagnostics['pageStack']
      | undefined
    const systemInfo = (await program?.systemInfo?.().catch(() => undefined)) as
      | RuntimeDiagnostics['systemInfo']
      | undefined
    return {
      consoleLogs: [...this.consoleLogs],
      exceptions: [...this.exceptions],
      pageStack,
      systemInfo,
    }
  }

  /** 订阅小程序 console / exception 事件(每个 program 实例只挂一次) */
  private attachDiagnostics(program: AutomatorProgram): void {
    if (this.diagnosticsAttachedTo === program || typeof program.on !== 'function') return
    this.diagnosticsAttachedTo = program
    program.on('console', (payload) => {
      const record = (payload ?? {}) as { type?: unknown; args?: unknown }
      const args = Array.isArray(record.args) ? record.args : []
      this.pushConsoleLog({
        ts: new Date().toISOString(),
        type: typeof record.type === 'string' ? record.type : 'log',
        text: args.map(serializeConsoleArg).join(' ').slice(0, CONSOLE_TEXT_LIMIT),
      })
    })
    program.on('exception', (payload) => {
      const record = (payload ?? {}) as { message?: unknown }
      const message = typeof record.message === 'string' ? record.message : String(payload)
      this.exceptions.push(message.slice(0, CONSOLE_TEXT_LIMIT))
      if (this.exceptions.length > DIAGNOSTICS_BUFFER_MAX) this.exceptions.shift()
    })
  }

  private pushConsoleLog(entry: ConsoleLogEntry): void {
    this.consoleLogs.push(entry)
    if (this.consoleLogs.length > DIAGNOSTICS_BUFFER_MAX) this.consoleLogs.shift()
  }

  async screenshot(): Promise<Buffer> {
    return this.runWithReconnect(async () => {
      const base64 = await (await this.getProgram()).screenshot()
      return Buffer.from(base64, 'base64')
    })
  }

  async startRequestCapture(): Promise<void> {
    if (this.requestCapture) await this.stopRequestCapture()
    const program = await this.getProgram()
    const requests: CapturedRequest[] = []
    const exposedName = `__testpilotRequest_${Date.now()}_${Math.random().toString(36).slice(2)}`
    await program.exposeFunction(exposedName, (value: unknown) => {
      if (value === null || typeof value !== 'object') return
      const request = value as Record<string, unknown>
      if (typeof request.url !== 'string') return
      requests.push({
        method: typeof request.method === 'string' ? request.method : 'GET',
        url: request.url,
      })
    })
    await program.mockWxMethod(
      'request',
      function (
        this: { origin(options: unknown): unknown },
        options: Record<string, unknown>,
        callbackName: string,
      ) {
        const callbacks = globalThis as unknown as Record<
          string,
          ((request: { method: string; url: string }) => void) | undefined
        >
        callbacks[callbackName]?.({
          method: typeof options.method === 'string' ? options.method : 'GET',
          url: typeof options.url === 'string' ? options.url : '',
        })
        return this.origin(options)
      },
      exposedName,
    )
    this.requestCapture = { program, exposedName, requests }
  }

  async stopRequestCapture(): Promise<CapturedRequest[]> {
    if (!this.requestCapture) return []
    const capture = this.requestCapture
    this.requestCapture = undefined
    await capture.program.restoreWxMethod('request')
    return capture.requests
  }

  async close(): Promise<void> {
    await this.stopRequestCapture().catch(() => [])
    if (!this.program) return
    const program = this.program
    this.program = undefined
    if (this.config.closeIde) {
      await program.close().catch(() => undefined)
    } else {
      await program.disconnect().catch(() => undefined)
    }
  }

  /** 连接被断开时重连一次再重试;其他错误原样抛出 */
  private async runWithReconnect<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!CONNECTION_LOST.test(message)) throw err
      await this.reconnect()
      return operation()
    }
  }

  private async reconnect(): Promise<void> {
    this.program = undefined
    await this.launch().catch(() => undefined)
  }

  private async getProgram(): Promise<AutomatorProgram> {
    if (!this.program) {
      // 引擎保证先 launch;此处兜底自动建立连接
      await this.launch()
    }
    return this.program!
  }

  private cssSelector(locator: CaseLocator): string {
    if (locator.css === undefined) {
      throw new Error('小程序端仅支持 css locator(class/id),不支持 text')
    }
    return locator.css
  }

  /** 轮询等待元素出现(模拟器编译/渲染期间元素可能尚未挂载) */
  private async element(locator: CaseLocator): Promise<AutomatorElement> {
    const selector = this.cssSelector(locator)
    const startedAt = Date.now()
    for (;;) {
      const page = await (await this.getProgram()).currentPage()
      const element = await page.$(selector)
      if (element) return element
      if (Date.now() - startedAt > ELEMENT_WAIT_MS) {
        throw new TestPilotError('ELEMENT_NOT_FOUND', `等待元素超时(${ELEMENT_WAIT_MS}ms):${selector}`)
      }
      await delay(500)
    }
  }
}
