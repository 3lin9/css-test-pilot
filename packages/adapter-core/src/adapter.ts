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
