import { loadProjectEnvFile } from '@testpilot/core'
import { createCli } from './cli'

// CLI 可执行入口:发布后由 bin 字段指向本文件的打包产物。
// 先加载项目根目录的 .env.testing(真实环境变量优先),保证所有子命令都能读到注入的变量。
// 刻意不加载 .env:那是前端项目自身的环境文件(构建工具占用),与测试变量无关。
loadProjectEnvFile()

// miniprogram-automator 存在晚期 rejection 竞态:调用方已按自身超时放弃后,
// 服务端的超时错误响应才到达,SDK 对无人等待的 promise 执行 reject
// (实测 "timeout waiting for automator response")。Node 22 默认把
// unhandledRejection 当致命错误,会把整个 CLI 进程打崩、遗弃刚拉起的会话;
// 这里降级为记录日志,命令的成败仍由步骤结果决定。
process.on('unhandledRejection', (reason) => {
  const text = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
  console.error(`⚠ 未接住的 Promise 拒绝(已忽略,不影响当前命令):${text}`)
})

void createCli().then((program) => program.parseAsync(process.argv))
