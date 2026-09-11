import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * 发布包布局回归:esbuild 单文件产物 dist/bin.js 必须能定位 dist/skills/testpilot。
 * 回归背景:0.2.0/0.3.0 曾因相对路径按"未打包目录结构"计算,发布包 init 装不上 Skill。
 * dist 未构建时跳过(测试不依赖 build 任务)。
 */
const distBin = join(
  dirname(fileURLToPath(import.meta.url)), // <repo>/apps/cli/src/commands/init
  '..',
  '..',
  '..',
  'dist',
  'bin.js', // -> <repo>/apps/cli/dist/bin.js
)

describe.skipIf(!existsSync(distBin))('cli:init:发布包布局', () => {
  test('dist/bin.js init 能安装 .agents/skills/testpilot', () => {
    const target = mkdtempSync(join(tmpdir(), 'csspilot-pkg-'))

    const res = spawnSync('node', [distBin, 'init'], {
      cwd: target,
      encoding: 'utf8',
      env: { ...process.env, TESTPILOT_SERVER_URL: '' },
      timeout: 120_000,
    })

    expect(res.stderr).not.toContain('无法定位 TestPilot Skill 源目录')
    expect(existsSync(join(target, '.agents', 'skills', 'testpilot', 'manifest.yaml'))).toBe(true)
    expect(existsSync(join(target, '.agents', 'skills', 'testpilot', 'references', 'project.md'))).toBe(true)
    expect(res.stdout).toContain('Skill 安装')
  })
})
