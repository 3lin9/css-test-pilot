import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { NativeSpawn } from '@testpilot/sdk'
import { buildServer, type TestPilotServer } from './server'

/** 零依赖 node:test 脚本:真实 spawn 即可通过(node --test --experimental-strip-types) */
const SMOKE_SCRIPT = `import { test } from 'node:test'
import assert from 'node:assert/strict'

test('api smoke: 占位断言', () => {
  assert.equal(1 + 1, 2)
})
`

async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'testpilot-server-'))
  await mkdir(join(root, 'tests', 'e2e', 'api'), { recursive: true })
  await writeFile(join(root, 'tests', 'e2e', 'api', 'smoke.test.ts'), SMOKE_SCRIPT, 'utf8')
  return root
}

/**
 * 可控 gate spawn:挂起直到 release/abort,用于确定性地验证「运行中取消」路径,
 * 同时不拖慢普通运行(普通运行用真实 node:test,毫秒级)。
 */
function makeGateSpawn(): { spawnImpl: NativeSpawn; release: () => void } {
  let releaseFn: (() => void) | undefined
  const spawnImpl: NativeSpawn = async (_command, _cwd, _output, signal) => {
    await new Promise<void>((resolvePromise) => {
      if (signal?.aborted) return resolvePromise()
      signal?.addEventListener('abort', () => resolvePromise(), { once: true })
      releaseFn = resolvePromise
    })
    return { code: 1, stdout: '' }
  }
  return { spawnImpl, release: () => releaseFn?.() }
}

