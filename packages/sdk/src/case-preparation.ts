import type { TestCase } from '@testpilot/dsl'
import {
  flattenVariables,
  isDataObject,
  loadCaseDataFile,
  mergeFixture,
  type DataObject,
} from './case-data'

export interface PreparedCaseExecution {
  data: TestCase
  file: string
  templateId: string
  rowId: string
  rowIndex: number
  initialVariables: Record<string, string>
  missingDependencies: string[]
}

export interface PrepareCaseOptions {
  root: string
  dataDir: string
  variables?: Record<string, string>
  accounts?: Record<string, string>
}

export async function prepareCaseExecutions(
  item: { data: TestCase; file: string },
  options: PrepareCaseOptions,
): Promise<PreparedCaseExecution[]> {
  const fixture = await loadFixtures(item.data.fixtures ?? [], options)
  const rows = await loadDataset(item.data, options)
  const projectVariables = flattenVariables('variable', options.variables ?? {})
  const accountVariables = accountValues(item.data, options.accounts)

  return rows.map(({ row, rowId }, rowIndex) => {
    const initialVariables = {
      ...flattenVariables('fixture', fixture),
      ...flattenVariables('dataset', row),
      ...projectVariables,
      ...accountVariables,
    }
    const missingDependencies = (item.data.requires ?? []).filter((path) =>
      isUnavailable(initialVariables[path]),
    )
    return {
      data: item.data,
      file: item.file,
      templateId: item.data.id,
      rowId,
      rowIndex,
      initialVariables,
      missingDependencies,
    }
  })
}

async function loadFixtures(
  references: readonly string[],
  options: PrepareCaseOptions,
): Promise<DataObject> {
  let merged: DataObject = {}
  for (const reference of references) {
    const value = await loadCaseDataFile(reference, options)
    if (!isDataObject(value)) {
      throw new Error(`fixture 文件根必须是对象:${reference}`)
    }
    merged = mergeFixture(merged, value)
  }
  return merged
}

async function loadDataset(
  data: TestCase,
  options: PrepareCaseOptions,
): Promise<Array<{ row: DataObject; rowId: string }>> {
  if (!data.datasets) return [{ row: {}, rowId: 'default' }]

  const value = await loadCaseDataFile(data.datasets.file, options)
  if (!Array.isArray(value)) {
    throw new Error(`dataset 文件根必须是对象数组:${data.datasets.file}`)
  }

  const seen = new Set<string>()
  return value.map((row, index) => {
    if (!isDataObject(row)) {
      throw new Error(`dataset 第 ${index + 1} 行必须是对象:${data.datasets!.file}`)
    }
    const rawId = row[data.datasets!.idField]
    if ((typeof rawId !== 'string' && typeof rawId !== 'number') || String(rawId).trim() === '') {
      throw new Error(
        `dataset 第 ${index + 1} 行缺少非空 row id 字段 "${data.datasets!.idField}"`,
      )
    }
    const rowId = String(rawId)
    if (seen.has(rowId)) throw new Error(`dataset row id 重复:${rowId}`)
    seen.add(rowId)
    return { row, rowId }
  })
}

function accountValues(
  data: TestCase,
  accounts: Record<string, string> | undefined,
): Record<string, string> {
  if (!data.accountRef) return {}
  const raw = accounts?.[data.accountRef]
  if (raw === undefined) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isDataObject(parsed)) return flattenVariables('account', parsed)
  } catch {
    // 非 JSON 凭据作为 ${account} 整值使用。
  }
  return { account: raw }
}

function isUnavailable(value: string | undefined): boolean {
  return value === undefined || value.trim() === '' || /\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(value)
}
