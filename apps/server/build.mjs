import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const dist = join(packageRoot, 'dist')

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

console.log('build done ->', dist)
