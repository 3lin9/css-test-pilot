import { TestPilotError } from '@testpilot/core'
import type { AdapterFactory, ApiRequestInput, ApiResult, TestAdapter } from '@testpilot/adapter-core'
import type { CaseLocator, StepTarget } from '@testpilot/dsl'

export interface ApiAdapterOptions {
  /** 相对 url 的基准地址(testpilot.yaml api.baseUrl) */
  baseUrl?: string
  /** 单请求超时毫秒,默认 15000 */
  timeoutMs?: number
}

/**
 * API 执行端:基于 Node fetch 的 HTTP 会话。
 * 会话内保留最近一次响应,供 api target 的 assert / extract 使用。
 */
export class ApiAdapter implements TestAdapter {
  readonly target: StepTarget = 'api'
  private last: ApiResult | undefined

  constructor(private readonly options: ApiAdapterOptions = {}) {}

  async launch(): Promise<void> {
    // HTTP 无长会话;保持幂等空实现
  }

  /** 相对 url 按 baseUrl 解析;已带协议的绝对地址原样发送 */
  private resolveUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url
    const base = this.options.baseUrl?.replace(/\/$/, '')
    if (!base) {
      throw new TestPilotError('CONFIG_MISSING', `相对 url "${url}" 需要在 testpilot.yaml 配置 api.baseUrl`)
    }
    return `${base}/${url.replace(/^\//, '')}`
  }

  async request(request: ApiRequestInput): Promise<ApiResult> {
    const url = this.resolveUrl(request.url)
    const headers: Record<string, string> = { ...(request.headers ?? {}) }
    let body: string | undefined
    if (request.body !== undefined) {
      if (typeof request.body === 'string') {
        body = request.body
      } else {
        body = JSON.stringify(request.body)
        headers['content-type'] ??= 'application/json'
      }
    }

    let res: Response
    try {
      res = await fetch(url, {
        method: request.method.toUpperCase(),
        headers,
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      })
    } catch (err) {
      throw new Error(`API 请求失败 ${request.method.toUpperCase()} ${url}:${err instanceof Error ? err.message : String(err)}`)
    }

    const bodyText = await res.text()
    let json: unknown
    if (bodyText) {
      try {
        json = JSON.parse(bodyText)
      } catch {
        json = undefined
      }
    }
    const responseHeaders: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    this.last = { status: res.status, statusText: res.statusText, headers: responseHeaders, bodyText, json }
    return this.last
  }

  async assertResponse(expected: string): Promise<void> {
    if (!this.last) throw new Error('尚未发起任何 API 请求,无法断言响应')
    if (!this.last.bodyText.includes(expected)) {
      const snippet = this.last.bodyText.slice(0, 200)
      throw new Error(`响应体不包含 "${expected}":HTTP ${this.last.status} ${snippet}`)
    }
  }

  async extractResponse(path: string): Promise<string> {
    if (!this.last) throw new Error('尚未发起任何 API 请求,无法提取响应字段')
    let current: unknown = this.last.json
    if (current === undefined) throw new Error('响应体不是 JSON,无法按 path 提取')
    for (const segment of path.split('.')) {
      if (current === null || current === undefined) {
        throw new Error(`JSON path "${path}" 在 "${segment}" 处中断:值为空`)
      }
      if (Array.isArray(current)) {
        const index = Number(segment)
        if (!Number.isInteger(index) || index < 0 || index >= current.length) {
          throw new Error(`JSON path "${path}":数组下标 "${segment}" 越界`)
        }
        current = current[index]
      } else if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[segment]
      } else {
        throw new Error(`JSON path "${path}" 在 "${segment}" 处中断:已是标量值`)
      }
    }
    if (current === null || current === undefined) throw new Error(`JSON path "${path}" 的值为空`)
    return typeof current === 'object' ? JSON.stringify(current) : String(current)
  }

  async close(): Promise<void> {
    this.last = undefined
  }

  // ---- UI 能力:api 端不支持 ----

  private unsupported(action: string): never {
    throw new TestPilotError('UNSUPPORTED_ACTION', `api 端不支持 "${action}"(仅支持 request / assert / extract)`)
  }

  async navigate(): Promise<void> {
    this.unsupported('navigate')
  }
  async click(_locator: CaseLocator): Promise<void> {
    this.unsupported('click')
  }
  async input(_locator: CaseLocator, _value: string): Promise<void> {
    this.unsupported('input')
  }
  async select(_locator: CaseLocator, _value: string): Promise<void> {
    this.unsupported('select')
  }
  async wait(_locator: CaseLocator | undefined, _timeoutMs: number | undefined): Promise<void> {
    this.unsupported('wait')
  }
  async assert(_locator: CaseLocator, _expected: string): Promise<void> {
    this.unsupported('assert(locator)')
  }
  async extract(_locator: CaseLocator): Promise<string> {
    this.unsupported('extract(locator)')
  }
  async screenshot(): Promise<Buffer> {
    // 引擎失败兜底会尝试截图;api 端无界面,抛错由引擎忽略
    this.unsupported('screenshot')
  }
}

/** adapter 工厂:SDK 按项目配置(api.baseUrl / 超时)注册 */
export function apiAdapterFactory(options: ApiAdapterOptions = {}): AdapterFactory {
  return {
    target: 'api',
    create: async () => new ApiAdapter(options),
  }
}
