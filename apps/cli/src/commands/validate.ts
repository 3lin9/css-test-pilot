import { readFile } from 'node:fs/promises'
import { Command } from 'commander'
import { loadTestpilotConfig } from '@testpilot/core'
import { validateCaseSource } from '@testpilot/dsl'
import { collectCaseFiles } from '../lib/cases'

export function makeValidateCommand(): Command {
  return new Command('validate')
    .description('校验用例 DSL')
    .argument('[paths...]', '用例文件或目录,默认按项目配置')
    .action(async (paths: string[] | undefined) => {
      const config = await loadTestpilotConfig().catch((err: Error) => {
        console.error(err.message)
        process.exitCode = 1
        return undefined
      })
      if (!config) return

      const inputs = paths && paths.length > 0 ? paths : [config.casesDir]
      const files = await collectCaseFiles(inputs)
      if (files.length === 0) {
        console.error(`未找到用例文件(查找:${inputs.join(', ')})`)
        console.error('提示:先运行 npx testpilot init 接入 TestPilot')
        process.exitCode = 1
        return
      }

      let failed = 0
      for (const file of files) {
        const source = await readFile(file, 'utf8')
        const result = validateCaseSource(source)
        if (result.ok) {
          console.log(`✓ ${result.data?.id ?? '(unknown)'}  ${file}`)
        } else {
          failed++
          console.log(`✗ ${file}`)
          for (const issue of result.issues) {
            const prefix = issue.code === 'yaml' ? '' : `${issue.path}: `
            console.log(`    - ${prefix}${issue.message}`)
          }
        }
      }

      console.log('')
      console.log(`${files.length - failed}/${files.length} 个用例通过校验`)
      if (failed > 0) process.exitCode = 1
    })
}
