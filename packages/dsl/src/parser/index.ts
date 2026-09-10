import { parse as parseYaml } from 'yaml'
import { caseSchema, type TestCase } from '../schema'

export interface DslIssue {
  /** 点分路径,如 steps[2].locator;'(root)' 表示文档级问题 */
  path: string
  message: string
  code: 'yaml' | 'schema' | 'semantic'
}

export type CaseParseResult =
  | { ok: true; data: TestCase }
  | { ok: false; issues: DslIssue[] }

/** 解析并做 schema 校验;语义校验由 validator 层完成 */
export function parseCase(source: string): CaseParseResult {
  let raw: unknown
  try {
    raw = parseYaml(source)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      issues: [{ path: '(root)', code: 'yaml', message: `YAML 解析失败:${message}` }],
    }
  }

  const result = caseSchema.safeParse(raw)
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path: formatPath(issue.path),
        code: 'schema',
        message: issue.message,
      })),
    }
  }
  return { ok: true, data: result.data }
}

/** zod issue.path 转可读点分路径:['steps', 2, 'locator'] -> 'steps[2].locator' */
export function formatPath(path: PropertyKey[]): string {
  if (path.length === 0) return '(root)'
  return path
    .map((segment, index) =>
      typeof segment === 'number'
        ? `[${segment}]`
        : index === 0
          ? String(segment)
          : `.${String(segment)}`,
    )
    .join('')
}
