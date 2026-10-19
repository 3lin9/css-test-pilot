import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { CaseLocator } from '@testpilot/dsl'
import { TestPilotError } from '@testpilot/core'
import { AdapterResolver, ArtifactManager, ExecutionContext, TestRunner, executeStep } from '@testpilot/execution-engine'
import type { TestStep } from '@testpilot/dsl'
import type { CapturedRequest, TestAdapter } from '@testpilot/adapter-core'

/** 进程内 mock adapter:验证引擎编排,不启动真实浏览器 */
class MockAdapter implements TestAdapter {
  readonly target = 'web' as const
  launched = 0
  readonly navigated: string[] = []
  readonly filled: Array<{ locator: string; value: string }> = []
  readonly clicked: string[] = []
  readonly evidenceStarted: string[] = []
  readonly evidenceStopped: string[] = []
  capturedRequests: CapturedRequest[] = []

  async launch(): Promise<void> {
    this.launched++
  }

  async navigate(url: string): Promise<void> {
    this.navigated.push(url)
  }

  async click(locator: CaseLocator): Promise<void> {
    if (locator.css === '.missing') throw new Error('element not found')
    this.clicked.push(locator.css ?? locator.text ?? '')
    if (locator.css === '.request-once') {
      this.capturedRequests.push({
        method: 'POST',
        url: 'https://example.test/api/orders?token=secret',
      })
    }
  }

  async input(locator: CaseLocator, value: string): Promise<void> {
    this.filled.push({ locator: locator.css ?? locator.text ?? '', value })
  }

  async select(): Promise<void> {}

  async wait(): Promise<void> {}

  async assert(locator: CaseLocator, expected: string): Promise<void> {
    const actual = locator.css === '.order-id' ? '订单号 12345 已创建' : ''
    if (!actual.includes(expected)) {
      throw new Error(`断言失败:期望 ${expected},实际 ${actual}`)
    }
  }

  async extract(locator: CaseLocator): Promise<string> {
    return locator.css === '.order-id' ? '12345' : 'unknown'
  }

  async screenshot(): Promise<Buffer> {
    return Buffer.from('fake-png')
  }

  async startEvidence(caseId: string): Promise<void> {
    this.evidenceStarted.push(caseId)
  }

  async stopEvidence(caseId: string): Promise<{ video: Buffer; trace: Buffer }> {
    this.evidenceStopped.push(caseId)
    return { video: Buffer.from('fake-video'), trace: Buffer.from('fake-trace') }
  }

  async startRequestCapture(): Promise<void> {
    this.capturedRequests = []
  }

  async stopRequestCapture(): Promise<CapturedRequest[]> {
    return this.capturedRequests
  }

  async close(): Promise<void> {}
}


