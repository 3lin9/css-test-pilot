import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { AdapterFactory, TestAdapter } from '@testpilot/adapter-core'
import { buildServer, type TestPilotServer } from './server'

const CASE_A = `id: case-a
name: 用例 A
workspace: mall-test
tags:
  - smoke
steps:
  - target: web
    action: launch
  - target: web
    action: wait
    timeout: 5000
  - target: web
    action: assert
    locator:
      css: ".title"
    expected: "ok"
`

const CASE_BROKEN = `id: case-broken
steps:
  - target: miniapp
    action: select
`

async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'testpilot-server-'))
  await mkdir(join(root, 'tests', 'e2e', 'cases'), { recursive: true })
  await writeFile(join(root, 'testpilot.yaml'), 'casesDir: tests/e2e/cases\n', 'utf8')
  await writeFile(join(root, 'tests', 'e2e', 'cases', 'case-a.yaml'), CASE_A, 'utf8')
  await writeFile(join(root, 'tests', 'e2e', 'cases', 'broken.yaml'), CASE_BROKEN, 'utf8')
  return root
}

/**
 * 可控 stub adapter:测试通过 block/unblock 决定 wait 步骤是否阻塞,
 * 用于确定性地验证「运行中取消」路径,同时不拖慢普通运行。
 */
function makeGateAdapter(): { factory: AdapterFactory; block: () => void; unblock: () => void } {
  let blocking = false
  let release: (() => void) | undefined

  const adapter: TestAdapter = {
    target: 'web',
    async launch() {},
    async navigate() {},
    async click() {},
    async input() {},
    async select() {},
    async wait() {
      if (!blocking) return
      await new Promise<void>((resolvePromise) => {
        release = resolvePromise
      })
    },
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
    factory: {
      target: 'web',
      async create() {
        return adapter
      },
    },
    block() {
      blocking = true
    },
    unblock() {
      blocking = false
      release?.()
      release = undefined
    },
  }
}

async function until(condition: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
  throw new Error('等待条件超时')
}

