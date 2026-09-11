import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { redactHeaders } from '@testpilot/adapter-core'
import { ApiAdapter, apiAdapterFactory } from './index'

/** 本地回声服务器:记录最近一次请求,按路由返回固定 JSON */
let http: Server
let base = ''
const seen: Array<{ method: string; url: string; headers: Record<string, string>; body: string }> = []

beforeAll(async () => {
  http = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers as Record<string, string>, body })
      res.setHeader('content-type', 'application/json')
      if (req.url === '/login') {
        res.end(JSON.stringify({ code: 0, data: { token: 't-123', orderId: 'o-9' }, items: [{ id: 7 }] }))
        return
      }
      if (req.url === '/not-found') {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'missing' }))
        return
      }
      res.end(JSON.stringify({ ok: true, echo: body }))
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

describe('adapter-api', () => {
  test('相对 url 按 baseUrl 解析,POST 对象自动 JSON 序列化', async () => {
    const adapter = new ApiAdapter({ baseUrl: base })
    const res = await adapter.request({
      method: 'POST',
      url: 'echo',
      headers: { 'x-test': '1' },
      body: { skuId: 'S1', count: 2 },
    })
    expect(res.status).toBe(200)
    expect(seen.at(-1)?.url).toBe('/echo')
    expect(seen.at(-1)?.headers['content-type']).toBe('application/json')
    expect(JSON.parse(seen.at(-1)?.body ?? '')).toEqual({ skuId: 'S1', count: 2 })
  })

  test('JSON path 提取:对象嵌套与数组下标', async () => {
    const adapter = new ApiAdapter({ baseUrl: base })
    await adapter.request({ method: 'GET', url: '/login' })
    expect(await adapter.extractResponse('data.orderId')).toBe('o-9')
    expect(await adapter.extractResponse('items.0.id')).toBe('7')
    await expect(adapter.extractResponse('data.none')).rejects.toThrow(/值为空|中断/)
  })

  test('断言响应体包含与失败信息', async () => {
    const adapter = new ApiAdapter({ baseUrl: base })
    await adapter.request({ method: 'GET', url: '/login' })
    await adapter.assertResponse('"token":"t-123"')
    await expect(adapter.assertResponse('nope')).rejects.toThrow('响应体不包含')
  })

  test('相对 url 且未配置 baseUrl 时给出配置错误', async () => {
    const adapter = new ApiAdapter()
    await expect(adapter.request({ method: 'GET', url: '/x' })).rejects.toThrow('api.baseUrl')
  })

  test('工厂 target 为 api;敏感头脱敏', async () => {
    const factory = apiAdapterFactory({ baseUrl: base })
    expect(factory.target).toBe('api')
    const adapter = await factory.create()
    expect(adapter.target).toBe('api')

    const redacted = redactHeaders({
      authorization: 'Bearer secret',
      'x-api-key': 'k',
      'content-type': 'application/json',
    })
    expect(redacted.authorization).toBe('[REDACTED]')
    expect(redacted['x-api-key']).toBe('[REDACTED]')
    expect(redacted['content-type']).toBe('application/json')
  })
})
