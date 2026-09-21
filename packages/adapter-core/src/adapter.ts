import type { CaseLocator, StepTarget } from '@testpilot/dsl'

/**
 * 平台适配器统一接口:执行引擎只依赖此抽象,不感知 Playwright / WeChatIDE 细节。
 * 方法入参中的模板变量(${var})已由引擎解析为字面量。
 */
export interface TestAdapter {
  readonly target: StepTarget
  /** 打开底层会话;需幂等(已被会话管理调用时不重复初始化) */
  launch(): Promise<void>
  navigate(url: string): Promise<void>
  click(locator: CaseLocator): Promise<void>
  input(locator: CaseLocator, value: string): Promise<void>
  select(locator: CaseLocator, value: string): Promise<void>
  /** locator 与 timeoutMs 至少提供一个 */
  wait(locator: CaseLocator | undefined, timeoutMs: number | undefined): Promise<void>
  /** 断言元素文本包含 expected(变量已解析) */
  assert(locator: CaseLocator, expected: string): Promise<void>
  /** 提取元素文本,由引擎存入 ExecutionContext */
  extract(locator: CaseLocator): Promise<string>
  /** 截图取证,返回 PNG 字节 */
  screenshot(): Promise<Buffer>
  /** 释放底层资源(浏览器 / IDE 连接) */
  close(): Promise<void>
/** [可选能力] 开始用例级取证(video/trace);不支持的可不实现 */
  startEvidence?(caseId: string): Promise<void>
  /** [可选能力] 结束取证并返回产物字节;与 startEvidence 成对调用 */
  stopEvidence?(caseId: string): Promise<AdapterEvidence>
  /** [可选能力] 开始采集当前 UI 会话发出的网络请求 */
  startRequestCapture?(): Promise<void>
  /** [可选能力] 停止采集并返回请求摘要 */
  stopRequestCapture?(): Promise<CapturedRequest[]>

  // ---- [可选能力] API 端(target: api) ----

  /** 发起 HTTP 请求;相对 url 由 adapter 按配置的 baseUrl 解析,模板变量已由引擎解析 */
  request?(request: ApiRequestInput): Promise<ApiResult>
  /** 断言最近一次响应体文本包含 expected */
  assertResponse?(expected: string): Promise<void>
  /** 按点号 JSON path(如 data.orderId / items.0.id)从最近一次响应提取值 */
  extractResponse?(path: string): Promise<string>
}

export interface CapturedRequest {
  method: string
  url: string
}

/** api target:request action 的请求描述 */
export interface ApiRequestInput {
  method: string
  url: string
  headers?: Record<string, string>
  /** 对象按 JSON 序列化并发送 application/json,字符串原样发送 */
  body?: string | Record<string, unknown>
}

/** api target:请求结果(adapter 保留最近一次,供 assert/extract 使用) */
export interface ApiResult {
  status: number
  statusText: string
  headers: Record<string, string>
  bodyText: string
  /** 响应体可解析为 JSON 时给出 */
  json?: unknown
}

/** 取证中必须脱敏的请求/响应头 */
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization'])

/** 复制头部并对敏感键脱敏(用于 StepResult.http 取证) */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[REDACTED]' : value
  }
  return redacted
}

/** adapter 工厂:引擎按需调用 create(),运行结束后统一 close */
export interface AdapterFactory {
  readonly target: StepTarget
  create(): Promise<TestAdapter>
}

/** 用例级取证产物(video/trace 字节,由引擎落盘到 run 目录) */
export interface AdapterEvidence {
  video?: Buffer
  trace?: Buffer
}
