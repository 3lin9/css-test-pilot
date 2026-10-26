import { exec, execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { WECHAT_DEVTOOLS_CLI_PATHS } from './constants'

const CLI_NAMES = ['cli.bat', 'cli']

const REGISTRY_UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
]

/**
 * 定位微信开发者工具 cli,依次尝试:
 * 1. 环境变量 WECHAT_DEVTOOLS_CLI
 * 2. 常见安装位置(WECHAT_DEVTOOLS_CLI_PATHS)
 * 3. 各盘符下 Program Files 的 Tencent 目录扫描
 * 4. 注册表卸载信息反查(覆盖自定义安装路径)
 */
export async function findWechatDevToolsCli(): Promise<string | undefined> {
  const fromEnv = process.env.WECHAT_DEVTOOLS_CLI
  if (fromEnv && existsSync(fromEnv)) return fromEnv

  for (const candidate of WECHAT_DEVTOOLS_CLI_PATHS) {
    if (existsSync(candidate)) return candidate
  }

  if (process.platform !== 'win32') return undefined

  for (const dir of candidateInstallDirs()) {
    for (const name of CLI_NAMES) {
      const cli = join(dir, name)
      if (existsSync(cli)) return cli
    }
  }

  return await findFromRegistry()
}

/** 扫描各盘符 Program Files 下的 Tencent 目录,返回"微信web开发者工具"安装目录 */
function candidateInstallDirs(): string[] {
  const dirs: string[] = []
  const tencentParents: string[] = []

  for (let code = 67; code <= 90; code++) {
    // 'C'..'Z'
    const drive = `${String.fromCharCode(code)}:\\`
    if (!existsSync(drive)) continue
    tencentParents.push(
      join(drive, 'Program Files (x86)', 'Tencent'),
      join(drive, 'Program Files', 'Tencent'),
    )
  }
  if (process.env.LOCALAPPDATA) {
    tencentParents.push(join(process.env.LOCALAPPDATA, 'Programs'))
  }

  for (const parent of tencentParents) {
    if (!existsSync(parent)) continue
    try {
      for (const entry of readdirSync(parent)) {
        if (/微信web开发者工具|wechatwebdevtools/i.test(entry)) {
          dirs.push(join(parent, entry))
        }
      }
    } catch {
      // 无权限读取的目录跳过
    }
  }
  return dirs
}

/** 从注册表卸载信息(DisplayIcon / UninstallString)反查安装目录 */
async function findFromRegistry(): Promise<string | undefined> {
  for (const key of REGISTRY_UNINSTALL_KEYS) {
    let stdout: string
    try {
      stdout = await execToString('reg', ['query', key, '/s', '/f', '微信开发者工具', '/d'])
    } catch {
      continue
    }
    for (const line of stdout.split('\n')) {
      const match = /(?:DisplayIcon|UninstallString)\s+REG_SZ\s+(.+)/.exec(line)
      if (!match) continue
      // DisplayIcon 可能带 ",0" 后缀;UninstallString 是卸载程序路径
      const raw = match[1]!.trim().replace(/,\d+$/, '').trim()
      const installDir = dirBefore(raw, /微信开发者工具\.exe|卸载微信开发者工具\.exe/i)
      if (!installDir) continue
      for (const name of CLI_NAMES) {
        const cli = join(installDir, name)
        if (existsSync(cli)) return cli
      }
    }
  }
  return undefined
}

/** 从可执行文件路径中截取其所在目录(即安装目录) */
function dirBefore(filePath: string, marker: RegExp): string | undefined {
  const match = new RegExp(`^(.*?)${marker.source}`, 'i').exec(filePath)
  return match?.[1] ?? undefined
}

/** reg 输出为控制台编码(中文系统为 GBK),以 buffer 接收后统一解码 */
function execToString(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(command, args, { encoding: 'buffer', windowsHide: true }, (err, stdout) => {
      if (err) {
        rejectPromise(err)
        return
      }
      resolvePromise(new TextDecoder('gbk').decode(stdout as Buffer))
    })
  })
}

/**
 * 查询开发者工具登录态(cli islogin)。
 * 返回 true / false;cli 执行失败或输出无法识别时返回 undefined(调用方按「未知」处理)。
 * 不同工具版本的输出文案有差异,这里做宽松解析。
 */
export async function isWechatDevToolsLoggedIn(cliPath: string): Promise<boolean | undefined> {
  const output = await execCliToString(cliPath, ['islogin']).catch(() => undefined)
  if (output === undefined) return undefined
  if (/is\s*login\s*[:=]?\s*(true|yes|1)\b/i.test(output)) return true
  if (/is\s*login\s*[:=]?\s*(false|no|0)\b/i.test(output)) return false
  if (/\btrue\b/i.test(output)) return true
  if (/\bfalse\b/i.test(output)) return false
  return undefined
}

