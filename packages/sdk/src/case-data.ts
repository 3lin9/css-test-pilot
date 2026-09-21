import { readFile, realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

export type DataObject = Record<string, unknown>

export async function loadCaseDataFile(
  reference: string,
  options: { root: string; dataDir: string },
): Promise<unknown> {
  if (isAbsolute(reference)) {
    throw new Error(`数据文件必须使用项目相对路径:${reference}`)
  }

  const root = resolve(options.root)
  const dataDir = resolve(options.dataDir)
  const target = resolve(root, reference)
  if (!isInside(dataDir, target)) {
    throw new Error(`数据文件必须位于 tests/e2e/data 目录:${reference}`)
  }

  const [realDataDir, realTarget] = await Promise.all([
    realpath(dataDir).catch(() => dataDir),
    realpath(target).catch((error: unknown) => {
      throw new Error(
        `读取数据文件失败:${reference}:${error instanceof Error ? error.message : String(error)}`,
      )
    }),
  ])
  if (!isInside(realDataDir, realTarget)) {
    throw new Error(`数据文件解析后越出 tests/e2e/data 目录:${reference}`)
  }

  const source = await readFile(realTarget, 'utf8')
  const extension = extname(realTarget).toLowerCase()
  try {
    if (extension === '.yaml' || extension === '.yml') return parseYaml(source)
    if (extension === '.json') return JSON.parse(source) as unknown
  } catch (error) {
    throw new Error(
      `解析数据文件失败:${reference}:${error instanceof Error ? error.message : String(error)}`,
    )
  }
  throw new Error(`数据文件仅支持 .yaml/.yml/.json:${reference}`)
}

export function isDataObject(value: unknown): value is DataObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function mergeFixture(target: DataObject, source: DataObject, at = 'fixture'): DataObject {
  const output: DataObject = { ...target }
  for (const [key, value] of Object.entries(source)) {
    const path = `${at}.${key}`
    if (!(key in output)) {
      output[key] = value
      continue
    }
    const current = output[key]
    if (isDataObject(current) && isDataObject(value)) {
      output[key] = mergeFixture(current, value, path)
      continue
    }
    throw new Error(`fixture 字段冲突:${path}`)
  }
  return output
}

export function flattenVariables(prefix: string, value: unknown): Record<string, string> {
  const output: Record<string, string> = {}
  visit(prefix, value, output)
  return output
}

function visit(path: string, value: unknown, output: Record<string, string>): void {
  if (value === null || value === undefined) return
  if (typeof value === 'object') {
    output[path] = JSON.stringify(value)
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(`${path}.${index}`, item, output))
    } else {
      for (const [key, item] of Object.entries(value as DataObject)) {
        visit(`${path}.${key}`, item, output)
      }
    }
    return
  }
  output[path] = String(value)
}

function isInside(base: string, candidate: string): boolean {
  const path = relative(base, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}
