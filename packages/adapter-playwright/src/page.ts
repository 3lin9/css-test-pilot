import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AdapterEvidence, CapturedRequest, TestAdapter } from '@testpilot/adapter-core'
import type { CaseLocator, StepTarget } from '@testpilot/dsl'
import { errors, type BrowserContext, type Locator, type Page, type Request } from 'playwright'
import { TestPilotError } from '@testpilot/core'
import {
  fingerprintMatches,
  observationStateHash,
  stableHash,
  type ElementFingerprint,
  type LocatorCandidate,
  type ObservedElement,
  type ProbeResult,
  type StabilityOptions,
  type StabilityResult,
  type UIObservation,
} from '@testpilot/observation-core'
import type { BrowserBundle, PlaywrightAdapterOptions } from './browser'
import { openCaseContext } from './browser'

/** assert / extract 对元素文本的轮询窗口(SPA 数据绑定未完成时等待内容出现);可用 options.textWaitMs 覆盖 */
const TEXT_WAIT_MS = 10_000

/** longpress 的按住时长(web 端以 click delay 近似原生长按) */
const LONG_PRESS_MS = 600
const OBSERVATION_LIMIT = 200
const RECENT_REQUEST_LIMIT = 100

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface CurrentContext {
  context: BrowserContext
  page: Page
  /** 存在时表示该用例正在录制 video/trace */
  evidenceTmpDir?: string
}

interface RawObservedElement {
  tag: string
  role?: string
  name?: string
  text?: string
  testId?: string
  label?: string
  placeholder?: string
  css?: string
  visible: boolean
  enabled: boolean
  editable: boolean
  covered: boolean
  box?: { x: number; y: number; width: number; height: number }
  stableAttributes: Record<string, string>
  ancestorPath: string[]
}

/** web 端适配器:把 TestAdapter 原语映射到 Playwright API;上下文按用例创建以支持录屏与 trace */
export class PlaywrightAdapter implements TestAdapter {
  readonly target: StepTarget = 'web'
  private current: CurrentContext | undefined
  private requestCapture:
    | { page: Page; listener: (request: Request) => void; requests: CapturedRequest[] }
    | undefined
  private observationPage: Page | undefined
  private readonly recentRequests: CapturedRequest[] = []
  private inFlightRequests = 0

  constructor(
    private readonly bundle: BrowserBundle,
    private readonly options: PlaywrightAdapterOptions = {},
  ) {}

  /** 浏览器在 create() 时已启动;context/page 按用例惰性创建,launch 保持幂等 */
  async launch(): Promise<void> {}

  /** 开始用例级取证:为本用例创建独立 context(录屏 + trace) */
  async startEvidence(_caseId: string): Promise<void> {
    await this.closeContextQuietly()
    const evidenceTmpDir = await mkdtemp(join(tmpdir(), 'testpilot-pw-'))
    this.current = {
      ...(await openCaseContext(this.bundle, this.options, evidenceTmpDir)),
      evidenceTmpDir,
    }
  }

  /** 结束取证:trace 落 zip、录屏在 context 关闭后完成,返回二者字节 */
  async stopEvidence(_caseId: string): Promise<AdapterEvidence> {
    await this.stopRequestCapture().catch(() => [])
    if (!this.current) return {}
    const { context, page, evidenceTmpDir } = this.current
    this.current = undefined

    const traceZipPath = join(evidenceTmpDir ?? tmpdir(), 'trace.zip')
    await context.tracing.stop({ path: traceZipPath }).catch(() => undefined)
    const recordedVideoPath = await page
      .video()
      ?.path()
      .catch(() => undefined)
    await context.close().catch(() => undefined)

    const video = recordedVideoPath && existsSync(recordedVideoPath) ? await readFile(recordedVideoPath) : undefined
    const trace = evidenceTmpDir && existsSync(traceZipPath) ? await readFile(traceZipPath) : undefined
    if (evidenceTmpDir) await rm(evidenceTmpDir, { recursive: true, force: true }).catch(() => undefined)
    return { video, trace }
  }

  async startRequestCapture(): Promise<void> {
    if (this.requestCapture) await this.stopRequestCapture()
    const page = await this.ensurePage()
    const requests: CapturedRequest[] = []
    const listener = (request: Request) => {
      requests.push({ method: request.method(), url: request.url() })
    }
    page.on('request', listener)
    this.requestCapture = { page, listener, requests }
  }

