import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { CaseLocator } from '@testpilot/dsl'
import { loadTestpilotConfig } from '@testpilot/core'
import { validateCaseSource } from '@testpilot/dsl'
import { AdapterResolver, TestRunner } from '@testpilot/execution-engine'
import type { TestAdapter } from '@testpilot/adapter-core'
import { createDefaultAdapters } from '@testpilot/sdk'

/** 进程内 mock adapter:记录 navigate 的 url,验证会话键路由 */
function createRecordingAdapter() {
  const navigated: string[] = []
  const adapter: TestAdapter = {
    target: 'web',
    launch: async () => undefined,
    navigate: async (url) => {
      navigated.push(url)
    },
    click: async () => undefined,
    input: async () => undefined,
    select: async () => undefined,
    wait: async () => undefined,
    assert: async () => undefined,
    extract: async () => '',
    screenshot: async () => Buffer.from('png'),
    close: async () => undefined,
  }
  return { adapter, navigated }
}

describe('testpilot.yaml systems 解析', () => {
  test('解析 systems 并注入 ${ENV_VAR}', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-systems-'))
    process.env.SYSTEMS_PROBE_URL = 'https://admin.example.test'
    await writeFile(
      join(root, 'testpilot.yaml'),
      [
        'systems:',
        '  mall-admin:',
        '    type: web',
        '    baseUrl: ${SYSTEMS_PROBE_URL}',
        '  mall-miniapp:',
        '    type: miniapp',
        '    projectPath: ../mall-miniapp',
        '  pay-api:',
        '    type: api',
        '    baseUrl: ' + '${PAY_API_URL}',
        '    timeoutMs: 8000',
      ].join('\n'),
      'utf8',
    )

    const config = await loadTestpilotConfig(root)
    expect(config.systems?.['mall-admin']).toEqual({
      type: 'web',
      baseUrl: 'https://admin.example.test',
    })
    expect(config.systems?.['mall-miniapp']?.projectPath).toBe('../mall-miniapp')
    expect(config.systems?.['pay-api']?.timeoutMs).toBe(8000)
    delete process.env.SYSTEMS_PROBE_URL
  })

  test('web 系统缺 baseUrl / miniapp 缺 projectPath 报配置错误', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-systems-bad-'))
    await writeFile(
      join(root, 'testpilot.yaml'),
      ['systems:', '  broken:', '    type: web'].join('\n'),
      'utf8',
    )
    await expect(loadTestpilotConfig(root)).rejects.toThrow(/web 系统需要 baseUrl/)
  })

  test('非法系统名(非 kebab-case)报配置错误', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-systems-name-'))
    await writeFile(
      join(root, 'testpilot.yaml'),
      ['systems:', '  Mall_Admin:', '    type: web', '    baseUrl: https://x.test'].join('\n'),
      'utf8',
    )
    await expect(loadTestpilotConfig(root)).rejects.toThrow('testpilot.yaml 配置不合法')
  })
})

describe('DSL system 字段', () => {
  test('step 带 system 通过校验并进入解析结果', () => {
    const result = validateCaseSource(`
id: multi-system
name: 跨系统
steps:
  - target: web
    system: mall-admin
    action: navigate
    url: /goods/edit
`)
    expect(result.ok).toBe(true)
    expect(result.data?.steps[0]?.system).toBe('mall-admin')
  })

  test('system 非 kebab-case 报 schema issue', () => {
    const result = validateCaseSource(`
id: bad-system
name: 非法系统名
steps:
  - target: web
    system: Mall_Admin
    action: navigate
    url: /x
`)
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.message.includes('kebab-case'))).toBe(true)
  })
})

describe('sdk createDefaultAdapters 注册 systems', () => {
  test('额外系统以 type@名称 为会话键;miniapp 相对 projectPath 按根目录解析', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-systems-sdk-'))
    const config = await loadTestpilotConfig(root).then(() => undefined).catch(() => undefined)
    void config
    const factories = createDefaultAdapters(
      {
        casesDir: 'cases',
        systems: {
          'mall-admin': { type: 'web', baseUrl: 'https://admin.example.test' },
          'mall-miniapp': { type: 'miniapp', projectPath: '../mall-miniapp' },
          'pay-api': { type: 'api', baseUrl: 'https://pay.example.test', timeoutMs: 5000 },
        },
      },
      root,
    )
    const keys = factories.map((factory) => factory.target)
    expect(keys).toContain('web')
    expect(keys).toContain('miniapp')
    expect(keys).toContain('api')
    expect(keys).toContain('web@mall-admin')
    expect(keys).toContain('miniapp@mall-miniapp')
    expect(keys).toContain('api@pay-api')
  })
})

