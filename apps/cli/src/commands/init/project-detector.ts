import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { readGitInfo } from '../../lib/git'

/** V0.1 项目类型(设计文档 §5) */
export type ProjectType = 'web' | 'wechat-miniapp' | 'hybrid' | 'unknown'

export interface ProjectInfo {
  root: string
  name: string
  type: ProjectType
  language: 'TypeScript' | 'JavaScript' | 'Unknown'
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'npx'
  git: Awaited<ReturnType<typeof readGitInfo>>
  /** 已有 tests/e2e(直接复用) */
  hasTestsE2e: boolean
  /** 项目里其他常见 E2E 目录(提示复用,不强制迁移) */
  existingE2eDirs: string[]
  hasTestpilotConfig: boolean
  hasProjectLink: boolean
}

/** 视为 Web 项目特征的前端/测试依赖 */
const WEB_DEP_MARKERS = [
  'playwright',
  '@playwright/test',
  'vite',
  'next',
  'react',
  'vue',
  '@angular/core',
  'nuxt',
  'svelte',
]

const E2E_DIR_CANDIDATES = ['tests/e2e', 'test/e2e', 'e2e', 'cypress']

interface PackageJson {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function readPackageJson(root: string): PackageJson | undefined {
  const file = join(root, 'package.json')
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PackageJson
  } catch {
    return undefined
  }
}

/** 项目类型:微信小程序 / Web / 混合 / 未知(均允许完成初始化) */
export function detectProjectType(root: string): ProjectType {
  const pkg = readPackageJson(root)
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
  const isWechat =
    existsSync(join(root, 'project.config.json')) ||
    existsSync(join(root, 'app.json')) ||
    existsSync(join(root, 'miniprogram', 'app.json'))
  const isWeb =
    existsSync(join(root, 'index.html')) ||
    WEB_DEP_MARKERS.some((marker) => deps?.[marker] !== undefined) ||
    ['.ts', '.tsx', '.js', '.jsx'].some((ext) => existsSync(join(root, 'src', `index${ext}`)))
  if (isWechat && isWeb) return 'hybrid'
  if (isWechat) return 'wechat-miniapp'
  if (isWeb) return 'web'
  return 'unknown'
}

/** 检测项目基础信息(设计文档 §5:名称/类型/语言/包管理器/Git/已有测试结构) */
export async function detectProject(root: string): Promise<ProjectInfo> {
  const pkg = readPackageJson(root)
  const type = detectProjectType(root)

  const language = existsSync(join(root, 'tsconfig.json'))
    ? 'TypeScript'
    : pkg || existsSync(join(root, 'src'))
      ? 'JavaScript'
      : 'Unknown'

  const packageManager = existsSync(join(root, 'pnpm-lock.yaml'))
    ? 'pnpm'
    : existsSync(join(root, 'yarn.lock'))
      ? 'yarn'
      : existsSync(join(root, 'package-lock.json'))
        ? 'npm'
        : 'npx'

  const existingE2eDirs = E2E_DIR_CANDIDATES.filter((dir) => existsSync(join(root, dir)))

  return {
    root,
    name: pkg?.name ?? basename(root),
    type,
    language,
    packageManager,
    git: await readGitInfo(root),
    hasTestsE2e: existingE2eDirs.includes('tests/e2e'),
    existingE2eDirs,
    hasTestpilotConfig: existsSync(join(root, 'testpilot.yaml')),
    hasProjectLink: existsSync(join(root, '.testpilot', 'project.json')),
  }
}

/** 项目类型 -> 默认执行端(project.json defaultAdapter) */
export function defaultAdapterFor(type: ProjectType): string {
  if (type === 'wechat-miniapp') return 'wechatide'
  return 'playwright'
}

/** 项目类型 -> 声明的执行端列表(testpilot.yaml adapters) */
export function adaptersFor(type: ProjectType): string[] {
  if (type === 'hybrid') return ['playwright', 'wechatide']
  if (type === 'wechat-miniapp') return ['wechatide']
  if (type === 'web') return ['playwright']
  return ['playwright']
}
