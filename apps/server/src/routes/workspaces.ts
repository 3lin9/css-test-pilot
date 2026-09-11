import type { FastifyInstance } from 'fastify'
import type { ServerContext } from '../server'
import { getProjectOrThrow } from '../services/project-service'
import {
  deleteEnvironmentSecret,
  findBinding,
  getEnvironmentRow,
  getWorkspaceRow,
  insertBinding,
  insertEnvironment,
  insertWorkspace,
  listBindings,
  listEnvironments,
  listEnvironmentSecretKeys,
  listWorkspaces,
  upsertEnvironmentSecret,
} from '../repositories/workspace-repo'
/** Project Environment 与 Test Workspace 管理(V0.1 最小集) */
export function registerWorkspaceRoutes(app: FastifyInstance, ctx: ServerContext): void {
  // ---- project environments ----

  app.get('/api/projects/:projectId/environments', async (request) => {
    const { projectId } = request.params as { projectId: string }
    await getProjectOrThrow(ctx.db, Number(projectId))
    return { environments: await listEnvironments(ctx.db, Number(projectId)) }
  })

  /** 环境凭据:Case 的 accountRef 运行时按环境解析;值只写,列表只回 key */
  async function requireEnvironment(ctx: ServerContext, projectId: number, environmentId: number) {
    const environment = await getEnvironmentRow(ctx.db, environmentId)
    if (!environment || environment.projectId !== projectId) {
      throw Object.assign(new Error(`环境不存在或不属于该项目:${environmentId}`), { statusCode: 404 })
    }
    return environment
  }

  app.get('/api/projects/:projectId/environments/:environmentId/secrets', async (request) => {
    const { projectId, environmentId } = request.params as Record<string, string>
    await getProjectOrThrow(ctx.db, Number(projectId))
    await requireEnvironment(ctx, Number(projectId), Number(environmentId))
    return { secrets: await listEnvironmentSecretKeys(ctx.db, Number(environmentId)) }
  })

  app.post('/api/projects/:projectId/environments/:environmentId/secrets', async (request, reply) => {
    const { projectId, environmentId } = request.params as Record<string, string>
    await getProjectOrThrow(ctx.db, Number(projectId))
    await requireEnvironment(ctx, Number(projectId), Number(environmentId))
    const body = (request.body ?? {}) as { key?: string; value?: string }
    if (!body.key || !body.value) {
      return reply.code(400).send({ error: '需要提供 key(对应 Case 的 accountRef)与 value(凭据,推荐 JSON)' })
    }
    const secret = await upsertEnvironmentSecret(ctx.db, {
      environmentId: Number(environmentId),
      secretKey: body.key,
      secretValue: body.value,
    })
    // 值不回显
    return reply.code(201).send({ secretKey: secret.secretKey, updatedAt: secret.updatedAt })
  })

  app.delete('/api/projects/:projectId/environments/:environmentId/secrets/:key', async (request, reply) => {
    const { projectId, environmentId, key } = request.params as Record<string, string>
    await getProjectOrThrow(ctx.db, Number(projectId))
    await requireEnvironment(ctx, Number(projectId), Number(environmentId))
    await deleteEnvironmentSecret(ctx.db, Number(environmentId), key)
    return reply.code(204).send()
  })

  app.post('/api/projects/:projectId/environments', async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    await getProjectOrThrow(ctx.db, Number(projectId))
    const body = (request.body ?? {}) as { name?: string; branch?: string; baseUrl?: string }
    if (!body.name) {
      return reply.code(400).send({ error: '环境名称不能为空' })
    }
    const environment = await insertEnvironment(ctx.db, {
      projectId: Number(projectId),
      name: body.name,
      branch: body.branch ?? null,
      baseUrl: body.baseUrl ?? null,
      createdAt: new Date().toISOString(),
    })
    return reply.code(201).send(environment)
  })

  // ---- workspaces ----

  app.get('/api/workspaces', async () => {
    // 列表直接带绑定信息,Web 卡片无需逐个请求详情
    const rows = await listWorkspaces(ctx.db)
    return {
      workspaces: await Promise.all(
        rows.map(async (workspace) => ({
          ...workspace,
          bindings: await listBindings(ctx.db, workspace.id),
        })),
      ),
    }
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
