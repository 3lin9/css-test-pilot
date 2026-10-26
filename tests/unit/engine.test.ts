import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import type { CaseLocator } from '@testpilot/dsl'
import { TestPilotError } from '@testpilot/core'
import { AdapterResolver, ArtifactManager, ExecutionContext, TestRunner, executeStep } from '@testpilot/execution-engine'
import type { TestStep } from '@testpilot/dsl'
import type { CapturedRequest, TestAdapter } from '@testpilot/adapter-core'
import type { RehearsalEvidence, UIObservation } from '@testpilot/observation-core'

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
  test('用户变量撞 account 前缀(${accountId})→ 仍 PREREQ_VARIABLE_MISSING,不误归凭据桶', () => {
    const context = new ExecutionContext()
    try {
      context.resolve('${accountId}')
      expect.unreachable()
    } catch (err) {
      expect((err as TestPilotError).code).toBe('PREREQ_VARIABLE_MISSING')
    }
  })
  test('${account} 整值未定义 → ACCOUNT_UNAVAILABLE(收窄判定后仍命中)', () => {
    const context = new ExecutionContext()
    try {
      context.resolve('${account}')
      expect.unreachable()
    } catch (err) {
      expect((err as TestPilotError).code).toBe('ACCOUNT_UNAVAILABLE')
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

describe('executeStep 彩排验证', () => {
  class ObservingAdapter extends MockAdapter {
    observationIndex = 0
    readonly states: string[]

    constructor(states: string[]) {
      super()
      this.states = states
    }

    async observe(): Promise<UIObservation> {
      const stateHash = this.states[Math.min(this.observationIndex++, this.states.length - 1)]!
      return {
        target: 'web',
        route: '/checkout',
        semanticTree: stateHash,
        interactiveElements: [],
        observedAt: new Date().toISOString(),
        stateHash,
      }
    }

    async probe(candidate: Parameters<NonNullable<TestAdapter['probe']>>[0]) {
      return {
        candidate,
        matchedCount: 1,
        unique: true,
        visible: true,
        enabled: true,
        editable: false,
        covered: false,
        actionable: true,
        stateHash: 'before',
        fingerprint: candidate.fingerprint,
      }
    }

    async waitForStable() {
      return { stable: true, durationMs: 10, samples: 2, stateHash: 'after' }
    }

    async trigger(): Promise<void> {}
  }

  async function rehearseClick(adapter: ObservingAdapter) {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-rehearse-step-'))
    const artifacts = new ArtifactManager(join(root, 'run'))
    await artifacts.prepare()
    const evidence: RehearsalEvidence = { verifiedLocators: [], pageStateHashes: {} }
    const result = await executeStep(
      { target: 'web', action: 'click', locator: { css: '.submit' } },
      0,
      adapter,
      new ExecutionContext(),
      artifacts,
      { screenshotName: 's0', rehearsal: { phase: 'steps', evidence } },
    )
    return { result, evidence }
  }

  test('彩排记录 probe、稳定性和动作前后状态变化', async () => {
    const { result, evidence } = await rehearseClick(new ObservingAdapter(['before', 'after']))
    expect(result.status).toBe('passed')
    expect(evidence.verifiedLocators[0]).toMatchObject({
      phase: 'steps',
      index: 0,
      locator: { css: '.submit' },
      transition: { changed: true, beforeHash: 'before', afterHash: 'after' },
    })
    expect(evidence.pageStateHashes['web:/checkout']).toBe('after')
  })

  test('click 没有 UI/请求变化时彩排失败，不能签发 ready', async () => {
    const { result } = await rehearseClick(new ObservingAdapter(['same', 'same']))
    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('NO_STATE_CHANGE')
  })

  test('trigger 彩排无 UI/请求变化时记 warning，不能静默视为已验证', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-rehearse-trigger-'))
    const artifacts = new ArtifactManager(join(root, 'run'))
    await artifacts.prepare()
    const adapter = new ObservingAdapter(['same', 'same'])
    const evidence: RehearsalEvidence = { verifiedLocators: [], pageStateHashes: {} }

    const result = await executeStep(
      {
        target: 'miniapp',
        action: 'trigger',
        locator: { css: '.consent' },
        eventType: 'agree',
      },
      0,
      adapter,
      new ExecutionContext(),
      artifacts,
      { screenshotName: 'trigger', rehearsal: { phase: 'steps', evidence } },
    )

    expect(result.status).toBe('warning')
    expect(result.error).toContain('trigger 执行后界面状态未变化')
    expect(evidence.verifiedLocators[0]?.transition?.changed).toBe(false)

    const runnerAdapter = new ObservingAdapter(['same', 'same'])
    const resolver = new AdapterResolver()
    resolver.register({ target: 'miniapp', create: async () => runnerAdapter })
    const summary = await new TestRunner({
      resolver,
      runsRoot: join(root, 'runs'),
      rehearsalEvidence: {},
    }).run([
      {
        file: 'trigger.case.yaml',
        data: {
          id: 'trigger-warning',
          name: 'trigger 无可见副作用',
          steps: [
            {
              target: 'miniapp',
              action: 'trigger',
              locator: { css: '.consent' },
              eventType: 'agree',
            },
          ],
        },
      },
    ])
    expect(summary.cases[0]?.warnings?.[0]).toContain('trigger 执行后界面状态未变化')
    expect(summary.totals.stepsWarning).toBe(1)
  })

  test('正式 require-ready 等待证书 locator 可操作后再执行，而非单次即时 probe', async () => {
    vi.useFakeTimers()
    const root = await mkdtemp(join(tmpdir(), 'testpilot-ready-step-'))
    const artifacts = new ArtifactManager(join(root, 'run'))
    await artifacts.prepare()
    const adapter = new ObservingAdapter(['state'])
    const verifiedCandidate = {
      locator: { css: '.fresh-submit' },
      strategy: 'css' as const,
      score: 100,
      description: '提交订单',
      fingerprint: { stableAttributes: {}, ancestorPath: [] },
    }
    const evidence: RehearsalEvidence = {
      pageStateHashes: {},
      verifiedLocators: [
        {
          phase: 'steps',
          index: 0,
          target: 'web',
          locator: { css: '.fresh-submit' },
          probe: {
            candidate: verifiedCandidate,
            matchedCount: 1,
            unique: true,
            visible: true,
            enabled: true,
            editable: false,
            covered: false,
            actionable: true,
            stateHash: 'state',
            fingerprint: verifiedCandidate.fingerprint,
          },
        },
      ],
    }
    let probeAttempts = 0
    adapter.probe = vi.fn(async (candidate) => {
      probeAttempts += 1
      const actionable = probeAttempts >= 2
      return {
        candidate,
        matchedCount: actionable ? 1 : 0,
        unique: actionable,
        visible: actionable,
        enabled: actionable,
        editable: false,
        covered: false,
        actionable,
        stateHash: 'state',
        fingerprint: actionable ? candidate.fingerprint : undefined,
        reason: actionable ? undefined : 'locator 命中 0 个元素',
      }
    })
    try {
      const pending = executeStep(
        { target: 'web', action: 'click', locator: { css: '.stale-submit' } },
        0,
        adapter,
        new ExecutionContext(),
        artifacts,
        { screenshotName: 's0', ready: { phase: 'steps', evidence } },
      )
      await vi.advanceTimersByTimeAsync(200)
      const result = await pending
      expect(result.status).toBe('passed')
      expect(adapter.probe).toHaveBeenCalledTimes(2)
      expect(adapter.clicked).toContain('.fresh-submit')
      expect(adapter.clicked).not.toContain('.stale-submit')
    } finally {
      vi.useRealTimers()
    }
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

  test('blockedError 预阻塞(fixture 缺失)→ case blocked,步骤不执行', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-preblocked-'))
    const resolver = new AdapterResolver()
    resolver.register({ target: 'web', create: async () => new MockAdapter() })
    const runner = new TestRunner({ resolver, runsRoot: join(root, 'runs') })
    const summary = await runner.run([
      {
        file: 'case.yaml',
        data: { id: 'no-fixture', name: '数据缺失', steps: [{ target: 'web', action: 'click', locator: { css: '.x' } }] } as never,
        blockedError: { code: 'FIXTURE_MISSING', message: '数据文件不存在:data/order.yaml' },
      },
    ])
    const item = summary.cases[0]
    expect(item?.status).toBe('blocked')
    expect(item?.errorCode).toBe('FIXTURE_MISSING')
    // 合成的失败步骤携带错误码,reporter 三桶/CLI 计数由此自然生效
    expect(item?.steps[0]?.errorCode).toBe('FIXTURE_MISSING')
    expect(summary.status).toBe('blocked')
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

describe('executeStep 交互扩展(assert count/attribute、callWxApi)', () => {
  class DeepMockAdapter extends MockAdapter {
    count = 3
    attributeValue: unknown = 'true'
    readonly wxCalls: Array<{ api: string; args: unknown[] }> = []

    async countElements(): Promise<number> {
      return this.count
    }

    async getElementAttribute(): Promise<unknown> {
      return this.attributeValue
    }

    async callWxApi(api: string, args: readonly unknown[]): Promise<unknown> {
      this.wxCalls.push({ api, args: [...args] })
      return { code: 0 }
    }

    readonly nativeCalls: Array<{ decision: 'allow' | 'cancel'; timeoutMs?: number }> = []

    async nativeAuthorize(decision: 'allow' | 'cancel', timeoutMs?: number): Promise<void> {
      this.nativeCalls.push({ decision, ...(timeoutMs !== undefined ? { timeoutMs } : {}) })
    }
  }

  /** 产物目录先于 fake timers 准备好(fs 操作不被假时钟包裹) */
  async function makeArtifacts() {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-deep-'))
    const artifacts = new ArtifactManager(join(root, 'run'))
    await artifacts.prepare()
    return artifacts
  }

  function runDeepStep(
    step: TestStep,
    adapter: DeepMockAdapter,
    artifacts: ArtifactManager,
  ) {
    return executeStep(step, 0, adapter, new ExecutionContext(), artifacts, { screenshotName: 's0' })
  }

  test('count 断言:匹配即通过,不匹配报 ASSERTION_FAILED', async () => {
    const adapter = new DeepMockAdapter()
    const ok = await runDeepStep(
      { target: 'web', action: 'assert', locator: { css: '.row' }, count: 3 },
      adapter,
      await makeArtifacts(),
    )
    expect(ok.status).toBe('passed')

    // 不匹配走轮询窗口(fake timers 推进,避免真实等待)
    const artifacts = await makeArtifacts()
    vi.useFakeTimers()
    try {
      const pending = runDeepStep(
        { target: 'web', action: 'assert', locator: { css: '.row' }, count: 5 },
        adapter,
        artifacts,
      ).then(
        (r) => r,
        (e) => e,
      )
      await vi.advanceTimersByTimeAsync(11_000)
      const failed = (await pending) as import('@testpilot/core').StepResult
      expect(failed.status).toBe('failed')
      expect(failed.error).toContain('实际 3,期望 5')
      expect(failed.errorCode).toBe('ASSERTION_FAILED')
    } finally {
      vi.useRealTimers()
    }
  })

  test('count: 0(元素不存在)断言只需短 settle 窗口', async () => {
    const adapter = new DeepMockAdapter()
    adapter.count = 0
    const artifacts = await makeArtifacts()
    vi.useFakeTimers()
    try {
      const pending = runDeepStep(
        { target: 'miniapp', action: 'assert', locator: { css: '.toast' }, count: 0 },
        adapter,
        artifacts,
      ).then(
        (r) => r,
        (e) => e,
      )
      await vi.advanceTimersByTimeAsync(2_500)
      const result = (await pending) as import('@testpilot/core').StepResult
      expect(result.status).toBe('passed')
    } finally {
      vi.useRealTimers()
    }
  })

  test('attribute 断言:String(值) 全等;缺失记为 <absent>', async () => {
    const adapter = new DeepMockAdapter()
    const ok = await runDeepStep(
      { target: 'web', action: 'assert', locator: { css: '.btn' }, attribute: 'disabled', expected: 'true' },
      adapter,
      await makeArtifacts(),
    )
    expect(ok.status).toBe('passed')

    adapter.attributeValue = null
    const artifacts = await makeArtifacts()
    vi.useFakeTimers()
    try {
      const pending = runDeepStep(
        { target: 'web', action: 'assert', locator: { css: '.btn' }, attribute: 'disabled', expected: 'true' },
        adapter,
        artifacts,
      ).then(
        (r) => r,
        (e) => e,
      )
      await vi.advanceTimersByTimeAsync(11_000)
      const failed = (await pending) as import('@testpilot/core').StepResult
      expect(failed.error).toContain('<absent>')
      expect(failed.errorCode).toBe('ASSERTION_FAILED')
    } finally {
      vi.useRealTimers()
    }
  })

  test('callWxApi:透传 wxApi/args,返回值可捕获为变量', async () => {
    const adapter = new DeepMockAdapter()
    const result = await runDeepStep(
      {
        target: 'miniapp',
        action: 'callWxApi',
        wxApi: 'getStorageInfo',
        args: ['token', 123],
        variable: 'info',
      },
      adapter,
      await makeArtifacts(),
    )
    expect(adapter.wxCalls).toEqual([{ api: 'getStorageInfo', args: ['token', 123] }])
    expect(result.extracted).toEqual({ info: '{"code":0}' })
    expect(result.status).toBe('passed')
  })

  test('nativeAuthorize 把 decision 和 timeout 交给 adapter', async () => {
    const adapter = new DeepMockAdapter()
    const result = await runDeepStep(
      { target: 'miniapp', action: 'nativeAuthorize', decision: 'cancel', timeout: 3000 },
      adapter,
      await makeArtifacts(),
    )
    expect(adapter.nativeCalls).toEqual([{ decision: 'cancel', timeoutMs: 3000 }])
    expect(result.status).toBe('passed')
  })

  test('adapter 缺少能力 → UNSUPPORTED_ACTION', async () => {
    const result = await runDeepStep(
      { target: 'web', action: 'assert', locator: { css: '.row' }, count: 1 },
      new MockAdapter() as DeepMockAdapter,
      await makeArtifacts(),
    )
    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('UNSUPPORTED_ACTION')
  })
})
