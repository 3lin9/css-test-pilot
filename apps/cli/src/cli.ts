import { Command } from 'commander'
import { makeCiCommand } from './commands/ci'
import { makeDoctorCommand } from './commands/doctor'
import { makeInitCommand } from './commands/init'
import { makeListCommand } from './commands/list'
import { makeReportCommand } from './commands/report'
import { makeRunCommand } from './commands/run'
import { makeSyncMetadataCommand } from './commands/sync-metadata'
import { makeUpdateCommand } from './commands/update'
import { makeValidateCommand } from './commands/validate'

export const CLI_VERSION = '0.6.0'

export async function createCli(): Promise<Command> {
  const program = new Command()

  program
    .name('csspilot')
    .description('TestPilot — AI Native 跨端业务测试基础设施 CLI')
    .version(CLI_VERSION, '-v, --version', 'output the current version')
    // 兼容旧习惯的 -V 大写别名(Commander 的 version 旗标最多注册两个短旗标)
    .option('-V', 'output the current version', () => {
      console.log(CLI_VERSION)
      process.exit(0)
    })
    .addCommand(makeInitCommand())
    .addCommand(makeValidateCommand())
    .addCommand(makeListCommand())
    .addCommand(makeRunCommand())
    .addCommand(makeReportCommand())
    .addCommand(makeSyncMetadataCommand())
    .addCommand(makeDoctorCommand())
    .addCommand(makeUpdateCommand())
    .addCommand(makeCiCommand())

  return program
}
