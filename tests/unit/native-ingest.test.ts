import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { buildNativeRunSummary } from '@testpilot/reporter'
import { runNativeCases, type NativeCommand } from '@testpilot/sdk'

const WEB_SPEC = `// 测试点: TP-001
// 视角: charter:error-path
`

const MINIAPP_TEST = `// 测试点: TP-002
// 视角: charter:persona
`

async function makeProject(): Promise<string> {
  const root = join(tmpdir(), `testpilot-ingest-${Date.now()}`)
  await mkdir(join(root, 'tests/e2e/web'), { recursive: true })
  await mkdir(join(root, 'tests/e2e/miniapp'), { recursive: true })
  await writeFile(join(root, 'tests/e2e/web/order.spec.ts'), WEB_SPEC)
  await writeFile(join(root, 'tests/e2e/miniapp/member.test.ts'), MINIAPP_TEST)
  return root
}

/** playwright.json:1 过 + 1 被三态标记为 blocked */
const PLAYWRIGHT_JSON = (webSpecRel: string) =>
  JSON.stringify({
    suites: [
      {
        title: 'order.spec.ts',
        file: webSpecRel,
        specs: [
          {
            title: '加购下单',
            tests: [
              {
                projectName: 'chrome',
                status: 'expected',
                results: [
                  { status: 'passed', duration: 120, attachments: [{ name: 'trace', path: 'trace.zip' }] },
                ],
              },
            ],
          },
          {
            title: '下单页加载',
            tests: [
              {
                status: 'unexpected',
                results: [
                  {
                    status: 'failed',
                    duration: 3000,
                    error: { message: '[TESTPILOT:ENVIRONMENT_UNAVAILABLE] staging 不可达' },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  })

/** node:test TAP(实测 Node 22 输出形态):1 过 + 1 被标记为 inconclusive */
const TAP_MIXED = `TAP version 13
# Subtest: 首页加载
ok 1 - 首页加载
  ---
  duration_ms: 0.6068
  type: 'test'
  ...
# Subtest: 会员价展示
not ok 2 - 会员价展示
  ---
  duration_ms: 0.1515
  type: 'test'
  failureType: 'testCodeFailure'
  error: '[TESTPILOT:PREREQ_VARIABLE_MISSING] 登录前置失败'
  code: 'ERR_TEST_FAILURE'
  ...
1..2
`

/** node:test TAP:describe 全包(嵌套 4 空格),取最浅层 test 事件 */
const TAP_NESTED = `TAP version 13
# Subtest: 会员套件
    # Subtest: 内部通过
    ok 1 - 内部通过
      ---
      duration_ms: 0.6
      type: 'test'
      ...
    # Subtest: 内部失败
    not ok 2 - 内部失败
      ---
      duration_ms: 0.2
      type: 'test'
      error: '[TESTPILOT:ENVIRONMENT_UNAVAILABLE] 工具未登录'
      code: 'ERR_TEST_FAILURE'
      ...
    1..2
not ok 1 - 会员套件
  ---
  duration_ms: 1.7
  type: 'suite'
  failureType: 'subtestsFailed'
  error: '1 subtest failed'
  code: 'ERR_TEST_FAILURE'
  ...
`

test('ingest 归一:头注释元数据、三态与 totals', async () => {
  const root = await makeProject()
  const webSpecAbs = join(root, 'tests/e2e/web/order.spec.ts')
  const miniAbs = join(root, 'tests/e2e/miniapp/member.test.ts')
  const startedAt = new Date('2026-10-28T02:00:00Z')

  const summary = await buildNativeRunSummary({
    runId: '20261028-001',
    startedAt,
    root,
    files: [webSpecAbs, miniAbs],
    playwrightJsonPath: await writeTemp(root, 'playwright.json', PLAYWRIGHT_JSON('tests/e2e/web/order.spec.ts')),
    nodeTestTaps: [{ path: await writeTemp(root, 'miniapp-0.tap', TAP_MIXED), target: 'miniapp', file: miniAbs }],
  })

  expect(summary.cases).toHaveLength(4)
  expect(summary.status).toBe('inconclusive') // failed(0) < inconclusive(1):三桶优先级
  expect(summary.totals).toMatchObject({ cases: 4, passed: 2, failed: 0, blocked: 1, inconclusive: 1 })

  const blockedCase = summary.cases.find((item) => item.caseId === 'TP-001' && item.rowId === '下单页加载')
  expect(blockedCase).toMatchObject({ status: 'blocked', errorCode: 'ENVIRONMENT_UNAVAILABLE' })
  expect(blockedCase?.file.replace(/\\/g, '/')).toBe('tests/e2e/web/order.spec.ts')

  const passedCase = summary.cases.find((item) => item.rowId === 'chrome:加购下单')
  expect(passedCase).toMatchObject({ caseId: 'TP-001', status: 'passed' })
  expect(passedCase?.trace).toBe('trace.zip')

  const inconclusiveCase = summary.cases.find((item) => item.caseId === 'TP-002' && item.rowId === '会员价展示')
  expect(inconclusiveCase).toMatchObject({ status: 'inconclusive', errorCode: 'PREREQ_VARIABLE_MISSING' })
  expect(inconclusiveCase?.steps[0]).toMatchObject({ target: 'miniapp', action: 'test' })
})

test('ingest 归一:describe 全包取最浅层 test,suite 失败冒泡不重复计', async () => {
  const root = await makeProject()
  const miniAbs = join(root, 'tests/e2e/miniapp/member.test.ts')

  const summary = await buildNativeRunSummary({
    runId: '20261028-002',
    startedAt: new Date(),
    root,
    files: [miniAbs],
    nodeTestTaps: [{ path: await writeTemp(root, 'miniapp-0.tap', TAP_NESTED), target: 'miniapp', file: miniAbs }],
  })

  expect(summary.cases).toHaveLength(2) // 内部通过 + 内部失败;suite 事件不重复计
  expect(summary.totals).toMatchObject({ cases: 2, passed: 1, blocked: 1 })
  expect(summary.status).toBe('blocked')
  expect(summary.cases.every((item) => item.caseId === 'TP-002')).toBe(true)
})

test('runNativeCases ingest:结构化输出落 run 目录,blocked 退出码 2', async () => {
  const root = await makeProject()

  const seen: NativeCommand[] = []
  const result = await runNativeCases({
    root,
    ingest: true,
    spawnImpl: async (command, _cwd, stdoutPath) => {
      seen.push(command)
      if (stdoutPath) {
        await writeFile(
          stdoutPath,
          command.target === 'web' ? PLAYWRIGHT_JSON('tests/e2e/web/order.spec.ts') : TAP_MIXED,
        )
      }
      return 0
    },
  })

  // web 一批;miniapp 逐文件 spawn 且 tap 是默认 reporter(无 reporter 参数)
  expect(seen).toHaveLength(2)
  expect(seen.find((item) => item.target === 'web')?.args).toContain('--reporter=json')
  const miniCommand = seen.find((item) => item.target === 'miniapp')
  expect(miniCommand?.files).toHaveLength(1)
  expect(miniCommand?.args.join(' ')).not.toContain('--test-reporter')

  expect(result.summary?.status).toBe('inconclusive')
  expect(result.exitCode).toBe(1) // failed/inconclusive → 1
  expect(result.runDir).toBeTruthy()

  const persisted = JSON.parse(
    await import('node:fs/promises').then((fs) => fs.readFile(join(result.runDir!, 'result.json'), 'utf8')),
  )
  expect(persisted.status).toBe('inconclusive')
  expect(persisted.cases).toHaveLength(4)
})

test('runNativeCases ingest:纯 blocked run 退出码 2', async () => {
  const root = await makeProject()
  const blockedSpec = JSON.stringify({
    suites: [
      {
        file: 'tests/e2e/web/order.spec.ts',
        specs: [
          {
            title: '下单页加载',
            tests: [
              {
                status: 'unexpected',
                results: [
                  { status: 'failed', duration: 10, error: { message: '[TESTPILOT:ENVIRONMENT_UNAVAILABLE] staging 不可达' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  })
  const blockedTap = `TAP version 13
# Subtest: 会员价展示
not ok 1 - 会员价展示
  ---
  duration_ms: 0.2
  type: 'test'
  error: '[TESTPILOT:ENVIRONMENT_UNAVAILABLE] 开发者工具未登录'
  code: 'ERR_TEST_FAILURE'
  ...
`

  const result = await runNativeCases({
    root,
    ingest: true,
    spawnImpl: async (command, _cwd, stdoutPath) => {
      if (stdoutPath) {
        await writeFile(stdoutPath, command.target === 'web' ? blockedSpec : blockedTap)
      }
      return 0
    },
  })

  expect(result.summary?.status).toBe('blocked')
  expect(result.exitCode).toBe(2)
})

async function writeTemp(root: string, name: string, content: string): Promise<string> {
  const file = join(root, name)
  await writeFile(file, content)
  return file
}
