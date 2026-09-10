import automator from 'miniprogram-automator'
import { spawn } from 'node:child_process'
import net from 'node:net'
import type { CaseLocator, StepTarget } from '@testpilot/dsl'
import type { TestAdapter } from '@testpilot/adapter-core'
import type { MiniappAdapterConfig } from './project'

/** 与 miniprogram-automator 运行时结构对应的最小类型(仅用到的能力) */
interface AutomatorElement {
  tap(): Promise<void>
  text(): Promise<string>
  input(value: string): Promise<void>
}

interface AutomatorPage {
  $(selector: string): Promise<AutomatorElement | null>
  waitFor(selectorOrMs: string | number): Promise<unknown>
}

export interface AutomatorProgram {
  reLaunch(url: string): Promise<unknown>
  currentPage(): Promise<AutomatorPage>
  screenshot(): Promise<string>
  disconnect(): Promise<void>
  close(): Promise<void>
}

/** 启动器抽象:便于测试注入假实现(默认绑定 miniprogram-automator SDK) */
export interface AutomatorLauncher {
  launch(options: { projectPath: string; cliPath?: string }): Promise<AutomatorProgram>
}

const AUTO_PORT_FALLBACK_WAIT_MS = 90_000
const NAVIGATE_RETRY_WINDOW_MS = 45_000
const ELEMENT_WAIT_MS = 10_000
/** 模拟器重编译 / IDE 重启会断开自动化 ws 连接 */
const CONNECTION_LOST = /connection closed|not connected/i

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
    child.once('error', (err) => rejectPromise(new Error(`拉起开发者工具 cli 失败:${err.message}`)))
    child.once('exit', (code) => {
      if (code === 0) {
        resolvePromise()
      } else {
        rejectPromise(new Error(`cli auto 退出码 ${code}:${output.slice(-400)}`))
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
          rejectPromise(new Error(`等待开发者工具自动化端口 ${port} 超时;请确认:1) 工具已登录 2) 设置->安全设置->服务端口已开启`))
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
        return
      } catch (err) {
        lastError = err
        await delay(3_000)
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  async click(locator: CaseLocator): Promise<void> {
    await this.runWithReconnect(async () => (await this.element(locator)).tap())
  }

  async input(locator: CaseLocator, value: string): Promise<void> {
    await this.runWithReconnect(async () => (await this.element(locator)).input(value))
  }

  async select(): Promise<void> {
    throw new Error('小程序端暂不支持 select(picker 交互),请改用 click 完成选择')
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
      const actual = (await element.text()).trim()
      const wanted = expected.trim()
      if (!actual.includes(wanted)) {
        throw new Error(`断言失败:期望包含 "${wanted}",实际为 "${actual.slice(0, 200)}"`)
      }
    })
  }

  async extract(locator: CaseLocator): Promise<string> {
    return this.runWithReconnect(async () => {
      const element = await this.element(locator)
      return (await element.text()).trim()
    })
  }

  async screenshot(): Promise<Buffer> {
    return this.runWithReconnect(async () => {
      const base64 = await (await this.getProgram()).screenshot()
      return Buffer.from(base64, 'base64')
    })
  }

  async close(): Promise<void> {
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
        throw new Error(`等待元素超时(${ELEMENT_WAIT_MS}ms):${selector}`)
      }
      await delay(500)
    }
  }
}
