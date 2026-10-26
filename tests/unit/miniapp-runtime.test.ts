import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectMiniappRuntime } from '@testpilot/core'
import { afterEach, describe, expect, test } from 'vitest'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function project(appid?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'testpilot-miniapp-'))
  roots.push(root)
  if (appid !== undefined) {
    await writeFile(join(root, 'project.config.json'), JSON.stringify({ appid }), 'utf8')
  }
  return root
}

describe('inspectMiniappRuntime', () => {
  test('未登录、服务端口未知、游客 appid 都会阻断', async () => {
    const root = await project('touristappid')
    const loggedOut = await inspectMiniappRuntime(
      { projectPath: root, cliPath: 'cli.bat' },
      { isLoggedIn: async () => false },
    )
    expect(loggedOut.issues.map((issue) => issue.code)).toEqual(['NOT_LOGGED_IN', 'TOURIST_APPID'])

    const portClosed = await inspectMiniappRuntime(
      { projectPath: root, cliPath: 'cli.bat' },
      { isLoggedIn: async () => undefined },
    )
    expect(portClosed.issues.map((issue) => issue.code)).toContain('SERVICE_PORT_UNCONFIRMED')

    const missingCli = await inspectMiniappRuntime(
      { projectPath: await project('wx123') },
      { findCli: async () => undefined, isLoggedIn: async () => true },
    )
    expect(missingCli.issues.map((issue) => issue.code)).toContain('CLI_NOT_FOUND')
  })

  test('已登录且 appid 真实时没有阻断项', async () => {
    const report = await inspectMiniappRuntime(
      { projectPath: await project('wx123'), cliPath: 'cli.bat' },
      { isLoggedIn: async () => true },
    )
    expect(report.issues).toEqual([])
    expect(report.loggedIn).toBe(true)
    expect(report.appid).toBe('wx123')
  })
})