  async stopRequestCapture(): Promise<CapturedRequest[]> {
    if (!this.requestCapture) return []
    const capture = this.requestCapture
    this.requestCapture = undefined
    capture.page.off('request', capture.listener)
    return capture.requests
  }

  async navigate(url: string): Promise<void> {
    const options = this.options
    const page = await this.ensurePage()
    const target =
      options.baseUrl && !/^https?:\/\//i.test(url) ? new URL(url, options.baseUrl).toString() : url
    try {
      await page.goto(target)
    } catch (err) {
      if (err instanceof errors.TimeoutError) {
        throw new TestPilotError('STEP_TIMEOUT', err.message, { cause: err })
      }
      if (err instanceof Error && err.message.includes('net::ERR')) {
        throw new TestPilotError('ENVIRONMENT_UNAVAILABLE', err.message, { cause: err })
      }
      throw err
    }
  }

  async click(locator: CaseLocator): Promise<void> {
    const target = await this.toLocator(locator)
    await this.coded(() => target.click())
  }

  /** 长按元素:web 端没有原生 longpress,以按住 LONG_PRESS_MS 的 click 近似 */
  async longpress(locator: CaseLocator): Promise<void> {
    const target = await this.toLocator(locator)
    await this.coded(() => target.click({ delay: LONG_PRESS_MS }))
  }

  /** 统计匹配元素数量(单次读取,不等待;重试语义由引擎负责) */
  async countElements(locator: CaseLocator): Promise<number> {
    const target = await this.toLocator(locator)
    return target.count()
  }

  /** 读取元素 attribute(不存在时为 null) */
  async getElementAttribute(locator: CaseLocator, name: string): Promise<unknown> {
    const target = await this.toLocator(locator)
    return this.coded(() => target.getAttribute(name))
  }

  async input(locator: CaseLocator, value: string): Promise<void> {
    const target = await this.toLocator(locator)
    await this.coded(() => target.fill(value))
  }

  async select(locator: CaseLocator, value: string): Promise<void> {
    const target = await this.toLocator(locator)
    await this.coded(() => target.selectOption(value))
  }

  async wait(locator: CaseLocator | undefined, timeoutMs: number | undefined): Promise<void> {
    const page = await this.ensurePage()
    if (locator) {
      await this.coded(() => this.toLocatorOn(page, locator).waitFor({ state: 'visible', timeout: timeoutMs }))
      return
    }
    await page.waitForTimeout(timeoutMs ?? 1_000)
  }

  async assert(locator: CaseLocator, expected: string): Promise<void> {
    const target = await this.toLocator(locator)
    const wanted = expected.trim()
    // SPA 数据绑定未完成时文本可能为空/陈旧:轮询直到包含期望内容或超时
    const startedAt = Date.now()
    for (;;) {
      await this.coded(() => target.waitFor({ state: 'visible' }))
      const actual = (await this.coded(() => target.innerText())).trim()
      if (actual.includes(wanted)) return
      if (Date.now() - startedAt > TEXT_WAIT_MS) {
        throw new TestPilotError(
          'ASSERTION_FAILED',
          `断言失败(等待 ${TEXT_WAIT_MS}ms):期望包含 "${wanted}",实际为 "${actual.slice(0, 200)}"`,
        )
      }
      await delay(300)
    }
  }

  async extract(locator: CaseLocator): Promise<string> {
    const target = await this.toLocator(locator)
    const startedAt = Date.now()
    // 数据绑定未完成时文本可能为空:轮询直到出现内容或超时(超时后返回当前文本)
    for (;;) {
      const text = (await this.coded(() => target.innerText())).trim()
      if (text.length > 0 || Date.now() - startedAt > TEXT_WAIT_MS) return text
      await delay(300)
    }
  }

  async screenshot(): Promise<Buffer> {
    return (await this.ensurePage()).screenshot()
  }

  /** 采集面向 AI 的语义树和经过精简的可交互元素，不读取 input value。 */
  async observe(intent?: string): Promise<UIObservation> {
    return this.observePage(true, intent)
  }

