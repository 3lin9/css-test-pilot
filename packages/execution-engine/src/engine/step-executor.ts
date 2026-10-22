import { describeLocator, redactHeaders, type CapturedRequest, type TestAdapter } from '@testpilot/adapter-core'
import { TestPilotError, type StepResult } from '@testpilot/core'
import type { CaseLocator, TestStep } from '@testpilot/dsl'
import type { ArtifactManager } from '../artifacts'
import type { ExecutionContext } from '../context'

export interface StepExecutorOptions {
  /** 截图文件名(不含扩展名) */
  screenshotName: string
}

/** 取证片段长度上限(请求体/响应体) */
const SNIPPET_LIMIT = 400
/** count / attribute 断言的轮询窗口(与 adapter 侧文本断言一致,容忍数据绑定延迟) */
const ASSERT_POLL_MS = 10_000
/** "元素不存在"(count: 0)断言的 settle 窗口:只等 UI 稳定,不拖满轮询窗口 */
const ABSENT_SETTLE_MS = 2_000

/**
 * 执行单步:解析模板变量 -> 调用 adapter -> 捕获变量 / 截图。
 * 永不抛出:错误进入 StepResult.error,失败时尽力截图取证。
 */
export async function executeStep(
  step: TestStep,
  index: number,
  adapter: TestAdapter,
  context: ExecutionContext,
  artifacts: ArtifactManager,
  options: StepExecutorOptions,
): Promise<StepResult> {
  const startedAt = Date.now()
  const result: StepResult = {
    index,
    target: step.target,
    action: step.action,
    status: 'passed',
    durationMs: 0,
  }
  let captureStarted = false

  try {
    // locator 支持 ${var} 模板解析(动态元素定位,如 .order-row-${orderId})
    const locator = step.locator
      ? {
          text: step.locator.text !== undefined ? context.resolve(step.locator.text) : undefined,
          css: step.locator.css !== undefined ? context.resolve(step.locator.css) : undefined,
        }
      : undefined

    if (step.expectRequests) {
      if (!adapter.startRequestCapture || !adapter.stopRequestCapture) {
        throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持请求次数断言`)
      }
      await adapter.startRequestCapture()
      captureStarted = true
    }

    switch (step.action) {
      case 'launch':
        // 会话已负责首次 launch;这里保持幂等语义
        await adapter.launch()
        break
      case 'navigate':
        await adapter.navigate(context.resolve(step.url ?? ''))
        break
      case 'click':
        await adapter.click(locator!)
        break
      case 'input':
        await adapter.input(locator!, resolveValueText(step.value, context))
        break
      case 'select':
        await adapter.select(locator!, resolveValueText(step.value, context))
        break
      case 'wait':
        await adapter.wait(locator, step.timeout)
        break
      case 'assert': {
        // count 模式:元素数量断言(0 即"元素不存在");引擎持有重试语义,adapter 单次读取
        if (step.count !== undefined) {
          if (!adapter.countElements) {
            throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持 count 断言`)
          }
          await assertElementCount(adapter, locator!, step.count)
          break
        }
        // attribute / property 模式:元素属性断言(String(值) 与 expected 全等)
        if (step.attribute !== undefined || step.property !== undefined) {
          await assertElementAttribute(adapter, locator!, step, context)
          break
        }
        // dataPath 模式:断言页面 data(仅 miniapp);locator 模式:断言元素文本
        if (step.dataPath !== undefined) {
          if (!adapter.assertData) {
            throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持 dataPath 断言`)
          }
          await adapter.assertData(context.resolve(step.dataPath), context.resolve(step.expected ?? ''))
          break
        }
        // api 端断言最近一次响应体;UI 端断言元素文本
        if (step.target === 'api') {
          if (!adapter.assertResponse) throw new TestPilotError('UNSUPPORTED_ACTION', '当前 adapter 不支持 api 断言')
          await adapter.assertResponse(context.resolve(step.expected ?? ''))
        } else {
          await adapter.assert(locator!, context.resolve(step.expected ?? ''))
        }
        break
      }
      case 'extract': {
        // api 端按 JSON path 从最近响应提取;UI 端提取元素文本
        const value =
          step.target === 'api'
            ? await extractApiResponse(adapter, resolveValueText(step.value, context))
            : await adapter.extract(locator!)
        if (step.variable) {
          context.set(step.variable, value)
          result.extracted = { [step.variable]: value }
        }
        break
      }
      case 'screenshot': {
        const data = await adapter.screenshot()
        result.screenshot = await artifacts.saveStepScreenshot(`${options.screenshotName}.png`, data)
        break
      }
      case 'request': {
        if (!adapter.request) throw new TestPilotError('UNSUPPORTED_ACTION', '当前 adapter 不支持 api request')
        const method = step.method ?? 'GET'
        const url = context.resolve(step.url ?? '')
        const headers = resolveHeaders(step.headers, context)
        const body = resolveBody(step.body, context)
        const response = await adapter.request({ method, url, headers, body })

        // 取证:敏感头脱敏,请求/响应体截断(凭据只在模板解析层流转,不落明文)
        result.http = {
          method: method.toUpperCase(),
          url,
          status: response.status,
          ...(headers ? { requestHeaders: redactHeaders(headers) } : {}),
          ...(body !== undefined ? { requestBody: snippet(body) } : {}),
          ...(response.bodyText ? { responseSnippet: snippet(response.bodyText) } : {}),
        }

        // expected 给出时断言状态码(与 UI assert 的文本语义区分:这里校验 HTTP status)
        if (step.expected !== undefined) {
          const expectedStatus = context.resolve(step.expected)
          if (String(response.status) !== expectedStatus) {
            throw new TestPilotError(
              'STATUS_MISMATCH',
              `HTTP 状态码 ${response.status} ${response.statusText},期望 ${expectedStatus}:${snippet(response.bodyText, 200)}`,
            )
          }
        }
        break
      }
      case 'callMethod': {
        // miniapp 端调用 Page / 组件方法(人工操作步骤快速自动化;定位/入参支持 ${var} 模板)
        if (typeof adapter.callMethod !== 'function') {
          throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持 callMethod`)
        }
        const methodName = context.resolve(step.methodName ?? '')
        if (!methodName) throw new TestPilotError('MISSING_METHOD_NAME', 'callMethod 必须提供 methodName')
        const callArgs = (step.args ?? []).map((arg) => resolveDeep(arg, context))
        await adapter.callMethod(locator, methodName, callArgs)
        break
      }
      case 'mockWxApi': {
        if (typeof adapter.mockWxApi !== 'function') {
          throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持 mockWxApi`)
        }
        await adapter.mockWxApi({
          api: context.resolve(step.wxApi ?? ''),
          result: step.result ? (resolveDeep(step.result, context) as Record<string, unknown>) : undefined,
          capture: step.capture,
        })
        break
      }
      case 'trigger': {
        if (typeof adapter.trigger !== 'function') {
          throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持 trigger`)
        }
        if (!locator) throw new TestPilotError('MISSING_LOCATOR', 'trigger 必须提供 locator(要触发事件的组件)')
        await adapter.trigger(locator, context.resolve(step.eventType ?? ''), step.detail ? (resolveDeep(step.detail, context) as Record<string, unknown>) : undefined)
        break
      }
      case 'setData': {
        if (typeof adapter.setData !== 'function') {
          throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持 setData`)
        }
        await adapter.setData(resolveDeep(step.patch ?? {}, context) as Record<string, unknown>, locator)
        break
      }
      case 'longpress': {
        if (typeof adapter.longpress !== 'function') {
          throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持 longpress`)
        }
        await adapter.longpress(locator!)
        break
      }
      case 'callWxApi': {
        // 主动调用 wx.* API 造前置状态(如 setStorageSync / clearStorageSync);返回值可捕获为变量
        if (typeof adapter.callWxApi !== 'function') {
          throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持 callWxApi`)
        }
        const wxApi = context.resolve(step.wxApi ?? '')
        if (!wxApi) throw new TestPilotError('MISSING_WX_API', 'callWxApi 必须提供 wxApi')
        const callArgs = (step.args ?? []).map((arg) => resolveDeep(arg, context))
        const returned = await adapter.callWxApi(wxApi, callArgs)
        if (step.variable) {
          const captured = typeof returned === 'string' ? returned : JSON.stringify(returned) ?? ''
          context.set(step.variable, captured)
          result.extracted = { [step.variable]: captured }
        }
        break
      }
      case 'touch': {
        if (typeof adapter.touch !== 'function') {
          throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持 touch`)
        }
        if (!locator) throw new TestPilotError('MISSING_LOCATOR', 'touch 必须提供 locator')
        const touches = (step.touches ?? []).map((point) => resolveDeep(point, context) as Record<string, unknown>)
        const changed = (step.changedTouches ?? step.touches ?? []).map(
          (point) => resolveDeep(point, context) as Record<string, unknown>,
        )
        await adapter.touch(locator, step.phase ?? '', touches, changed)
        break
      }
      case 'scroll': {
        if (typeof adapter.scroll !== 'function') {
          throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持 scroll`)
        }
        await adapter.scroll(locator, step.scrollTop ?? 0)
        break
      }
      case 'swipeTo': {
        if (typeof adapter.swipeTo !== 'function') {
          throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持 swipeTo`)
        }
        await adapter.swipeTo(locator!, step.index ?? 0)
        break
      }
      case 'slideTo': {
        if (typeof adapter.slideTo !== 'function') {
          throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持 slideTo`)
        }
        await adapter.slideTo(locator!, Number(resolveValueText(step.value, context)))
        break
      }
      case 'moveTo': {
        if (typeof adapter.moveTo !== 'function') {
          throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持 moveTo`)
        }
        await adapter.moveTo(locator!, step.x ?? 0, step.y ?? 0)
        break
      }
      default: {
        const exhaustive: never = step.action
        throw new TestPilotError('UNSUPPORTED_ACTION', `不支持的 action:${String(exhaustive)}`)
      }
    }

    if (step.expectRequests) {
      const windowMs = Math.max(...step.expectRequests.map((item) => item.windowMs))
      if (windowMs > 0) await delay(windowMs)
      const requests = await adapter.stopRequestCapture!()
      captureStarted = false
      result.requestAssertions = buildRequestAssertions(step, requests, context)
      const mismatches = result.requestAssertions.filter((item) => item.actualCount !== item.count)
      if (mismatches.length > 0) {
        throw new TestPilotError(
          'REQUEST_COUNT_MISMATCH',
          mismatches
            .map(
              (item) =>
                `请求次数不匹配:${item.method ?? '*'} ${item.urlContains},实际 ${item.actualCount},期望 ${item.count}`,
            )
            .join('; '),
        )
      }
    }
  } catch (err) {
    if (captureStarted) {
      try {
        await adapter.stopRequestCapture?.()
      } catch {
        // 尽力恢复请求观察器;保留原始动作错误。
      }
      captureStarted = false
    }
    result.status = 'failed'
    result.error = err instanceof Error ? err.message : String(err)
    // TestPilotError 的机器码透传给 case 级三态判定;普通 Error 无码
    result.errorCode = err instanceof TestPilotError ? err.code : undefined
    try {
      const data = await adapter.screenshot()
      result.screenshot = await artifacts.saveStepScreenshot(`${options.screenshotName}-failed.png`, data)
    } catch {
      // 截图失败不影响错误信息(api 端无截图能力,走这里)
    }
  }

  result.durationMs = Date.now() - startedAt
  return result
}

