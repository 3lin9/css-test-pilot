import { parseCase, type DslIssue } from '../parser'
import { SYSTEM_READONLY_ACTIONS, type ActionName, type StepTarget, type TestCase, type TestStep } from '../schema'

/** 各端 adapter 支持的 action 矩阵(小程序端 select/picker 交互暂不支持;api 端只支持 request/assert/extract;callMethod/mockWxApi/trigger/setData 及小程序交互扩展仅 miniapp) */
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
  callMethod: ['miniapp'],
  mockWxApi: ['miniapp'],
  trigger: ['miniapp'],
  setData: ['miniapp'],
  longpress: ['web', 'miniapp'],
  callWxApi: ['miniapp'],
  touch: ['miniapp'],
  scroll: ['miniapp'],
  swipeTo: ['miniapp'],
  slideTo: ['miniapp'],
  moveTo: ['miniapp'],
  nativeAuthorize: ['miniapp'],
}

const LOCATOR_REQUIRED = new Set<ActionName>([
  'click',
  'input',
  'select',
  'assert',
  'extract',
  'longpress',
  'touch',
  'swipeTo',
  'slideTo',
  'moveTo',
  'trigger',
])
const VALUE_REQUIRED = new Set<ActionName>(['input', 'select', 'slideTo'])
const REQUEST_EXPECTATION_ACTIONS = new Set<ActionName>(['navigate', 'click', 'input', 'select'])

/** 字段只允许出现在指定 action 上(防复制粘贴/拼写错误) */
const FIELD_ALLOWED: Record<
  | 'url'
  | 'value'
  | 'expected'
  | 'variable'
  | 'timeout'
  | 'method'
  | 'headers'
  | 'body'
  | 'methodName'
  | 'args'
  | 'wxApi'
  | 'result'
  | 'capture'
  | 'eventType'
  | 'detail'
  | 'patch'
  | 'dataPath'
  | 'attribute'
  | 'property'
  | 'count'
  | 'phase'
  | 'touches'
  | 'changedTouches'
  | 'scrollTop'
  | 'index'
  | 'x'
  | 'y'
  | 'decision',
  readonly ActionName[]
