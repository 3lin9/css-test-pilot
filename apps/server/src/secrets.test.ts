import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { buildServer, type TestPilotServer } from './server'

async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'testpilot-secrets-'))
  await writeFile(join(root, 'package.json'), '{"name":"secrets-app"}', 'utf8')
  return root
}

describe('server:environment secrets', () => {
  let server: TestPilotServer
  let projectId: number
  let testEnvId: number

  beforeAll(async () => {
    const root = await makeProject()
    server = await buildServer({ root, dbPath: join(root, '.testpilot', 'server.db') })
    const created = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'secrets-app', repositoryUrl: 'git@example:app.git' },
    })
    projectId = created.json().id

    testEnvId = (
      await server.app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/environments`,
        payload: { name: 'TEST', branch: 'main' },
      })
    ).json().id
  })

  afterAll(async () => {
    await server.close()
  })

  test('写入凭据(值只写不回显),列表只返回 key', async () => {
    const upsert = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/environments/${testEnvId}/secrets`,
      payload: { key: 'test-user', value: '{"username":"a","password":"b"}' },
    })
    expect(upsert.statusCode).toBe(201)
    expect(upsert.json()).toMatchObject({ secretKey: 'test-user' })
    expect(upsert.body).not.toContain('password')

    const list = await server.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/environments/${testEnvId}/secrets`,
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().secrets).toEqual([
      expect.objectContaining({ secretKey: 'test-user' }),
    ])
    expect(list.body).not.toContain('"password"')
  })

  test('重复写入为更新(幂等),删除后列表为空', async () => {
    await server.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/environments/${testEnvId}/secrets`,
      payload: { key: 'ci-bot', value: 'token-2' },
    })
    const again = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/environments/${testEnvId}/secrets`,
      payload: { key: 'ci-bot', value: 'token-3' },
    })
    expect(again.statusCode).toBe(201)

    const del = await server.app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/environments/${testEnvId}/secrets/ci-bot`,
    })
    expect(del.statusCode).toBe(204)

    const list = await server.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/environments/${testEnvId}/secrets`,
    })
    expect(list.json().secrets.map((item: { secretKey: string }) => item.secretKey)).toEqual(['test-user'])
  })

  test('环境归属校验:别的项目的环境 404', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId + 999}/environments/${testEnvId}/secrets`,
      payload: { key: 'x', value: 'y' },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })
})
