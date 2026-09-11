import { Command } from 'commander'
import { makeCiCommand } from './commands/ci'
import { makeDoctorCommand } from './commands/doctor'
import { makeInitCommand } from './commands/init'
import { makeListCommand } from './commands/list'
import { makeReportCommand } from './commands/report'
import { makeRunCommand } from './commands/run'
import { makeSyncMetadataCommand } from './commands/sync-metadata'
import { makeValidateCommand } from './commands/validate'

export const CLI_VERSION = '0.3.1'

export async function createCli(): Promise<Command> {
  const program = new Command()

  program
    .name('csspilot')
    .description('TestPilot — AI Native 跨端业务测试基础设施 CLI')
    .version(CLI_VERSION)
    .addCommand(makeInitCommand())
    .addCommand(makeValidateCommand())
    .addCommand(makeListCommand())
    .addCommand(makeRunCommand())
    .addCommand(makeReportCommand())
    .addCommand(makeSyncMetadataCommand())
    .addCommand(makeDoctorCommand())
    .addCommand(makeCiCommand())

  return program
}
