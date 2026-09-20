import type { FastifyInstance } from 'fastify'
import type { ServerContext } from '../server'
import {
  createProject,
  getProjectOrThrow,
  listProjectsWithCounts,
  openLocalProject,
} from '../services/project-service'
import { getSyncStatus } from '../services/metadata-sync-service'
import { pickFolderNative } from '../services/fs-browse'

export function registerProjectRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get('/api/projects', async () => {
    return { projects: await listProjectsWithCounts(ctx.db) }
  })

  /** 弹出操作系统自带选文件夹对话框(与 Server 同机桌面会话) */
  app.post('/api/fs/pick-folder', async () => {
    return pickFolderNative({ title: '选择业务项目根目录' })
  })

  /** 打开本地目录并登记为可写项目(幂等) */
  app.post('/api/projects/open', async (request, reply) => {
    const body = (request.body ?? {}) as { rootPath?: string }
    const project = await openLocalProject(ctx.db, body.rootPath ?? '')
    return reply.code(200).send(project)
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
