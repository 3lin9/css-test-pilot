import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ensureCaseConfiguration } from '@testpilot/sdk'

describe('Case 生成前自动补齐系统配置', () => {
  test('从 Case 提取 system/accountRef/variable，幂等写入 YAML 引用与 env 占位', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-case-config-'))
    await writeFile(
      join(root, 'testpilot.yaml'),
      'version: 1\nproject:\n  name: demo\nvariables: {}\nsystems: {}\n',
      'utf8',
    )
    await writeFile(join(root, '.env.testing'), 'TEST_BASE_URL=http://existing.test\n', 'utf8')
    const source = `
id: app-login
name: 应用登录
accountRef: test-user
requires:
  - variable.projectId
steps:
  - target: web
    system: app-admin
    action: navigate
    url: /projects/\${variable.projectId}
  - target: api
    system: app-api
    action: request
    method: GET
    url: /me
`

    const first = await ensureCaseConfiguration({ root, caseSource: source })
    const second = await ensureCaseConfiguration({ root, caseSource: source })
    const config = await readFile(join(root, 'testpilot.yaml'), 'utf8')
    const env = await readFile(join(root, '.env.testing'), 'utf8')

    expect(first).toMatchObject({
      systems: ['app-admin', 'app-api'],
      variables: ['projectId'],
      accounts: ['test-user'],
    })
    expect(second).toEqual(first)
    expect(config).toContain('app-admin:')
    expect(config).toContain('type: web')
    expect(config).toMatch(/baseUrl: "?\$\{APP_ADMIN_BASE_URL\}"?/)
    expect(config).toContain('app-api:')
    expect(config).toContain('type: api')
    expect(config).toMatch(/baseUrl: "?\$\{APP_API_BASE_URL\}"?/)
    expect(config).toMatch(/projectId: "?\$\{PROJECT_ID\}"?/)
    expect(env).toContain('TEST_BASE_URL=http://existing.test')
    expect(env).toContain('APP_ADMIN_BASE_URL=')
    expect(env).toContain('APP_API_BASE_URL=')
    expect(env).toContain('PROJECT_ID=')
    expect(env).toContain(
      'TESTPILOT_ACCOUNT_TEST_USER={"username":"","password":""}',
    )
    expect(env.match(/^APP_ADMIN_BASE_URL=/gm)).toHaveLength(1)
  })

  test('明确提供的 ENV=value 用作新字段初值，但不覆盖已有 env', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-case-config-values-'))
    await writeFile(join(root, 'testpilot.yaml'), 'version: 1\n', 'utf8')
    await writeFile(join(root, '.env.testing'), 'CRM_BASE_URL=https://existing.test\n', 'utf8')
    const source = `
id: crm-smoke
name: CRM
steps:
  - target: web
    system: crm
    action: navigate
    url: /
`

    await ensureCaseConfiguration({
      root,
      caseSource: source,
      prompt: 'CRM_BASE_URL=https://prompt.test',
    })
    const env = await readFile(join(root, '.env.testing'), 'utf8')
    expect(env).toContain('CRM_BASE_URL=https://existing.test')
    expect(env).not.toContain('https://prompt.test')
  })
})
