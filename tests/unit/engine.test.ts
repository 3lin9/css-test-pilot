import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { CaseLocator } from '@testpilot/dsl'
import { AdapterResolver, TestRunner } from '@testpilot/execution-engine'
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
    expect(summary.totals.failed).toBe(2)

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