describe('server:control-plane', () => {
  let server: TestPilotServer
  let gate: ReturnType<typeof makeGateAdapter>
  let root: string

  beforeAll(async () => {
    root = await makeProject()
    gate = makeGateAdapter()
    server = await buildServer({
      root,
      dbPath: join(root, '.testpilot', 'server.db'),
      adapters: [gate.factory],
    })
  })

  afterAll(async () => {
    gate.unblock()
    await server.close()
  })

  test('GET /api/health 返回默认项目', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.project.rootPath).toBe(server.ctx.defaultProject.rootPath)
  })

  test('GET /api/projects 返回启动时注册的本地项目', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.projects).toHaveLength(1)
    expect(body.projects[0].rootPath).toBe(server.ctx.defaultProject.rootPath)
  })

  test('POST /api/projects 注册远端项目(无本地根目录)', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        name: 'ppm',
        repositoryUrl: 'git@github.com:company/ppm.git',
        defaultBranch: 'main',
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().name).toBe('ppm')
    expect(res.json().rootPath).toBeNull()
  })

  test('POST /api/projects 缺少名称时 400/422', async () => {
    const res = await server.app.inject({ method: 'POST', url: '/api/projects', payload: {} })
    expect([400, 422]).toContain(res.statusCode)
  })

  test('GET /api/projects/:id 404', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/projects/999' })
    expect(res.statusCode).toBe(404)
  })

  test('cases/sync 快照同步:新增 -> 删除 -> sync-status', async () => {
    const projectId = server.ctx.defaultProject.id

    // 第一次同步:A + B(用临时文件路径模拟远端快照)
    const first = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/cases/sync`,
      payload: {
        repository: 'git@github.com:company/mall.git',
        branch: 'main',
        commit: 'a82fd91',
        cases: [
          { id: 'case-a', title: '用例 A', file: 'tests/e2e/cases/case-a.yaml', tags: ['smoke'] },
          { id: 'case-b', title: '用例 B', file: 'tests/e2e/cases/case-b.yaml' },
        ],
      },
    })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ added: 2, updated: 0, deleted: 0, activeTotal: 2 })

    // 第二次同步:A + C -> B 被标记 deleted
    const second = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/cases/sync`,
      payload: {
        repository: 'git@github.com:company/mall.git',
        branch: 'main',
        commit: 'b93ce02',
        cases: [
          { id: 'case-a', title: '用例 A', file: 'tests/e2e/cases/case-a.yaml', tags: ['smoke'] },
          { id: 'case-c', title: '用例 C', file: 'tests/e2e/cases/case-c.yaml' },
        ],
      },
    })
    expect(second.statusCode).toBe(200)
    // case-a 指向新 commit 计入 updated;B 消失计入 deleted;C 新增
    expect(second.json()).toMatchObject({ added: 1, updated: 1, deleted: 1, activeTotal: 2 })

    // Case Index:A active / B deleted / C active
    const casesRes = await server.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/cases`,
    })
    const cases = casesRes.json().cases
    expect(cases.find((item: { caseId: string }) => item.caseId === 'case-b').status).toBe('deleted')
    expect(cases.find((item: { caseId: string }) => item.caseId === 'case-c').commit).toBe('b93ce02')

    // 按 DSL case id 查询
    const oneRes = await server.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/cases/case-a`,
    })
    expect(oneRes.statusCode).toBe(200)
    expect(oneRes.json().tags).toEqual(['smoke'])

    // sync-status:Web 项目概览
    const statusRes = await server.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/sync-status`,
    })
    expect(statusRes.statusCode).toBe(200)
    expect(statusRes.json()).toMatchObject({
      branch: 'main',
      lastSyncedCommit: 'b93ce02',
      caseCount: 2,
    })
    expect(statusRes.json().lastSyncedAt).toBeTruthy()
  })

  test('cases/sync 缺少 branch/commit 时 400', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${server.ctx.defaultProject.id}/cases/sync`,
      payload: { cases: [] },
    })
    expect(res.statusCode).toBe(400)
  })

  test('Workspace:创建 / 绑定环境 / Case 声明解析到 Run 快照', async () => {
    const projectId = server.ctx.defaultProject.id

    // 环境 + workspace + 绑定
    const envRes = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/environments`,
      payload: { name: 'TEST', baseUrl: 'http://test.local' },
    })
    expect(envRes.statusCode).toBe(201)

    const wsRes = await server.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: 'mall-test', description: '商城测试环境' },
    })
    expect(wsRes.statusCode).toBe(201)
    const workspaceId = wsRes.json().id

    const bindRes = await server.app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspaceId}/bindings`,
      payload: { projectId, environmentId: envRes.json().id },
    })
    expect(bindRes.statusCode).toBe(201)

    // Case 声明 workspace: mall-test -> 运行时自动解析
    const createRes = await server.app.inject({ method: 'POST', url: '/api/runs', payload: {} })
    expect(createRes.statusCode).toBe(202)
    const runId = createRes.json().id as string
    await server.ctx.orchestrator.wait(runId)

    const runRes = await server.app.inject({ method: 'GET', url: `/api/runs/${runId}` })
    const run = runRes.json()
    expect(run.status).toBe('passed')
    expect(run.workspaceId).toBe(workspaceId)
    const snapshot = JSON.parse(run.workspaceSnapshotJson)
    expect(snapshot.name).toBe('mall-test')
    expect(snapshot.bindings[0].environmentName).toBe('TEST')
  })

  test('运行生命周期:202 -> passed -> events -> report,Run 记录显式 commit', async () => {
    const createRes = await server.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { branch: 'main', commit: 'a82fd91' },
    })
    expect(createRes.statusCode).toBe(202)
    const runId = createRes.json().id as string
    await server.ctx.orchestrator.wait(runId)

    const runRes = await server.app.inject({ method: 'GET', url: `/api/runs/${runId}` })
    const run = runRes.json()
    expect(run.status).toBe('passed')
    expect(run.branch).toBe('main')
    expect(run.commit).toBe('a82fd91')
    expect(JSON.parse(run.totalsJson).cases).toBe(1)

    const eventsRes = await server.app.inject({ method: 'GET', url: `/api/runs/${runId}/events` })
    const events = eventsRes.json().events
    expect(events[0].type).toBe('run-started')
    expect(events.at(-1).type).toBe('run-finished')

    const reportRes = await server.app.inject({ method: 'GET', url: `/api/runs/${runId}/report` })
    expect(reportRes.statusCode).toBe(200)
    expect(reportRes.json().runId).toBe(runId)
    expect(reportRes.json().htmlPath).toContain('report.html')
  })

  test('POST /api/runs 无可执行用例时 422', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { paths: ['tests/e2e/cases/broken.yaml'] },
    })
    expect(res.statusCode).toBe(422)
  })

  test('项目并发运行 409;运行中取消 -> cancelled;重复取消 409', async () => {
    gate.block()

    const createRes = await server.app.inject({ method: 'POST', url: '/api/runs', payload: {} })
    expect(createRes.statusCode).toBe(202)
    const runId = createRes.json().id as string

    // 等待 wait 步骤进入阻塞
    await until(async () => {
      const res = await server.app.inject({ method: 'GET', url: `/api/runs/${runId}/events` })
      return res.json().events.some(
        (item: { event: { action?: string } }) => item.event.action === 'wait',
      )
    })

    // 同项目第二个运行应 409
    const busyRes = await server.app.inject({ method: 'POST', url: '/api/runs', payload: {} })
    expect(busyRes.statusCode).toBe(409)

    // 运行中取消:当前用例完成后停止
    const cancelRes = await server.app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/cancel`,
    })
    expect(cancelRes.statusCode).toBe(200)

    gate.unblock()
    await server.ctx.orchestrator.wait(runId)
    const runRes = await server.app.inject({ method: 'GET', url: `/api/runs/${runId}` })
    expect(runRes.json().status).toBe('cancelled')

    const againRes = await server.app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/cancel`,
    })
    expect(againRes.statusCode).toBe(409)
  })

  test('GET /api/runs 列表', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/runs' })
    expect(res.statusCode).toBe(200)
    expect(res.json().runs.length).toBeGreaterThanOrEqual(3)
  })
})
