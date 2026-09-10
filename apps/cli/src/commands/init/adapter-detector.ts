import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findWechatDevToolsCli } from '@testpilot/core'
import type { ProjectType } from './project-detector'

export type AdapterId = 'playwright' | 'wechatide'

export interface AdapterInfo {
  id: AdapterId
  /** 工具链是否就绪(不就绪只降级为 warning,不阻塞 init) */
  available: boolean
  detail: string
  /** 该 Adapter 是否被当前项目类型需要 */
  required: boolean
}

/** 检测执行端可用性(设计文档 §11):Playwright 依赖与微信开发者工具 */
export async function detectAdapters(root: string, projectType: ProjectType): Promise<AdapterInfo[]> {
  const required = projectType === 'hybrid' ? ['playwright', 'wechatide']
    : projectType === 'wechat-miniapp' ? ['wechatide']
      : projectType === 'web' ? ['playwright']
        : []

  const pkg = readPackageJsonDeps(root)
  const hasPlaywrightDep = pkg !== undefined && ('playwright' in pkg || '@playwright/test' in pkg)
  const playwrightInstalled = hasPlaywrightDep || existsSync(join(root, 'node_modules', 'playwright'))

  const devtoolsCli = await findWechatDevToolsCli().catch(() => undefined)

  return [
    {
      id: 'playwright',
      available: playwrightInstalled,
      detail: playwrightInstalled ? (pkg?.['playwright'] ?? pkg?.['@playwright/test'] ?? '已安装') : '未检测到(pnpm add -D playwright)',
      required: required.includes('playwright'),
    },
    {
      id: 'wechatide',
      available: devtoolsCli !== undefined,
      detail: devtoolsCli ?? '未找到微信开发者工具(可设置 WECHAT_DEVTOOLS_CLI 指向 cli 可执行文件)',
      required: required.includes('wechatide'),
    },
  ]
}

function readPackageJsonDeps(root: string): Record<string, string> | undefined {
  const file = join(root, 'package.json')
  if (!existsSync(file)) return undefined
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    return { ...pkg.dependencies, ...pkg.devDependencies }
  } catch {
    return undefined
  }
}
