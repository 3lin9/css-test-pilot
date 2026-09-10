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

test('golden: CLI 驱动 Web 用例(validate -> run -> report 全链路)', async () => {
  test.setTimeout(180_000)
  const project = await mkdtemp(join(tmpdir(), 'testpilot-e2e-'))
  try {
    await mkdir(join(project, 'tests/e2e/cases'), { recursive: true })
    await writeFile(
      join(project, 'testpilot.yaml'),
      'casesDir: tests/e2e/cases\nweb:\n  baseUrl: http://127.0.0.1:8080\n',
    )
    await writeFile(
      join(project, 'tests/e2e/cases/web-demo.yaml'),
      [
        'id: web-demo',
        'name: Web 黄金冒烟',
        'steps:',
        '  - target: web',
        '    action: navigate',
        '    url: /orders',
        '  - target: web',
        '    action: assert',
        '    locator:',
        '      css: "h1"',
        '    expected: "订单后台"',
        '  - target: web',
        '    action: screenshot',
        '',
      ].join('\n'),
    )

    // validate
    const validate = await runCli(['validate'], project)
    expect(validate.code).toBe(0)
    expect(validate.stdout).toContain('web-demo')

    // run(启动真实 Chromium)
    const run = await runCli(['run'], project)
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('PASSED')

    // 用例级取证:result.json 记录 video/trace,文件真实落盘
    const runsRoot = join(project, '.testpilot', 'artifacts', 'runs')
    const runs = await readdir(runsRoot)
    const runDir = join(runsRoot, runs.sort().at(-1)!)
    const result = JSON.parse(await readFile(join(runDir, 'result.json'), 'utf8')) as {
      cases: Array<{ caseId: string; video?: string; trace?: string }>
    }
    expect(result.cases[0]?.video).toContain('videos/')
    expect(result.cases[0]?.trace).toContain('traces/')
    const videoBytes = await readFile(join(runDir, result.cases[0]!.video!))
    expect(videoBytes.byteLength).toBeGreaterThan(0)
    const traceBytes = await readFile(join(runDir, result.cases[0]!.trace!))
    expect(traceBytes.byteLength).toBeGreaterThan(0)

    // report
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
    expect(html).toContain('web-demo')
    expect(html).toContain('passed')
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})
