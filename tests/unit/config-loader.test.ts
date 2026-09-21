import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { loadTestpilotConfig } from '@testpilot/core'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'testpilot-cfg-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.TEST_BASE_URL
  delete process.env.MISSING_VAR_X
  delete process.env.DOTENV_TEST_BASE
  delete process.env.DOTENV_PRIORITY
  delete process.env.PPM_PROJECT_ID
})

beforeEach(() => {
  delete process.env.TEST_BASE_URL
  delete process.env.MISSING_VAR_X
  delete process.env.PPM_PROJECT_ID
})

async function writeAndLoad(yaml: string) {
  await writeFile(join(dir, 'testpilot.yaml'), yaml)
  return loadTestpilotConfig(dir)
}

describe('loadTestpilotConfig 环境变量注入', () => {
  test('environment.baseUrl 的 ${VAR} 由进程环境变量注入', async () => {
    process.env.TEST_BASE_URL = 'http://127.0.0.1:8080'
    const config = await writeAndLoad(
      'environment:\n  default: test\n  test:\n    baseUrl: ${TEST_BASE_URL}\n',
    )
    expect(config.environment?.test).toEqual({ baseUrl: 'http://127.0.0.1:8080' })
    // default 键是环境名,不做插值
    expect(config.environment?.default).toBe('test')
  })

  test('web.baseUrl 同样支持 ${VAR} 引用', async () => {
    process.env.TEST_BASE_URL = 'http://127.0.0.1:8080'
    const config = await writeAndLoad('web:\n  baseUrl: ${TEST_BASE_URL}\n')
    expect(config.web?.baseUrl).toBe('http://127.0.0.1:8080')
  })

  test('未设置的变量保持字面量(doctor / inspect 负责标记缺失)', async () => {
    const config = await writeAndLoad('web:\n  baseUrl: ${MISSING_VAR_X}/api\n')
    expect(config.web?.baseUrl).toBe('${MISSING_VAR_X}/api')
  })

  test('variables 白名单注入 Case 可见的项目变量', async () => {
    process.env.PPM_PROJECT_ID = 'ppm-100'
    const config = await writeAndLoad(
      'variables:\n  ppmProjectId: ${PPM_PROJECT_ID}\n  literalValue: fixed\n',
    )
    expect(config.variables).toEqual({
      ppmProjectId: 'ppm-100',
      literalValue: 'fixed',
    })
  })

  test('variables 中未设置的环境变量保持字面量供 requires 预检', async () => {
    const config = await writeAndLoad('variables:\n  missingValue: ${MISSING_VAR_X}\n')
    expect(config.variables).toEqual({ missingValue: '${MISSING_VAR_X}' })
  })

  test('项目根目录 .env 文件自动加载', async () => {
    await writeFile(join(dir, '.env'), 'DOTENV_TEST_BASE=http://from-dotenv\n')
    const config = await writeAndLoad('web:\n  baseUrl: ${DOTENV_TEST_BASE}\n')
    expect(config.web?.baseUrl).toBe('http://from-dotenv')
  })

  test('真实环境变量优先于 .env 文件', async () => {
    await writeFile(join(dir, '.env'), 'DOTENV_PRIORITY=from-dotenv\n')
    process.env.DOTENV_PRIORITY = 'from-real-env'
    const config = await writeAndLoad('web:\n  baseUrl: ${DOTENV_PRIORITY}\n')
    expect(config.web?.baseUrl).toBe('from-real-env')
  })
})
