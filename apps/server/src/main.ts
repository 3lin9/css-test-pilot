import { buildServer } from './server'

const server = await buildServer({ logger: true })
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '127.0.0.1'

await server.app.listen({ port, host })
console.log(`TestPilot Control Plane API -> http://${host}:${port}`)
console.log(`project: ${server.ctx.defaultProject.name} (${server.ctx.defaultProject.rootPath})`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0))
  })
}
