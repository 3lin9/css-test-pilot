import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { collectNativeCases, loadProjectConfig, resolveRoot, type ProjectOptions } from '@testpilot/sdk'

/** native.md 约定的视角取值(与评审清单一致) */
export const PERSPECTIVES = [
  'charter:persona',
  'charter:edge-input',
  'charter:numbers-copy',
  'charter:state-recovery',
  'charter:error-path',
] as const

export interface NativeLintFile {
  /** 相对项目根的脚本路径 */
  file: string
  issues: string[]
}

export interface NativeLintReport {
  files: NativeLintFile[]
  issueCount: number
}

const HEADER_HEAD_CHARS = 4000

/**
 * 原生脚本 lint:no-invention 的残留硬卡。
 * 1) 头注释 evidence 链(测试点 ID + 视角枚举)
 * 2) 测试点 ID 必须在 tests/e2e/reviews/ 清单中——清单是唯一的用例来源
 * 3) process.env.* 引用必须在 .env.testing / testpilot.yaml 中声明
 */
export async function lintNativeCases(paths: readonly string[], options: ProjectOptions = {}): Promise<NativeLintReport> {
  const root = resolveRoot(options.root)
  const files = paths.length > 0 ? paths : await collectNativeCases([], { root })

  const reviewsText = await readReviewsText(root)
  const knownEnv = await collectKnownEnvNames(root)
  const report: NativeLintFile[] = []
  let issueCount = 0

  for (const file of files) {
    const issues: string[] = []
    const source = await readFile(file, 'utf8').catch(() => '')
    const head = source.slice(0, HEADER_HEAD_CHARS)

    const testPointId = /^\s*\/\/\s*测试点[:：]\s*(\S+)/m.exec(head)?.[1]
    if (!testPointId) {
      issues.push('缺少文件头 `// 测试点: <ID>`(evidence 链起点)')
    } else if (reviewsText && !reviewsText.includes(testPointId)) {
      issues.push(`测试点 ${testPointId} 不在 tests/e2e/reviews/ 清单中——清单里没有的 ID 不得生成用例`)
    }

    const perspective = /^\s*\/\/\s*视角[:：]\s*(\S+)/m.exec(head)?.[1]
    if (!perspective) {
      issues.push('缺少文件头 `// 视角: charter:*`')
    } else if (!(PERSPECTIVES as readonly string[]).includes(perspective)) {
      issues.push(`视角 ${perspective} 不在枚举内(${PERSPECTIVES.join(' / ')})`)
    }

    for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (!knownEnv.has(match[1])) {
        issues.push(`环境变量 ${match[1]} 未在 .env.testing / testpilot.yaml 中声明`)
      }
    }

    issueCount += issues.length
    report.push({ file: relative(root, file) || file, issues })
  }
  return { files: report, issueCount }
}

async function readReviewsText(root: string): Promise<string> {
  const dir = join(root, 'tests', 'e2e', 'reviews')
  if (!existsSync(dir)) return ''
  const entries = await readdir(dir).catch(() => [])
  const texts = await Promise.all(
    entries
      .filter((entry) => /\.(md|yaml|yml|json)$/i.test(entry))
      .map((entry) => readFile(join(dir, entry), 'utf8').catch(() => '')),
  )
  return texts.join('\n')
}

async function collectKnownEnvNames(root: string): Promise<Set<string>> {
  const names = new Set<string>(['NODE_ENV', 'CI'])
  // TESTPILOT_* 运行时注入的变量天然合法
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('TESTPILOT_')) names.add(key)
  }
  // .env.testing 的 KEY=...(本地直接填值的文件)
  const envTesting = await readFile(join(root, '.env.testing'), 'utf8').catch(() => '')
  for (const match of envTesting.matchAll(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/gm)) {
    names.add(match[1])
  }
  // testpilot.yaml 的 ${VAR} 引用(配置里出现的变量即已声明)
  if (existsSync(join(root, 'testpilot.yaml'))) {
    await loadProjectConfig(root).catch(() => undefined)
    const raw = await readFile(join(root, 'testpilot.yaml'), 'utf8').catch(() => '')
    for (const match of raw.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
      names.add(match[1])
    }
  }
  return names
}
