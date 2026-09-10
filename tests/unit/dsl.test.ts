import { describe, expect, test } from 'vitest'
import { parseCase, validateCase, validateCaseSource } from '@testpilot/dsl'

const validCase = `
id: order-create
name: 用户创建订单
tags:
  - smoke
  - order
steps:
  - target: miniapp
    action: launch
  - target: miniapp
    action: click
    locator:
      css: ".buy-btn"
  - target: miniapp
    action: extract
    locator:
      css: .order-id
    variable: orderId
  - target: web
    action: navigate
    url: /orders
  - target: web
    action: assert
    locator:
      css: .order-id
    expected: "\${orderId}"
`

describe('parser + schema', () => {
  test('合法用例通过解析', () => {
    const result = parseCase(validCase)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.id).toBe('order-create')
    expect(result.data.steps).toHaveLength(5)
    expect(result.data.tags).toContain('smoke')
    expect(result.data.steps[3]).toMatchObject({ action: 'navigate', url: '/orders' })
  })

  test('YAML 语法错误返回 yaml issue', () => {
    const result = parseCase('{ unclosed: [')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.code).toBe('yaml')
  })

  test('非法 id 与未知字段返回 schema issue', () => {
    const result = parseCase(`
id: OrderCreate
name: bad id
steps:
  - target: web
    action: click
    locator:
      text: 按钮
    expects: 1
`)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const paths = result.issues.map((issue) => issue.path)
    expect(paths).toContain('id')
    // zod v4 的未知字段问题上报在对象级路径,消息中包含字段名
    expect(paths).toContain('steps[0]')
    expect(result.issues.some((issue) => issue.message.includes('expects'))).toBe(true)
    expect(result.issues.every((issue) => issue.code === 'schema')).toBe(true)
  })
})

describe('validator 语义校验', () => {
  test('黄金路径用例无问题', () => {
    const result = validateCaseSource(validCase)
    expect(result.ok).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  test('覆盖必填字段 / 字段误用 / target 支持 / 变量引用', () => {
    const broken = `
id: broken-case
name: 各种错误
steps:
  - target: web
    action: navigate
  - target: miniapp
    action: select
    locator:
      css: ".picker"
    value: a
  - target: web
    action: click
  - target: web
    action: assert
    locator:
      text: a
      css: .b
    expected: "\${missingVar}"
  - target: web
    action: extract
    locator:
      css: .order-id
  - target: web
    action: click
    locator:
      css: .btn
    timeout: 1000
`
    const result = validateCaseSource(broken)
    expect(result.ok).toBe(false)
    const paths = result.issues.map((issue) => issue.path)
    expect(paths).toEqual(
      expect.arrayContaining([
        'steps[0].url', // navigate 缺 url
        'steps[1].target', // miniapp 不支持 navigate
        'steps[2].locator', // click 缺 locator
        'steps[3].locator', // text 与 css 二选一
        'steps[3].expected', // 引用未定义变量
        'steps[4].variable', // extract 缺 variable
        'steps[5].timeout', // timeout 仅用于 wait
      ]),
    )
  })

  test('变量需先 extract 再引用,重复定义报错', () => {
    const okCase = validateCaseSource(`
id: extract-first
name: 先提取后引用
steps:
  - target: web
    action: extract
    locator:
      css: .order-id
    variable: orderId
  - target: web
    action: input
    locator:
      css: .search
    value: "\${orderId}"
`)
    expect(okCase.ok).toBe(true)

    const dup = validateCaseSource(`
id: dup-var
name: 重复定义变量
steps:
  - target: web
    action: extract
    locator:
      css: .a
    variable: v
  - target: web
    action: extract
    locator:
      css: .b
    variable: v
`)
    expect(dup.ok).toBe(false)
    expect(dup.issues.map((issue) => issue.path)).toContain('steps[1].variable')
  })

  test('miniapp 端限制:text locator 与 select', () => {
    const result = validateCaseSource(`
id: mini-limits
name: 小程序限制
steps:
  - target: miniapp
    action: click
    locator:
      text: 登录
  - target: miniapp
    action: select
    locator:
      css: ".picker"
    value: a
`)
    expect(result.ok).toBe(false)
    const paths = result.issues.map((issue) => issue.path)
    expect(paths).toContain('steps[0].locator.text')
    expect(paths).toContain('steps[1].target')
  })

  test('validateCase 直接接收对象', () => {
    const issues = validateCase({
      id: 'obj-case',
      name: '对象入参',
      steps: [
        { target: 'web', action: 'launch' },
        { target: 'web', action: 'wait', timeout: 500 },
      ],
    })
    expect(issues).toHaveLength(0)
  })
})
