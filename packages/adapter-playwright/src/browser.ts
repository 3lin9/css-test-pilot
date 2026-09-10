import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { DEFAULT_STEP_TIMEOUT_MS } from '@testpilot/core'

export interface PlaywrightAdapterOptions {
  /** 相对 url 的基准,navigate 时解析 */
  baseUrl?: string
  /** 默认 true,TESTPILOT_HEADLESS=false 可覆盖为有头模式 */
  headless?: boolean
  /** 单步操作超时毫秒;环境变量 TESTPILOT_STEP_TIMEOUT 可覆盖 */
  timeout?: number
}

export interface BrowserBundle {
  browser: Browser
}

export function resolveHeadless(options: PlaywrightAdapterOptions): boolean {
  if (options.headless !== undefined) return options.headless
  return process.env.TESTPILOT_HEADLESS !== 'false'
}

export function stepTimeout(options: PlaywrightAdapterOptions): number {
  const fromEnv = Number(process.env.TESTPILOT_STEP_TIMEOUT)
  if (options.timeout !== undefined) return options.timeout
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_STEP_TIMEOUT_MS
}

/** 浏览器整个运行期共享;context/page 按用例创建以支持录屏与 trace */
export async function launchBrowser(options: PlaywrightAdapterOptions = {}): Promise<BrowserBundle> {
  const browser = await chromium.launch({ headless: resolveHeadless(options) })
  return { browser }
}

export async function openCaseContext(
  bundle: BrowserBundle,
  options: PlaywrightAdapterOptions,
  evidenceTmpDir?: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await bundle.browser.newContext({
    ...(evidenceTmpDir ? { recordVideo: { dir: evidenceTmpDir } } : {}),
  })
  context.setDefaultTimeout(stepTimeout(options))
  if (evidenceTmpDir) {
    await context.tracing.start({ screenshots: true, snapshots: true })
  }
  const page = await context.newPage()
  return { context, page }
}
