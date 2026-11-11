// csspilot 单 run 报告样稿生成器:走真实 CLI 渲染链路,产出 docs/samples/report.html(演示数据)。
// 截图资产(assets/*.png)由真实浏览器渲染后随仓库提交,本脚本只做复制,零运行时依赖。
// 用法:先 pnpm build(apps/cli 需要 dist),再 node docs/samples/generate-report-sample.mjs
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const here = join(fileURLToPath(import.meta.url), '..')
const cliBin = join(here, '..', '..', 'apps', 'cli', 'dist', 'bin.js')
const runId = '20261110-001'

const run = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120_000, ...opts }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || String(err))) : resolve(stdout),
    )
  })

async function main() {
  // ---------- 演示项目:临时目录里搭一次真实的 run 产物结构 ----------
  const root = join(tmpdir(), `csspilot-sample-${process.pid}`)
  const runDir = join(root, '.testpilot', 'artifacts', 'runs', runId)
  const tracesDir = join(runDir, 'traces')
  const shotsDir = join(root, '.testpilot', 'artifacts', 'shots', runId)
  mkdirSync(tracesDir, { recursive: true })
  mkdirSync(shotsDir, { recursive: true })

  // 真实浏览器截图:失败现场显示“欢迎回来,访客”(与断言的 Received 一致),通过用例显示购物车
  copyFileSync(join(here, 'assets', 'login-visitor.png'), join(shotsDir, 'login--登录成功.png'))
  copyFileSync(join(here, 'assets', 'cart.png'), join(shotsDir, 'cart--加购下单.png'))
  writeFileSync(join(tracesDir, 'login.spec--登录成功.zip'), 'PK placeholder')

  const summary = {
    runId,
    startedAt: '2026-11-10T03:00:00.000Z',
    finishedAt: '2026-11-10T03:01:12.000Z',
    durationMs: 72_000,
    status: 'failed',
    cases: [
      {
        caseId: 'TP-001',
        caseName: '登录成功页展示',
        file: 'tests/e2e/web/login.spec.ts',
        rowId: '登录成功',
        rowIndex: 0,
        status: 'failed',
        error:
          'Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: "欢迎回来,梅玲玲"\nReceived: "欢迎回来,访客"\n\nCall log:\n  - expect.toHaveText with timeout 5000ms',
        trace: 'traces/login.spec--登录成功.zip',
        steps: [
          { index: 1, target: 'web', action: 'test', status: 'failed', durationMs: 8_400, screenshot: `shots/${runId}/login--登录成功.png`, error: 'Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: "欢迎回来,梅玲玲"\nReceived: "欢迎回来,访客"' },
        ],
        startedAt: '2026-11-10T03:00:00.000Z',
        finishedAt: '2026-11-10T03:00:08.000Z',
        durationMs: 8_400,
        consoleLog: [
          { level: 'error', text: 'GET /api/user/me 401 (session expired)' },
          { level: 'warning', text: '[Deprecation] window.localStorage 处于 deprecated 分支' },
        ],
        networkLog: [
          { method: 'GET', url: 'https://staging.example.com/api/user/me', status: 401, durationMs: 82 },
          { method: 'POST', url: 'https://staging.example.com/api/login', status: 200, durationMs: 310 },
        ],
      },
      {
        caseId: 'TP-002',
        caseName: '加购下单',
        file: 'tests/e2e/web/cart.spec.ts',
        rowId: '加购下单',
        rowIndex: 0,
        status: 'passed',
        steps: [
          { index: 1, target: 'web', action: 'test', status: 'passed', durationMs: 21_000, screenshot: `shots/${runId}/cart--加购下单.png` },
        ],
        startedAt: '2026-11-10T03:00:08.000Z',
        finishedAt: '2026-11-10T03:00:29.000Z',
        durationMs: 21_000,
      },
      {
        caseId: 'TP-003',
        caseName: '会员价展示',
        file: 'tests/e2e/miniapp/member.test.ts',
        rowId: '会员价展示',
        rowIndex: 0,
        status: 'blocked',
        error: '[TESTPILOT:ENVIRONMENT_UNAVAILABLE] 微信开发者工具未登录,staging 环境不可达',
        steps: [
          { index: 1, target: 'miniapp', action: 'test', status: 'failed', durationMs: 1_200, error: '[TESTPILOT:ENVIRONMENT_UNAVAILABLE] 微信开发者工具未登录,staging 环境不可达' },
        ],
        startedAt: '2026-11-10T03:00:29.000Z',
        finishedAt: '2026-11-10T03:00:30.000Z',
        durationMs: 1_200,
      },
    ],
    totals: {
      cases: 3,
      passed: 1,
      failed: 1,
      blocked: 1,
      steps: 3,
      stepsPassed: 1,
      stepsFailed: 2,
      stepsSkipped: 0,
    },
  }
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(summary), 'utf8')

  // ---------- 用构建好的 CLI 走真实渲染链路 ----------
  const stdout = await run(process.execPath, [cliBin, 'report', '--run', runId], { cwd: root })
  const generated = join(runDir, 'report.html')
  const out = join(here, 'report.html')
  copyFileSync(generated, out)
  rmSync(root, { recursive: true, force: true })
  console.log(stdout.trim())
  console.log('generated:', out)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
