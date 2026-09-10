import { readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

export const DEFAULT_CASES_DIR = 'tests/e2e/cases'

/** 展开输入路径:目录递归收集 .yaml/.yml,文件直接保留;不存在的路径跳过 */
export async function collectCaseFiles(paths: readonly string[]): Promise<string[]> {
  const files: string[] = []
  for (const input of paths) {
    const info = await stat(input).catch(() => undefined)
    if (!info) continue
    if (info.isDirectory()) {
      files.push(...(await collectFromDir(input)))
    } else if (isCaseFile(input)) {
      files.push(input)
    }
  }
  return [...new Set(files)].sort()
}

async function collectFromDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const found: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await collectFromDir(full)))
    } else if (isCaseFile(entry.name)) {
      found.push(full)
    }
  }
  return found
}

function isCaseFile(file: string): boolean {
  const ext = extname(file).toLowerCase()
  return ext === '.yaml' || ext === '.yml'
}
