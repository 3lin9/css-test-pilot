import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { net } from 'node:net'
import { dirname, join } from 'node:path'
import { NATIVE_CODE_PREFIX } from '@testpilot/core'

/** 官方默认自动化端口(cli auto --auto-port 9420) */
export const DEFAULT_AUTOMATOR_PORT = 9420

/**
 * miniprogram-automator 的最小结构化接口。
 * 官方包是可选依赖(未安装时这里不做类型依赖);helper 只调用会话建立相关成员,其余 API 在脚本内按官方类型调用。
 */
export interface MiniProgramLike {
  close(): Promise<void>
  disconnect(): Promise<void>
  /** 开启真机调试:remote(true) 自动调起微信(安卓 >= 7.0.6 / iOS >= 6.6.7) */
  remote(enable?: boolean): Promise<void>
  /** 读取登录票据(2 小时有效);配合 launch({ ticket }) 实现 CI 免扫码 */
  getTicket(): Promise<string>
  // 官方 API 面(reLaunch/currentPage/$/$$/mockWxMethod/callWxMethod…)由脚本侧按官方类型使用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

interface AutomatorModule {
  connect(options: { wsEndpoint: string }): Promise<MiniProgramLike>
  launch(options: {
    projectPath: string
    cliPath?: string
    port?: number
    timeout?: number
    account?: string
    ticket?: string
    projectConfig?: Record<string, unknown>
  }): Promise<MiniProgramLike>
}

export interface LaunchMiniAppOptions {
  /** 小程序项目目录(含 project.config.json);缺省读 MINIAPP_PROJECT_PATH */
  projectPath?: string
  /** 开发者工具 cli 路径;缺省读 MINIAPP_CLI_PATH,再按官方默认位置查找 */
  cliPath?: string
  /** 自动化端口;默认 9420 */
  port?: number
  /** 启动超时 ms;官方默认 30000 */
  timeout?: number
  /** 多账号调试:以指定 openid 启动(IDE >= 1.02.2002272) */
  account?: string
  /** 登录票据(工具登录态跨机器复用,2 小时有效);缺省读本地缓存 */
  ticket?: string
  /** 启动时覆盖 project.config.json 的字段 */
  projectConfig?: Record<string, unknown>
  /** 'auto'(默认)先探测常驻自动化端口,存在则 connect(免重复启动编译);否则 launch。'launch' / 'connect' 强制指定 */
  mode?: 'auto' | 'launch' | 'connect'
  /** launch 成功后开启真机调试 */
  remote?: boolean
  /** launch 成功后把 getTicket() 缓存到 <root>/.testpilot/cache/,供后续 run/CI 复用;默认开启 */
  cacheTicket?: boolean
  /** ticket 缓存定位的项目根;默认 process.cwd() */
  root?: string
  /** connect 的 wsEndpoint;缺省按 port 拼 ws://127.0.0.1:<port> */
  wsEndpoint?: string
}

const TICKET_CACHE = join('.testpilot', 'cache', 'miniapp-ticket.json')

function infraError(message: string): Error {
  // 带 [TESTPILOT:ENVIRONMENT_UNAVAILABLE] 前缀:ingest 归一为 blocked,脚本不必自己标
  return new Error(`${NATIVE_CODE_PREFIX}ENVIRONMENT_UNAVAILABLE] ${message}`)
}

/**
 * 建立小程序自动化会话,返回官方 MiniProgram;之后的操作全部是原生 API,不做步骤翻译。
 * 连接模式的稳定性收益与官方参数透传见《TestPilot-原生脚本改造设计.md》§6.1。
 */
export async function launchMiniApp(options: LaunchMiniAppOptions = {}): Promise<MiniProgramLike> {
  const automator = await loadAutomator()
  const port = options.port ?? DEFAULT_AUTOMATOR_PORT
  const mode = options.mode ?? 'auto'
  const ticket = options.ticket ?? (await readCachedTicket(options.root))

  if (mode !== 'launch') {
    const wsEndpoint = options.wsEndpoint ?? `ws://127.0.0.1:${port}`
    if (mode === 'connect' || (await isPortOpen(port))) {
      return automator.connect({ wsEndpoint })
    }
  }

  const projectPath = options.projectPath ?? process.env.MINIAPP_PROJECT_PATH
  if (!projectPath) {
    throw infraError('launchMiniApp: 缺少 projectPath(或环境变量 MINIAPP_PROJECT_PATH)')
  }
  const mini = await automator.launch({
    projectPath,
    cliPath: options.cliPath ?? process.env.MINIAPP_CLI_PATH,
    port,
    timeout: options.timeout,
    account: options.account,
    ticket,
    projectConfig: options.projectConfig,
  })
  if (options.remote) await mini.remote(true)
  if (options.cacheTicket !== false) await cacheTicket(mini, options.root)
  return mini
}

async function loadAutomator(): Promise<AutomatorModule> {
  try {
    // 动态变量 import:可选依赖,不在类型层面绑定
    const packageName = 'miniprogram-automator'
    return (await import(packageName)) as unknown as AutomatorModule
  } catch {
    throw infraError('未安装 miniprogram-automator:在项目中运行 npm i -D miniprogram-automator')
  }
}

function isPortOpen(port: number, host = '127.0.0.1', timeoutMs = 500): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = net.connect({ host, port })
    const settle = (open: boolean) => {
      socket.destroy()
      resolvePromise(open)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })
}

async function readCachedTicket(root?: string): Promise<string | undefined> {
  try {
    const raw = JSON.parse(await readFile(join(root ?? process.cwd(), TICKET_CACHE), 'utf8')) as {
      ticket?: string
    }
    return raw.ticket || undefined
  } catch {
    return undefined
  }
}

/** 登录票据尽力而为:未登录或旧版 IDE 没有该 API 时静默跳过 */
async function cacheTicket(mini: MiniProgramLike, root?: string): Promise<void> {
  try {
    const ticket = await mini.getTicket()
    if (!ticket) return
    const file = join(root ?? process.cwd(), TICKET_CACHE)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(
      file,
      JSON.stringify({ ticket, savedAt: new Date().toISOString() }, null, 2),
      'utf8',
    )
  } catch {
    // 忽略:票据缓存失败不影响测试执行
  }
}
