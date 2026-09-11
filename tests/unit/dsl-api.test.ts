import { describe, expect, test } from 'vitest'
import { validateCaseSource } from '@testpilot/dsl'

describe('dsl:api target 语义', () => {
  const apiCase = `
id: api-order-flow
name: API 下单流程
accountRef: test-user
steps:
  - target: api
    action: request
    url: /api/login
    method: POST
    headers:
      authorization: 'Bearer \${account.token}'
    body:
      username: '\${account.username}'
    expected: '200'
  - target: api
    action: extract
    value: data.orderId
    variable: orderId
  - target: api
    action: request
    url: '/api/orders/\${orderId}'
  - target: api
    action: assert
    expected: '"status":"PAID"'
`

  test('合法 api 用例通过校验(含 account.* 引用)', () => {
    const result = validateCaseSource(apiCase)
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
  })

  test('未声明 accountRef 时 account.* 引用报未定义变量', () => {
    const noRef = apiCase.replace('accountRef: test-user\n', '')
    const result = validateCaseSource(noRef)
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.message.includes('未定义变量'))).toBe(true)
  })

  test('UI action 不支持 api target', () => {
    const result = validateCaseSource(`
id: api-click
name: 误用
steps:
  - target: api
    action: click
    locator:
      css: .btn
`)
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.message.includes('不支持 target "api"'))).toBe(true)
  })

  test('api 端拒绝 locator', () => {
    const result = validateCaseSource(`
id: api-locator
name: 误用
steps:
  - target: api
    action: assert
    locator:
      css: .btn
    expected: ok
`)
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.message.includes('api 端不支持 locator'))).toBe(true)
  })

  test('request 必须提供 url;method/headers/body 仅用于 request', () => {
    const noUrl = validateCaseSource(`
id: api-nourl
name: 缺 url
steps:
  - target: api
    action: request
    method: GET
`)
    expect(noUrl.issues.some((issue) => issue.message.includes('request 必须提供 url'))).toBe(true)

    const misuse = validateCaseSource(`
id: api-misuse
name: 字段误用
steps:
  - target: web
    action: navigate
    url: /x
    method: GET
`)
    expect(misuse.issues.some((issue) => issue.message.includes('字段 "method" 仅用于 request'))).toBe(true)
  })

  test('api extract 必须提供 value(JSON path)', () => {
    const result = validateCaseSource(`
id: api-extract
name: 缺 path
steps:
  - target: api
    action: request
    url: /x
  - target: api
    action: extract
    variable: orderId
`)
    expect(result.issues.some((issue) => issue.message.includes('api 端 extract 必须提供 value'))).toBe(true)
  })

  test('request 断言的是 HTTP 状态码(expected=200 合法)', () => {
    const result = validateCaseSource(`
id: api-status
name: 状态码断言
steps:
  - target: api
    action: request
    url: /x
    expected: '201'
`)
    expect(result.issues.filter((issue) => issue.message.includes('仅用于'))).toEqual([])
    expect(result.ok).toBe(true)
  })
})
