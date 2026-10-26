import type { CaseLocator, NativeAuthorizeDecision, StepTarget } from '@testpilot/dsl'
import type {
  LocatorCandidate,
  ProbeResult,
  StabilityOptions,
  StabilityResult,
  UIObservation,
} from '@testpilot/observation-core'

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
  /** [可选能力] 只读观察当前真实界面；不得把敏感输入值放入结果 */
  observe?(intent?: string): Promise<UIObservation>
  /** [可选能力] 实测候选 locator 的唯一性、可见性和可操作性 */
  probe?(candidate: LocatorCandidate): Promise<ProbeResult>
  /** [可选能力] 等待 DOM/WXML 在 quiet window 内保持不变 */
  waitForStable?(options?: StabilityOptions): Promise<StabilityResult>
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

  // ---- [可选能力] miniapp 端(target: miniapp) ----

  /** [可选能力] 调用 Page / 组件方法(用于把人工操作步骤快速自动化;页面级调用 locator 传 undefined) */
  callMethod?(
    locator: CaseLocator | undefined,
    methodName: string,
    args: readonly unknown[],
  ): Promise<unknown>
  /** [可选能力] mock 任意 wx.* API:拦截调用并返回 mock 值;capture 记录真实调用参数 */
  mockWxApi?(options: {
    api: string
    result?: Record<string, unknown>
    capture?: string
  }): Promise<void>
  /** [可选能力] 读取 mock 期间捕获的调用参数(无激活 mock 时返回 undefined) */
  readWxApiCaptures?(): { name: string; calls: Array<Record<string, unknown>> } | undefined
  /** [可选能力] 恢复 mock 的 wx API(用例结束由引擎调用) */
  restoreWxMock?(): Promise<void>
  /** [可选能力] 触发组件事件(trigger;detail 作为 e.detail 注入,空 detail 即"用户拒绝/取消"类分支) */
  trigger?(locator: CaseLocator, eventType: string, detail?: Record<string, unknown>): Promise<void>
  /** [可选能力] 读取页面 data(点号路径,缺省为整个 data 对象) */
  getData?(dataPath?: string): Promise<unknown>
  /** [可选能力] 写入 data 补丁;locator 缺省为页面级,提供时为组件级(仅 miniapp) */
  setData?(patch: Record<string, unknown>, locator?: CaseLocator): Promise<void>
  /** [可选能力] 断言页面 data 路径的值包含 expected */
  assertData?(dataPath: string, expected: string): Promise<void>

  // ---- [可选能力] miniapp 交互扩展(对照官方 automator Element/MiniProgram API) ----

  /** [可选能力] 长按元素(web 端以按住 ~600ms 的 click 近似) */
  longpress?(locator: CaseLocator): Promise<void>
  /** [可选能力] 主动调用 wx.* API(如 setStorageSync / clearStorageSync 造前置状态);返回值供引擎捕获为变量 */
  callWxApi?(api: string, args: readonly unknown[]): Promise<unknown>
  /** [可选能力] 派发触摸事件(phase: touchstart / touchmove / touchend) */
  touch?(
    locator: CaseLocator,
    phase: string,
    touches: ReadonlyArray<Record<string, unknown>>,
    changedTouches: ReadonlyArray<Record<string, unknown>>,
  ): Promise<void>
  /** [可选能力] 滚动:locator 提供时滚动 scroll-view 元素,缺省滚动页面 */
  scroll?(locator: CaseLocator | undefined, scrollTop: number): Promise<void>
  /** [可选能力] swiper 切换到指定页 */
  swipeTo?(locator: CaseLocator, index: number): Promise<void>
  /** [可选能力] slider 滑到指定值 */
  slideTo?(locator: CaseLocator, value: number): Promise<void>
  /** [可选能力] movable-view 移动到指定坐标 */
  moveTo?(locator: CaseLocator, x: number, y: number): Promise<void>
  /**
   * [可选能力] 点击开发者工具原生授权弹窗。
   * 弹窗可能晚于点击出现,实现应在 timeoutMs 内重试。
   */
  nativeAuthorize?(decision: NativeAuthorizeDecision, timeoutMs?: number): Promise<void>
  /** [可选能力] 统计匹配元素数量(存在性/计数断言;单次读取,重试语义由引擎负责) */
  countElements?(locator: CaseLocator): Promise<number>
  /** [可选能力] 读取元素 attribute;不存在时返回 undefined/null */
  getElementAttribute?(locator: CaseLocator, name: string): Promise<unknown>
  /** [可选能力] 读取元素 property(miniapp 自定义组件实例属性) */
  getElementProperty?(locator: CaseLocator, name: string): Promise<unknown>
  /** [可选能力] 导出运行时诊断(console 尾部 / 异常 / 页面栈 / systemInfo),供失败取证落盘 */
  readDiagnostics?(): Promise<RuntimeDiagnostics>
}

/** 运行时诊断快照(小程序端失败取证的数据源) */
export interface RuntimeDiagnostics {
  /** console 消息尾部(环形缓冲,已在 adapter 侧序列化为文本) */
  consoleLogs: ConsoleLogEntry[]
  /** appservice 未捕获异常(official automator exception 事件) */
  exceptions: string[]
  /** 当前页面栈(读取失败或缺省时为 undefined) */
  pageStack?: Array<{ path?: string; [key: string]: unknown }>
  /** 系统/基础库信息(读取失败或缺省时为 undefined) */
  systemInfo?: Record<string, unknown>
}

/** 一条 console 取证记录(args 已序列化为文本并截断) */
export interface ConsoleLogEntry {
  ts: string
  type: string
  text: string
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
