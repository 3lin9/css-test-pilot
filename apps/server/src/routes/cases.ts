import type { FastifyInstance } from 'fastify'
import type { ServerContext } from '../server'
import {
  getCaseViewByCaseId,
  getCaseViewById,
  listCaseViews,
  readCaseSource,
} from '../services/case-service'

export function registerCaseRoutes(app: FastifyInstance, ctx: ServerContext): void {
  // 项目维度 Case Index(Server 只存 metadata,Source of Truth 始终在 Git)
  app.get('/api/projects/:projectId/cases', async (request) => {
    const { projectId } = request.params as { projectId: string }
    const query = request.query as { status?: string }
    return {
      cases: await listCaseViews(ctx.db, Number(projectId), {
        status: query.status === 'deleted' || query.status === 'active'
          ? query.status
          : undefined,
      }),
    }
  })

  app.get('/api/projects/:projectId/cases/:caseId', async (request) => {
    const { projectId, caseId } = request.params as { projectId: string; caseId: string }
    if (/^\d+$/.test(caseId)) {
      const byRowId = await getCaseViewById(ctx.db, Number(caseId))
      if (byRowId.projectId !== Number(projectId)) {
        throw Object.assign(new Error(`Case 不存在:${caseId}`), { statusCode: 404 })
      }
      return byRowId
    }
    return getCaseViewByCaseId(ctx.db, Number(projectId), caseId)
  })

  /** 读取 Case DSL 原文(仅本地项目;Web 只读,不修改 Case 源文件) */
  app.get('/api/projects/:projectId/cases/:caseId/source', async (request) => {
    const { projectId, caseId } = request.params as { projectId: string; caseId: string }
    const view = await getCaseViewByCaseId(ctx.db, Number(projectId), caseId)
    return readCaseSource(ctx.db, view.id)
  })

  // 本地开发便捷入口:默认项目(启动时注册的本地项目)
  app.get('/api/cases', async () => {
    return {
      cases: await listCaseViews(ctx.db, ctx.defaultProject.id),
    }
  })

  app.get('/api/cases/:id', async (request) => {
    const { id } = request.params as { id: string }
    return readCaseSource(ctx.db, Number(id))
  })
}
