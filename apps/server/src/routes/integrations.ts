import type { FastifyInstance } from 'fastify'
import type { ServerContext } from '../server'
import { getProjectOrThrow } from '../services/project-service'
import {
  syncProjectCases,
  type CaseSyncPayload,
} from '../services/metadata-sync-service'

/**
 * Git / CI 同步入口。
 * Git Push 是 Case Metadata 进入 Server 的正式同步边界:
 * git push -> CI -> `npx csspilot sync-metadata` -> POST /api/projects/:id/cases/sync
 */
export function registerIntegrationRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.post('/api/projects/:projectId/cases/sync', async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    await getProjectOrThrow(ctx.db, Number(projectId))
    const payload = (request.body ?? {}) as CaseSyncPayload
    const result = await syncProjectCases(ctx.db, Number(projectId), payload)
    return reply.code(200).send(result)
  })
}
