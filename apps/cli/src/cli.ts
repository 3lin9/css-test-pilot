import { Command } from 'commander'
import { makeDoctorCommand } from './commands/doctor'
import { makeInitCommand } from './commands/init'
import { makeListCommand } from './commands/list'
import { makeReportCommand } from './commands/report'
import { makeRunCommand } from './commands/run'
import { makeSyncMetadataCommand } from './commands/sync-metadata'
import { makeValidateCommand } from './commands/validate'

export async function createCli(): Promise<Command> {
  const program = new Command()

  program
    .name('csspilot')
    .description('TestPilot — AI Native 跨端业务测试基础设施')
    .version('0.1.1')
    .addCommand(makeInitCommand())
    .addCommand(makeValidateCommand())
    .addCommand(makeListCommand())
    .addCommand(makeRunCommand())
    .addCommand(makeReportCommand())
    .addCommand(makeSyncMetadataCommand())
    .addCommand(makeDoctorCommand())

  return program
}
