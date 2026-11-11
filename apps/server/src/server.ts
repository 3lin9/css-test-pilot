import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify'
import fastifyStatic from '@fastify/static'
import { resolveRoot, type NativeSpawn } from '@testpilot/sdk'
import { openDatabase, type Db } from './db'
import { RunOrchestrator } from './orchestrator/run-orchestrator'
import { registerArtifactRoutes } from './routes/artifacts'
import { registerCaseRoutes } from './routes/cases'
import { registerHealthRoutes } from './routes/health'
import { registerIntegrationRoutes } from './routes/integrations'
import { registerProjectRoutes } from './routes/projects'
import { registerReportRoutes } from './routes/reports'
import { registerRunRoutes } from './routes/runs'
import { registerWorkspaceRoutes } from './routes/workspaces'
import { registerProject, type ProjectRow } from './services/project-service'

export interface ServerContext {
  db: Db
  orchestrator: RunOrchestrator
  /** 默认项目(服务启动时按根目录注册) */
  defaultProject: ProjectRow
}

export interface BuildServerOptions {
  /** 业务项目根目录,默认 TESTPILOT_PROJECT_ROOT 或 process.cwd() */
  root?: string
  dbPath?: string
  /** 注入自定义 spawn(测试);缺省真实 spawn 各端框架命令 */
  spawnImpl?: NativeSpawn
  logger?: boolean
}

export interface TestPilotServer {
  app: FastifyInstance
  ctx: ServerContext
  /** 等待所有后台运行结束并关闭数据库(测试与优雅退出用) */
  close(): Promise<void>
}

/** 组装 Control Plane API;注册默认项目并挂载全部路由 */
export async function buildServer(options: BuildServerOptions = {}): Promise<TestPilotServer> {
  const root = resolveRoot(options.root ?? process.env.TESTPILOT_PROJECT_ROOT ?? undefined)
  const db = openDatabase({ root, dbPath: options.dbPath })
  const defaultProject = await registerProject(db, root)
  const orchestrator = new RunOrchestrator(db, { spawnImpl: options.spawnImpl })

  const app = Fastify({ logger: options.logger ?? false })

  // 本地 Control Plane 防护(无登录态,靠请求头约束浏览器侧攻击面):
  // - Host 必须是本机回环 -> 挡 DNS rebinding(攻击者域名解析到 127.0.0.1 时 Host 头是其域名)
  // - 带 Origin 的请求(浏览器)Origin 必须是回环 -> 挡恶意网页跨源驱动 API(CSRF)
  // - 无 Origin 的非浏览器客户端(CLI / SDK / curl)不受影响
  const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host ?? ''
    if (!LOOPBACK_HOST.test(host)) {
      return reply.code(403).send({ error: `拒绝非本机 Host 的请求:${host}` })
    }
    const origin = request.headers.origin
    if (origin) {
      try {
        const originHost = new URL(origin).host
        if (!LOOPBACK_HOST.test(originHost)) {
          return reply.code(403).send({ error: `拒绝跨源 Origin 的请求:${origin}` })
        }
      } catch {
        return reply.code(403).send({ error: `非法 Origin:${origin}` })
      }
    }
  })

  // 无 body 的动作型 POST(如弹系统选文件夹)可能带任意 content-type,一律当空 body 放行
  app.addContentTypeParser('*', (_request, payload, done) => {
    let raw = ''
    payload.on('data', (chunk: Buffer | string) => {
      raw += chunk.toString()
    })
    payload.on('end', () => {
      const text = raw.trim()
      if (!text) return done(null, undefined)
      try {
        done(null, JSON.parse(text) as unknown)
      } catch {
        done(null, text)
      }
    })
  })

  // 服务层抛出的 statusCode 优先;其余一律 500。5xx 不回显原始 message(可能含内部路径),
  // 详情只在服务端日志;4xx 的 message 面向调用方,保留
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply: FastifyReply) => {
    const statusCode = error.statusCode ?? 500
    if (statusCode >= 500) {
      app.log.error(error)
      if (!options.logger) console.error('[server] internal error:', error)
      return void reply.code(statusCode).send({ error: '服务器内部错误,详情见服务端日志' })
    }
    return void reply.code(statusCode).send({ error: error.message })
  })

  const ctx: ServerContext = { db, orchestrator, defaultProject }
  registerHealthRoutes(app, ctx)
  registerProjectRoutes(app, ctx)
  registerCaseRoutes(app, ctx)
  registerRunRoutes(app, ctx)
  registerReportRoutes(app, ctx)
  registerIntegrationRoutes(app, ctx)
  registerWorkspaceRoutes(app, ctx)
  registerArtifactRoutes(app, ctx)

  // Web 控制台(生产形态):静态托管 apps/web/dist,SPA 路由回退 index.html
  const serverFile = fileURLToPath(import.meta.url)
  const webDist = join(dirname(serverFile), '..', '..', 'web', 'dist')
  if (existsSync(join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist })
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not found' })
      }
      return reply.sendFile('index.html')
    })
  }

  return {
    app,
    ctx,
    async close() {
      await orchestrator.waitAll()
      await app.close()
    },
  }
}
