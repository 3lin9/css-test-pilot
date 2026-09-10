import type { FastifyInstance } from 'fastify'
import type { ServerContext } from '../server'

export function registerHealthRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get('/api/health', async () => ({
    ok: true,
    name: 'testpilot-server',
    project: {
      id: ctx.defaultProject.id,
      name: ctx.defaultProject.name,
      rootPath: ctx.defaultProject.rootPath,
    },
  }))
}