async function extractApiResponse(adapter: TestAdapter, path: string): Promise<string> {
  if (!adapter.extractResponse) throw new TestPilotError('UNSUPPORTED_ACTION', '当前 adapter 不支持 api 提取')
  if (!path) throw new TestPilotError('UNSUPPORTED_ACTION', 'api 端 extract 需要提供 value(点号 JSON path)')
  return adapter.extractResponse(path)
}

/** value 字段可为数字(slideTo)或模板字符串;统一解析为文本 */
function resolveValueText(value: string | number | undefined, context: ExecutionContext): string {
  return value === undefined ? '' : context.resolve(String(value))
}

/** 元素数量断言:期望 > 0 时按数据绑定窗口轮询;期望 0(不存在)只等短 settle 窗口,避免负向断言拖满超时 */
async function assertElementCount(
  adapter: TestAdapter,
  locator: CaseLocator,
  expected: number,
): Promise<void> {
  const windowMs = expected > 0 ? ASSERT_POLL_MS : ABSENT_SETTLE_MS
  const startedAt = Date.now()
  for (;;) {
    const actual = await adapter.countElements!(locator)
    if (actual === expected) return
    if (Date.now() - startedAt > windowMs) {
      throw new TestPilotError(
        'ASSERTION_FAILED',
        `元素数量断言失败(等待 ${windowMs}ms):${describeLocator(locator)} 实际 ${actual},期望 ${expected}`,
      )
    }
    await delay(300)
  }
}

