import { exec } from 'node:child_process'
import { Command } from 'commander'
import { TestPilotClient } from '@testpilot/sdk'

export function makeReportCommand(): Command {
  return new Command('report')
    .description('生成测试报告(JSON + HTML)')
    .option('--run <id>', '运行记录 ID,默认最近一次')
    .option('--open', '生成后在浏览器打开', false)
    .action(async (options: { run?: string; open?: boolean }) => {
      const client = new TestPilotClient()
      try {
        const report = await client.generateReport(options.run)
        console.log(`✓ report.json  ${report.json}`)
        console.log(`✓ report.html  ${report.html}`)
        if (options.open) await openInBrowser(report.html)
      } catch (err) {
        console.error(err instanceof Error ? err.message : err)
        process.exitCode = 1
      }
    })
}

function openInBrowser(file: string): Promise<void> {
  const command =
    process.platform === 'win32'
      ? `start "" "${file}"`
      : process.platform === 'darwin'
        ? `open "${file}"`
        : `xdg-open "${file}"`
  return new Promise((resolvePromise) => {
    exec(command, () => resolvePromise())
  })
}
