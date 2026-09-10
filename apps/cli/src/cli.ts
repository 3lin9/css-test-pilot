import { Command } from 'commander'
import { makeDoctorCommand } from './commands/doctor'
import { makeInitCommand } from './commands/init'
import { makeListCommand } from './commands/list'
import { makeReportCommand } from './commands/report'
import { makeRunCommand } from './commands/run'
import { makeValidateCommand } from './commands/validate'

export async function createCli(): Promise<Command> {
  const program = new Command()

  program
    .name('testpilot')
    .description('TestPilot — AI Native 跨端业务测试基础设施')
    .version('0.1.0')
    .addCommand(makeInitCommand())
    .addCommand(makeValidateCommand())
    .addCommand(makeListCommand())
    .addCommand(makeRunCommand())
    .addCommand(makeReportCommand())
    .addCommand(makeDoctorCommand())

  return program
}