/** attribute / property 断言:String(值) 与 expected 全等;属性缺失时实际值记为 <absent> */
async function assertElementAttribute(
  adapter: TestAdapter,
  locator: CaseLocator,
  step: TestStep,
  context: ExecutionContext,
): Promise<void> {
  const useProperty = step.property !== undefined
  const name = (useProperty ? step.property : step.attribute) ?? ''
  const wanted = context.resolve(step.expected ?? '').trim()
  const startedAt = Date.now()
  for (;;) {
    const actual = useProperty
      ? await adapter.getElementProperty!(locator, name)
      : await adapter.getElementAttribute!(locator, name)
    const actualText = actual === undefined || actual === null ? '<absent>' : String(actual)
    if (actualText.trim() === wanted) return
    if (Date.now() - startedAt > ASSERT_POLL_MS) {
      throw new TestPilotError(
        'ASSERTION_FAILED',
        `属性断言失败(等待 ${ASSERT_POLL_MS}ms):${describeLocator(locator)} 的 ${useProperty ? 'property' : 'attribute'} "${name}" 期望 "${wanted}",实际为 "${actualText.slice(0, 200)}"`,
      )
    }
    await delay(300)
  }
}

/** 请求头值模板解析 */
function resolveHeaders(
  headers: Record<string, string> | undefined,
  context: ExecutionContext,
): Record<string, string> | undefined {
  if (!headers) return undefined
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    resolved[key] = context.resolve(value)
  }
  return resolved
}

