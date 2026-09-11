import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readProjectLink } from '@testpilot/sdk'
import { detectProject, detectProjectType } from './project-detector'
import { runInit } from './index'
import { runDoctor } from './doctor'
import { initCi } from './ci-initializer'

/** 造一个临时业务项目 */
async function makeProject(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'csspilot-init-'))
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, content, 'utf8')
  }
  // 测试统一走本地模式,不触网
  delete process.env.TESTPILOT_SERVER_URL
  return root
}

/** 遍历目录收集全部文件内容(用于 Secret 泄露断言) */
async function readAllFiles(root: string, dir = root): Promise<string> {
  const parts: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) parts.push(await readAllFiles(root, full))
    else parts.push(await readFile(full, 'utf8').catch(() => ''))
  }
  return parts.join('\n')
}

let savedEnv: NodeJS.ProcessEnv

beforeEach(() => {
  savedEnv = { ...process.env }
})

afterEach(() => {
  process.env = savedEnv
})

describe('cli:init:项目检测', () => {
  test('识别 web / wechat-miniapp / hybrid / unknown', async () => {
    const web = await makeProject({ 'package.json': '{"name":"web-app"}', 'index.html': '<html></html>' })
    const wechat = await makeProject({
      'project.config.json': '{"appid":"wx123"}',
      'app.json': '{"pages":["pages/index/index"]}',
    })
    const hybrid = await makeProject({
      'index.html': '<html></html>',
      'project.config.json': '{}',
      'app.json': '{}',
    })
    const unknown = await makeProject({ 'README.md': '# doc project' })

    expect(detectProjectType(web)).toBe('web')
    expect(detectProjectType(wechat)).toBe('wechat-miniapp')
    expect(detectProjectType(hybrid)).toBe('hybrid')
    expect(detectProjectType(unknown)).toBe('unknown')
  })

  test('识别包管理器与 TypeScript', async () => {
    const root = await makeProject({
      'package.json': '{"name":"ts-app"}',
      'pnpm-lock.yaml': '',
      'tsconfig.json': '{}',
    })
    const info = await detectProject(root)
    expect(info.packageManager).toBe('pnpm')
    expect(info.language).toBe('TypeScript')
    expect(info.name).toBe('ts-app')
  })
})

