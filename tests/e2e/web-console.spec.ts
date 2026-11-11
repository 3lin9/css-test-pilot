import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const serverBundle = join(repoRoot, 'apps', 'server', 'dist', 'server.js')
const webDistIndex = join(repoRoot, 'apps', 'web', 'dist', 'index.html')

/**
 * Web 链路 e2e:以生产形态把 Server 打包产物作为子进程启动(静态托管 apps/web/dist),
 * 浏览器加载 SPA 控制台并经 API 读到注册的本地项目。
 * 需要先 `pnpm build`(server bundle + web dist);缺产物时跳过。
 */
test('web 控制台:Server 托管 SPA,dashboard 渲染本地项目', async ({ page }) => {
  test.skip(!existsSync(serverBundle), '需要 server bundle:先 pnpm build')
  test.skip(!existsSync(webDistIndex), '需要 web 产物:先 pnpm build')

  const project = await mkdtemp(join(tmpdir(), 'testpilot-web-e2e-'))
  await mkdir(join(project, '.testpilot'), { recursive: true })
  await writeFile(join(project, 'testpilot.yaml'), 'version: 1\n\nproject:\n  name: web-console-demo\n', 'utf8')

  const port = 31800 + Math.floor(Math.random() * 1000)
  const server = spawn(
    process.execPath,
    [serverBundle],
    {
      cwd: project,
      env: {
        ...process.env,
        // main.ts 读 PORT/HOST;db 与项目根都隔离在临时目录,不碰全局 ~/.testpilot
        PORT: String(port),
        HOST: '127.0.0.1',
        TESTPILOT_PROJECT_ROOT: project,
        TESTPILOT_DB_PATH: join(project, '.testpilot', 'server.db'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const serverOutput: Buffer[] = []
  server.stdout?.on('data', (chunk: Buffer) => serverOutput.push(chunk))
  server.stderr?.on('data', (chunk: Buffer) => serverOutput.push(chunk))

  try {
    // 等控制台启动横幅:出现后再访问,避免竞态
    await expect
      .poll(() => Buffer.concat(serverOutput).toString('utf8'), { timeout: 30_000 })
      .toContain('Control Plane API')
    const baseUrl = `http://127.0.0.1:${port}`
    // 项目名 = 项目根目录名(registerProject 的命名约定)
    const projectName = basename(project)
    // Projects 页列出已注册项目:server -> API -> SPA 渲染全链路打通
    await page.goto(`${baseUrl}/projects`)
    await expect(page.getByText(projectName).first()).toBeVisible()
    // SPA 路由不落在 404(fastifyStatic + index.html 回退)
    await expect(page.locator('#app')).not.toBeEmpty()
  } finally {
    // 先等子进程完全退出再删目录:Windows 下 SQLite 文件句柄在进程存活期间锁住临时目录
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null) return resolve()
      server.once('exit', () => resolve())
      server.kill()
    })
    await rm(project, { recursive: true, force: true }).catch(() => undefined)
  }
})
