import { redactHeaders, type CapturedRequest, type TestAdapter } from '@testpilot/adapter-core'
import type { StepResult } from '@testpilot/core'
import type { TestStep } from '@testpilot/dsl'
import type { ArtifactManager } from '../artifacts'
import type { ExecutionContext } from '../context'

export interface StepExecutorOptions {
  /** 截图文件名(不含扩展名) */
  screenshotName: string
}

/** 取证片段长度上限(请求体/响应体) */
const SNIPPET_LIMIT = 400

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
        throw new Error(`当前 ${step.target} adapter 不支持请求次数断言`)
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
        await adapter.input(locator!, context.resolve(step.value ?? ''))
        break
      case 'select':
        await adapter.select(locator!, context.resolve(step.value ?? ''))
        break
      case 'wait':
        await adapter.wait(locator, step.timeout)
        break
      case 'assert':
        // api 端断言最近一次响应体;UI 端断言元素文本
        if (step.target === 'api') {
          if (!adapter.assertResponse) throw new Error('当前 adapter 不支持 api 断言')
          await adapter.assertResponse(context.resolve(step.expected ?? ''))
        } else {
          await adapter.assert(locator!, context.resolve(step.expected ?? ''))
        }
        break
      case 'extract': {
        // api 端按 JSON path 从最近响应提取;UI 端提取元素文本
        const value =
          step.target === 'api'
            ? await extractApiResponse(adapter, context.resolve(step.value ?? ''))
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
        if (!adapter.request) throw new Error('当前 adapter 不支持 api request')
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
            throw new Error(
              `HTTP 状态码 ${response.status} ${response.statusText},期望 ${expectedStatus}:${snippet(response.bodyText, 200)}`,
            )
          }
        }
        break
      }
      default: {
        const exhaustive: never = step.action
        throw new Error(`不支持的 action:${String(exhaustive)}`)
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
        throw new Error(
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
  if (!adapter.extractResponse) throw new Error('当前 adapter 不支持 api 提取')
  if (!path) throw new Error('api 端 extract 需要提供 value(点号 JSON path)')
  return adapter.extractResponse(path)
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
