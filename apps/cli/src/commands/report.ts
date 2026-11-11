import { exec, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { RUNS_DIR, type RunSummary } from '@testpilot/core'
import { generateReport, generateSummaryReport, getRun, latestRunId, resolvePlaywrightCliFor, resolveRoot } from '@testpilot/sdk'
import { infoMark, okMark, paint } from '../lib/ui'

export function makeReportCommand(): Command {
  return new Command('report')
    .description('生成测试报告(JSON + HTML)')
    .option('--run <id>', '运行记录 ID,默认最近一次')
    .option('--open', '生成后在浏览器打开', false)
    .option('--summary', '生成跨 run 汇总报告(summary.html + summary.json)', false)
    .option('--last <n>', '汇总统计窗口:最近 N 次运行', '30')
    .option('--trace [caseId]', '用 Playwright trace viewer 回放失败用例(时间线 + DOM 快照逐帧 + 网络 + 控制台);缺省取最近一次失败')
    .action(async (options: { run?: string; open?: boolean; summary?: boolean; last?: string; trace?: boolean | string }) => {
      try {
        if (options.trace !== undefined) {
          await replayTrace(options.run, typeof options.trace === 'string' ? options.trace : undefined)
          return
        }
        if (options.summary) {
          const result = await generateSummaryReport({
            last: Number(options.last) > 0 ? Number(options.last) : undefined,
          })
          console.log(
            `${okMark()} summary.html  ${result.html}(统计最近 ${result.window.runs} 次运行,整体通过率 ${(result.data.kpis.overallRate * 100).toFixed(1)}%)`,
          )
          console.log(`${okMark()} summary.json  ${result.json}`)
          if (options.open) await openInBrowser(result.html)
          return
        }

        const report = await generateReport(options.run)
        console.log(`${okMark()} report.json  ${report.json}`)
        console.log(`${okMark()} report.html  ${report.html}`)
        if (options.open) await openInBrowser(report.html)
      } catch (err) {
        console.error(err instanceof Error ? err.message : err)
        process.exitCode = 1
      }
    })
}

/**
 * `report --trace`:定位失败用例的 trace.zip 并调用 Playwright trace viewer 回放。
 * trace viewer 提供 DOM 快照逐帧回放、网络与控制台侧栏——这是 Playwright 的护城河,不自研。
 * viewer 是常驻图形进程,spawn 后立即返回,不阻塞 CLI。
 */
async function replayTrace(runIdArg: string | undefined, caseIdArg: string | undefined): Promise<void> {
  const runId = runIdArg ?? (await latestRunId())
  if (!runId) {
    console.error('未找到运行记录(先运行 npx csspilot run)')
    process.exitCode = 1
    return
  }
  const summary: RunSummary = await getRun(runId)
  const traced = summary.cases.filter((item) => typeof item.trace === 'string' && item.trace !== '')
  if (traced.length === 0) {
    console.error(`Run ${runId} 没有可回放的 trace(web 失败用例自动保留;先运行 npx csspilot run 触发失败用例)`)
    process.exitCode = 1
    return
  }
  const target =
    caseIdArg !== undefined
      ? traced.find((item) => item.caseId === caseIdArg || item.caseName === caseIdArg)
      : traced.find((item) => item.status === 'failed' || item.status === 'inconclusive') ?? traced[0]
  if (!target?.trace) {
    console.error(`Run ${runId} 中没有 ${caseIdArg} 对应的带 trace 用例;可回放的:${traced.map((item) => item.caseId).join(', ')}`)
    process.exitCode = 1
    return
  }
  const traceFile = join(resolveRoot(), RUNS_DIR, runId, target.trace)
  if (!existsSync(traceFile)) {
    console.error(`trace 文件不存在:${traceFile}`)
    process.exitCode = 1
    return
  }
  const status = paint(target.status.toUpperCase(), target.status === 'passed' ? 'green' : 'red')
  console.log(`回放 ${status} ${target.caseName}(${traceFile})`)
  console.log(`${infoMark()} trace viewer 已在新窗口打开:时间线 + DOM 快照逐帧 + 网络 + 控制台`)
  // 用 node 直启业务项目本地 cli.js:shell 包装下 trace 路径无法安全转义(空格断参、元字符注入);
  // detached + unref 让 viewer 独立常驻,CLI 即退
  let playwrightCli: string
  try {
    playwrightCli = resolvePlaywrightCliFor(resolveRoot())
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    console.error(`可手动执行:npx playwright show-trace ${traceFile}`)
    process.exitCode = 1
    return
  }
  const child = spawn(process.execPath, [playwrightCli, 'show-trace', traceFile], {
    shell: false,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  child.on('error', (err) => {
    console.error(`启动 trace viewer 失败:${err.message}`)
    console.error(`可手动执行:npx playwright show-trace ${traceFile}`)
    process.exitCode = 1
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
