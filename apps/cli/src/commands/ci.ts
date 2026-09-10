import { Command } from 'commander'
import { initCi } from './init/ci-initializer'

export function makeCiCommand(): Command {
  const ci = new Command('ci').description('CI 集成(生成模板,不修改已有 CI)')
  ci
    .command('init')
    .description('生成 .github/workflows/testpilot.yml(validate + sync-metadata;已有则跳过)')
    .action(async () => {
      const result = await initCi(process.cwd())
      if (result.created) {
        console.log(`✓ CI 工作流已生成   ${result.file}`)
        console.log('  Git Push 后自动执行 csspilot validate 与 sync-metadata(需配置 TESTPILOT_SERVER_URL Secret)')
      } else {
        console.log(`✓ CI 工作流已存在   ${result.file}(跳过)`)
      }
    })
  return ci
}