/**
 * 执行开发者工具 cli 子命令并取回输出。
 * cli 在 Windows 上是 .bat,Node 20.12+ 禁止直接 spawn,须走 shell;路径含空格自行加引号。
 * 非零退出码但有输出时仍返回输出(部分子命令以退出码表达业务结果)。
 */
function execCliToString(cliPath: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const quote = (value: string) => (/\s/.test(value) ? `"${value}"` : value)
    // exec 在 Windows 上本身即经 shell 执行,.bat 可直接运行
    exec(
      `"${cliPath}" ${args.map(quote).join(' ')}`,
      { windowsHide: true, timeout: 30_000, encoding: 'buffer' },
      (err, stdout, stderr) => {
        const text = `${stdout.toString('utf8')}${stderr.toString('utf8')}`.trim()
        if (err && !text) {
          rejectPromise(err)
          return
        }
        resolvePromise(text)
      },
    )
  })
}

export type MiniappRuntimeIssueCode =
  | 'CLI_NOT_FOUND'
  | 'NOT_LOGGED_IN'
  | 'SERVICE_PORT_UNCONFIRMED'
  | 'PROJECT_CONFIG_MISSING'
  | 'APPID_MISSING'
  | 'TOURIST_APPID'

export interface MiniappRuntimeIssue {
  code: MiniappRuntimeIssueCode
  summary: string
  hint: string
}

export interface MiniappRuntimeReport {
  cliPath?: string
  appid?: string
  loggedIn?: boolean
  issues: MiniappRuntimeIssue[]
}

/**
 * 小程序自动化能否启动的阻断检查。
 * 未登录、服务端口未开启、游客 appid 都会让授权弹窗和 CLI 调用失败。
 */
export async function inspectMiniappRuntime(
  input: { projectPath: string; cliPath?: string },
  deps: {
    findCli?: () => Promise<string | undefined>
    isLoggedIn?: (cliPath: string) => Promise<boolean | undefined>
  } = {},
): Promise<MiniappRuntimeReport> {
  const issues: MiniappRuntimeIssue[] = []
  const cliPath = input.cliPath ?? (await (deps.findCli ?? findWechatDevToolsCli)())
  let loggedIn: boolean | undefined
  if (!cliPath) {
    issues.push({
      code: 'CLI_NOT_FOUND',
      summary: '微信开发者工具 CLI 未找到',
      hint: '安装微信开发者工具,或设置 WECHAT_DEVTOOLS_CLI 指向 cli',
    })
  } else {
    loggedIn = await (deps.isLoggedIn ?? isWechatDevToolsLoggedIn)(cliPath)
    if (loggedIn === false) {
      issues.push({
        code: 'NOT_LOGGED_IN',
        summary: '开发者工具未登录',
        hint: '打开工具扫码登录后再运行小程序用例',
      })
    } else if (loggedIn !== true) {
      issues.push({
        code: 'SERVICE_PORT_UNCONFIRMED',
        summary: '无法确认开发者工具登录态',
        hint: '请确认工具已登录,且设置->安全设置->服务端口已开启',
      })
    }
  }

  const appidInfo = readMiniappProjectAppid(input.projectPath)
  if (!appidInfo) {
    issues.push({
      code: 'PROJECT_CONFIG_MISSING',
      summary: 'project.config.json 缺失',
      hint: `${input.projectPath} 下未找到,自动化无法定位项目`,
    })
  } else if (!appidInfo.appid) {
    issues.push({
      code: 'APPID_MISSING',
      summary: 'project.config.json 缺少 appid',
      hint: '手机号等授权能力不可用,请填写真实 appid',
    })
  } else if (appidInfo.appid === 'touristappid') {
    issues.push({
      code: 'TOURIST_APPID',
      summary: 'appid 为 touristappid(游客模式)',
      hint: '游客模式无法完成手机号等授权,请在 project.config.json 填写真实 appid',
    })
  }

  return {
    ...(cliPath ? { cliPath } : {}),
    ...(appidInfo?.appid ? { appid: appidInfo.appid } : {}),
    ...(loggedIn !== undefined ? { loggedIn } : {}),
    issues,
  }
}

/**
 * 读取小程序 project.config.json 的 appid(用于 doctor 校验)。
 * 文件缺失或 JSON 损坏时返回 undefined;appid 缺失时 appid 字段为 undefined。
 */
export function readMiniappProjectAppid(
  projectPath: string,
): { appid?: string; configPath: string } | undefined {
  const configPath = join(projectPath, 'project.config.json')
  if (!existsSync(configPath)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { appid?: unknown }
    return { appid: typeof parsed.appid === 'string' ? parsed.appid : undefined, configPath }
  } catch {
    return undefined
  }
}
