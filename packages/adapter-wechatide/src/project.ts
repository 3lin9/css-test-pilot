import { existsSync } from 'node:fs'
import { findWechatDevToolsCli } from '@testpilot/core'

export interface MiniappAdapterConfig {
  /** 小程序项目目录(包含 project.config.json) */
  projectPath: string
  /** 开发者工具 cli 可执行文件;缺省时自动探测(环境变量 / 常见位置 / 注册表) */
  cliPath?: string
  /** 运行结束后直接关闭开发者工具(默认仅断开自动化连接,保留 IDE) */
  closeIde: boolean
}

export interface MiniappConfigInput {
  projectPath?: string
  cliPath?: string
}

/**
 * 合并显式配置与环境变量(TESTPILOT_MINIPROGRAM_PROJECT_PATH / WECHAT_DEVTOOLS_CLI),
 * 校验路径存在;未配置 projectPath 时返回 undefined。
 */
export async function resolveMiniappConfig(input: MiniappConfigInput): Promise<MiniappAdapterConfig | undefined> {
  const projectPath = input.projectPath ?? process.env.TESTPILOT_MINIPROGRAM_PROJECT_PATH
  if (!projectPath) return undefined
  if (!existsSync(projectPath)) {
    throw new Error(`小程序项目路径不存在:${projectPath}`)
  }
  const cliPath = input.cliPath ?? process.env.WECHAT_DEVTOOLS_CLI ?? (await findWechatDevToolsCli())
  return {
    projectPath,
    cliPath,
    closeIde: process.env.TESTPILOT_MINIPROGRAM_CLOSE_IDE === 'true',
  }
}
