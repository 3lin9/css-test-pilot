import { exec } from 'node:child_process'
import { Command } from 'commander'
import { TestPilotClient } from '@testpilot/sdk'

export function makeReportCommand(): Command {
  return new Command('report')
    .description('生成测试报告(JSON + HTML)')
    .option('--run <id>', '运行记录 ID,默认最近一次')
    .option('--open', '生成后在浏览器打开', false)
    .option('--summary', '生成跨 run 汇总报告(summary.html + summary.json)', false)
    .option('--last <n>', '汇总统计窗口:最近 N 次运行', '30')
    .action(async (options: { run?: string; open?: boolean; summary?: boolean; last?: string }) => {
      const client = new TestPilotClient()
      try {
        if (options.summary) {
          const result = await client.generateSummaryReport({
            last: Number(options.last) > 0 ? Number(options.last) : undefined,
          })
          console.log(
            `✓ summary.html  ${result.html}(统计最近 ${result.window.runs} 次运行,整体通过率 ${(result.data.kpis.overallRate * 100).toFixed(1)}%)`,
          )
          console.log(`✓ summary.json  ${result.json}`)
          if (options.open) await openInBrowser(result.html)
          return
        }

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