describe('server:control-plane', () => {
  let server: TestPilotServer
  let root: string

  beforeAll(async () => {
    root = await makeProject()
    server = await buildServer({
      root,
      dbPath: join(root, '.testpilot', 'server.db'),
    })
  })

  afterAll(async () => {
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

  test('打开本地文件夹:open 幂等登记 rootPath', async () => {
    const extra = await mkdtemp(join(tmpdir(), 'testpilot-open-'))
    const opened = await server.app.inject({
      method: 'POST',
      url: '/api/projects/open',
      payload: { rootPath: extra },
    })
    expect(opened.statusCode).toBe(200)
    expect(opened.json().rootPath).toBe(resolve(extra))

    const again = await server.app.inject({
      method: 'POST',
      url: '/api/projects/open',
      payload: { rootPath: extra },
    })
    expect(again.json().id).toBe(opened.json().id)
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
          { id: 'TP-001', title: 'TP-001', file: 'tests/e2e/web/order.spec.ts', tags: ['charter:error-path'] },
          { id: 'TP-002', title: 'TP-002', file: 'tests/e2e/api/member.test.ts' },
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
          { id: 'TP-001', title: 'TP-001', file: 'tests/e2e/web/order.spec.ts', tags: ['charter:error-path'] },
          { id: 'TP-003', title: 'TP-003', file: 'tests/e2e/miniapp/cart.test.ts' },
        ],
      },
    })
    expect(second.statusCode).toBe(200)
    // TP-001 内容未变不算修改(commit 变化记录在分支成员表);TP-002 消失计入 deleted;TP-003 新增
    expect(second.json()).toMatchObject({ added: 1, updated: 0, deleted: 1, activeTotal: 2 })

    // Case Index:TP-002 deleted / TP-003 active
    const casesRes = await server.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/cases`,
    })
    const cases = casesRes.json().cases
    expect(cases.find((item: { caseId: string }) => item.caseId === 'TP-002').status).toBe('deleted')
    expect(cases.find((item: { caseId: string }) => item.caseId === 'TP-003').commit).toBe('b93ce02')

    // 按 case id 查询
    const oneRes = await server.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/cases/TP-001`,
    })
    expect(oneRes.statusCode).toBe(200)
    expect(oneRes.json().tags).toEqual(['charter:error-path'])

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

  test('多分支同步:分支即测试环境,main 与 release 互不影响', async () => {
    const projectId = server.ctx.defaultProject.id

    // release 分支只同步 TP-002:TP-002 在 main 上已 deleted,但在 release 上存在 -> 整体恢复 active
    const syncRes = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/cases/sync`,
      payload: {
        repository: 'git@github.com:company/mall.git',
        branch: 'release',
        commit: 'c11ce02',
        cases: [{ id: 'TP-002', title: 'TP-002', file: 'tests/e2e/api/member.test.ts' }],
      },
    })
    expect(syncRes.statusCode).toBe(200)
    expect(syncRes.json()).toMatchObject({ added: 0, updated: 1, deleted: 0, activeTotal: 3 })

    // TP-002:main 成员 deleted + release 成员 active -> 整体 active,branches 仅 release
    const caseBRes = await server.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/cases/TP-002`,
    })
    expect(caseBRes.json().status).toBe('active')
    expect(caseBRes.json().branches).toEqual(['release'])

    // TP-001 不受 release 同步影响:仍在 main 上
    const caseARes = await server.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/cases/TP-001`,
    })
    expect(caseARes.json().status).toBe('active')
    expect(caseARes.json().branches).toEqual(['main'])

    // sync-status:按分支聚合的同步状态(分支即测试环境)
    const statusRes = await server.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/sync-status`,
    })
    const branches = statusRes.json().branches
    expect(branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ branch: 'main', caseCount: 2 }),
        expect.objectContaining({ branch: 'release', caseCount: 1 }),
      ]),
    )
  })

  test('Workspace:显式 workspaceId 传入时 Run 记录环境快照', async () => {
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

    // 显式 workspaceId -> 运行行记录快照
    const createRes = await server.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { workspaceId },
    })
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

  test('运行生命周期:202 -> passed -> report,Run 记录显式 commit', async () => {
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

    const reportRes = await server.app.inject({ method: 'GET', url: `/api/runs/${runId}/report` })
    expect(reportRes.statusCode).toBe(200)
    expect(reportRes.json().runId).toBe(runId)
    expect(reportRes.json().htmlPath).toContain('report.html')
  })

  test('POST /api/runs 无可执行用例时 422', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { paths: ['tests/e2e/api/missing.test.ts'] },
    })
    expect(res.statusCode).toBe(422)
  })

  test('run summary 与 artifacts:列举 / 读取 / 路径穿越防护', async () => {
    const createRes = await server.app.inject({ method: 'POST', url: '/api/runs', payload: {} })
    expect(createRes.statusCode).toBe(202)
    const runId = createRes.json().id as string
    await server.ctx.orchestrator.wait(runId)

    const summaryRes = await server.app.inject({ method: 'GET', url: `/api/runs/${runId}/summary` })
    expect(summaryRes.statusCode).toBe(200)
    expect(summaryRes.json().status).toBe('passed')
    expect(summaryRes.json().cases[0].steps.length).toBeGreaterThan(0)

    const listRes = await server.app.inject({ method: 'GET', url: `/api/runs/${runId}/artifacts` })
    const paths = listRes.json().files.map((file: { path: string }) => file.path)
    expect(paths).toContain('result.json')
    expect(paths.some((path: string) => path.endsWith('.tap'))).toBe(false)

    const fileRes = await server.app.inject({
      method: 'GET',
      url: `/api/runs/${runId}/artifacts/result.json`,
    })
    expect(fileRes.statusCode).toBe(200)
    expect(fileRes.json().runId).toBe(runId)

    // 越出 run 目录的相对路径必须被拒绝
    const evil = await server.app.inject({
      method: 'GET',
      url: `/api/runs/${runId}/artifacts/..%5C..%5Ctestpilot.yaml`,
    })
    expect([400, 404]).toContain(evil.statusCode)
  })

  test('项目并发运行 409;运行中取消 -> cancelled;重复取消 409', async () => {
    const gate = makeGateSpawn()
    const gateServer = await buildServer({
      root,
      dbPath: join(root, '.testpilot', 'server-gate.db'),
      spawnImpl: gate.spawnImpl,
    })
    try {
      const createRes = await server.app.inject({ method: 'POST', url: '/api/runs', payload: {} })
      expect(createRes.statusCode).toBe(202)
      const runId = createRes.json().id as string

      // gate server 的运行进入挂起的 spawn
      const gateCreate = await gateServer.app.inject({ method: 'POST', url: '/api/runs', payload: {} })
      expect(gateCreate.statusCode).toBe(202)
      const gateRunId = gateCreate.json().id as string

      // 同项目第二个运行应 409
      const busyRes = await gateServer.app.inject({ method: 'POST', url: '/api/runs', payload: {} })
      expect(busyRes.statusCode).toBe(409)

      // 运行中取消:spawn 被唤醒后停止
      const cancelRes = await gateServer.app.inject({
        method: 'POST',
        url: `/api/runs/${gateRunId}/cancel`,
      })
      expect(cancelRes.statusCode).toBe(200)

      await gateServer.ctx.orchestrator.wait(gateRunId)
      const runRes = await gateServer.app.inject({ method: 'GET', url: `/api/runs/${gateRunId}` })
      expect(runRes.json().status).toBe('cancelled')

      const againRes = await gateServer.app.inject({
        method: 'POST',
        url: `/api/runs/${gateRunId}/cancel`,
      })
      expect(againRes.statusCode).toBe(409)

      // 主 server 的运行照常收尾
      await server.ctx.orchestrator.wait(runId)
    } finally {
      gate.release()
      await gateServer.close()
    }
  })

  test('GET /api/runs 列表', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/runs' })
    expect(res.statusCode).toBe(200)
    expect(res.json().runs.length).toBeGreaterThanOrEqual(3)
  })
})