describe('cli:init:新项目', () => {
  test('创建全部基础文件(设计文档 §21 验收清单)', async () => {
    const root = await makeProject({ 'index.html': '<html></html>' })
    const summary = await runInit(root, { serverUrl: null })

    // 配置
    expect(existsSync(join(root, 'testpilot.yaml'))).toBe(true)
    expect(existsSync(join(root, '.testpilot', 'project.json'))).toBe(true)
    expect(existsSync(join(root, '.testpilot', 'artifacts'))).toBe(true)
    // 测试目录
    for (const dir of ['cases', 'fixtures', 'data']) {
      expect(existsSync(join(root, 'tests', 'e2e', dir))).toBe(true)
    }
    // Skill + references
    expect(existsSync(join(root, '.agents', 'skills', 'testpilot', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(root, '.agents', 'skills', 'testpilot', 'manifest.yaml'))).toBe(true)
    expect(existsSync(join(root, '.agents', 'skills', 'testpilot', 'references', 'project.md'))).toBe(true)
    expect(
      existsSync(join(root, '.agents', 'skills', 'testpilot', 'references', 'test-conventions.md')),
    ).toBe(true)

    // project.json 结构(§9)
    const link = await readProjectLink(root)
    expect(link?.projectId).toMatch(/^proj_/)
    expect(link?.version).toBe(1)
    expect(link?.testDir).toBe('tests/e2e')
    expect(link?.caseDir).toBe('tests/e2e/cases')
    expect(link?.defaultAdapter).toBe('playwright')

    // testpilot.yaml 关键段(§9-10)
    const yaml = await readFile(join(root, 'testpilot.yaml'), 'utf8')
    expect(yaml).toContain('version: 1')
    expect(yaml).toContain('project:')
    expect(yaml).toContain('caseDirectory: tests/e2e/cases')
    expect(yaml).toContain('baseUrl: ${TEST_BASE_URL}')
    expect(yaml).not.toMatch(/password|secret\s*:/i)

    // init 自动执行 doctor(§12)
    expect(summary.doctor.sections.length).toBeGreaterThan(0)
  })

  test('wechat-miniapp 项目写入 wechatide 默认执行端', async () => {
    const root = await makeProject({ 'project.config.json': '{}', 'app.json': '{}' })
    await runInit(root, { serverUrl: null })
    const link = await readProjectLink(root)
    expect(link?.defaultAdapter).toBe('wechatide')
    const yaml = await readFile(join(root, 'testpilot.yaml'), 'utf8')
    expect(yaml).toContain('- wechatide')
  })
})

describe('cli:init:幂等与保留(§17/§20)', () => {
  test('重复 init 不覆盖、不重置 projectId', async () => {
    const root = await makeProject({ 'index.html': '' })
    await runInit(root, { serverUrl: null })
    const yamlBefore = await readFile(join(root, 'testpilot.yaml'), 'utf8')
    const linkBefore = await readProjectLink(root)

    const second = await runInit(root, { serverUrl: null })

    expect(await readFile(join(root, 'testpilot.yaml'), 'utf8')).toBe(yamlBefore)
    expect(second.config.yaml).toBe('reused')
    expect(second.skill.core).toBe('reused')
    const linkAfter = await readProjectLink(root)
    expect(linkAfter?.projectId).toBe(linkBefore?.projectId)
  })

  test('已有 tests/e2e 内容不被改动', async () => {
    const sentinel = 'id: keep-me\nname: 保留\nsteps:\n  - target: web\n    action: launch\n'
    const root = await makeProject({ 'index.html': '', 'tests/e2e/cases/keep.yaml': sentinel })
    await runInit(root, { serverUrl: null })
    expect(await readFile(join(root, 'tests', 'e2e', 'cases', 'keep.yaml'), 'utf8')).toBe(sentinel)
  })

  test('已有 testpilot.yaml 保留原配置', async () => {
    const custom = 'casesDir: my/cases\n'
    const root = await makeProject({ 'index.html': '', 'testpilot.yaml': custom })
    await runInit(root, { serverUrl: null })
    expect(await readFile(join(root, 'testpilot.yaml'), 'utf8')).toBe(custom)
  })
})

describe('cli:init:安全(§18/§20)', () => {
  test('Adapter 不可用不阻塞 init,doctor 给 warning', async () => {
    const root = await makeProject({ 'index.html': '' }) // 无 playwright 依赖、无微信开发者工具
    // 隔离环境变量问题:模板引用的变量先注入,专注验证 Adapter 降级为 warning
    process.env.TEST_BASE_URL = 'http://localhost:8080'
    process.env.STAGING_BASE_URL = 'http://localhost:8081'
    const summary = await runInit(root, { serverUrl: null })
    expect(summary.adapters.some((item) => !item.available)).toBe(true)
    expect(summary.doctor.warnings).toBeGreaterThan(0)
    expect(summary.doctor.errors).toBe(0)
  })

  test('references/project.md 渲染配置中的默认环境', async () => {
    const root = await makeProject({
      'index.html': '',
      'testpilot.yaml': 'environment:\n  default: staging\nworkspace:\n  default: mall-test\n',
    })
    await runInit(root, { serverUrl: null })
    const projectMd = await readFile(
      join(root, '.agents', 'skills', 'testpilot', 'references', 'project.md'),
      'utf8',
    )
    expect(projectMd).toContain('Default environment: staging')
    expect(projectMd).toContain('Default workspace: mall-test')
  })

  test('已有其他 E2E 目录:保持标准 tests/e2e,只提示不迁移(§6 决策)', async () => {
    const root = await makeProject({
      'index.html': '',
      'cypress/e2e/old.spec.js': '// legacy',
    })
    const summary = await runInit(root, { serverUrl: null })
    // 标准 tests/e2e 仍创建;已有目录原样保留;配置指向标准目录
    expect(existsSync(join(root, 'tests', 'e2e', 'cases'))).toBe(true)
    expect(existsSync(join(root, 'cypress', 'e2e', 'old.spec.js'))).toBe(true)
    const yaml = await readFile(join(root, 'testpilot.yaml'), 'utf8')
    expect(yaml).toContain('caseDirectory: tests/e2e/cases')
    expect(summary.project.existingE2eDirs).toContain('cypress')
  })

  test('doctor 检查 Case 声明的账号凭据(§12 Required secrets)', async () => {
    const root = await makeProject({
      'index.html': '',
      '.testpilot/project.json': '{"projectId":"proj_t1"}',
      'tests/e2e/cases/a.yaml':
        'id: a\nname: A\naccountRef: ci-runner\nsteps:\n  - target: web\n    action: launch\n',
    })
    delete process.env.TESTPILOT_ACCOUNT_CI_RUNNER
    const missing = await runDoctor(root)
    const envMissing = missing.sections
      .find((section) => section.name === 'Environment')
      ?.items.filter((item) => item.label.includes('ci-runner'))
    expect(envMissing).toHaveLength(1)
    expect(envMissing?.[0]?.status).toBe('warn') // Server 已配置 → warn 而非 error

    process.env.TESTPILOT_ACCOUNT_CI_RUNNER = '{"token":"t"}'
    const provided = await runDoctor(root)
    const envProvided = provided.sections
      .find((section) => section.name === 'Environment')
      ?.items.filter((item) => item.label.includes('ci-runner'))
    expect(envProvided?.[0]?.status).toBe('ok')
  })

  test('.env 中的 Secret 不会写进任何生成文件', async () => {
    const root = await makeProject({ 'index.html': '', '.env': 'TEST_ACCOUNT=super-secret-token-xyz\n' })
    await runInit(root, { serverUrl: null })
    const all = await readAllFiles(root)
    // .env 本身保留,但生成物(Skill/配置/project.json)不含其内容
    const generated = all.replace(/super-secret-token-xyz/, '')
    expect(generated.includes('super-secret-token-xyz')).toBe(false)
    expect(all.includes('super-secret-token-xyz')).toBe(true) // .env 原样保留
  })
})

describe('cli:doctor:环境变量检查(§12 Environment)', () => {
  test('配置引用的变量缺失为 error,设置后为 ok', async () => {
    const root = await makeProject({
      'index.html': '',
      'testpilot.yaml': 'environment:\n  default: test\n  test:\n    baseUrl: ${TEST_BASE_URL_CHECK}\n',
      '.testpilot/project.json': '{"projectId":"proj_test1"}',
    })
    delete process.env.TEST_BASE_URL_CHECK
    const missing = await runDoctor(root)
    const envItems = missing.sections.find((section) => section.name === 'Environment')?.items ?? []
    expect(envItems.some((item) => item.status === 'error' && item.label.includes('TEST_BASE_URL_CHECK'))).toBe(true)

    process.env.TEST_BASE_URL_CHECK = 'http://localhost:8080'
    const set = await runDoctor(root)
    const okItems = set.sections.find((section) => section.name === 'Environment')?.items ?? []
    expect(okItems.some((item) => item.status === 'ok' && item.label === 'TEST_BASE_URL_CHECK')).toBe(true)
  })
})

describe('cli:ci init(§13)', () => {
  test('生成 testpilot.yml 且幂等', async () => {
    const root = await makeProject({ 'index.html': '' })
    const first = await initCi(root)
    expect(first.created).toBe(true)
    const content = await readFile(first.file, 'utf8')
    expect(content).toContain('csspilot@latest validate')
    expect(content).toContain('csspilot@latest sync-metadata')

    const second = await initCi(root)
    expect(second.created).toBe(false)
    expect(await readFile(second.file, 'utf8')).toBe(content)
  })
})
