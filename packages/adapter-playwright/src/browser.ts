import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { DEFAULT_STEP_TIMEOUT_MS } from '@testpilot/core'

export interface PlaywrightAdapterOptions {
  /** 相对 url 的基准,navigate 时解析 */
  baseUrl?: string
  /** 默认 true;环境变量 TESTPILOT_HEADLESS=false 可覆盖为有头模式 */
  headless?: boolean
  /** 单步操作超时毫秒;环境变量 TESTPILOT_STEP_TIMEOUT 可覆盖 */
  timeout?: number
}

export interface BrowserBundle {
  browser: Browser
  context: BrowserContext
  page: Page
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

export async function launchBrowser(options: PlaywrightAdapterOptions = {}): Promise<BrowserBundle> {
  const browser = await chromium.launch({ headless: resolveHeadless(options) })
  const context = await browser.newContext()
  context.setDefaultTimeout(stepTimeout(options))
  const page = await context.newPage()
  return { browser, context, page }
}
