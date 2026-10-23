import { join } from 'node:path'
import { Command } from 'commander'
import { TestPilotClient } from '@testpilot/sdk'
import { exitCodeForSummary } from './run'

export function makeRehearseCommand(): Command {
  return new Command('rehearse')
    .description('在可重置测试环境完整彩排 Case，通过后签发 Ready Certificate')
    .argument('[paths...]', '用例文件或目录,默认按项目配置')
    .option('--tag <tag>', '按标签过滤用例')
    .action(async (paths: string[] | undefined, options: { tag?: string }) => {
      const client = new TestPilotClient()
      try {
        const result = await client.rehearseCases({
          paths,
          tag: options.tag,
          accounts: collectAccountEnv(),
        })
        console.log(
          `Rehearse ${result.summary.runId}: ${result.summary.status.toUpperCase()}，签发 ${result.readyCertificates?.length ?? 0} 张 Ready Certificate`,
        )
        console.log(`运行产物:${join('.testpilot', 'artifacts', 'runs', result.summary.runId)}`)
        if ((result.readyCertificates?.length ?? 0) > 0) {
          console.log(`证书目录:${join('.testpilot', 'ready')}`)
        }
        process.exitCode =
          result.summary.status === 'passed' && (result.readyCertificates?.length ?? 0) === 0
            ? 1
            : exitCodeForSummary(result.summary.status)
      } catch (err) {
        console.error(err instanceof Error ? err.message : err)
        process.exitCode = 1
      }
    })
}

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
