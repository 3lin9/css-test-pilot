import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(packageRoot, '..', '..')
const dist = join(packageRoot, 'dist')

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  // 运行时重依赖保持外部(由 dependencies 安装),内部 @testpilot/* 全部打入
  external: ['playwright', 'miniprogram-automator'],
  // ESM 产物中 CJS 依赖动态 require 内置模块需要真实 require(esbuild 默认 stub 会抛错)
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
}

// CLI 可执行入口(bin)
await build({
  ...common,
  entryPoints: [join(packageRoot, 'src/bin.ts')],
  outfile: join(dist, 'bin.js'),
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
})

// 库入口(供程序化调用 createCli)
await build({
  ...common,
  entryPoints: [join(packageRoot, 'src/index.ts')],
  outfile: join(dist, 'index.js'),
})

// Skill 随包分发:init 在打包形态下从 dist/skills/testpilot 安装到业务项目
cpSync(join(repoRoot, 'skills', 'testpilot'), join(dist, 'skills', 'testpilot'), { recursive: true })

console.log('build done ->', dist)
