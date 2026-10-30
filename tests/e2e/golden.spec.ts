import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const cliBin = join(repoRoot, 'apps/cli/dist/bin.js')

interface CliResult {
  code: number
  stdout: string
}

/** 以临时业务项目为 cwd 运行打包后的 CLI */
function runCli(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cliBin, ...args],
      { cwd, timeout: 150_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        const code = err && typeof err.code === 'number' ? err.code : err ? 1 : 0
        resolve({ code, stdout })
      },
    )
  })
}

test('golden: CLI 驱动原生用例(validate lint -> run -> report 全链路)', async () => {
  test.setTimeout(180_000)
  const project = await mkdtemp(join(tmpdir(), 'testpilot-e2e-'))
  try {
    // 最小原生项目:api 端零依赖(node --test),不要求业务项目安装任何框架
    await mkdir(join(project, 'tests/e2e/api'), { recursive: true })
    await mkdir(join(project, 'tests/e2e/reviews'), { recursive: true })
    await writeFile(join(project, 'testpilot.yaml'), 'version: 1\n\nproject:\n  name: golden-demo\n', 'utf8')
    await writeFile(
      join(project, 'tests/e2e/reviews/order-coverage.md'),
      '# 订单覆盖\n\n- TP-001 首页可达\n',
      'utf8',
    )
    await writeFile(
      join(project, 'tests/e2e/api/smoke.test.ts'),
      [
        '// 测试点: TP-001',
        '// 视角: charter:persona',
        "import { test } from 'node:test'",
        "import assert from 'node:assert/strict'",
        '',
        "test('首页可达占位断言', () => {",
        '  assert.equal(1 + 1, 2)',
        '})',
        '',
      ].join('\n'),
      'utf8',
    )

    // validate:原生 lint(evidence 头注释 / reviews 出处 / env 引用)
    const validate = await runCli(['validate'], project)
    expect(validate.code).toBe(0)
    expect(validate.stdout).toContain('1/1 个原生脚本通过 lint')

    // run:真实 node:test spawn + TAP ingest -> result.json
    const run = await runCli(['run'], project)
    expect(run.code).toBe(0)
    expect(run.stdout).toMatch(/Run \d{8}-\d{3}: PASSED/)
    expect(run.stdout).toContain('✓1')

    const runsRoot = join(project, '.testpilot', 'artifacts', 'runs')
    const runs = await readdir(runsRoot)
    const runDir = join(runsRoot, runs.sort().at(-1)!)
    const result = JSON.parse(await readFile(join(runDir, 'result.json'), 'utf8')) as {
      status: string
      totals: { cases: number; passed: number }
      cases: Array<{ caseId: string; status: string }>
    }
    expect(result.status).toBe('passed')
    expect(result.totals).toMatchObject({ cases: 1, passed: 1 })
    expect(result.cases[0]?.caseId).toBe('TP-001') // 头注释 evidence 链回写
    expect(runs.length).toBeGreaterThan(0)

    // report:吃归一 result.json 生成 HTML
    const report = await runCli(['report'], project)
    expect(report.code).toBe(0)
    const htmlPath = report.stdout
      .split('\n')
      .find((line) => line.includes('report.html'))
      ?.trim()
      .split(/\s+/)
      .pop()
    expect(htmlPath).toBeTruthy()
    const html = await readFile(htmlPath!, 'utf8')
    expect(html).toContain('TP-001')
    expect(html).toContain('passed')
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})
