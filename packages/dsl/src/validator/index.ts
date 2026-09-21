import { parseCase, type DslIssue } from '../parser'
import { type ActionName, type StepTarget, type TestCase, type TestStep } from '../schema'

/** V0.1 各端 adapter 支持的 action 矩阵(小程序端 select/picker 交互暂不支持;api 端只支持 request/assert/extract) */
const ADAPTER_SUPPORT: Record<ActionName, readonly StepTarget[]> = {
  launch: ['web', 'miniapp'],
  navigate: ['web', 'miniapp'],
  click: ['web', 'miniapp'],
  input: ['web', 'miniapp'],
  select: ['web'],
  wait: ['web', 'miniapp'],
  assert: ['web', 'miniapp', 'api'],
  extract: ['web', 'miniapp', 'api'],
  screenshot: ['web', 'miniapp'],
  request: ['api'],
}

const LOCATOR_REQUIRED = new Set<ActionName>(['click', 'input', 'select', 'assert', 'extract'])
const VALUE_REQUIRED = new Set<ActionName>(['input', 'select'])
const REQUEST_EXPECTATION_ACTIONS = new Set<ActionName>(['navigate', 'click', 'input', 'select'])

/** 字段只允许出现在指定 action 上(防复制粘贴/拼写错误) */
const FIELD_ALLOWED: Record<
  'url' | 'value' | 'expected' | 'variable' | 'timeout' | 'method' | 'headers' | 'body',
  readonly ActionName[]
> = {
  url: ['navigate', 'request'],
  value: ['input', 'select', 'extract'],
  expected: ['assert', 'request'],
  variable: ['extract'],
  timeout: ['wait'],
  method: ['request'],
  headers: ['request'],
  body: ['request'],
}

const VARIABLE_REF = /\$\{([A-Za-z_][A-Za-z0-9_.]*)\}/g

/** 语义校验:action/target 支持关系、必填字段、字段误用、变量引用 */
export function validateCase(data: TestCase): DslIssue[] {
  const issues: DslIssue[] = []
  const declared = new Set<string>()

  if (data.fixtures) declared.add('fixture')
  if (data.datasets) declared.add('dataset')
  // variable.* 只能来自 testpilot.yaml 白名单;具体值在项目级预检阶段检查。
  declared.add('variable')

  // Case 声明了 accountRef 时,运行时把凭据注入为 account.* 变量(整值为 ${account},JSON 字段为 ${account.username} 等)
  if (data.accountRef) {
    declared.add('account')
  }

  data.setup?.forEach((step, index) => {
    checkStep(step, `setup[${index}]`, declared, issues)
  })
  data.steps.forEach((step, index) => {
    checkStep(step, `steps[${index}]`, declared, issues)
  })
  data.teardown?.forEach((step, index) => {
    checkStep(step, `teardown[${index}]`, declared, issues)
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

  // api 端不使用元素 locator;断言/提取走 assertResponse / extractResponse
  if (step.target === 'api') {
    if (step.locator) {
      issues.push({ path: `${at}.locator`, code: 'semantic', message: 'api 端不支持 locator,断言用 expected,提取用 value(JSON path)' })
    }
  } else {
    checkLocator(step, at, issues)
  }

  // 小程序 WXML 无法按文案查询,text locator 仅 web 可用
  if (step.target === 'miniapp' && step.locator?.text !== undefined) {
    issues.push({
      path: `${at}.locator.text`,
      code: 'semantic',
      message: '小程序端暂不支持 text locator,请使用 css 定位 class/id',
    })
  }

  for (const [field, actions] of Object.entries(FIELD_ALLOWED)) {
    const key = field as 'url' | 'value' | 'expected' | 'variable' | 'timeout' | 'method' | 'headers' | 'body'
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

  if (step.action === 'request' && !step.url) {
    issues.push({ path: `${at}.url`, code: 'semantic', message: 'request 必须提供 url(相对路径按 api.baseUrl 解析)' })
  }

  if (VALUE_REQUIRED.has(step.action) && !step.value) {
    issues.push({ path: `${at}.value`, code: 'semantic', message: `action "${step.action}" 必须提供 value` })
  }

  if (step.action === 'extract' && step.target === 'api' && !step.value) {
    issues.push({ path: `${at}.value`, code: 'semantic', message: 'api 端 extract 必须提供 value(点号 JSON path,如 data.orderId)' })
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

  if (step.expectRequests) {
    if (step.target === 'api' || !REQUEST_EXPECTATION_ACTIONS.has(step.action)) {
      issues.push({
        path: `${at}.expectRequests`,
        code: 'semantic',
        message: 'expectRequests 仅用于 web/miniapp 的 navigate/click/input/select',
      })
    }
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
  /** 字段 -> 引用的变量名;account.* 一类点号引用按首段匹配已声明变量 */
  const refs: Array<[field: string, name: string]> = []
  const collect = (field: string, raw: string | undefined): void => {
    if (!raw) return
    for (const match of raw.matchAll(VARIABLE_REF)) {
      if (match[1]) refs.push([field, match[1]])
    }
  }
  collect('value', step.value)
  collect('expected', step.expected)
  collect('url', step.url)
  collect('locator.text', step.locator?.text)
  collect('locator.css', step.locator?.css)
  if (typeof step.body === 'string') collect('body', step.body)
  else if (step.body) collect('body', JSON.stringify(step.body))
  for (const headerValue of Object.values(step.headers ?? {})) collect('headers', headerValue)
  for (const [index, expectation] of (step.expectRequests ?? []).entries()) {
    collect(`expectRequests[${index}].urlContains`, expectation.urlContains)
  }

  for (const [field, name] of refs) {
    const root = name.split('.')[0] ?? name
    if (!declared.has(root)) {
      issues.push({
        path: `${at}.${field}`,
        code: 'semantic',
        message: `引用了未定义变量 "\${${name}}":先通过 extract 提取,或 Case 声明 accountRef 后使用 \${account.*}`,
      })
    }
  }
}
