import { Command } from 'commander'
import { TestPilotClient } from '@testpilot/sdk'

export function makeValidateCommand(): Command {
  return new Command('validate')
    .description('校验用例 DSL')
    .argument('[paths...]', '用例文件或目录,默认按项目配置')
    .action(async (paths: string[] | undefined) => {
      const client = new TestPilotClient()
      const infos = await client.listCases(paths).catch((err: Error) => {
        console.error(err.message)
        process.exitCode = 1
        return undefined
      })
      if (!infos) return

      if (infos.length === 0) {
        console.error(`未找到用例文件(查找:${(paths ?? []).join(', ') || '项目配置的 casesDir'})`)
        console.error('提示:先运行 npx csspilot init 接入 TestPilot')
        process.exitCode = 1
        return
      }

      let failed = 0
      for (const item of infos) {
        if (item.valid) {
          console.log(`✓ ${item.case?.id ?? '(unknown)'}  ${item.file}`)
        } else {
          failed++
          console.log(`✗ ${item.file}`)
          for (const issue of item.issues) {
            const prefix = issue.code === 'yaml' ? '' : `${issue.path}: `
            console.log(`    - ${prefix}${issue.message}`)
          }
        }
      }

      console.log('')
      console.log(`${infos.length - failed}/${infos.length} 个用例通过校验`)
      if (failed > 0) process.exitCode = 1
    })
}
