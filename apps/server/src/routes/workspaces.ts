import type { FastifyInstance } from 'fastify'
import type { ServerContext } from '../server'
import { getProjectOrThrow } from '../services/project-service'
import {
  findBinding,
  getEnvironmentRow,
  getWorkspaceRow,
  insertBinding,
  insertEnvironment,
  insertWorkspace,
  listBindings,
  listEnvironments,
  listWorkspaces,
} from '../repositories/workspace-repo'
/** Project Environment 与 Test Workspace 管理(V0.1 最小集) */
export function registerWorkspaceRoutes(app: FastifyInstance, ctx: ServerContext): void {
  // ---- project environments ----

  app.get('/api/projects/:projectId/environments', async (request) => {
    const { projectId } = request.params as { projectId: string }
    await getProjectOrThrow(ctx.db, Number(projectId))
    return { environments: await listEnvironments(ctx.db, Number(projectId)) }
  })

  app.post('/api/projects/:projectId/environments', async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    await getProjectOrThrow(ctx.db, Number(projectId))
    const body = (request.body ?? {}) as { name?: string; baseUrl?: string }
    if (!body.name) {
      return reply.code(400).send({ error: '环境名称不能为空' })
    }
    const environment = await insertEnvironment(ctx.db, {
      projectId: Number(projectId),
      name: body.name,
      baseUrl: body.baseUrl ?? null,
      createdAt: new Date().toISOString(),
    })
    return reply.code(201).send(environment)
  })

  // ---- workspaces ----

  app.get('/api/workspaces', async () => {
    return { workspaces: await listWorkspaces(ctx.db) }
  })

  app.post('/api/workspaces', async (request, reply) => {
    const body = (request.body ?? {}) as { name?: string; description?: string }
    if (!body.name) {
      return reply.code(400).send({ error: 'Workspace 名称不能为空' })
    }
    const now = new Date().toISOString()
    const workspace = await insertWorkspace(ctx.db, {
      name: body.name,
      description: body.description ?? null,
      createdAt: now,
      updatedAt: now,
    })
    return reply.code(201).send(workspace)
  })

  app.get('/api/workspaces/:id', async (request) => {
    const { id } = request.params as { id: string }
    const workspace = await requireWorkspace(ctx, Number(id))
    return { ...workspace, bindings: await listBindings(ctx.db, workspace.id) }
  })

  /** 绑定 Project Environment 到 Workspace(组合多系统测试环境) */
  app.post('/api/workspaces/:id/bindings', async (request, reply) => {
    const { id } = request.params as { id: string }
    const workspace = await requireWorkspace(ctx, Number(id))
    const body = (request.body ?? {}) as { projectId?: number; environmentId?: number }
    if (!body.projectId || !body.environmentId) {
      return reply.code(400).send({ error: '需要提供 projectId 与 environmentId' })
    }
    await getProjectOrThrow(ctx.db, body.projectId)
    const environment = await getEnvironmentRow(ctx.db, body.environmentId)
    if (!environment || environment.projectId !== body.projectId) {
      return reply.code(400).send({ error: 'environmentId 与 projectId 不匹配' })
    }
    if (await findBinding(ctx.db, workspace.id, body.projectId)) {
      return reply.code(409).send({ error: '该项目已绑定到此 Workspace' })
    }
    const binding = await insertBinding(ctx.db, {
      workspaceId: workspace.id,
      projectId: body.projectId,
      environmentId: body.environmentId,
      createdAt: new Date().toISOString(),
    })
    return reply.code(201).send(binding)
  })
}

async function requireWorkspace(ctx: ServerContext, id: number) {
  const workspace = await getWorkspaceRow(ctx.db, id)
  if (!workspace) {
    throw Object.assign(new Error(`Workspace 不存在:${id}`), { statusCode: 404 })
  }
  return workspace
}