> = {
  url: ['navigate', 'request'],
  value: ['input', 'select', 'extract', 'slideTo'],
  expected: ['assert', 'request'],
  variable: ['extract', 'callWxApi'],
  timeout: ['wait', 'nativeAuthorize'],
  method: ['request'],
  headers: ['request'],
  body: ['request'],
  methodName: ['callMethod'],
  args: ['callMethod', 'callWxApi'],
  wxApi: ['mockWxApi', 'callWxApi'],
  result: ['mockWxApi'],
  capture: ['mockWxApi'],
  eventType: ['trigger'],
  detail: ['trigger'],
  patch: ['setData'],
  dataPath: ['assert'],
  attribute: ['assert'],
  property: ['assert'],
  count: ['assert'],
  phase: ['touch'],
  touches: ['touch'],
  changedTouches: ['touch'],
  scrollTop: ['scroll'],
  index: ['swipeTo'],
  x: ['moveTo'],
  y: ['moveTo'],
  decision: ['nativeAuthorize'],
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

  // 小程序 automator 只接受 CSS selector；Web 语义定位器不能直接映射。
  if (
    step.target === 'miniapp' &&
    step.locator &&
    Object.entries(step.locator).some(([key, value]) => key !== 'css' && value !== undefined)
  ) {
    const unsupported = Object.keys(step.locator).find(
      (key) => key !== 'css' && step.locator?.[key as keyof typeof step.locator] !== undefined,
    )
    issues.push({
      path: `${at}.locator.${unsupported ?? 'unknown'}`,
      code: 'semantic',
      message: '小程序端仅支持 css locator；请使用运行时观察生成稳定 class/id',
    })
  }

  for (const [field, actions] of Object.entries(FIELD_ALLOWED)) {
    const key = field as keyof typeof FIELD_ALLOWED
    if (step[key] !== undefined && !actions.includes(step.action)) {
      issues.push({
        path: `${at}.${field}`,
        code: 'semantic',
        message: `字段 "${field}" 仅用于 ${actions.join(' / ')}`,
      })
    }
  }

  // callWxApi:主动调用的 wx.* API 名必填
  if (step.action === 'callWxApi' && !step.wxApi) {
    issues.push({ path: `${at}.wxApi`, code: 'semantic', message: 'callWxApi 必须提供 wxApi(要主动调用的 wx.* API 名,如 setStorageSync)' })
  }

  // touch:触摸阶段与触摸点必填;坐标在执行时规范成 pageX/pageY
  if (step.action === 'touch') {
    if (!step.phase) {
      issues.push({ path: `${at}.phase`, code: 'semantic', message: 'touch 必须提供 phase(touchstart / touchmove / touchend)' })
    }
    if (!step.touches || step.touches.length === 0) {
      issues.push({ path: `${at}.touches`, code: 'semantic', message: 'touch 必须提供 touches(触摸点数组,如 [{identifier: 0, x: 0, y: 0}])' })
    }
    for (const [field, points] of [
      ['touches', step.touches],
      ['changedTouches', step.changedTouches],
    ] as const) {
      points?.forEach((point, index) => {
        if (!touchPointHasPosition(point)) {
          issues.push({
            path: `${at}.${field}[${index}]`,
            code: 'semantic',
            message: '触摸点需要 x/y 或 pageX/pageY',
          })
        }
      })
    }
  }

  // scroll:滚动位置必填(locator 可选:提供时滚动 scroll-view 元素,缺省滚动页面)
  if (step.action === 'scroll' && step.scrollTop === undefined) {
    issues.push({ path: `${at}.scrollTop`, code: 'semantic', message: 'scroll 必须提供 scrollTop(滚动位置像素)' })
  }

  if (step.action === 'swipeTo' && step.index === undefined) {
    issues.push({ path: `${at}.index`, code: 'semantic', message: 'swipeTo 必须提供 index(swiper 目标页索引)' })
  }

  if (step.action === 'moveTo' && (step.x === undefined || step.y === undefined)) {
    issues.push({ path: `${at}.x`, code: 'semantic', message: 'moveTo 必须提供 x 与 y(movable-view 目标坐标)' })
  }

  // assert 的四种模式互斥:dataPath(页面 data)/ attribute / property / count(元素数量);缺省为文本断言
  if (step.action === 'assert') {
    const modes = [
      step.dataPath !== undefined,
      step.attribute !== undefined,
      step.property !== undefined,
      step.count !== undefined,
    ].filter(Boolean).length
    if (modes > 1) {
      issues.push({ path: `${at}.assert`, code: 'semantic', message: 'assert 的 dataPath / attribute / property / count 只能提供其一(缺省为元素文本断言)' })
    }
    if (step.property !== undefined && step.target !== 'miniapp') {
      issues.push({ path: `${at}.property`, code: 'semantic', message: 'property 断言仅 miniapp 支持(自定义组件实例属性)' })
    }
    if ((step.attribute !== undefined || step.property !== undefined) && !step.locator) {
      issues.push({ path: `${at}.locator`, code: 'semantic', message: 'attribute / property 断言必须提供 locator' })
    }
    if (step.count !== undefined && !step.locator) {
      issues.push({ path: `${at}.locator`, code: 'semantic', message: 'count 断言必须提供 locator(统计匹配元素)' })
    }
    if (step.count !== undefined && step.expected !== undefined) {
      issues.push({ path: `${at}.assert`, code: 'semantic', message: 'count 断言以 count 为期望值,不需要 expected' })
    }
    if (step.target === 'api' && (step.attribute !== undefined || step.property !== undefined || step.count !== undefined)) {
      issues.push({ path: `${at}.assert`, code: 'semantic', message: 'api 端 assert 仅支持 expected(响应体包含)' })
    }
    if (step.dataPath !== undefined && step.target !== 'miniapp') {
      issues.push({ path: `${at}.dataPath`, code: 'semantic', message: 'dataPath 断言仅 miniapp 支持(web 端用 locator)' })
    }
  }

  // mockWxApi:wx API 名与 mock 返回值必填
  if (step.action === 'mockWxApi') {
    if (!step.wxApi) {
      issues.push({ path: `${at}.wxApi`, code: 'semantic', message: 'mockWxApi 必须提供 wxApi(要 mock 的 wx.* API 名)' })
    }
    if (!step.result) {
      issues.push({ path: `${at}.result`, code: 'semantic', message: 'mockWxApi 必须提供 result(mock 返回值)' })
    }
  }

  // trigger:事件类型必填;locator 由 LOCATOR_REQUIRED 检查
  if (step.action === 'trigger' && !step.eventType) {
    issues.push({ path: `${at}.eventType`, code: 'semantic', message: 'trigger 必须提供 eventType(触发的事件类型)' })
  }

  if (step.action === 'nativeAuthorize' && !step.decision) {
    issues.push({
      path: `${at}.decision`,
      code: 'semantic',
      message: 'nativeAuthorize 必须提供 decision(allow 确认授权 / cancel 取消授权)',
    })
  }

  // setData:补丁必填
  if (step.action === 'setData' && (!step.patch || Object.keys(step.patch).length === 0)) {
    issues.push({ path: `${at}.patch`, code: 'semantic', message: 'setData 必须提供 patch(写入页面 data 的补丁)' })
  }

  if (step.action === 'navigate' && !step.url) {
    issues.push({ path: `${at}.url`, code: 'semantic', message: 'navigate 必须提供 url' })
  }

  if (step.action === 'request' && !step.url) {
    issues.push({ path: `${at}.url`, code: 'semantic', message: 'request 必须提供 url(相对路径按 api.baseUrl 解析)' })
  }

  // value 可为数字 0(slideTo),仅按"未提供/空串"判定缺失
  if (VALUE_REQUIRED.has(step.action) && (step.value === undefined || step.value === '')) {
    issues.push({ path: `${at}.value`, code: 'semantic', message: `action "${step.action}" 必须提供 value` })
  }

  if (step.action === 'extract' && step.target === 'api' && !step.value) {
    issues.push({ path: `${at}.value`, code: 'semantic', message: 'api 端 extract 必须提供 value(点号 JSON path,如 data.orderId)' })
  }

  // count 断言以 count 为期望值,不需要 expected;其余模式必须提供 expected
  if (step.action === 'assert' && step.count === undefined && !step.expected) {
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

  if (step.action === 'callMethod' && !step.methodName) {
    issues.push({
      path: `${at}.methodName`,
      code: 'semantic',
      message: 'callMethod 必须提供 methodName(页面或组件的方法名)',
    })
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

  // 跨系统只读:system 指向的是被测(默认)系统之外的系统,只允许查询
  // (检查与被测系统的一致性);输入/新建/编辑等写操作只能在被测系统执行
  if (step.system) {
    const method = (step.action === 'request' ? (step.method ?? 'GET') : 'GET').toUpperCase()
    const readonlyRequest = step.action === 'request' && (method === 'GET' || method === 'HEAD')
    if (step.action === 'request') {
      if (!readonlyRequest) {
        issues.push({
          path: `${at}.method`,
          code: 'semantic',
          message: `跨系统只读:request 仅允许 GET/HEAD 查询其它系统,当前 ${method}`,
        })
      }
    } else if (!SYSTEM_READONLY_ACTIONS.has(step.action)) {
      issues.push({
        path: `${at}.system`,
        code: 'semantic',
        message: `跨系统只读:system "${step.system}" 仅允许 navigate/wait/assert/extract/screenshot 与 GET/HEAD request,"${step.action}" 会操作其它系统,请在被测系统的用例中执行`,
      })
    }
  }

  checkVariableRefs(step, at, declared, issues)
}

function touchPointHasPosition(point: Record<string, unknown>): boolean {
  const hasX = point.x !== undefined || point.pageX !== undefined || point.clientX !== undefined
  const hasY = point.y !== undefined || point.pageY !== undefined || point.clientY !== undefined
  return hasX && hasY
}

function checkLocator(step: TestStep, at: string, issues: DslIssue[]): void {
  const locator = step.locator
  if (!locator) {
    // dataPath 断言走页面 data,不需要元素定位
    if (step.action === 'assert' && step.dataPath !== undefined) return
    if (LOCATOR_REQUIRED.has(step.action)) {
      issues.push({
        path: `${at}.locator`,
        code: 'semantic',
        message: `action "${step.action}" 必须提供 locator`,
      })
    }
    return
  }
  const provided = [
    locator.text !== undefined,
    locator.css !== undefined,
    locator.testId !== undefined,
    locator.role !== undefined,
    locator.label !== undefined,
    locator.placeholder !== undefined,
  ].filter(Boolean).length
  if (provided === 0) {
    issues.push({ path: `${at}.locator`, code: 'semantic', message: 'locator 必须提供一种定位策略' })
  } else if (provided > 1) {
    issues.push({ path: `${at}.locator`, code: 'semantic', message: 'locator 只能提供一种定位策略' })
  }
  if (locator.name !== undefined && locator.role === undefined) {
    issues.push({
      path: `${at}.locator.name`,
      code: 'semantic',
      message: 'locator.name 只能与 locator.role 配合使用',
    })
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
  collect('value', step.value === undefined ? undefined : String(step.value))
  collect('expected', step.expected)
  collect('url', step.url)
  collect('methodName', step.methodName)
  collect('locator.text', step.locator?.text)
  collect('locator.css', step.locator?.css)
  collect('locator.testId', step.locator?.testId)
  collect('locator.name', step.locator?.name)
  collect('locator.label', step.locator?.label)
  collect('locator.placeholder', step.locator?.placeholder)
  if (typeof step.body === 'string') collect('body', step.body)
  else if (step.body) collect('body', JSON.stringify(step.body))
  for (const headerValue of Object.values(step.headers ?? {})) collect('headers', headerValue)
  if (Array.isArray(step.args)) {
    step.args.forEach((arg, index) => {
      if (typeof arg === 'string') collect(`args[${index}]`, arg)
    })
  }
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
