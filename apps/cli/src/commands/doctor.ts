import { Command } from 'commander'
import { printDoctor, runDoctor } from './init/doctor'

export function makeDoctorCommand(): Command {
  return new Command('doctor')
    .description('csspilot 健康检查(Runtime / 项目 / 用例 / Skill / Adapter / 环境变量 / Server)')
    .addHelpText(
      'after',
      `
检查范围:Node 版本、Git、testpilot.yaml、.testpilot/project.json、原生脚本与各端 runner 依赖、
Skill 安装与版本、Miniapp IDE(登录/appid)、环境变量引用、Server 连通性。
退出码:0 无 error;1 存在 error(warning 不影响退出码)。

Examples:
  $ npx csspilot doctor           init 之后、run 之前先体检一次`,
    )
    .action(async () => {
      const report = await runDoctor(process.cwd())
      printDoctor(report)
      if (report.errors > 0) process.exitCode = 1
    })
}
