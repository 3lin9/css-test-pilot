import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { apiAdapterFactory } from '@testpilot/adapter-api'
import { TestPilotClient } from './index'

/** 被测系统桩:登录返回订单号,订单查询按 token 区分身份 */
let http: Server
let base = ''
const loginCalls: Array<{ authorization: string; body: unknown }> = []

beforeAll(async () => {
  http = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      res.setHeader('content-type', 'application/json')
      if (req.url === '/login') {
        loginCalls.push({ authorization: String(req.headers.authorization), body: body ? JSON.parse(body) : undefined })
        res.end(JSON.stringify({ code: 0, data: { orderId: 'od-1001' } }))
        return
      }
      if (req.url === '/orders/od-1001') {
        res.end(JSON.stringify({ order: { id: 'od-1001', status: 'PAID', amount: 1999 } }))
        return
      }
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'not found' }))
    })
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const address = http.address()
  if (address === null || typeof address === 'string') throw new Error('监听失败')
  base = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => http.close(() => resolve()))
})

const CASE = `
id: api-checkout
name: API 下单校验
accountRef: test-user
steps:
  - target: api
    action: request
    url: /login
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
    url: '/orders/\${orderId}'
  - target: api
    action: assert
    expected: '"status":"PAID"'
`

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'testpilot-sdk-api-'))
  await mkdir(join(root, 'tests/e2e/cases'), { recursive: true })
  await writeFile(join(root, 'testpilot.yaml'), `api:\n  baseUrl: ${base}\n`, 'utf8')
  await writeFile(join(root, 'tests/e2e/cases/checkout.yaml'), CASE, 'utf8')
  return root
}

describe('sdk:runCases(api target + accountRef)', () => {
  test('凭据注入 account.* 变量,混合 request/extract/assert 全链路通过', async () => {
    const client = new TestPilotClient({ root: await makeRoot() })
    const { summary, missingAccounts } = await client.runCases({
      adapters: [apiAdapterFactory({ baseUrl: base })],
      accounts: {
        'test-user': JSON.stringify({ username: 'alice', token: 'secret-token-1' }),
      },
    })

    expect(missingAccounts).toEqual([])
    expect(summary.status).toBe('passed')
    expect(summary.totals.cases).toBe(1)

    // 服务端收到的请求已解析凭据(不是字面量 \${account.*})
    expect(loginCalls.at(-1)?.authorization).toBe('Bearer secret-token-1')
    expect(loginCalls.at(-1)?.body).toEqual({ username: 'alice' })

    // http 取证:敏感头脱敏,请求/响应体截断
    const request0 = summary.cases[0]?.steps.find((step) => step.action === 'request')
    expect(request0?.http).toMatchObject({ method: 'POST', url: '/login', status: 200 })
    expect(request0?.http?.requestHeaders?.authorization).toBe('[REDACTED]')
    expect(request0?.http?.requestBody).toContain('alice')
    // 凭据原文不出现在任何取证文本里
    expect(JSON.stringify(summary)).not.toContain('secret-token-1')
  })

  test('未提供账号时报告 missingAccounts,用例按 ACCOUNT_UNAVAILABLE 阻塞', async () => {
    const client = new TestPilotClient({ root: await makeRoot() })
    const callsBefore = loginCalls.length
    const { summary, missingAccounts } = await client.runCases({
      adapters: [apiAdapterFactory({ baseUrl: base })],
    })

    expect(missingAccounts).toEqual(['test-user'])
    // 账号缺失 → ${account.*} 解析即失败(ACCOUNT_UNAVAILABLE),用例 blocked,不会发出字面量占位符请求
    expect(summary.cases[0]?.status).toBe('blocked')
    expect(summary.cases[0]?.errorCode).toBe('ACCOUNT_UNAVAILABLE')
    expect(loginCalls.length).toBe(callsBefore)
  })

  test('fixture 缺失 → 该 case blocked,其余 case 照常执行(FIXTURE_MISSING 端到端)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-sdk-fixture-'))
    await mkdir(join(root, 'tests/e2e/cases'), { recursive: true })
    await writeFile(join(root, 'testpilot.yaml'), `api:\n  baseUrl: ${base}\n`, 'utf8')
    await writeFile(
      join(root, 'tests/e2e/cases/missing-fixture.yaml'),
      `id: missing-fixture\nname: 数据缺失\nfixtures: [tests/e2e/data/no-such-fixture.yaml]\nsteps:\n  - target: api\n    action: request\n    url: /login\n    expected: '200'\n`,
      'utf8',
    )
    await writeFile(
      join(root, 'tests/e2e/cases/healthy.yaml'),
      `id: healthy\nname: 正常用例\nsteps:\n  - target: api\n    action: request\n    url: /login\n    expected: '200'\n`,
      'utf8',
    )
    const client = new TestPilotClient({ root })
    const { summary } = await client.runCases({
      adapters: [apiAdapterFactory({ baseUrl: base })],
    })

    // 不再整 run 中止:缺数据的 case blocked(exit 2 语义),健康 case 照常跑完
    const blocked = summary.cases.find((item) => item.caseId === 'missing-fixture')
    const healthy = summary.cases.find((item) => item.caseId === 'healthy')
    expect(blocked?.status).toBe('blocked')
    expect(blocked?.errorCode).toBe('FIXTURE_MISSING')
    expect(healthy?.status).toBe('passed')
    expect(summary.totals.blocked).toBe(1)
    expect(summary.totals.passed).toBe(1)
    expect(summary.status).toBe('blocked')
  })
})