/** 请求体模板解析:字符串直接解析;对象递归解析所有字符串值(支持 ${account.password} 等) */
function resolveBody(
  body: string | Record<string, unknown> | undefined,
  context: ExecutionContext,
): string | undefined {
  if (body === undefined) return undefined
  if (typeof body === 'string') return context.resolve(body)
  return JSON.stringify(resolveDeep(body, context))
}

function resolveDeep(value: unknown, context: ExecutionContext): unknown {
  if (typeof value === 'string') return context.resolve(value)
  if (Array.isArray(value)) return value.map((item) => resolveDeep(item, context))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = resolveDeep(item, context)
    }
    return out
  }
  return value
}

function snippet(text: string, limit = SNIPPET_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function buildRequestAssertions(
  step: TestStep,
  requests: CapturedRequest[],
  context: ExecutionContext,
): NonNullable<StepResult['requestAssertions']> {
  return (step.expectRequests ?? []).map((expectation) => {
    const method = expectation.method?.toUpperCase()
    const urlContains = context.resolve(expectation.urlContains)
    const matches = requests.filter(
      (request) =>
        (!method || request.method.toUpperCase() === method) && request.url.includes(urlContains),
    )
    return {
      method,
      urlContains: expectation.urlContains,
      count: expectation.count,
      actualCount: matches.length,
      windowMs: expectation.windowMs,
      requests: matches.slice(0, 20).map((request) => ({
        method: request.method.toUpperCase(),
        url: sanitizeRequestUrl(request.url),
      })),
    }
  })
}

function sanitizeRequestUrl(url: string): string {
  const queryIndex = url.indexOf('?')
  const safe = queryIndex >= 0 ? `${url.slice(0, queryIndex)}?<redacted>` : url
  return snippet(safe, 300)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
