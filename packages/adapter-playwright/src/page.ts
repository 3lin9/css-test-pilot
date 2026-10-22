import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AdapterEvidence, CapturedRequest, TestAdapter } from '@testpilot/adapter-core'
import type { CaseLocator, StepTarget } from '@testpilot/dsl'
import { errors, type BrowserContext, type Locator, type Page, type Request } from 'playwright'
import { TestPilotError } from '@testpilot/core'
import type { BrowserBundle, PlaywrightAdapterOptions } from './browser'
import { openCaseContext } from './browser'

/** assert / extract 对元素文本的轮询窗口(SPA 数据绑定未完成时等待内容出现);可用 options.textWaitMs 覆盖 */
const TEXT_WAIT_MS = 10_000

/** longpress 的按住时长(web 端以 click delay 近似原生长按) */
const LONG_PRESS_MS = 600

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface CurrentContext {
  context: BrowserContext
  page: Page
  /** 存在时表示该用例正在录制 video/trace */
  evidenceTmpDir?: string
}

/** web 端适配器:把 TestAdapter 原语映射到 Playwright API;上下文按用例创建以支持录屏与 trace */
export class PlaywrightAdapter implements TestAdapter {
  readonly target: StepTarget = 'web'
  private current: CurrentContext | undefined
  private requestCapture:
    | { page: Page; listener: (request: Request) => void; requests: CapturedRequest[] }
    | undefined

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

  async close(): Promise<void> {
    await this.closeContextQuietly()
    await this.bundle.browser.close().catch(() => undefined)
  }

  private async ensurePage(): Promise<Page> {
    if (!this.current) {
      this.current = await openCaseContext(this.bundle, this.options)
    }
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
    throw new Error(`无效的 locator:${JSON.stringify(locator)}`)
  }

  private async closeContextQuietly(): Promise<void> {
    await this.stopRequestCapture().catch(() => [])
    if (!this.current) return
    const { context } = this.current
    this.current = undefined
    await context.close().catch(() => undefined)
  }
}
