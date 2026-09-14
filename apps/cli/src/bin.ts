import { loadProjectEnvFile } from '@testpilot/core'
import { createCli } from './cli'

// CLI 可执行入口:发布后由 bin 字段指向本文件的打包产物。
// 先加载项目根目录的 .env(真实环境变量优先),保证所有子命令都能读到注入的变量。
loadProjectEnvFile()

void createCli().then((program) => program.parseAsync(process.argv))
