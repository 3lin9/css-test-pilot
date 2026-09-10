import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { CaseLocator } from '@testpilot/dsl'
import type { AdapterFactory, TestAdapter } from '@testpilot/adapter-core'
import { TestPilotClient, RunError } from './index'

const VALID_CASE = `id: smoke-login
name: 冒烟 - 打开首页
tags:
  - smoke
steps:
  - target: web
    action: launch
  - target: web
    action: navigate
    url: /
  - target: web
    action: assert
    locator:
      css: ".title"
    expected: "首页"
`

const INVALID_CASE = `id: broken-case
steps:
  - target: miniapp
    action: select
`

const OTHER_CASE = `id: other-case
name: 其他用例
tags:
  - slow
steps:
  - target: web
    action: launch
`

/** 进程内 stub adapter:全部成功,记录调用 */
function stubAdapterFactory(target: 'web'): AdapterFactory {
  const seen: string[] = []
  const adapter: TestAdapter = {
    target,
    async launch() {},
    async navigate(url: string) {
      seen.push(`navigate:${url}`)
    },
    async click(locator: CaseLocator) {
      seen.push(`click:${locator.css ?? locator.text ?? ''}`)
    },
    async input(locator: CaseLocator, value: string) {
      seen.push(`input:${locator.css}:${value}`)
    },
    async select() {},
    async wait() {},
    async assert() {},
    async extract() {
      return '42'
    },
    async screenshot() {
      return Buffer.from('png')
    },
    async close() {},
  }
  return {
    target,
    async create() {
      return adapter
    },
  }
}

async function makeProject(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'testpilot-sdk-'))
  for (const [file, content] of Object.entries(files)) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), content, 'utf8')
  }
  return root
}

describe('sdk:project', () => {
  test('inspectProject:无配置文件时返回默认配置', async () => {
    const root = await makeProject({ 'tests/e2e/cases/a.yaml': VALID_CASE })
    const client = new TestPilotClient({ root })

    const inspection = await client.inspect()
    expect(inspection.hasConfig).toBe(false)
    expect(inspection.config.casesDir).toBe('tests/e2e/cases')
    expect(inspection.skillInstalled).toBe(false)
    expect(inspection.targets).toEqual(['web'])
  })

  test('inspectProject:识别配置与 Skill 安装状态', async () => {
    const root = await makeProject({
      'testpilot.yaml': `casesDir: tests/e2e/cases\nminiapp:\n  projectPath: mini-proj\n`,
      'tests/e2e/cases/a.yaml': VALID_CASE,
      '.agents/skills/testpilot/SKILL.md': '# skill',
    })
    const client = new TestPilotClient({ root })

    const inspection = await client.inspect()
    expect(inspection.hasConfig).toBe(true)
    expect(inspection.skillInstalled).toBe(true)
    expect(inspection.targets).toEqual(['web', 'miniapp'])
  })
})

describe('sdk:cases', () => {
  test('listCases:区分有效与无效用例,支持 tag 过滤', async () => {
    const root = await makeProject({
      'tests/e2e/cases/smoke.yaml': VALID_CASE,
      'tests/e2e/cases/broken.yaml': INVALID_CASE,
      'tests/e2e/cases/other.yaml': OTHER_CASE,
    })
    const client = new TestPilotClient({ root })

    const all = await client.listCases()
    expect(all).toHaveLength(3)
    expect(all.filter((item) => item.valid)).toHaveLength(2)
    expect(all.find((item) => !item.valid)?.issues.length).toBeGreaterThan(0)

    const smoke = await client.listCases(undefined, 'smoke')
    expect(smoke.map((item) => item.case?.id)).toEqual(['smoke-login'])
  })

  test('writeCase:拒绝无效用例,拒绝覆盖,允许显式覆盖', async () => {
    const root = await makeProject({})
    const client = new TestPilotClient({ root })

    const rejected = await client.writeCase('tests/e2e/cases/bad.yaml', INVALID_CASE)
    expect(rejected.written).toBe(false)
    expect(rejected.validation.ok).toBe(false)

    const accepted = await client.writeCase('tests/e2e/cases/ok.yaml', VALID_CASE)
    expect(accepted.written).toBe(true)
    expect(accepted.validation.data?.id).toBe('smoke-login')

    await expect(client.writeCase('tests/e2e/cases/ok.yaml', VALID_CASE)).rejects.toThrow(
      /已存在/,
    )
    const overwritten = await client.writeCase('tests/e2e/cases/ok.yaml', OTHER_CASE, {
      overwrite: true,
    })
    expect(overwritten.written).toBe(true)
  })
})

