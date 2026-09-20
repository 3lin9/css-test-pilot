import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify'
import fastifyStatic from '@fastify/static'
import { resolveRoot } from '@testpilot/sdk'
import type { AdapterFactory } from '@testpilot/adapter-core'
import { openDatabase, type Db } from './db'
import { AgentOrchestrator } from './orchestrator/agent-orchestrator'
import { RunOrchestrator } from './orchestrator/run-orchestrator'
import { registerAgentRoutes } from './routes/agent'
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
  agentOrchestrator: AgentOrchestrator
  /** 默认项目(服务启动时按根目录注册) */
  defaultProject: ProjectRow
}

export interface BuildServerOptions {
  /** 业务项目根目录,默认 TESTPILOT_PROJECT_ROOT 或 process.cwd() */
  root?: string
  dbPath?: string
  /** 注入自定义 adapter(测试);缺省用 SDK 默认组合 */
  adapters?: readonly AdapterFactory[]
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
  const orchestrator = new RunOrchestrator(db, { adapters: options.adapters })
  const agentOrchestrator = new AgentOrchestrator(db)

  const app = Fastify({ logger: options.logger ?? false })

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

  // 服务层抛出的 statusCode 优先;其余一律 500
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply: FastifyReply) => {
    const statusCode = error.statusCode ?? 500
    if (statusCode >= 500) app.log.error(error)
    void reply.code(statusCode).send({ error: error.message })
  })

  const ctx: ServerContext = { db, orchestrator, agentOrchestrator, defaultProject }
  registerHealthRoutes(app, ctx)
  registerProjectRoutes(app, ctx)
  registerCaseRoutes(app, ctx)
  registerRunRoutes(app, ctx)
  registerAgentRoutes(app, ctx)
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
      await Promise.all([orchestrator.waitAll(), agentOrchestrator.waitAll()])
      await app.close()
    },
  }
}
