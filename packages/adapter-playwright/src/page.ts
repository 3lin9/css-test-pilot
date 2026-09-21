import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AdapterEvidence, CapturedRequest, TestAdapter } from '@testpilot/adapter-core'
import type { CaseLocator, StepTarget } from '@testpilot/dsl'
import type { BrowserContext, Locator, Page, Request } from 'playwright'
import type { BrowserBundle, PlaywrightAdapterOptions } from './browser'
import { openCaseContext } from './browser'

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
    await page.goto(target)
  }

  async click(locator: CaseLocator): Promise<void> {
    await (await this.toLocator(locator)).click()
  }

  async input(locator: CaseLocator, value: string): Promise<void> {
    await (await this.toLocator(locator)).fill(value)
  }

  async select(locator: CaseLocator, value: string): Promise<void> {
    await (await this.toLocator(locator)).selectOption(value)
  }

  async wait(locator: CaseLocator | undefined, timeoutMs: number | undefined): Promise<void> {
    const page = await this.ensurePage()
    if (locator) {
      await this.toLocatorOn(page, locator).waitFor({ state: 'visible', timeout: timeoutMs })
      return
    }
    await page.waitForTimeout(timeoutMs ?? 1_000)
  }

  async assert(locator: CaseLocator, expected: string): Promise<void> {
    const target = await this.toLocator(locator)
    await target.waitFor({ state: 'visible' })
    const actual = (await target.innerText()).trim()
    const wanted = expected.trim()
    if (!actual.includes(wanted)) {
      throw new Error(`断言失败:期望包含 "${wanted}",实际为 "${actual.slice(0, 200)}"`)
    }
  }

  async extract(locator: CaseLocator): Promise<string> {
    return (await this.toLocator(locator)).innerText().then((text) => text.trim())
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
