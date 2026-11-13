import type { FastifyInstance } from 'fastify'
import { getRun } from '@testpilot/sdk'
import { buildJunitXml } from '@testpilot/reporter'
import type { ServerContext } from '../server'
import type { RunStatus } from '../repositories/run-repo'
import { getProjectOrThrow } from '../services/project-service'
import {
  cancelRun,
  createRun,
  getRunViewOrThrow,
  listRunViews,
} from '../services/run-service'
import { createRunSchema, parseBody } from '../schemas'

export function registerRunRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.post('/api/runs', async (request, reply) => {
    const body = parseBody(createRunSchema, request.body)
    const run = await createRun(ctx.db, ctx.orchestrator, body, ctx.defaultProject)
    return reply.code(202).send(run)
  })

  app.get('/api/runs', async (request) => {
    const query = request.query as { projectId?: string; status?: RunStatus }
    const runs = await listRunViews(ctx.db, {
      projectId: query.projectId ? Number(query.projectId) : undefined,
      status: query.status,
    })
    return { runs }
  })

  app.get('/api/runs/:id', async (request) => {
    const { id } = request.params as { id: string }
    return getRunViewOrThrow(ctx.db, id)
  })

  app.post('/api/runs/:id/cancel', async (request) => {
    const { id } = request.params as { id: string }
    return cancelRun(ctx.db, ctx.orchestrator, id)
  })

  /** JUnit XML(供 Jenkins/GitLab 测试插件):按需从 result.json 生成,附件下载 */
  app.get('/api/runs/:id/junit', async (request, reply) => {
    const { id } = request.params as { id: string }
    const run = await getRunViewOrThrow(ctx.db, id)
    const project = await getProjectOrThrow(ctx.db, run.projectId)
    if (!project.rootPath) {
      throw Object.assign(new Error(`项目 ${project.name} 未配置本地根目录,无法读取运行产物`), {
        statusCode: 422,
      })
    }
    const summary = await getRun(id, { root: project.rootPath })
    return reply
      .type('application/xml')
      .header('content-disposition', `attachment; filename="junit-${id}.xml"`)
      .send(buildJunitXml(summary))
  })
}
