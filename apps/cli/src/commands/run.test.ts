import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { exitCodeForRunStatus } from '@testpilot/core'
import { preflightNativeRun } from './run'

// 计划契约:failed|inconclusive → 1(黄/红),blocked → 2(环境问题不污染产品缺陷统计),其余 → 0
test('exitCodeForRunStatus:passed/skipped → 0', () => {
  expect(exitCodeForRunStatus('passed')).toBe(0)
  expect(exitCodeForRunStatus('skipped')).toBe(0)
})

test('exitCodeForRunStatus:failed/inconclusive → 1', () => {
  expect(exitCodeForRunStatus('failed')).toBe(1)
  expect(exitCodeForRunStatus('inconclusive')).toBe(1)
})

test('exitCodeForRunStatus:blocked → 2', () => {
  expect(exitCodeForRunStatus('blocked')).toBe(2)
})

test('preflight:头注释或清单不过时不放行', async () => {
  const root = join(tmpdir(), `testpilot-preflight-${Date.now()}`)
  await mkdir(join(root, 'tests/e2e/reviews'), { recursive: true })
  await mkdir(join(root, 'tests/e2e/web'), { recursive: true })
  await writeFile(join(root, 'tests/e2e/reviews/order.md'), 'TP-001\n')
  await writeFile(join(root, 'tests/e2e/web/order.spec.ts'), 'test("order", () => {})\n')

  const blocked = await preflightNativeRun(['tests/e2e/web/order.spec.ts'], { root })
  expect(blocked.issueCount).toBeGreaterThan(0)
  expect(blocked.files[0]?.issues.some((issue) => issue.includes('测试点'))).toBe(true)
})

test('preflight:三道卡通过时 issue 为 0', async () => {
  const root = join(tmpdir(), `testpilot-preflight-ok-${Date.now()}`)
  await mkdir(join(root, 'tests/e2e/reviews'), { recursive: true })
  await mkdir(join(root, 'tests/e2e/api'), { recursive: true })
  await writeFile(join(root, 'tests/e2e/reviews/health.md'), 'TP-001\n')
  await writeFile(join(root, '.env.testing'), 'API_BASE_URL=http://127.0.0.1:8080/api\n')
  await writeFile(
    join(root, 'tests/e2e/api/health.test.ts'),
    '// 测试点: TP-001\n// 视角: charter:error-path\nconst base = process.env.API_BASE_URL\n',
  )

  const ready = await preflightNativeRun(['tests/e2e/api/health.test.ts'], { root })
  expect(ready.issueCount).toBe(0)
})

test('preflight:没有可执行脚本时不报 lint', async () => {
  const root = join(tmpdir(), `testpilot-preflight-empty-${Date.now()}`)
  await mkdir(root, { recursive: true })
  const empty = await preflightNativeRun([], { root })
  expect(empty).toEqual({ files: [], issueCount: 0 })
})
