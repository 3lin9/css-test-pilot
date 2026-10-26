import { describeLocator, redactHeaders, type CapturedRequest, type TestAdapter } from '@testpilot/adapter-core'
import { DEFAULT_STEP_TIMEOUT_MS, TestPilotError, type StepResult } from '@testpilot/core'
import { SYSTEM_READONLY_ACTIONS } from '@testpilot/dsl'
import type { CaseLocator, TestStep } from '@testpilot/dsl'
import type {
  LocatorCandidate,
  RehearsalEvidence,
  VerifiedLocator,
} from '@testpilot/observation-core'
import type { ArtifactManager } from '../artifacts'
import type { ExecutionContext } from '../context'

export interface StepExecutorOptions {
  /** 截图文件名(不含扩展名) */
  screenshotName: string
  rehearsal?: {
    phase: 'setup' | 'steps' | 'teardown'
    evidence: RehearsalEvidence
  }
  ready?: {
    phase: 'setup' | 'steps' | 'teardown'
    evidence: RehearsalEvidence
  }
}

/** 取证片段长度上限(请求体/响应体) */
const SNIPPET_LIMIT = 400
/** count / attribute 断言的轮询窗口(与 adapter 侧文本断言一致,容忍数据绑定延迟) */
const ASSERT_POLL_MS = 10_000
/** "元素不存在"(count: 0)断言的 settle 窗口:只等 UI 稳定,不拖满轮询窗口 */
const ABSENT_SETTLE_MS = 2_000
/** Ready/Rehearse 的指纹探针保持即时语义，由执行层在单步超时内负责重试。 */
const ACTIONABILITY_POLL_MS = 100
const ACTIONABLE_ACTIONS = new Set<TestStep['action']>([
  'click',
  'input',
  'select',
  'longpress',
  'touch',
  'scroll',
  'swipeTo',
  'slideTo',
  'moveTo',
  'trigger',
])
const STATE_TRANSITION_ACTIONS = new Set<TestStep['action']>([
  'navigate',
  'click',
  'longpress',
  'trigger',
  'nativeAuthorize',
])

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
    ...(step.system ? { system: step.system } : {}),
    action: step.action,
    status: 'passed',
    durationMs: 0,
  }
  let captureStarted = false

  try {
    // 跨系统只读运行时守卫(validator 已拦截;此处兜住绕过校验的程序化路径)
    if (step.system && !SYSTEM_READONLY_ACTIONS.has(step.action)) {
      throw new TestPilotError(
        'CROSS_SYSTEM_READONLY',
        `跨系统只读:system "${step.system}" 仅允许查询(navigate/wait/assert/extract/screenshot 与 GET/HEAD request),"${step.action}" 会操作其它系统,请在被测系统的用例中执行`,
      )
    }
    if (
      step.system &&
      step.action === 'request' &&
      !['GET', 'HEAD'].includes((step.method ?? 'GET').toUpperCase())
    ) {
      throw new TestPilotError(
        'CROSS_SYSTEM_READONLY',
        `跨系统只读:request 仅允许 GET/HEAD 查询其它系统,当前 ${(step.method ?? 'GET').toUpperCase()}`,
      )
    }
    // locator 支持 ${var} 模板解析(动态元素定位,如 .order-row-${orderId})
    let locator = resolveLocator(step.locator, context)
    if (
      options.ready &&
      step.target !== 'api' &&
      locator &&
      !(step.action === 'assert' && step.count === 0)
    ) {
      if (!adapter.probe) {
        throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持 Ready locator probe`)
      }
      const verified = options.ready.evidence.verifiedLocators.find(
        (item) =>
          item.phase === options.ready!.phase &&
          item.index === index &&
          item.target === step.target,
      )
      if (!verified) {
        throw new TestPilotError(
          'READY_LOCATOR_MISSING',
          `Ready Certificate 缺少 ${options.ready.phase}[${index}] 的已验证 locator`,
        )
      }
      locator = verified.locator
      const requiresActionable = ACTIONABLE_ACTIONS.has(step.action)
      const requiresEditable = step.action === 'input' || step.action === 'select'
      await waitForVerifiedProbe(
        adapter,
        {
          ...verified.probe.candidate,
          locator,
          fingerprint:
            verified.probe.fingerprint ?? verified.probe.candidate.fingerprint,
        },
        requiresActionable,
        requiresEditable,
        `Ready locator 已失效:${describeLocator(locator)}`,
        step.timeout ?? DEFAULT_STEP_TIMEOUT_MS,
      )
    }
    let beforeObservation:
      | Awaited<ReturnType<NonNullable<TestAdapter['observe']>>>
      | undefined
    let verified: VerifiedLocator | undefined
    if (options.rehearsal && step.target !== 'api') {
      if (!adapter.observe || !adapter.waitForStable) {
        throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持运行时彩排`)
      }
      beforeObservation = await adapter.observe()
      options.rehearsal.evidence.pageStateHashes[
        `${step.target}:${beforeObservation.route}`
      ] = beforeObservation.stateHash
      // count:0 是“确认不存在”，不应要求 locator 当前可见。
      if (locator && !(step.action === 'assert' && step.count === 0)) {
        if (!adapter.probe) {
          throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持 locator probe`)
        }
        const candidate = locatorCandidate(locator)
        const requiresActionable = ACTIONABLE_ACTIONS.has(step.action)
        const requiresEditable = step.action === 'input' || step.action === 'select'
        const probe = await waitForVerifiedProbe(
          adapter,
          candidate,
          requiresActionable,
          requiresEditable,
          `locator 彩排未通过:${JSON.stringify(locator)}`,
          step.timeout ?? DEFAULT_STEP_TIMEOUT_MS,
        )
        verified = {
          phase: options.rehearsal.phase,
          index,
          target: step.target,
          locator,
          probe,
        }
        options.rehearsal.evidence.verifiedLocators.push(verified)
      }
    }

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
      case 'nativeAuthorize': {
        if (typeof adapter.nativeAuthorize !== 'function') {
          throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${step.target} adapter 不支持 nativeAuthorize`)
        }
        if (step.decision !== 'allow' && step.decision !== 'cancel') {
          throw new TestPilotError('MISSING_NATIVE_DECISION', 'nativeAuthorize 必须提供 decision(allow / cancel)')
        }
        await adapter.nativeAuthorize(step.decision, step.timeout)
        break
      }
      default: {
        const exhaustive: never = step.action
        throw new TestPilotError('UNSUPPORTED_ACTION', `不支持的 action:${String(exhaustive)}`)
      }
    }

    if (options.rehearsal && step.target !== 'api' && STATE_TRANSITION_ACTIONS.has(step.action)) {
      const stability = await adapter.waitForStable!()
      if (!stability.stable) {
        throw new TestPilotError('PAGE_NOT_STABLE', stability.reason ?? '动作后页面未稳定')
      }
      const afterObservation = await adapter.observe!()
      options.rehearsal.evidence.pageStateHashes[
        `${step.target}:${afterObservation.route}`
      ] = afterObservation.stateHash
      const beforeHash = beforeObservation?.stateHash ?? ''
      const transition = {
        changed: beforeHash !== afterObservation.stateHash,
        beforeHash,
        afterHash: afterObservation.stateHash,
        stability,
      }
      if (verified) verified.transition = transition
      if (!transition.changed && !step.expectRequests) {
        const message = `${step.action} 执行后界面状态未变化，且没有请求断言证明副作用`
        if (step.action === 'trigger' || step.action === 'nativeAuthorize') {
          result.status = 'warning'
          result.error = message
        } else {
          throw new TestPilotError('NO_STATE_CHANGE', message)
        }
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

function resolveLocator(
  locator: CaseLocator | undefined,
  context: ExecutionContext,
): CaseLocator | undefined {
  if (!locator) return undefined
  const resolved: CaseLocator = {}
  for (const key of ['text', 'css', 'testId', 'role', 'name', 'label', 'placeholder'] as const) {
    const value = locator[key]
    if (value !== undefined) resolved[key] = context.resolve(value)
  }
  return resolved
}

function locatorCandidate(locator: CaseLocator): LocatorCandidate {
  const strategy =
    locator.testId !== undefined
      ? 'testId'
      : locator.role !== undefined
        ? 'role'
        : locator.label !== undefined
          ? 'label'
          : locator.placeholder !== undefined
            ? 'placeholder'
            : locator.text !== undefined
              ? 'text'
              : 'css'
  return {
    locator,
    strategy,
    score: 0,
    description: describeLocator(locator),
    fingerprint: { stableAttributes: {}, ancestorPath: [] },
  }
}

async function waitForVerifiedProbe(
  adapter: TestAdapter,
  candidate: LocatorCandidate,
  requiresActionable: boolean,
  requiresEditable: boolean,
  failurePrefix: string,
  timeoutMs: number,
): Promise<Awaited<ReturnType<NonNullable<TestAdapter['probe']>>>> {
  const startedAt = Date.now()
  let lastReason = '元素尚未就绪'
  for (;;) {
    try {
      const probe = await adapter.probe!(candidate)
      const valid = requiresActionable
        ? probe.actionable && (!requiresEditable || probe.editable)
        : probe.unique && probe.visible
      if (valid) return probe
      lastReason = probe.reason ?? (requiresEditable && !probe.editable ? '元素不可编辑' : '元素尚未就绪')
    } catch (err) {
      // DOM 在 count/evaluate 之间被替换属于可恢复瞬态；在单步超时内继续探测。
      lastReason = err instanceof Error ? err.message : String(err)
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new TestPilotError(
        'LOCATOR_UNVERIFIED',
        `${failurePrefix}(等待 ${timeoutMs}ms):${lastReason}`,
      )
    }
    await delay(ACTIONABILITY_POLL_MS)
  }
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