describe('TestRunner(引擎编排)', () => {
  test('变量链路 / 失败跳过 / 未注册 adapter / 产物落盘', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-engine-'))
    const adapter = new MockAdapter()
    const resolver = new AdapterResolver()
    resolver.register({ target: 'web', create: async () => adapter })

    const runner = new TestRunner({ resolver, runsRoot: join(root, 'runs') })
    const summary = await runner.run([
      {
        file: 'ok.case.yaml',
        data: {
          id: 'extract-assert',
          name: '变量链路',
          steps: [
            { target: 'web', action: 'navigate', url: 'https://example.com/orders' },
            { target: 'web', action: 'extract', locator: { css: '.order-id' }, variable: 'orderId' },
            { target: 'web', action: 'click', locator: { css: '.order-row-${orderId}' } },
            { target: 'web', action: 'input', locator: { css: '#search' }, value: '${orderId}' },
            { target: 'web', action: 'assert', locator: { css: '.order-id' }, expected: '${orderId}' },
          ],
        },
      },
      {
        file: 'bad.case.yaml',
        data: {
          id: 'failing',
          name: '失败用例',
          steps: [
            { target: 'web', action: 'click', locator: { css: '.missing' } },
            { target: 'web', action: 'click', locator: { text: '不应执行' } },
          ],
        },
      },
      {
        file: 'mini.case.yaml',
        data: {
          id: 'no-miniapp',
          name: '未注册 adapter',
          steps: [{ target: 'miniapp', action: 'launch' }],
        },
      },
    ])

    expect(summary.status).toBe('failed')
    expect(summary.totals.passed).toBe(1)
    // 未注册 adapter 归 blocked(infra 桶),只有真实产品失败计入 failed
    expect(summary.totals.failed).toBe(1)

    // 用例 1:extract -> input/assert 均拿到解析后的变量
    const ok = summary.cases.find((item) => item.caseId === 'extract-assert')
    expect(ok?.status).toBe('passed')
    expect(adapter.navigated).toEqual(['https://example.com/orders'])
    expect(adapter.filled).toEqual([{ locator: '#search', value: '12345' }])
    // locator 同样支持变量解析
    expect(adapter.clicked).toContain('.order-row-12345')
    expect(ok?.steps[1]?.extracted).toEqual({ orderId: '12345' })

    // 用例 2:失败后剩余步骤 skipped,失败截图已取证
    const bad = summary.cases.find((item) => item.caseId === 'failing')
    expect(bad?.steps[0]?.status).toBe('failed')
    expect(bad?.steps[0]?.error).toContain('element not found')
    expect(bad?.steps[0]?.screenshot).toBeDefined()
    expect(bad?.steps[1]?.status).toBe('skipped')

    // 用例级取证:video/trace 落盘并写入 CaseResult
    expect(ok?.video).toContain('videos/')
    expect(ok?.trace).toContain('traces/')
    const videoBytes = await readFile(join(root, 'runs', summary.runId, ok!.video!))
    expect(videoBytes.toString()).toBe('fake-video')
    expect(adapter.evidenceStarted).toEqual(['extract-assert-default', 'failing-default'])
    expect(adapter.evidenceStopped).toEqual(['extract-assert-default', 'failing-default'])

    // 用例 3:未注册 miniapp adapter -> 步骤失败并给出原因
    const mini = summary.cases.find((item) => item.caseId === 'no-miniapp')
    expect(mini?.status).toBe('blocked')
    expect(mini?.errorCode).toBe('ADAPTER_NOT_FOUND')
    expect(mini?.steps[0]?.error).toContain('adapter')

    // result.json 与 events.ndjson 落盘
    const runDir = join(root, 'runs', summary.runId)
    const written = JSON.parse(await readFile(join(runDir, 'result.json'), 'utf8'))
    expect(written.runId).toBe(summary.runId)
    const events = await readFile(join(runDir, 'events.ndjson'), 'utf8')
    expect(events.split('\n').filter(Boolean).length).toBeGreaterThan(10)
    expect(adapter.launched).toBe(1)
  })

  test('逐行依赖预检与 setup/steps/teardown 生命周期', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-engine-lifecycle-'))
    const adapter = new MockAdapter()
    const resolver = new AdapterResolver()
    resolver.register({ target: 'web', create: async () => adapter })
    const runner = new TestRunner({ resolver, runsRoot: join(root, 'runs') })

    const summary = await runner.run([
      {
        file: 'rows.case.yaml',
        templateId: 'row-case',
        rowId: 'ready',
        rowIndex: 0,
        initialVariables: { 'dataset.button': '.ready' },
        missingDependencies: [],
        data: {
          id: 'row-case',
          name: '逐行用例',
          setup: [{ target: 'web', action: 'click', locator: { css: '.setup' } }],
          steps: [
            {
              target: 'web',
              action: 'click',
              locator: { css: '${dataset.button}' },
            },
          ],
          teardown: [{ target: 'web', action: 'click', locator: { css: '.missing' } }],
        },
      },
      {
        file: 'rows.case.yaml',
        templateId: 'row-case',
        rowId: 'missing-data',
        rowIndex: 1,
        initialVariables: {},
        missingDependencies: ['dataset.button'],
        data: {
          id: 'row-case',
          name: '逐行用例',
          steps: [{ target: 'web', action: 'click', locator: { css: '.never' } }],
        },
      },
    ])

    expect(summary.status).toBe('passed')
    expect(summary.totals).toMatchObject({
      templates: 1,
      cases: 2,
      passed: 1,
      failed: 0,
      skipped: 1,
      warnings: 1,
      stepsWarning: 1,
    })
    const ready = summary.cases[0]
    expect(ready).toMatchObject({ rowId: 'ready', rowIndex: 0, status: 'passed' })
    expect(ready?.steps.map((step) => [step.phase, step.status])).toEqual([
      ['setup', 'passed'],
      ['steps', 'passed'],
      ['teardown', 'warning'],
    ])
    expect(ready?.warnings?.[0]).toContain('element not found')
    expect(adapter.clicked).toEqual(['.setup', '.ready'])

    const skipped = summary.cases[1]
    expect(skipped).toMatchObject({
      rowId: 'missing-data',
      status: 'skipped',
      skipReason: 'dependency-not-ready',
      missingDependencies: ['dataset.button'],
      steps: [],
    })
  })

  test('UI 动作按 method + urlContains 精确断言请求次数并脱敏证据', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-engine-request-'))
    const adapter = new MockAdapter()
    const resolver = new AdapterResolver()
    resolver.register({ target: 'web', create: async () => adapter })
    const runner = new TestRunner({ resolver, runsRoot: join(root, 'runs') })

    const summary = await runner.run([
      {
        file: 'request.case.yaml',
        data: {
          id: 'request-count',
          name: '请求次数',
          steps: [
            {
              target: 'web',
              action: 'click',
              locator: { css: '.request-once' },
              expectRequests: [
                {
                  method: 'POST',
                  urlContains: '/api/orders',
                  count: 1,
                  windowMs: 0,
                },
              ],
            },
          ],
        },
      },
    ])

    expect(summary.status).toBe('passed')
    expect(summary.cases[0]?.steps[0]?.requestAssertions).toEqual([
      expect.objectContaining({
        actualCount: 1,
        count: 1,
        requests: [
          {
            method: 'POST',
            url: 'https://example.test/api/orders?<redacted>',
          },
        ],
      }),
    ])
  })
})

