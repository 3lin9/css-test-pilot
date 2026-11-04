import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { createShotNamer } from '../../packages/native/src/shot-name.mjs'

const HOOK = new URL('../../packages/native/src/shot-hook.mjs', import.meta.url).href

test('小程序钩子:通过和失败截图,跳过不截', async () => {
  const root = await mkdtemp(join(tmpdir(), 'testpilot-shot-'))
  const pkgDir = join(root, 'node_modules', 'miniprogram-automator')
  await mkdir(pkgDir, { recursive: true })
  await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ main: 'index.cjs' }))
  await writeFile(
    join(pkgDir, 'index.cjs'),
    `const fs = require('node:fs')
function session() {
  return {
    screenshot({ path }) { fs.writeFileSync(path, 'shot') },
    async close() {},
    async disconnect() {},
  }
}
module.exports = { launch: async () => session(), connect: async () => session() }
`,
  )
  const script = join(root, 'demo.test.mjs')
  await writeFile(
    script,
    `import { test } from 'node:test'
import automator from 'miniprogram-automator'

test('通过', async () => {
  const mini = await automator.launch()
  await mini.close()
})

test('失败', async () => {
  await automator.launch()
  throw new Error('boom')
})

test.skip('跳过', async () => {
  await automator.launch()
})
`,
  )

  const shots = join(root, 'shots')
  await mkdir(shots)
  const output = await runNode(['--import', HOOK, '--test', script], root, shots)
  expect(output.code, output.stderr).toBe(1)

  const namer = createShotNamer()
  const pass = namer(script, '通过')
  const fail = namer(script, '失败')
  expect((await readdir(shots)).sort(), output.stderr).toEqual([fail, pass].sort())
})

function runNode(args: string[], cwd: string, shotsDir: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, TESTPILOT_SHOTS_DIR: shotsDir },
    })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.once('error', reject)
    child.once('exit', (code) => resolve({ code: code ?? 1, stderr }))
  })
}
