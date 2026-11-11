import { build } from 'esbuild'
import { cpSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(packageRoot, '..', '..')
const dist = join(packageRoot, 'dist')

rmSync(dist, { recursive: true, force: true })

// 内部 @testpilot/* 以源码形式打入;原生模块与重依赖保持外部
await build({
  entryPoints: [join(packageRoot, 'src/main.ts')],
  outfile: join(dist, 'server.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  external: [
    'better-sqlite3',
    'drizzle-orm',
    'fastify',
    'playwright',
    'miniprogram-automator',
  ],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
})

// native 包的截图钩子是独立 .mjs(node --import 运行时加载,不能打入 bundle);
// shotHookPath() 按 import.meta.url 定位到 dist/,必须复制到产物旁
for (const hook of ['shot-hook.mjs', 'shot-loader.mjs', 'shot-name.mjs']) {
  cpSync(join(repoRoot, 'packages', 'native', 'src', hook), join(dist, hook))
}

console.log('build done ->', dist)
