import type { TestAdapter } from '@testpilot/adapter-core'
import type { CaseLocator, StepTarget } from '@testpilot/dsl'
import type { Locator, Page } from 'playwright'
import type { BrowserBundle, PlaywrightAdapterOptions } from './browser'

/** web 端适配器:把 TestAdapter 原语映射到 Playwright API */
export class PlaywrightAdapter implements TestAdapter {
  readonly target: StepTarget = 'web'

  constructor(
    private readonly bundle: BrowserBundle,
    private readonly options: PlaywrightAdapterOptions = {},
  ) {}

  /** 浏览器与页面在 create() 时已打开;launch 保持幂等 */
  async launch(): Promise<void> {}

  async navigate(url: string): Promise<void> {
    const target =
      this.options.baseUrl && !/^https?:\/\//i.test(url) ? new URL(url, this.options.baseUrl).toString() : url
    await this.page.goto(target)
  }

  async click(locator: CaseLocator): Promise<void> {
    await this.toLocator(locator).click()
  }

  async input(locator: CaseLocator, value: string): Promise<void> {
    await this.toLocator(locator).fill(value)
  }

  async select(locator: CaseLocator, value: string): Promise<void> {
    await this.toLocator(locator).selectOption(value)
  }

  async wait(locator: CaseLocator | undefined, timeoutMs: number | undefined): Promise<void> {
    if (locator) {
      await this.toLocator(locator).waitFor({ state: 'visible', timeout: timeoutMs })
      return
    }
    await this.page.waitForTimeout(timeoutMs ?? 1_000)
  }

  async assert(locator: CaseLocator, expected: string): Promise<void> {
    const target = this.toLocator(locator)
    await target.waitFor({ state: 'visible' })
    const actual = (await target.innerText()).trim()
    const wanted = expected.trim()
    if (!actual.includes(wanted)) {
      throw new Error(`断言失败:期望包含 "${wanted}",实际为 "${actual.slice(0, 200)}"`)
    }
  }

  async extract(locator: CaseLocator): Promise<string> {
    return (await this.toLocator(locator).innerText()).trim()
  }

  async screenshot(): Promise<Buffer> {
    return this.page.screenshot()
  }

  async close(): Promise<void> {
    await this.bundle.context.close().catch(() => undefined)
    await this.bundle.browser.close().catch(() => undefined)
  }

  private get page(): Page {
    return this.bundle.page
  }

  private toLocator(locator: CaseLocator): Locator {
    if (locator.text !== undefined) {
      return this.page.getByText(locator.text, { exact: true })
    }
    if (locator.css !== undefined) {
      return this.page.locator(locator.css)
    }
    throw new Error(`无效的 locator:${JSON.stringify(locator)}`)
  }
}
