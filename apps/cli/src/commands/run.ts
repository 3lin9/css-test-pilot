import { join } from 'node:path'
import { Command } from 'commander'
import { TestPilotClient, type RunEvent } from '@testpilot/sdk'

export function makeRunCommand(): Command {
  return new Command('run')
    .description('执行测试用例(默认运行 testpilot.yaml 配置的 Case)')
    .argument('[paths...]', '用例文件或目录,默认按项目配置')
    .option('--tag <tag>', '按标签过滤用例')
    .action(async (paths: string[] | undefined, options: { tag?: string }) => {
      const client = new TestPilotClient()
      try {
        const { summary, invalid, tagFiltered } = await client.runCases({
          paths,
          tag: options.tag,
          onEvent: consoleEventHandler,
        })

        const notes = [
          invalid.length > 0 ? `${invalid.length} 个校验失败跳过` : '',
          tagFiltered > 0 ? `${tagFiltered} 个被 --tag 过滤` : '',
        ]
          .filter(Boolean)
          .join(',')
        console.log('')
        console.log(
          `Run ${summary.runId}${summary.cancelled ? '(已取消)' : ''}: ${summary.status.toUpperCase()} — 用例 ✓${summary.totals.passed} ✗${summary.totals.failed},步骤 ✓${summary.totals.stepsPassed} ✗${summary.totals.stepsFailed} ↷${summary.totals.stepsSkipped}${notes ? `(${notes})` : ''}`,
        )
        console.log(`产物目录:${join('.testpilot', 'artifacts', 'runs', summary.runId)}`)
        console.log('查看报告:npx csspilot report')
        if (summary.status === 'failed') process.exitCode = 1
      } catch (err) {
        console.error(err instanceof Error ? err.message : err)
        process.exitCode = 1
      }
    })
}

function consoleEventHandler(event: RunEvent): void {
  switch (event.type) {
    case 'run-started':
      console.log(`运行 ${event.totalCases} 个用例\n`)
      break
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