describe('ExecutionContext.resolve 未定义变量', () => {
  test('已定义变量正常替换(Review Focus 3)', () => {
    const context = new ExecutionContext()
    context.seed({ orderId: '42' })
    expect(context.resolve('order-${orderId}')).toBe('order-42')
  })
  test('普通变量未定义 → PREREQ_VARIABLE_MISSING', () => {
    const context = new ExecutionContext()
    try {
      context.resolve('${missingVar}')
      expect.unreachable()
    } catch (err) {
      expect((err as TestPilotError).code).toBe('PREREQ_VARIABLE_MISSING')
    }
  })
  test('凭据 JSON 缺字段 → ACCOUNT_UNAVAILABLE(Review Focus 2)', () => {
    const context = new ExecutionContext()
    context.seedAccount('{"username":"a"}')
    expect(context.resolve('${account.username}')).toBe('a')
    try {
      context.resolve('${account.password}')
      expect.unreachable()
    } catch (err) {
      expect((err as TestPilotError).code).toBe('ACCOUNT_UNAVAILABLE')
    }
  })
})

describe('executeStep 错误码化', () => {
  class ApiMockAdapter extends MockAdapter {
    async request(): Promise<{ status: number; statusText: string; bodyText?: string }> {
      return { status: 500, statusText: 'Internal Server Error', bodyText: 'boom' }
    }
  }

  async function runStep(step: TestStep, adapter: MockAdapter) {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-step-'))
    const artifacts = new ArtifactManager(join(root, 'run'))
    await artifacts.prepare()
    return executeStep(step, 0, adapter, new ExecutionContext(), artifacts, { screenshotName: 's0' })
  }

  test('普通 Error → errorCode 为 undefined,error 保留消息', async () => {
    const result = await runStep({ target: 'web', action: 'click', locator: { css: '.missing' } }, new MockAdapter())
    expect(result.status).toBe('failed')
    expect(result.error).toContain('element not found')
    expect(result.errorCode).toBeUndefined()
  })

  test('请求次数不匹配 → REQUEST_COUNT_MISMATCH', async () => {
    const result = await runStep(
      {
        target: 'web',
        action: 'click',
        locator: { css: '.request-once' },
        expectRequests: [{ method: 'POST', urlContains: '/api/orders', count: 2, windowMs: 0 }],
      },
      new MockAdapter(),
    )
    expect(result.status).toBe('failed')
    expect(result.error).toContain('请求次数不匹配')
    expect(result.errorCode).toBe('REQUEST_COUNT_MISMATCH')
  })

  test('request 步骤状态码不匹配 → STATUS_MISMATCH', async () => {
    const result = await runStep(
      { target: 'api', action: 'request', url: 'https://api.test/orders', expected: '200' },
      new ApiMockAdapter(),
    )
    expect(result.status).toBe('failed')
    expect(result.error).toContain('HTTP 状态码 500')
    expect(result.errorCode).toBe('STATUS_MISMATCH')
  })

  test('引用未定义变量 → PREREQ_VARIABLE_MISSING', async () => {
    const result = await runStep({ target: 'web', action: 'click', locator: { css: '${missingVar}' } }, new MockAdapter())
    expect(result.status).toBe('failed')
    expect(result.error).toContain('missingVar')
    expect(result.errorCode).toBe('PREREQ_VARIABLE_MISSING')
  })
})

