import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
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
