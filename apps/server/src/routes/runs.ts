import type { FastifyInstance } from 'fastify'
import type { ServerContext } from '../server'
import type { RunStatus } from '../repositories/run-repo'
import {
  cancelRun,
  createRun,
  getRunViewOrThrow,
  listRunViews,
  type CreateRunInput,
} from '../services/run-service'

export function registerRunRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.post('/api/runs', async (request, reply) => {
    const body = (request.body ?? {}) as CreateRunInput
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
}
