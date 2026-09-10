import { createCli } from './cli'

// CLI 可执行入口:发布后由 bin 字段指向本文件的打包产物
void createCli().then((program) => program.parseAsync(process.argv))
