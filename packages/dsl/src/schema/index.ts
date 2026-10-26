import { z } from 'zod'

/** Step 执行端 */
export const STEP_TARGETS = ['web', 'miniapp', 'api'] as const
export type StepTarget = (typeof STEP_TARGETS)[number]

/** HTTP 方法(api target 的 request action) */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

/**
 * 稳定 Action:通用测试原语,不含业务动作
 * (login / order / payment 是业务 Case,不是 Action)
 */
export const ACTIONS = [
  'launch',
  'navigate',
  'click',
  'input',
  'select',
  'wait',
  'assert',
  'extract',
  'screenshot',
  'request',
  'callMethod',
  'mockWxApi',
  'trigger',
  'setData',
  'longpress',
  'callWxApi',
  'touch',
  'scroll',
  'swipeTo',
  'slideTo',
  'moveTo',
] as const

/** touch action 的触摸阶段(对应 automator element.touchstart/touchmove/touchend) */
export const TOUCH_PHASES = ['touchstart', 'touchmove', 'touchend'] as const
export type TouchPhase = (typeof TOUCH_PHASES)[number]
export type ActionName = (typeof ACTIONS)[number]

/**
 * 跨系统只读白名单:step.system 指向的是被测(默认)系统之外的系统,
 * 只允许查询类 action(检查与被测系统的一致性),输入/新建/编辑等写操作禁止。
 * request 仅限 GET/HEAD(在 validator 单独校验 method)。
 */
export const SYSTEM_READONLY_ACTIONS: ReadonlySet<ActionName> = new Set([
  'navigate',
  'wait',
  'assert',
  'extract',
  'screenshot',
])

export const locatorSchema = z
  .strictObject({
    text: z.string().min(1).optional(),
    css: z.string().min(1).optional(),
    /** data-testid(Playwright testId) */
    testId: z.string().min(1).optional(),
    /** ARIA role；可与 accessible name 组合 */
    role: z.string().min(1).optional(),
    /** role 的 accessible name，不是独立定位策略 */
    name: z.string().min(1).optional(),
    /** 关联 label 文案 */
    label: z.string().min(1).optional(),
    /** input/textarea placeholder */
    placeholder: z.string().min(1).optional(),
  })
  .describe('text/css/testId/role/label/placeholder 只能提供一种策略；name 仅配合 role')

export const requestExpectationSchema = z.strictObject({
  method: z.enum(HTTP_METHODS).optional(),
  urlContains: z.string().min(1),
  count: z.number().int().nonnegative(),
  windowMs: z.number().int().nonnegative().default(1_000),
})

