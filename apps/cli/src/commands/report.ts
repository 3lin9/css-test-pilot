import { exec } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Command } from 'commander'
import { RESULT_FILE, RUNS_DIR, type RunSummary } from '@testpilot/core'
import { writeReports } from '@testpilot/reporter'

export function makeReportCommand(): Command {
  return new Command('report')
    .description('生成测试报告(JSON + HTML)')
    .option('--run <id>', '运行记录 ID,默认最近一次')
    .option('--open', '生成后在浏览器打开', false)
    .action(async (options: { run?: string; open?: boolean }) => {
      const runId = options.run ?? (await latestRunId())
      if (!runId) {
        console.error(`未找到运行记录(${RUNS_DIR} 为空,先运行 npx testpilot run)`)
        process.exitCode = 1
        return
      }

      const runDir = join(RUNS_DIR, runId)
      let summary: RunSummary
      try {
        summary = JSON.parse(await readFile(join(runDir, RESULT_FILE), 'utf8')) as RunSummary
      } catch {
        console.error(`读取运行结果失败:${join(runDir, RESULT_FILE)}`)
        process.exitCode = 1
        return
      }

      const written = await writeReports(runDir, summary)
      console.log(`✓ report.json  ${written.json}`)
      console.log(`✓ report.html  ${written.html}`)
      if (options.open) await openInBrowser(written.html)
    })
}

async function latestRunId(): Promise<string | undefined> {
  const entries = await readdir(RUNS_DIR).catch(() => [] as string[])
  return entries.sort().at(-1)
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
