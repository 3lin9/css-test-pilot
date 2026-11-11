import { Command } from 'commander'
import { collectNativeCases, isYamlCasePath, resolveRoot } from '@testpilot/sdk'
import { lintNativeCases } from './native-lint'
import { failMark, okMark, paint } from '../lib/ui'

export function makeValidateCommand(): Command {
  return new Command('validate')
    .description('校验用例:原生脚本 lint(evidence 头注释 / reviews 清单出处 / env 引用)')
    .argument('[paths...]', '脚本文件或目录,默认收集 tests/e2e/{web,miniapp,api}')
    .action(async (paths: string[] | undefined) => {
      const requested = paths ?? []
      const yamlRequested = requested.filter((file) => isYamlCasePath(file))
      if (yamlRequested.length > 0) {
        console.error(`YAML 用例链路已退役(${yamlRequested.join(', ')}),不再校验。`)
        console.error('请按 skills/testpilot/rules/native.md 迁移为原生脚本后重试。')
        process.exitCode = 1
        return
      }

      const root = resolveRoot()
      const targets =
        requested.length > 0 ? requested : await collectNativeCases([], { root }).catch(() => [])
      if (targets.length === 0) {
        console.error(`未找到原生用例(查找:${requested.join(', ') || 'tests/e2e/web、miniapp、api'})`)
        console.error('提示:先运行 npx csspilot init 接入 csspilot')
        process.exitCode = 1
        return
      }

      const report = await lintNativeCases(targets, { root })
      for (const item of report.files) {
        if (item.issues.length === 0) {
          console.log(`${okMark()} ${item.file}`)
        } else {
          console.log(`${failMark()} ${item.file}`)
          for (const issue of item.issues) {
            console.log(paint(`    - ${issue}`, 'dim'))
          }
        }
      }
      console.log('')
      const passed = report.files.filter((item) => item.issues.length === 0).length
      const summaryText = `${passed}/${report.files.length} 个原生脚本通过 lint`
      console.log(passed === report.files.length ? paint(summaryText, 'green') : paint(summaryText, 'yellow'))
      if (report.issueCount > 0) process.exitCode = 1
    })
}