  async probe(candidate: LocatorCandidate): Promise<ProbeResult> {
    const page = await this.ensurePage()
    const target = this.toLocatorOn(page, candidate.locator)
    const matchedCount = await target.count()
    const unique = matchedCount === 1
    let visible = false
    let enabled = false
    let editable = false
    let covered = true
    let fingerprint: ElementFingerprint | undefined
    if (unique) {
      ;[visible, enabled, editable] = await Promise.all([
        target.isVisible(),
        target.isEnabled().catch(() => true),
        target.isEditable().catch(() => false),
      ])
      const snapshot = await target.evaluate((element) => {
        const node = element as HTMLElement
        const rect = node.getBoundingClientRect()
        const center = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        const role =
          node.getAttribute('role') ??
          (node.tagName === 'BUTTON'
            ? 'button'
            : node.tagName === 'A'
              ? 'link'
              : node.tagName === 'INPUT'
                ? 'textbox'
                : undefined)
        const name =
          node.getAttribute('aria-label') ??
          (node instanceof HTMLInputElement ? node.labels?.[0]?.textContent?.trim() : undefined) ??
          node.textContent?.trim()
        const stableAttributes: Record<string, string> = {}
        for (const key of ['type', 'name', 'aria-controls', 'aria-expanded']) {
          const value = node.getAttribute(key)
          if (value !== null) stableAttributes[key] = value
        }
        const ancestorPath: string[] = []
        let parent = node.parentElement
        while (parent && ancestorPath.length < 3) {
          ancestorPath.unshift(
            `${parent.tagName.toLowerCase()}${parent.id ? `#${parent.id}` : ''}`,
          )
          parent = parent.parentElement
        }
        return {
          tag: node.tagName.toLowerCase(),
          role,
          name,
          testId: node.getAttribute('data-testid') ?? undefined,
          stableAttributes,
          ancestorPath,
          text: node.textContent?.trim(),
          box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          covered: center !== node && !node.contains(center),
        }
      })
      covered = snapshot.covered
      fingerprint = {
        tag: snapshot.tag,
        role: snapshot.role,
        name: snapshot.name,
        testId: snapshot.testId,
        stableAttributes: snapshot.stableAttributes,
        ancestorPath: snapshot.ancestorPath,
        textHash: snapshot.text ? stableHash(snapshot.text) : undefined,
        box: snapshot.box,
      }
    }
    const identityMatches =
      fingerprint !== undefined && fingerprintMatches(candidate.fingerprint, fingerprint)
    const actionable = unique && visible && enabled && !covered && identityMatches
    return {
      candidate,
      matchedCount,
      unique,
      visible,
      enabled,
      editable,
      covered,
      actionable,
      stateHash: stableHash({ route: page.url() }),
      fingerprint,
      reason: actionable
        ? undefined
        : !unique
          ? `locator 命中 ${matchedCount} 个元素`
          : !identityMatches
            ? '元素指纹与候选不一致'
            : !visible
              ? '元素不可见'
              : !enabled
                ? '元素未启用'
                : covered
                  ? '元素被遮挡'
                  : '元素不可操作',
    }
  }

  async waitForStable(options: StabilityOptions = {}): Promise<StabilityResult> {
    const timeoutMs = options.timeoutMs ?? 5_000
    const quietWindowMs = options.quietWindowMs ?? 500
    const pollMs = options.pollMs ?? 100
    const startedAt = Date.now()
    let stableSince = startedAt
    let previous = ''
    let samples = 0
    let latest = ''
    while (Date.now() - startedAt <= timeoutMs) {
      latest = (await this.observePage(false)).stateHash
      samples += 1
      if (latest !== previous || this.inFlightRequests > 0) {
        previous = latest
        stableSince = Date.now()
      } else if (Date.now() - stableSince >= quietWindowMs) {
        return { stable: true, durationMs: Date.now() - startedAt, samples, stateHash: latest }
      }
      await delay(pollMs)
    }
    return {
      stable: false,
      durationMs: Date.now() - startedAt,
      samples,
      stateHash: latest,
      reason: `页面在 ${timeoutMs}ms 内未稳定`,
    }
  }

  async close(): Promise<void> {
    await this.closeContextQuietly()
    await this.bundle.browser.close().catch(() => undefined)
  }

