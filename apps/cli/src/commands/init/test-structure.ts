import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectInfo } from './project-detector'

export interface TestStructureResult {
  web: 'created' | 'reused'
  miniapp: 'created' | 'reused'
  api: 'created' | 'reused'
  data: 'created' | 'reused'
  reviews: 'created' | 'reused'
  fixtures: 'created' | 'reused'
}

/**
 * Web 观测 fixture:用例从这里导入 test/expect,自动采集控制台与网络请求,
 * 经 attachment(testpilot-console / testpilot-network)进报告面板。已存在一律保留。
 */
export async function ensureWebFixture(root: string): Promise<'created' | 'reused'> {
  const file = join(root, 'tests', 'e2e', 'web', 'fixtures.ts')
  if (existsSync(file)) return 'reused'
  await mkdir(join(root, 'tests', 'e2e', 'web'), { recursive: true })
  await writeFile(file, WEB_FIXTURE_TEMPLATE, 'utf8')
  return 'created'
}

const WEB_FIXTURE_TEMPLATE = `import { test as base, expect } from '@playwright/test'

/**
 * csspilot Web 观测 fixture:用例从这里导入 test / expect(代替 '@playwright/test'),
 * 自动采集浏览器控制台与网络请求,以 attachment(testpilot-console / testpilot-network)
 * 交给 npx csspilot run 的 ingest,显示在报告的"控制台 / 网络请求"面板。
 * 失败用例另有 trace.zip(运行器注入 --trace=retain-on-failure),逐帧回放:
 *   npx playwright show-trace <trace 文件>
 * 失败视频(可选):在业务项目 playwright.config 的 use 段加 video: 'retain-on-failure',
 * 失败用例的视频会复制进 run 目录并内嵌到报告的证据盒,浏览器直接播放。默认不开,避免录制开销。
 */
type ConsoleEntry = { level: string; text: string }
type NetworkEntry = { method: string; url: string; status: number; durationMs?: number }

const MAX_CONSOLE = 200
const MAX_NETWORK = 200
const TEXT_LIMIT = 500

let consoleEntries: ConsoleEntry[] = []
let networkEntries: NetworkEntry[] = []

test.beforeEach(async ({ page }) => {
  consoleEntries = []
  networkEntries = []
  page.on('console', (message) => {
    if (consoleEntries.length >= MAX_CONSOLE) return
    consoleEntries.push({ level: message.type(), text: message.text().slice(0, TEXT_LIMIT) })
  })
  page.on('pageerror', (error) => {
    if (consoleEntries.length >= MAX_CONSOLE) return
    consoleEntries.push({ level: 'pageerror', text: String(error).slice(0, TEXT_LIMIT) })
  })
  page.on('requestfinished', (request) => {
    if (networkEntries.length >= MAX_NETWORK) return
    const response = request.response()
    const timing = request.timing()
    networkEntries.push({
      method: request.method(),
      url: request.url().slice(0, TEXT_LIMIT),
      status: response ? response.status() : 0,
      durationMs: timing.responseEnd >= 0 ? Math.round(timing.responseEnd) : undefined,
    })
  })
})

test.afterEach(async (_fixtures, testInfo) => {
  if (consoleEntries.length > 0) {
    await testInfo.attach('testpilot-console', {
      body: JSON.stringify(consoleEntries),
      contentType: 'application/json',
    })
  }
  if (networkEntries.length > 0) {
    await testInfo.attach('testpilot-network', {
      body: JSON.stringify(networkEntries),
      contentType: 'application/json',
    })
  })
})

export const test = base
export { expect }
`

/**
 * 初始化 tests/e2e/{web,miniapp,api,data,reviews} 与 Web 观测 fixture;
 * 已有目录/文件直接复用,不迁移不删除。不建 cases/(YAML 链路已退役);
 * 项目里残留的 cases/*.yaml 不受影响,由用户决定迁移或删除。
 */
export async function initTestStructure(root: string, _info: ProjectInfo): Promise<TestStructureResult> {
  const dirs = {
    web: join(root, 'tests', 'e2e', 'web'),
    miniapp: join(root, 'tests', 'e2e', 'miniapp'),
    api: join(root, 'tests', 'e2e', 'api'),
    data: join(root, 'tests', 'e2e', 'data'),
    reviews: join(root, 'tests', 'e2e', 'reviews'),
  } as const

  const existed: Record<keyof typeof dirs, boolean> = {
    web: existsSync(dirs.web),
    miniapp: existsSync(dirs.miniapp),
    api: existsSync(dirs.api),
    data: existsSync(dirs.data),
    reviews: existsSync(dirs.reviews),
  }

  for (const dir of Object.values(dirs)) {
    await mkdir(dir, { recursive: true })
  }

  const fixtures = await ensureWebFixture(root)

  return {
    web: existed.web ? 'reused' : 'created',
    miniapp: existed.miniapp ? 'reused' : 'created',
    api: existed.api ? 'reused' : 'created',
    data: existed.data ? 'reused' : 'created',
    reviews: existed.reviews ? 'reused' : 'created',
    fixtures,
  }
}
