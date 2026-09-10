import type { FastifyInstance } from 'fastify'
import type { ServerContext } from '../server'
import {
  getRunSummary,
  listRunArtifacts,
  readRunArtifact,
} from '../services/artifact-service'

/**
 * Run 产物与结果的可观测性入口:
 * Web 通过这里拿到 Step 级结果(result.json)、截图 / 日志 / Trace 等取证文件。
 * 大文件始终留在 .testpilot/artifacts/,由 Server 按需流式发送。
 */
export function registerArtifactRoutes(app: FastifyInstance, ctx: ServerContext): void {
  /** Step 级运行结果(用例 / 步骤 / 错误 / 证据路径) */
  app.get('/api/runs/:id/summary', async (request) => {
    const { id } = request.params as { id: string }
    return getRunSummary(ctx.db, id)
  })

  /** run 目录内的产物清单 */
  app.get('/api/runs/:id/artifacts', async (request) => {
    const { id } = request.params as { id: string }
    return { files: await listRunArtifacts(ctx.db, id) }
  })

  /** 单个产物文件(截图内联预览,trace / video 以附件下载) */
  app.get('/api/runs/:id/artifacts/*', async (request, reply) => {
    const { id } = request.params as { id: string }
    const filePath = (request.params as Record<string, string>)['*'] ?? ''
    const content = await readRunArtifact(ctx.db, id, filePath)
    if (content.download) {
      const name = filePath.split('/').at(-1) ?? 'artifact'
      void reply.header('content-disposition', `attachment; filename="${encodeURIComponent(name)}"`)
    }
    void reply.type(content.contentType)
    return reply.send(content.stream)
  })
}