describe('runCase 三态汇总', () => {
  class CodedAssertAdapter extends MockAdapter {
    async assert(): Promise<void> {
      throw new TestPilotError('ASSERTION_FAILED', '断言失败:期望 x,实际 y')
    }
  }

  async function runWith(data: Record<string, unknown>, adapter: MockAdapter) {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-verdict-'))
    const resolver = new AdapterResolver()
    resolver.register({ target: 'web', create: async () => adapter })
    const runner = new TestRunner({ resolver, runsRoot: join(root, 'runs') })
    const summary = await runner.run([{ file: 'case.yaml', data: data as never }])
    return summary
  }

  test('未注册 adapter → case blocked + errorCode', async () => {
    const summary = await runWith(
      { id: 'no-adapter', name: '未注册', steps: [{ target: 'miniapp', action: 'launch' }] },
      new MockAdapter(),
    )
    const item = summary.cases[0]
    expect(item?.status).toBe('blocked')
    expect(item?.errorCode).toBe('ADAPTER_NOT_FOUND')
  })

  test('步骤 PREREQ_VARIABLE_MISSING → case inconclusive', async () => {
    const summary = await runWith(
      {
        id: 'prereq',
        name: '前置缺失',
        steps: [{ target: 'web', action: 'click', locator: { css: '${missingVar}' } }],
      },
      new MockAdapter(),
    )
    const item = summary.cases[0]
    expect(item?.status).toBe('inconclusive')
    expect(item?.errorCode).toBe('PREREQ_VARIABLE_MISSING')
  })

  test('步骤 ASSERTION_FAILED → case failed(产品问题优先暴露)', async () => {
    const summary = await runWith(
      {
        id: 'assert-fail',
        name: '断言失败',
        steps: [{ target: 'web', action: 'assert', locator: { css: '.order-id' }, expected: 'x' }],
      },
      new CodedAssertAdapter(),
    )
    const item = summary.cases[0]
    expect(item?.status).toBe('failed')
    expect(item?.errorCode).toBe('ASSERTION_FAILED')
  })

  test('run 状态优先级 failed > inconclusive > blocked > passed,totals 三桶计数', async () => {
    const blockedData = {
      id: 'blk',
      name: '环境阻塞',
      steps: [{ target: 'miniapp', action: 'launch' }],
    }
    const inconclusiveData = {
      id: 'inc',
      name: '前置缺失',
      steps: [{ target: 'web', action: 'click', locator: { css: '${missingVar}' } }],
    }
    const failedData = {
      id: 'fail',
      name: '断言失败',
      steps: [{ target: 'web', action: 'assert', locator: { css: '.order-id' }, expected: 'x' }],
    }

    // 1) 单 blocked → run blocked,totals.blocked === 1
    const onlyBlocked = await runWith(blockedData, new MockAdapter())
    expect(onlyBlocked.status).toBe('blocked')
    expect(onlyBlocked.totals.blocked).toBe(1)

    // 2) 单 inconclusive → run inconclusive
    const onlyInconclusive = await runWith(inconclusiveData, new MockAdapter())
    expect(onlyInconclusive.status).toBe('inconclusive')
    expect(onlyInconclusive.totals.inconclusive).toBe(1)

    // 3) failed + blocked → failed(产品失败优先暴露)
    const failedAndBlocked = await runWith(failedData, new CodedAssertAdapter())
    // 单 case 版:failed 优先于 blocked 的混合见下一条;这里先钉单 failed
    expect(failedAndBlocked.status).toBe('failed')

    const mixed = await (async () => {
      const root = await mkdtemp(join(tmpdir(), 'testpilot-mixed-'))
      const resolver = new AdapterResolver()
      resolver.register({ target: 'web', create: async () => new CodedAssertAdapter() })
      const runner = new TestRunner({ resolver, runsRoot: join(root, 'runs') })
      return runner.run([
        { file: 'fail.yaml', data: failedData as never },
        { file: 'blk.yaml', data: blockedData as never },
        { file: 'inc.yaml', data: inconclusiveData as never },
      ])
    })()
    expect(mixed.status).toBe('failed')
    expect(mixed.totals).toMatchObject({ failed: 1, blocked: 1, inconclusive: 1 })

    // 4) blocked + inconclusive(无 failed)→ inconclusive
    const blockedAndInconclusive = await (async () => {
      const root = await mkdtemp(join(tmpdir(), 'testpilot-mixed2-'))
      const resolver = new AdapterResolver()
      resolver.register({ target: 'web', create: async () => new MockAdapter() })
      const runner = new TestRunner({ resolver, runsRoot: join(root, 'runs') })
      return runner.run([
        { file: 'blk.yaml', data: blockedData as never },
        { file: 'inc.yaml', data: inconclusiveData as never },
      ])
    })()
    expect(blockedAndInconclusive.status).toBe('inconclusive')

    // 5) 单 passed → passed(现状回归)
    const onlyPassed = await runWith(
      { id: 'ok', name: '通过', steps: [{ target: 'web', action: 'navigate', url: 'https://example.com' }] },
      new MockAdapter(),
    )
    expect(onlyPassed.status).toBe('passed')
    // totals.blocked/inconclusive 按契约只在有值时输出
    expect(onlyPassed.totals).not.toHaveProperty('blocked')
    expect(onlyPassed.totals).not.toHaveProperty('inconclusive')
  })

  test('teardown 失败仍为 warning,不影响 case 状态(现状回归)', async () => {
    const summary = await runWith(
      {
        id: 'teardown-warn',
        name: 'teardown 警告',
        steps: [{ target: 'web', action: 'navigate', url: 'https://example.com' }],
        teardown: [{ target: 'web', action: 'click', locator: { css: '.missing' } }],
      },
      new MockAdapter(),
    )
    const item = summary.cases[0]
    expect(item?.status).toBe('passed')
    expect(item?.errorCode).toBeUndefined()
    expect(item?.warnings?.[0]).toContain('element not found')
  })
})
