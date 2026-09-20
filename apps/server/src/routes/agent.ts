import type { FastifyInstance } from 'fastify'
import type { ServerContext } from '../server'
import type { AgentJobStatus } from '../repositories/agent-job-repo'
import {
  cancelAgentJob,
  createAgentJob,
  getAgentJobEventViews,
  getAgentJobOrThrow,
  listAgentJobs,
  type CreateAgentJobInput,
} from '../services/agent-job-service'

export function registerAgentRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.post('/api/projects/:projectId/agent/jobs', async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const body = (request.body ?? {}) as Omit<CreateAgentJobInput, 'projectId'>
    const job = await createAgentJob(
      ctx.db,
      ctx.agentOrchestrator,
      { ...body, projectId: Number(projectId) },
      ctx.defaultProject,
    )
    return reply.code(202).send(job)
  })

  app.get('/api/projects/:projectId/agent/jobs', async (request) => {
    const { projectId } = request.params as { projectId: string }
    const query = request.query as { status?: AgentJobStatus }
    const jobs = await listAgentJobs(ctx.db, {
      projectId: Number(projectId),
      status: query.status,
    })
    return { jobs }
  })

  app.get('/api/agent/jobs', async (request) => {
    const query = request.query as { projectId?: string; status?: AgentJobStatus }
    const jobs = await listAgentJobs(ctx.db, {
      projectId: query.projectId ? Number(query.projectId) : undefined,
      status: query.status,
    })
    return { jobs }
  })

  app.get('/api/agent/jobs/:id', async (request) => {
    const { id } = request.params as { id: string }
    return getAgentJobOrThrow(ctx.db, id)
  })

  app.get('/api/agent/jobs/:id/events', async (request) => {
    const { id } = request.params as { id: string }
    const rows = await getAgentJobEventViews(ctx.db, id)
    return {
      events: rows.map((row) => ({
        seq: row.seq,
        type: row.type,
        ts: row.ts,
        event: JSON.parse(row.payloadJson) as unknown,
      })),
    }
  })

  app.post('/api/agent/jobs/:id/cancel', async (request) => {
    const { id } = request.params as { id: string }
    return cancelAgentJob(ctx.db, ctx.agentOrchestrator, id)
  })
}