describe('sdk:runs', () => {
  test('runCases -> getRun -> listRuns -> getRunEvents -> generateReport 全链路', async () => {
    const root = await makeProject({
      'tests/e2e/cases/smoke.yaml': VALID_CASE,
      'tests/e2e/cases/broken.yaml': INVALID_CASE,
    })
    const client = new TestPilotClient({ root })

    const { summary, invalid, tagFiltered } = await client.runCases({
      adapters: [stubAdapterFactory('web')],
    })
    expect(summary.status).toBe('passed')
    expect(summary.cancelled).toBeFalsy()
    expect(summary.totals.cases).toBe(1)
    expect(invalid.map((item) => item.file)).toContainEqual(expect.stringContaining('broken.yaml'))
    expect(tagFiltered).toBe(0)

    const fetched = await client.getRun(summary.runId)
    expect(fetched.runId).toBe(summary.runId)

    const runs = await client.listRuns()
    expect(runs[0]?.runId).toBe(summary.runId)

    const events = await client.getRunEvents(summary.runId)
    expect(events[0]?.type).toBe('run-started')
    expect(events.at(-1)?.type).toBe('run-finished')

    const report = await client.generateReport(summary.runId)
    expect(report.json).toContain('report.json')
    const payload = await client.readReport(summary.runId)
    expect(payload?.summary.runId).toBe(summary.runId)
    await expect(readFile(report.html, 'utf8')).resolves.toContain('TestPilot 报告')
  })

  test('runCases:没有用例时抛 RunError', async () => {
    const root = await makeProject({})
    const client = new TestPilotClient({ root })
    await expect(client.runCases({ adapters: [stubAdapterFactory('web')] })).rejects.toBeInstanceOf(
      RunError,
    )
  })

  test('runCases:已取消的信号使运行标记 cancelled', async () => {
    const root = await makeProject({ 'tests/e2e/cases/smoke.yaml': VALID_CASE })
    const client = new TestPilotClient({ root })
    const controller = new AbortController()
    controller.abort()

    const { summary } = await client.runCases({
      adapters: [stubAdapterFactory('web')],
      signal: controller.signal,
    })
    expect(summary.cancelled).toBe(true)
    expect(summary.totals.cases).toBe(0)
  })
})

describe('sdk:project-link', () => {
  test('writeProjectLink / getProjectLink 读写关联信息', async () => {
    const root = await makeProject({})
    const client = new TestPilotClient({ root })

    expect(await client.getProjectLink()).toBeUndefined()

    await client.linkProject({
      projectId: 'proj_01HXYZ',
      serverUrl: 'http://127.0.0.1:3000',
      repositoryUrl: 'git@github.com:company/my-project.git',
      branch: 'main',
    })

    const link = await client.getProjectLink()
    expect(link?.projectId).toBe('proj_01HXYZ')
    expect(link?.serverUrl).toBe('http://127.0.0.1:3000')
  })
})

describe('sdk:dsl-workspace', () => {
  test('Case 可声明 workspace(引用 Test Workspace)', async () => {
    const root = await makeProject({
      'tests/e2e/cases/ws.yaml': `id: ws-case
name: 跨系统用例
workspace: mall-test
steps:
  - target: web
    action: launch
`,
    })
    const client = new TestPilotClient({ root })
    const infos = await client.listCases()
    expect(infos[0]?.valid).toBe(true)
    expect(infos[0]?.case?.workspace).toBe('mall-test')
  })
})
