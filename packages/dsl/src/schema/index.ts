import { z } from 'zod'

/** Step 执行端 */
export const STEP_TARGETS = ['web', 'miniapp', 'api'] as const
export type StepTarget = (typeof STEP_TARGETS)[number]

/** HTTP 方法(api target 的 request action) */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

/**
 * V0.1 稳定 Action:通用测试原语,不含业务动作
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
] as const
export type ActionName = (typeof ACTIONS)[number]

export const locatorSchema = z
  .strictObject({
    text: z.string().min(1).optional(),
    css: z.string().min(1).optional(),
  })
  .describe('text 与 css 只能提供其一')

export const stepSchema = z.strictObject({
  target: z.enum(STEP_TARGETS),
  action: z.enum(ACTIONS),
  locator: locatorSchema.optional(),
  url: z.string().min(1).optional(),
  value: z.string().optional(),
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
})

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
  steps: z.array(stepSchema).min(1, 'Case 至少包含一个 step'),
})

export type CaseLocator = z.infer<typeof locatorSchema>
export type TestStep = z.infer<typeof stepSchema>
export type TestCase = z.infer<typeof caseSchema>
