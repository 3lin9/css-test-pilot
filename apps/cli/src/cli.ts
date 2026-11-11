import { Command } from 'commander'
import { makeCiCommand } from './commands/ci'
import { makeDoctorCommand } from './commands/doctor'
import { makeInitCommand } from './commands/init'
import { makeReportCommand } from './commands/report'
import { makeRunCommand } from './commands/run'
import { makeSyncMetadataCommand } from './commands/sync-metadata'
import { makeUpdateCommand } from './commands/update'
import { makeValidateCommand } from './commands/validate'

// CLI 版本(发布时与 apps/cli/package.json、skills/testpilot/manifest.yaml 三处同步更新)
export const CLI_VERSION = '0.9.6'

export async function createCli(): Promise<Command> {
  const program = new Command()

  program
    .name('csspilot')
    .description('csspilot — AI Native 跨端业务测试基础设施 CLI')
    .version(CLI_VERSION, '-v, --version', 'output the current version')
    // 兼容旧习惯的 -V 大写别名(Commander 的 version 旗标最多注册两个短旗标)
    .option('-V', 'output the current version', () => {
      console.log(CLI_VERSION)
      process.exit(0)
    })
    .addCommand(makeInitCommand())
    .addCommand(makeValidateCommand())
    .addCommand(makeRunCommand())
    .addCommand(makeReportCommand())
    .addCommand(makeSyncMetadataCommand())
    .addCommand(makeDoctorCommand())
    .addCommand(makeUpdateCommand())
    .addCommand(makeCiCommand())

  program.addHelpText(
    'after',
    `
Examples:
  $ npx csspilot init                  接入项目(配置 + 测试目录 + Skill,幂等)
  $ npx csspilot doctor                环境健康检查(Node / 配置 / 用例 / Skill / Server)
  $ npx csspilot run                   跑全部原生用例(web / miniapp / api)
  $ npx csspilot run tests/e2e/web     只跑某一端
  $ npx csspilot report --open         生成最近一次报告并在浏览器打开
  $ npx csspilot report --trace        用 Playwright trace viewer 回放最近失败用例
  $ npx csspilot validate              用例 lint(evidence 头注释 / env 引用)
  $ npx csspilot update                升级项目里的 Skill 与观测 fixture`,
  )

  return program
}
