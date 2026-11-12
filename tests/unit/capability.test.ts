import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { basename } from 'node:path'
import { expect, test } from 'vitest'
import { buildJunitXml } from '@testpilot/reporter'
import { collectHistory } from '@testpilot/reporter'
import { runNativeCases, type NativeCommand } from '@testpilot/sdk'
import type { RunSummary } from '@testpilot/core'

async function makeProject(): Promise<string> {
  const root = join(tmpdir(), `testpilot-cap-${Date.now()}`)
  await mkdir(join(root, 'tests/e2e/web'), { recursive: true })
  await mkdir(join(root, 'tests/e2e/api'), { recursive: true })
  await writeFile(join(root, 'tests/e2e/web/order.spec.ts'), '// 测试点: TP-001\n// 视角: charter:persona\n')
  await writeFile(join(root, 'tests/e2e/api/a.test.ts'), '// 测试点: TP-002\n// 视角: charter:edge-input\n')
  await writeFile(join(root, 'tests/e2e/api/b.test.ts'), '// 测试点: TP-003\n// 视角: charter:error-path\n')
  return root
}

test('grep 按端注入:web 走 --grep,api 走 --test-name-pattern 且落在文件名之前', async () => {
  const root = await makeProject()
  const seen: NativeCommand[] = []
  await runNativeCases({
    root,
    grep: '登录',
    spawnImpl: async (command) => {
      seen.push(command)
      return { code: 0, stdout: '' }
    },
  })
  const web = seen.find((item) => item.target === 'web')
  expect(web?.args).toEqual([
    '<playwright-cli>',
    'test',
    expect.stringContaining('order.spec.ts'),
    '--retries=1',
    '--grep',
    '登录',
  ])
  const api = seen.find((item) => item.target === 'api')
  // .ts 文件带 --experimental-strip-types;--test-name-pattern 插在文件名之前
  expect(api?.args).toEqual([
    '--test',
    '--experimental-strip-types',
    '--test-name-pattern',
    '登录',
    expect.stringContaining('a.test.ts'),
  ])
})

test('重试次数注入 web 命令(默认 1);extraEnv 原样进入 spawn 输出', async () => {
  const root = await makeProject()
  const envs: Array<Record<string, string> | undefined> = []
  const seen: NativeCommand[] = []
  await runNativeCases({
    root,
    extraEnv: { TESTPILOT_ACCOUNT_TEST_USER: '{"username":"u"}' },
    spawnImpl: async (command, _cwd, output) => {
      seen.push(command)
      envs.push(output?.env)
      return { code: 0, stdout: '' }
    },
  })
  const web = seen.find((item) => item.target === 'web')
  expect(web?.args).toContain('--retries=1')
  for (const env of envs) {
    expect(env?.TESTPILOT_ACCOUNT_TEST_USER).toBe('{"username":"u"}')
  }
})

test('api 脚本并发执行;TAP 回收按脚本文件顺序(完成序不乱报告)', async () => {
  const root = await makeProject()
  let active = 0
  let peak = 0
  const result = await runNativeCases({
    root,
    ingest: true,
    spawnImpl: async (command, _cwd, output) => {
      active++
      peak = Math.max(peak, active)
      // b 比 a 快完成:完成序与文件序相反
      await new Promise((resolve) => setTimeout(resolve, command.files[0]?.endsWith('a.test.ts') ? 40 : 10))
      const text = `TAP version 13\n# Subtest: ${basename(command.files[0] ?? '')}\nok 1 - ${basename(command.files[0] ?? '')}\n  ---\n  duration_ms: 1\n  type: 'test'\n  ...\n`
      if (output?.stdoutPath) await writeFile(output.stdoutPath, text)
      active--
      return { code: 0, stdout: text }
    },
  })
  expect(peak).toBeGreaterThanOrEqual(2) // 并发池生效
  const fileOrder = result.summary?.cases
    .map((item) => item.file.replace(/\\/g, '/'))
    .filter((file) => file.includes('tests/e2e/api'))
  expect(fileOrder?.[0]?.includes('a.test.ts')).toBe(true)
  expect(fileOrder?.[1]?.includes('b.test.ts')).toBe(true)
})

function summaryFixture(): RunSummary {
  const base = {
    startedAt: '2026-11-12T00:00:00.000Z',
    finishedAt: '2026-11-12T00:01:00.000Z',
    durationMs: 60000,
    steps: [],
    startedAt2: undefined,
  }
  const item = (patch: Record<string, unknown>) => ({
    caseId: 'TP-001',
    caseName: '下单',
    file: 'tests/e2e/web/order.spec.ts',
    status: 'passed',
    steps: [],
    startedAt: base.startedAt,
    finishedAt: base.finishedAt,
    durationMs: 1000,
    ...patch,
  })
  return {
    runId: '20261112-001',
    startedAt: base.startedAt,
    finishedAt: base.finishedAt,
    durationMs: base.durationMs,
    status: 'failed',
    cases: [
      item({}),
      item({ caseId: 'TP-002', status: 'failed', error: '期望 "100" 实际 "99" & <差异>', errorCode: 'ASSERTION_FAILED' }),
      item({ caseId: 'TP-003', status: 'blocked', error: 'staging 不可达' }),
      item({ caseId: 'TP-004', status: 'inconclusive', error: '前置变量缺失' }),
      item({ caseId: 'TP-005', status: 'skipped', skipReason: 'dependency-not-ready' }),
    ],
    totals: { cases: 5, templates: 5, passed: 1, failed: 1, blocked: 1, inconclusive: 1, skipped: 1 },
  } as unknown as RunSummary
}

test('JUnit XML:failed/inconclusive→failure,blocked/skipped→skipped,特殊字符转义', () => {
  const xml = buildJunitXml(summaryFixture())
  expect(xml).toContain('<testsuites name="csspilot 20261112-001" tests="5" failures="2" skipped="2"')
  // failed 与 inconclusive 都是 failure;inconclusive 的 type 标记区分
  expect(xml).toContain('type="ASSERTION_FAILED"')
  expect(xml).toContain('type="inconclusive"')
  // blocked 归 skipped(非产品回归不标红 CI)
  expect(xml).toContain('<skipped message="环境/前置受阻:staging 不可达"/>')
  // XML 转义:& < > " ' 全覆盖
  expect(xml).toContain('期望 &quot;100&quot; 实际 &quot;99&quot; &amp; &lt;差异&gt;')
  // passed 用例是自闭合 testcase
  expect(xml).toContain('<testcase name="TP-001" classname="tests/e2e/web/order.spec.ts" time="1.000"/>')
})

test('collectHistory 提取失败用例明细(供 flaky 嫌疑标记)', async () => {
  const runsRoot = join(tmpdir(), `testpilot-hist-${Date.now()}`)
  await mkdir(join(runsRoot, '20261112-001'), { recursive: true })
  await writeFile(
    join(runsRoot, '20261112-001', 'result.json'),
    JSON.stringify({
      startedAt: '2026-11-12T00:00:00.000Z',
      status: 'failed',
      durationMs: 1000,
      totals: { passed: 1, failed: 1 },
      cases: [
        { caseId: 'TP-001', status: 'passed' },
        { caseId: 'TP-002', status: 'failed' },
        { caseId: 'TP-003', status: 'inconclusive' },
      ],
    }),
  )
  const history = await collectHistory(runsRoot, '20261112-002')
  expect(history).toHaveLength(1)
  expect(history[0]?.failedCaseIds).toEqual(['TP-002', 'TP-003'])
})
