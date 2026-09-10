import { Command } from 'commander'
import { printDoctor, runDoctor } from './init/doctor'

export function makeDoctorCommand(): Command {
  return new Command('doctor')
    .description('TestPilot 健康检查(Runtime / 项目 / 用例 / Skill / Adapter / 环境变量 / Server)')
    .action(async () => {
      const report = await runDoctor(process.cwd())
      printDoctor(report)
      if (report.errors > 0) process.exitCode = 1
    })
}
