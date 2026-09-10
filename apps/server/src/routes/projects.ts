import type { FastifyInstance } from 'fastify'
import type { ServerContext } from '../server'
import {
  createProject,
  getProjectOrThrow,
  listProjectsWithCounts,
} from '../services/project-service'
import { getSyncStatus } from '../services/metadata-sync-service'

export function registerProjectRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get('/api/projects', async () => {
    return { projects: await listProjectsWithCounts(ctx.db) }
  })

  /** 注册项目(init / API 创建);可只登记 Git 信息而不提供本地根目录 */
  app.post('/api/projects', async (request, reply) => {
    const body = (request.body ?? {}) as {
      name?: string
      rootPath?: string
      repositoryUrl?: string
      defaultBranch?: string
    }
    const project = await createProject(ctx.db, {
      name: body.name ?? '',
      rootPath: body.rootPath,
      repositoryUrl: body.repositoryUrl,
      defaultBranch: body.defaultBranch,
    })
    return reply.code(201).send(project)
  })

  app.get('/api/projects/:id', async (request) => {
    const { id } = request.params as { id: string }
    return getProjectOrThrow(ctx.db, Number(id))
  })

  /** 项目 Git 同步状态:Web 项目概览展示(分支 / 最近同步 commit / Case 数) */
  app.get('/api/projects/:id/sync-status', async (request) => {
    const { id } = request.params as { id: string }
    return getSyncStatus(ctx.db, Number(id))
  })
}
