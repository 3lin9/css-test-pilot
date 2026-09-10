import { parseCase, type DslIssue } from '../parser'
import { type ActionName, type StepTarget, type TestCase, type TestStep } from '../schema'

/** V0.1 各端 adapter 支持的 action 矩阵(小程序端 select/picker 交互暂不支持) */
const ADAPTER_SUPPORT: Record<ActionName, readonly StepTarget[]> = {
  launch: ['web', 'miniapp'],
  navigate: ['web', 'miniapp'],
  click: ['web', 'miniapp'],
  input: ['web', 'miniapp'],
  select: ['web'],
  wait: ['web', 'miniapp'],
  assert: ['web', 'miniapp'],
  extract: ['web', 'miniapp'],
  screenshot: ['web', 'miniapp'],
}

const LOCATOR_REQUIRED = new Set<ActionName>(['click', 'input', 'select', 'assert', 'extract'])
const VALUE_REQUIRED = new Set<ActionName>(['input', 'select'])

/** 字段只允许出现在指定 action 上(防复制粘贴/拼写错误) */
const FIELD_ALLOWED: Record<'url' | 'value' | 'expected' | 'variable' | 'timeout', readonly ActionName[]> = {
  url: ['navigate'],
  value: ['input', 'select'],
  expected: ['assert'],
  variable: ['extract'],
  timeout: ['wait'],
}

const VARIABLE_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/** 语义校验:action/target 支持关系、必填字段、字段误用、变量引用 */
export function validateCase(data: TestCase): DslIssue[] {
  const issues: DslIssue[] = []
  const declared = new Set<string>()

  data.steps.forEach((step, index) => {
    checkStep(step, `steps[${index}]`, declared, issues)
  })

  return issues
}

export interface CaseValidationResult {
  ok: boolean
  data?: TestCase
  issues: DslIssue[]
}

/** 解析 + schema + 语义的一次性入口 */
export function validateCaseSource(source: string): CaseValidationResult {
  const parsed = parseCase(source)
  if (!parsed.ok) {
    return { ok: false, issues: parsed.issues }
  }
  const issues = validateCase(parsed.data)
  return issues.length > 0 ? { ok: false, data: parsed.data, issues } : { ok: true, data: parsed.data, issues: [] }
}

function checkStep(step: TestStep, at: string, declared: Set<string>, issues: DslIssue[]): void {
  const supported = ADAPTER_SUPPORT[step.action]
  if (!supported.includes(step.target)) {
    issues.push({
      path: `${at}.target`,
      code: 'semantic',
      message: `action "${step.action}" 不支持 target "${step.target}"(支持:${supported.join(' / ')})`,
    })
  }

  checkLocator(step, at, issues)

  // 小程序 WXML 无法按文案查询,text locator 仅 web 可用
  if (step.target === 'miniapp' && step.locator?.text !== undefined) {
    issues.push({
      path: `${at}.locator.text`,
      code: 'semantic',
      message: '小程序端暂不支持 text locator,请使用 css 定位 class/id',
    })
  }

  for (const [field, actions] of Object.entries(FIELD_ALLOWED)) {
    const key = field as 'url' | 'value' | 'expected' | 'variable' | 'timeout'
    if (step[key] !== undefined && !actions.includes(step.action)) {
      issues.push({
        path: `${at}.${field}`,
        code: 'semantic',
        message: `字段 "${field}" 仅用于 ${actions.join(' / ')}`,
      })
    }
  }

  if (step.action === 'navigate' && !step.url) {
    issues.push({ path: `${at}.url`, code: 'semantic', message: 'navigate 必须提供 url' })
  }

  if (VALUE_REQUIRED.has(step.action) && !step.value) {
    issues.push({ path: `${at}.value`, code: 'semantic', message: `action "${step.action}" 必须提供 value` })
  }

  if (step.action === 'assert' && !step.expected) {
    issues.push({ path: `${at}.expected`, code: 'semantic', message: 'assert 必须提供 expected' })
  }

  if (step.action === 'extract') {
    if (!step.variable) {
      issues.push({
        path: `${at}.variable`,
        code: 'semantic',
        message: 'extract 必须提供 variable(提取值保存的变量名)',
      })
    } else if (declared.has(step.variable)) {
      issues.push({ path: `${at}.variable`, code: 'semantic', message: `变量 "${step.variable}" 被重复定义` })
    } else {
      declared.add(step.variable)
    }
  }

  if (step.action === 'wait' && !step.locator && step.timeout === undefined) {
    issues.push({ path: at, code: 'semantic', message: 'wait 需要提供 locator(等待元素)或 timeout(毫秒)' })
  }

  checkVariableRefs(step, at, declared, issues)
}

function checkLocator(step: TestStep, at: string, issues: DslIssue[]): void {
  const locator = step.locator
  if (!locator) {
    if (LOCATOR_REQUIRED.has(step.action)) {
      issues.push({
        path: `${at}.locator`,
        code: 'semantic',
        message: `action "${step.action}" 必须提供 locator`,
      })
    }
    return
  }
  const provided = [locator.text !== undefined, locator.css !== undefined].filter(Boolean).length
  if (provided === 0) {
    issues.push({ path: `${at}.locator`, code: 'semantic', message: 'locator 必须提供 text 或 css 之一' })
  } else if (provided === 2) {
    issues.push({ path: `${at}.locator`, code: 'semantic', message: 'locator 的 text 与 css 只能二选一' })
  }
}

function checkVariableRefs(
  step: TestStep,
  at: string,
  declared: Set<string>,
  issues: DslIssue[],
): void {
  for (const field of ['value', 'expected'] as const) {
    const raw = step[field]
    if (!raw) continue
    for (const match of raw.matchAll(VARIABLE_REF)) {
      const name = match[1]
      if (name && !declared.has(name)) {
        issues.push({
          path: `${at}.${field}`,
          code: 'semantic',
          message: `引用了未定义变量 "\${${name}}":需要先通过 extract 步骤提取`,
        })
      }
    }
  }
}
