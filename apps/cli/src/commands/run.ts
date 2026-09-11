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
        const { summary, invalid, tagFiltered, missingAccounts } = await client.runCases({
          paths,
          tag: options.tag,
          accounts: collectAccountEnv(),
          onEvent: consoleEventHandler,
        })

        if (missingAccounts.length > 0) {
          console.log(
            `⚠ 缺少账号凭据:${missingAccounts.join(', ')}(本地用环境变量 TESTPILOT_ACCOUNT_<REF大写下划线> 提供;Server 触发时按环境凭据解析)`,
          )
        }

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

/**
 * 本地账号凭据注入:环境变量 TESTPILOT_ACCOUNT_<REF>(ref 的 - 转 _,大写)
 * 如 accountRef: test-user -> TESTPILOT_ACCOUNT_TEST_USER='{"username":"a","password":"b"}'
 */
function collectAccountEnv(): Record<string, string> {
  const accounts: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('TESTPILOT_ACCOUNT_') || value === undefined) continue
    const ref = key
      .slice('TESTPILOT_ACCOUNT_'.length)
      .toLowerCase()
      .replace(/_/g, '-')
    if (ref) accounts[ref] = value
  }
  return accounts
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