  private async ensurePage(): Promise<Page> {
    if (!this.current) {
      this.current = await openCaseContext(this.bundle, this.options)
    }
    this.attachObservationTracking(this.current.page)
    return this.current.page
  }

  private async toLocator(locator: CaseLocator): Promise<Locator> {
    return this.toLocatorOn(await this.ensurePage(), locator)
  }

  /** 定位类操作的统一兜底:等待超时按「元素没等到」归类(可能是回归也可能是 selector 腐烂,不允许静默) */
  private async coded<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof errors.TimeoutError) {
        throw new TestPilotError('ELEMENT_NOT_FOUND', err.message, { cause: err })
      }
      throw err
    }
  }

  private toLocatorOn(page: Page, locator: CaseLocator): Locator {
    if (locator.text !== undefined) {
      return page.getByText(locator.text, { exact: true })
    }
    if (locator.css !== undefined) {
      return page.locator(locator.css)
    }
    if (locator.testId !== undefined) {
      return page.getByTestId(locator.testId)
    }
    if (locator.role !== undefined) {
      return page.getByRole(locator.role as Parameters<Page['getByRole']>[0], {
        ...(locator.name !== undefined ? { name: locator.name } : {}),
        exact: true,
      })
    }
    if (locator.label !== undefined) {
      return page.getByLabel(locator.label, { exact: true })
    }
    if (locator.placeholder !== undefined) {
      return page.getByPlaceholder(locator.placeholder, { exact: true })
    }
    throw new Error(`无效的 locator:${JSON.stringify(locator)}`)
  }

  private async observePage(withScreenshot: boolean, intent?: string): Promise<UIObservation> {
    const page = await this.ensurePage()
    const [rawSemanticTree, title, rows, screenshot] = await Promise.all([
      page.ariaSnapshot({ mode: 'ai', boxes: true }),
      page.title(),
      page.evaluate((limit) => {
        const selector =
          'button,a[href],input,textarea,select,[role],[contenteditable="true"],[tabindex],[data-testid]'
        return Array.from(document.querySelectorAll<HTMLElement>(selector))
          .slice(0, limit)
          .map((node) => {
            const style = getComputedStyle(node)
            const rect = node.getBoundingClientRect()
            const visible =
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== 'hidden' &&
              style.display !== 'none'
            const center = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            )
            const role =
              node.getAttribute('role') ??
              (node.tagName === 'BUTTON'
                ? 'button'
                : node.tagName === 'A'
                  ? 'link'
                  : node.tagName === 'INPUT'
                    ? 'textbox'
                    : undefined)
            const label =
              node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
                ? node.labels?.[0]?.textContent?.trim()
                : undefined
            const name =
              node.getAttribute('aria-label') ?? label ?? node.textContent?.trim() ?? undefined
            const stableAttributes: Record<string, string> = {}
            for (const key of ['type', 'name', 'aria-controls', 'aria-expanded']) {
              const value = node.getAttribute(key)
              if (value !== null) stableAttributes[key] = value
            }
            const ancestorPath: string[] = []
            let parent = node.parentElement
            while (parent && ancestorPath.length < 3) {
              ancestorPath.unshift(
                `${parent.tagName.toLowerCase()}${parent.id ? `#${parent.id}` : ''}`,
              )
              parent = parent.parentElement
            }
            const classNames = Array.from(node.classList).filter(
              (value) => !/\d{4,}|^(css|sc|jsx)-/i.test(value),
            )
            const css = node.id
              ? `#${node.id}`
              : classNames.length > 0
                ? `${node.tagName.toLowerCase()}.${classNames.slice(0, 2).join('.')}`
                : undefined
            return {
              tag: node.tagName.toLowerCase(),
              role,
              name,
              text: node.textContent?.trim() || undefined,
              testId: node.getAttribute('data-testid') ?? undefined,
              label,
              placeholder: node.getAttribute('placeholder') ?? undefined,
              css,
              visible,
              enabled: !(
                node instanceof HTMLButtonElement ||
                node instanceof HTMLInputElement ||
                node instanceof HTMLSelectElement ||
                node instanceof HTMLTextAreaElement
              ) || !node.disabled,
              editable:
                node instanceof HTMLInputElement ||
                node instanceof HTMLTextAreaElement ||
                node instanceof HTMLSelectElement ||
                node.isContentEditable,
              covered: center !== node && !node.contains(center),
              box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              stableAttributes,
              ancestorPath,
            }
          })
      }, OBSERVATION_LIMIT) as Promise<RawObservedElement[]>,
      withScreenshot ? page.screenshot() : Promise.resolve(undefined),
    ])
    const semanticTree = sanitizeAriaSnapshot(rawSemanticTree)
    const interactiveElements = rows.map((row, index) => toObservedElement(row, index, intent))
    const partial: Omit<UIObservation, 'stateHash'> = {
      target: 'web',
      route: page.url(),
      title,
      semanticTree,
      screenshot,
      interactiveElements,
      networkActivity: this.recentRequests.map((request) => ({
        method: request.method,
        url: sanitizeObservedUrl(request.url),
      })),
      observedAt: new Date().toISOString(),
    }
    return { ...partial, stateHash: observationStateHash(partial) }
  }

  private attachObservationTracking(page: Page): void {
    if (this.observationPage === page || typeof page.on !== 'function') return
    this.observationPage = page
    page.on('request', (request) => {
      this.inFlightRequests += 1
      this.recentRequests.push({ method: request.method(), url: request.url() })
      if (this.recentRequests.length > RECENT_REQUEST_LIMIT) this.recentRequests.shift()
    })
    const settled = () => {
      this.inFlightRequests = Math.max(0, this.inFlightRequests - 1)
    }
    page.on('requestfinished', settled)
    page.on('requestfailed', settled)
  }

  private async closeContextQuietly(): Promise<void> {
    await this.stopRequestCapture().catch(() => [])
    if (!this.current) return
    const { context } = this.current
    this.current = undefined
    await context.close().catch(() => undefined)
  }
}

