import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Command } from 'commander'
import { playwrightAdapterFactory } from '@testpilot/adapter-playwright'
import { wechatideAdapterFactory } from '@testpilot/adapter-wechatide'
import { loadTestpilotConfig, type RunSummary } from '@testpilot/core'
import { validateCaseSource, type TestCase } from '@testpilot/dsl'
import { AdapterResolver, TestRunner, type RunEvent } from '@testpilot/execution-engine'
import { collectCaseFiles } from '../lib/cases'

export function makeRunCommand(): Command {
  return new Command('run')
    .description('执行测试用例(默认运行 testpilot.yaml 配置的 Case)')
    .argument('[paths...]', '用例文件或目录,默认按项目配置')
    .option('--tag <tag>', '按标签过滤用例')
    .action(async (paths: string[] | undefined, options: { tag?: string }) => {
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
        process.exitCode = 1
        return
      }

      const cases: Array<{ data: TestCase; file: string }> = []
      let invalid = 0
      let tagFiltered = 0
      for (const file of files) {
        const source = await readFile(file, 'utf8')
        const result = validateCaseSource(source)
        if (!result.ok || !result.data) {
          invalid++
          console.log(`✗ ${file}(校验未通过,已跳过;运行 npx testpilot validate 查看详情)`)
          continue
        }
        if (options.tag && !(result.data.tags ?? []).includes(options.tag)) {
          tagFiltered++
          continue
        }
        cases.push({ data: result.data, file })
      }

      if (cases.length === 0) {
        console.error('没有可执行的用例')
        process.exitCode = 1
        return
      }

      const resolver = new AdapterResolver()
      resolver.register(playwrightAdapterFactory({ baseUrl: config.web?.baseUrl }))
      resolver.register(
        wechatideAdapterFactory({
          projectPath: config.miniapp?.projectPath,
          cliPath: config.miniapp?.cliPath,
        }),
      )

      const runner = new TestRunner({ resolver, onEvent: consoleEventHandler })
      const notes = [
        invalid > 0 ? `${invalid} 个校验失败跳过` : '',
        tagFiltered > 0 ? `${tagFiltered} 个被 --tag 过滤` : '',
      ]
        .filter(Boolean)
        .join(',')
      console.log(`运行 ${cases.length} 个用例${notes ? `(${notes})` : ''}\n`)

      const summary: RunSummary = await runner.run(cases)

      console.log('')
      console.log(
        `Run ${summary.runId}: ${summary.status.toUpperCase()} — 用例 ✓${summary.totals.passed} ✗${summary.totals.failed},步骤 ✓${summary.totals.stepsPassed} ✗${summary.totals.stepsFailed} ↷${summary.totals.stepsSkipped}`,
      )
      console.log(`产物目录:${join('.testpilot', 'artifacts', 'runs', summary.runId)}`)
      console.log('查看报告:npx testpilot report')
      if (summary.status === 'failed') process.exitCode = 1
    })
}

function consoleEventHandler(event: RunEvent): void {
  switch (event.type) {
    case 'case-started':
      console.log(`▶ ${event.caseId} (${event.file})`)
      break
    case 'step-finished': {
      const mark = event.status === 'passed' ? '  ✓' : event.status === 'failed' ? '  ✗' : '  ↷'
      console.log(
        `${mark} ${event.target}/${event.action} ${event.durationMs}ms${event.error ? ` — ${event.error}` : ''}`,
      )
      break
    }
    default:
      break
  }
}
