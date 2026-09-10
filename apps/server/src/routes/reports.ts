import type { FastifyInstance } from 'fastify'
import type { ServerContext } from '../server'
import { getOrGenerateReport } from '../services/report-service'

export function registerReportRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get('/api/runs/:id/report', async (request) => {
    const { id } = request.params as { id: string }
    return getOrGenerateReport(ctx.db, id)
  })
}