function toObservedElement(row: RawObservedElement, index: number, intent?: string): ObservedElement {
  const fingerprint: ElementFingerprint = {
    role: row.role,
    name: row.name,
    testId: row.testId,
    tag: row.tag,
    stableAttributes: row.stableAttributes,
    ancestorPath: row.ancestorPath,
    textHash: row.text ? stableHash(row.text) : undefined,
    box: row.box,
  }
  const candidates: LocatorCandidate[] = []
  const add = (
    locator: CaseLocator,
    strategy: LocatorCandidate['strategy'],
    baseScore: number,
    description: string,
  ) => {
    const haystack = `${description} ${row.text ?? ''}`.toLocaleLowerCase()
    const intentBonus =
      intent && haystack.includes(intent.trim().toLocaleLowerCase()) ? 5 : 0
    candidates.push({ locator, strategy, score: baseScore + intentBonus, description, fingerprint })
  }
  if (row.testId) add({ testId: row.testId }, 'testId', 100, row.name ?? row.testId)
  if (row.role) add({ role: row.role, ...(row.name ? { name: row.name } : {}) }, 'role', 90, row.name ?? row.role)
  if (row.label) add({ label: row.label }, 'label', 80, row.label)
  if (row.placeholder) add({ placeholder: row.placeholder }, 'placeholder', 70, row.placeholder)
  if (row.text) add({ text: row.text }, 'text', 50, row.text)
  if (row.css) add({ css: row.css }, 'css', 40, row.css)
  candidates.sort((left, right) => right.score - left.score)
  return {
    index,
    tag: row.tag,
    role: row.role,
    name: row.name,
    text: row.text,
    testId: row.testId,
    label: row.label,
    placeholder: row.placeholder,
    css: row.css,
    visible: row.visible,
    enabled: row.enabled,
    editable: row.editable,
    covered: row.covered,
    box: row.box,
    fingerprint,
    candidates,
  }
}

function sanitizeObservedUrl(url: string): string {
  const query = url.indexOf('?')
  return query >= 0 ? `${url.slice(0, query)}?<redacted>` : url
}

/** aria snapshot 可能包含表单当前值；观察层只保留控件语义，不保留输入内容。 */
function sanitizeAriaSnapshot(snapshot: string): string {
  return snapshot
    .split('\n')
    .map((line) =>
      /\b(?:textbox|searchbox|combobox)\b/i.test(line)
        ? line.replace(/:\s*(?:".*"|'.*'|\S.*)$/u, ': <redacted>')
        : line,
    )
    .join('\n')
}