describe('engine system 会话键路由', () => {
  test('step.system 命中 target@system 的 adapter,不影响默认系统', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-engine-sys-'))
    const defaultAdapter = createRecordingAdapter()
    const mallAdmin = createRecordingAdapter()
    const resolver = new AdapterResolver()
    resolver.register({ target: 'web', create: async () => defaultAdapter.adapter })
    resolver.register({ target: 'web@mall-admin', create: async () => mallAdmin.adapter })

    const runner = new TestRunner({ resolver, runsRoot: join(root, 'runs') })
    const summary = await runner.run([
      {
        file: 'multi.case.yaml',
        data: {
          id: 'multi-system-run',
          name: '跨系统运行',
          steps: [
            { target: 'web', action: 'navigate', url: 'https://front.example.test' },
            { target: 'web', system: 'mall-admin', action: 'navigate', url: 'https://admin.example.test/goods' },
          ],
        },
      },
    ])

    expect(summary.status).toBe('passed')
    expect(defaultAdapter.navigated).toEqual(['https://front.example.test'])
    expect(mallAdmin.navigated).toEqual(['https://admin.example.test/goods'])
    // 取证记录 system
    expect(summary.cases[0]?.steps[1]?.system).toBe('mall-admin')
    expect(summary.cases[0]?.steps[0]?.system).toBeUndefined()
  })

  test('system 未声明时给出明确 ADAPTER_NOT_FOUND', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-engine-sys-miss-'))
    const { adapter } = createRecordingAdapter()
    const locator: CaseLocator = { css: '.x' }
    void locator
    const resolver = new AdapterResolver()
    resolver.register({ target: 'web', create: async () => adapter })

    const runner = new TestRunner({ resolver, runsRoot: join(root, 'runs') })
    const summary = await runner.run([
      {
        file: 'miss.case.yaml',
        data: {
          id: 'missing-system',
          name: '未声明系统',
          steps: [{ target: 'web', system: 'nope', action: 'navigate', url: '/x' }],
        },
      },
    ])

    // 三态判定:adapter 缺失属环境问题,run 记 blocked(非产品 bug)
    expect(summary.status).toBe('blocked')
    expect(summary.cases[0]?.steps[0]?.error).toContain('web@nope')
  })
})

describe('跨系统只读(system 步骤强制查询语义)', () => {
  test('validate:input/callMethod 等 system 步骤被拒绝', () => {
    const input = validateCaseSource(`
id: ro-input
name: 跨系统写被拒
steps:
  - target: web
    system: mall-admin
    action: input
    locator: { css: '#price' }
    value: '99'
`)
    expect(input.ok).toBe(false)
    expect(input.issues.some((issue) => issue.message.includes('跨系统只读'))).toBe(true)

    const callMethod = validateCaseSource(`
id: ro-call
name: 跨系统方法调用被拒
steps:
  - target: miniapp
    system: mall-miniapp
    action: callMethod
    methodName: refresh
`)
    expect(callMethod.issues.some((issue) => issue.message.includes('跨系统只读'))).toBe(true)
  })

  test('validate:查询类 system 步骤放行(navigate/assert/GET request)', () => {
    const result = validateCaseSource(`
id: ro-query
name: 跨系统查询
steps:
  - target: web
    system: mall-admin
    action: navigate
    url: /goods/1
  - target: web
    system: mall-admin
    action: extract
    locator: { css: '.price' }
    variable: mallPrice
  - target: api
    system: pay-api
    action: request
    url: /orders/1
  - target: api
    system: pay-api
    action: request
    url: /orders/1
    method: HEAD
  - target: api
    system: pay-api
    action: assert
    expected: '"status":"PAID"'
`)
    expect(result.issues).toEqual([])
  })

  test('validate:system 步骤的非 GET request 被拒', () => {
    const post = validateCaseSource(`
id: ro-post
name: 跨系统 POST 被拒
steps:
  - target: api
    system: pay-api
    action: request
    url: /orders
    method: POST
    body: { sku: s1 }
`)
    expect(post.ok).toBe(false)
    expect(post.issues.some((issue) => issue.message.includes('仅允许 GET/HEAD'))).toBe(true)
  })

  test('运行时守卫:绕过 validate 的程序化用例也被拒且不命中 adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-ro-guard-'))
    const { adapter, navigated } = createRecordingAdapter()
    const resolver = new AdapterResolver()
    resolver.register({ target: 'web', create: async () => adapter })
    resolver.register({ target: 'web@mall-admin', create: async () => adapter })

    const runner = new TestRunner({ resolver, runsRoot: join(root, 'runs') })
    const summary = await runner.run([
      {
        file: 'guard.case.yaml',
        data: {
          id: 'runtime-guard',
          name: '运行时守卫',
          steps: [{ target: 'web', system: 'mall-admin', action: 'input', locator: { css: '#p' }, value: '1' }],
        },
      },
    ])

    // 用例写错(CROSS_SYSTEM_READONLY 不在 infra/unverified 桶)→ 归 failed
    expect(summary.status).toBe('failed')
    expect(summary.cases[0]?.steps[0]?.error).toContain('跨系统只读')
    expect(navigated).toEqual([])
  })
})
