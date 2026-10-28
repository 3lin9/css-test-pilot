import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { runNativeCases } from '@testpilot/sdk'

// 一次性冒烟:真实 node:test runner 全链路(spawn → ndjson → ingest → result.json → 退出码)
test('真实 node:test 冒烟:归一 blocked 退出码 2', async () => {
  const root = join(tmpdir(), `testpilot-smoke-${Date.now()}`)
  await mkdir(join(root, 'tests/e2e/api'), { recursive: true })
  // 模拟业务脚本:不依赖任何 @testpilot 包,直接按协议写 message 前缀
  await writeFile(
    join(root, 'tests/e2e/api/smoke.test.ts'),
    `// 测试点: TP-900
// 视角: charter:edge-input
import { test } from 'node:test'
import { strict } from 'node:assert'

test('加法正确', () => {
  strict.equal(1 + 1, 2)
})
test('staging 不可达', () => {
  throw new Error('[TESTPILOT:ENVIRONMENT_UNAVAILABLE] staging 不可达')
})
`,
  )

  const result = await runNativeCases({ root, ingest: true })
  console.log('smoke:', JSON.stringify({
    status: result.status,
    exitCode: result.exitCode,
    runId: result.runId,
    totals: result.summary?.totals,
  }))
  expect(result.status).toBe('blocked')
  expect(result.exitCode).toBe(2)

  const persisted = JSON.parse(await readFile(join(result.runDir!, 'result.json'), 'utf8'))
  expect(persisted.status).toBe('blocked')
  expect(persisted.totals).toMatchObject({ cases: 2, passed: 1, blocked: 1 })
  expect(persisted.cases[0]).toMatchObject({
    caseId: 'TP-900',
    file: 'tests/e2e/api/smoke.test.ts'.replace(/\//g, '\\'),
  })

  // 报告体系零改动复用:writeReports 吃归一 summary
  const { writeReports } = await import('@testpilot/reporter')
  const written = await writeReports(result.runDir!, persisted)
  const html = await readFile(written.html, 'utf8')
  expect(html).toContain('环境与前置(非产品回归)')
}, 60000)