export const stepSchema = z.strictObject({
  target: z.enum(STEP_TARGETS),
  action: z.enum(ACTIONS),
  /** 引用 testpilot.yaml systems 中的系统名;缺省用 target 对应的默认系统 */
  system: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'system 需为 kebab-case').optional(),
  locator: locatorSchema.optional(),
  url: z.string().min(1).optional(),
  value: z.union([z.string(), z.number()]).optional(),
  expected: z.string().optional(),
  /** api target:request 的 HTTP 方法(默认 GET) */
  method: z.enum(HTTP_METHODS).optional(),
  /** api target:request 的请求头(值支持 ${var} 模板) */
  headers: z.record(z.string(), z.string()).optional(),
  /** api target:请求体;对象按 JSON 序列化,字符串原样发送(支持 ${var} 模板) */
  body: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  variable: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, '变量名需以字母或下划线开头,仅含字母、数字、下划线')
    .optional(),
  timeout: z.number().int().positive().optional(),
  /** UI 动作触发的网络请求精确次数断言 */
  expectRequests: z.array(requestExpectationSchema).min(1).optional(),
  /** callMethod:要调用的 Page / 组件方法名(仅 miniapp;页面级调用不写 locator) */
  methodName: z.string().min(1).optional(),
  /** callMethod 的入参(支持 ${var} 模板) */
  args: z.array(z.unknown()).optional(),
  /** mockWxApi:要 mock 的 wx.* API 名(如 showModal / request) */
  wxApi: z.string().min(1).optional(),
  /** mockWxApi:mock 返回值(对象按原样注入;capture 时真实调用先上报再返回 mock 值) */
  result: z.record(z.string(), z.unknown()).optional(),
  /** mockWxApi:捕获真实调用参数的变量名(${<capture>.options} / ${<capture>.called}) */
  capture: z.string().min(1).optional(),
  /** trigger:触发的事件类型(如 getphonenumber;空 detail 即"用户拒绝/取消"类分支) */
  eventType: z.string().min(1).optional(),
  /** trigger:作为事件 e.detail 注入(值支持 ${var} 模板) */
  detail: z.record(z.string(), z.unknown()).optional(),
  /** setData:写入页面 data 的补丁(值支持 ${var} 模板);提供 locator 时为组件级 setData */
  patch: z.record(z.string(), z.unknown()).optional(),
  /** assert:页面 data 路径断言(与 locator/attribute/property/count 互斥,仅 miniapp) */
  dataPath: z.string().min(1).optional(),
  /** assert:元素 attribute 名(与 expected 组合做属性断言;web/miniapp) */
  attribute: z.string().min(1).optional(),
  /** assert:元素 property 名(自定义组件实例属性;仅 miniapp) */
  property: z.string().min(1).optional(),
  /** assert:匹配元素的精确数量(0 即"元素不存在"断言;与 expected/attribute/property/dataPath 互斥) */
  count: z.number().int().nonnegative().optional(),
  /** touch:触摸阶段 */
  phase: z.enum(TOUCH_PHASES).optional(),
  /** touch:触摸点数组(元素如 [{identifier: 0, x: 100, y: 200}],值支持 ${var} 模板) */
  touches: z.array(z.record(z.string(), z.unknown())).min(1).optional(),
  /** touch:changedTouches 触摸点数组;缺省复用 touches */
  changedTouches: z.array(z.record(z.string(), z.unknown())).optional(),
  /** scroll:滚动位置(scroll-view 内滚动提供 locator;缺省滚动页面) */
  scrollTop: z.number().optional(),
  /** swipeTo:swiper 目标页索引 */
  index: z.number().int().nonnegative().optional(),
  /** moveTo:movable-view 目标坐标 */
  x: z.number().optional(),
  y: z.number().optional(),
})

export const datasetReferenceSchema = z.strictObject({
  file: z.string().min(1),
  idField: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'idField 需为合法字段名')
    .default('id'),
})

const dependencyPathSchema = z
  .string()
  .regex(
    /^(fixture|dataset|account|variable)(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/,
    'requires 路径必须以 fixture/dataset/account/variable 开头并包含字段',
  )

export const caseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id 需为 kebab-case(小写字母、数字、连字符)'),
  name: z.string().min(1, 'name 不能为空'),
  description: z.string().optional(),
  /** 引用 Test Workspace(多系统环境组合);Case 只表达测试意图,环境由 Workspace 提供 */
  workspace: z.string().min(1).optional(),
  /** 引用项目环境(testpilot.yaml environment 段);Case 不写死地址 */
  environment: z.string().min(1).optional(),
  /** 引用测试账号标识;凭据由 Environment + Server/CI Secret 管理,禁止写进 Case */
  accountRef: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
  fixtures: z.array(z.string().min(1)).min(1).optional(),
  datasets: datasetReferenceSchema.optional(),
  requires: z.array(dependencyPathSchema).min(1).optional(),
  setup: z.array(stepSchema).min(1).optional(),
  steps: z.array(stepSchema).min(1, 'Case 至少包含一个 step'),
  teardown: z.array(stepSchema).min(1).optional(),
})

export type CaseLocator = z.infer<typeof locatorSchema>
export type RequestExpectation = z.infer<typeof requestExpectationSchema>
export type DatasetReference = z.infer<typeof datasetReferenceSchema>
export type TestStep = z.infer<typeof stepSchema>
export type TestCase = z.infer<typeof caseSchema>
