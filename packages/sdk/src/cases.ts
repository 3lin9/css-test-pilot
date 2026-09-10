import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import type { DslIssue, CaseValidationResult, TestCase } from '@testpilot/dsl'
import { validateCaseSource } from '@testpilot/dsl'
import { resolveRoot, type ProjectOptions } from './project'

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

/** 相对路径按项目根目录解析,绝对路径原样保留 */
function resolveAgainstRoot(root: string | undefined, file: string): string {
  return isAbsolute(file) ? file : resolve(resolveRoot(root), file)
}

export interface CaseInfo {
  /** 绝对路径 */
  file: string
  valid: boolean
  /** 解析 + 语义校验通过时给出 */
  case?: TestCase
  issues: DslIssue[]
}

/** 收集并校验用例;相对路径按项目根目录展开;无效文件以 valid:false 返回供上层处理 */
export async function collectCases(
  paths: readonly string[],
  options: ProjectOptions = {},
): Promise<CaseInfo[]> {
  const files = await collectCaseFiles(
    paths.map((input) => resolveAgainstRoot(options.root, input)),
  )
  const infos: CaseInfo[] = []
  for (const file of files) {
    const validation = await validateCaseFile(file)
    infos.push({
      file,
      valid: validation.ok,
      case: validation.data,
      issues: validation.issues,
    })
  }
  return infos
}

/** 读取单个用例文件:source 原文 + 解析校验结果 */
export async function readCaseFile(
  file: string,
  options: ProjectOptions = {},
): Promise<{ file: string; source: string; validation: CaseValidationResult }> {
  const target = resolveAgainstRoot(options.root, file)
  const source = await readFile(target, 'utf8')
  return { file: target, source, validation: validateCaseSource(source) }
}

async function validateCaseFile(file: string): Promise<CaseValidationResult> {
  const source = await readFile(file, 'utf8')
  return validateCaseSource(source)
}

export interface WriteCaseResult {
  file: string
  written: boolean
  validation: CaseValidationResult
}

/**
 * 写入用例文件:内容必须先通过 DSL 校验,拒绝落盘无效用例;
 * 已存在文件需显式 overwrite。
 */
export async function writeCaseFile(
  file: string,
  source: string,
  options: ProjectOptions & { overwrite?: boolean } = {},
): Promise<WriteCaseResult> {
  const target = resolveAgainstRoot(options.root, file)
  const validation = validateCaseSource(source)
  if (!validation.ok) {
    return { file: target, written: false, validation }
  }
  if (!options.overwrite) {
    const existing = await stat(target).catch(() => undefined)
    if (existing) {
      throw new Error(`用例文件已存在:${target}(覆盖需显式 overwrite: true)`)
    }
  }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, source, 'utf8')
  return { file: target, written: true, validation }
}
