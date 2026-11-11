import { join } from 'node:path'
import { Command } from 'commander'
import { isYamlCasePath, runNativeCases } from '@testpilot/sdk'
import { failMark, infoMark, okMark, paint, startSpinner } from '../lib/ui'

/** run 的退出码契约:0=全过/跳过,1=产品失败或证据不足,2=环境/前置阻塞(非产品回归) */
export function exitCodeForSummary(status: 'passed' | 'failed' | 'blocked' | 'skipped' | 'inconclusive'): 0 | 1 | 2 {
  if (status === 'failed' || status === 'inconclusive') return 1
  if (status === 'blocked') return 2
  return 0
}

const STATUS_PAINT: Record<string, (text: string) => string> = {
  passed: (text) => paint(text, 'green'),
  failed: (text) => paint(text, 'red'),
  blocked: (text) => paint(text, 'yellow'),
  inconclusive: (text) => paint(text, 'yellow'),
  skipped: (text) => paint(text, 'gray'),
}

export function makeRunCommand(): Command {
  return new Command('run')
    .description('执行各端原生测试脚本(web=playwright test;miniapp/api=node --test)')
    .argument('[paths...]', '脚本文件或目录,默认收集 tests/e2e/{web,miniapp,api}')
    .action(async (paths: string[] | undefined) => {
      const requested = paths ?? []
      const yamlRequested = requested.filter((file) => isYamlCasePath(file))
      if (yamlRequested.length > 0) {
        console.error(`YAML 用例链路已退役(${yamlRequested.join(', ')})。`)
        console.error('请按 skills/testpilot/rules/native.md 迁移为各端原生脚本;新用例一律写原生脚本。')
        process.exitCode = 1
        return
      }

      // 子进程输出进 run 目录,终端无回显;spinner 让等待可见(非 TTY 自动禁用)
      const spinner = startSpinner('csspilot run — 执行原生用例…')
      // Ctrl+C 中止:abort 信号传给执行链,整棵框架/浏览器进程树被击杀(而非仅父进程)
      const controller = new AbortController()
      const onInterrupt = () => {
        spinner.stop()
        console.error('\n收到中断,正在终止运行中的框架与浏览器进程…')
        controller.abort()
      }
      process.once('SIGINT', onInterrupt)
      // miniprogram-automator 存在晚期 rejection 竞态:调用方已按自身超时放弃后,
      // SDK 才对无人等待的 promise reject(实测 "timeout waiting for automator response")。
      // 仅在 run 期间容忍(记录不致命);其他命令冒出的 unhandledRejection 仍是 bug,按 Node 默认退出。
      const onLateRejection = (reason: unknown) => {
        const text = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
        console.error(`⚠ 运行期间未接住的 Promise 拒绝(已忽略,不影响本次结果):${text}`)
      }
      process.on('unhandledRejection', onLateRejection)
      try {
        const result = await runNativeCases({ paths: requested, ingest: true, signal: controller.signal })
        spinner.stop()
        if (result.files.length === 0) {
          console.error('未找到原生用例。请写入 tests/e2e/web/*.spec.ts、tests/e2e/miniapp/*.test.ts 或 tests/e2e/api/*.test.ts。')
          process.exitCode = 1
          return
        }
        if (result.summary) {
          const totals = result.summary.totals
          const statusText = STATUS_PAINT[result.summary.status]?.(result.summary.status.toUpperCase()) ?? result.summary.status.toUpperCase()
          console.log(
            `Run ${result.runId}: ${statusText} — 用例 ${okMark()}${totals.passed} ${failMark()}${totals.failed} ⊘${totals.blocked ?? 0} ?${totals.inconclusive ?? 0} ↷${totals.skipped ?? 0}`,
          )
          console.log(`产物目录:${join('.testpilot', 'artifacts', 'runs', result.runId ?? '')}`)
          console.log(`截图目录:${join('.testpilot', 'artifacts', 'shots', result.runId ?? '')}`)
          console.log('查看报告:npx csspilot report')
          if (result.summary.status === 'failed' || result.summary.status === 'inconclusive') {
            console.log(`${infoMark()} 失败用例已保留 trace,回放:npx csspilot report --trace`)
          }
        } else {
          console.log(`原生脚本 ${result.files.length} 个:${result.status.toUpperCase()}`)
        }
        process.exitCode = exitCodeForSummary(
          result.summary?.status ?? (result.status === 'failed' ? 'failed' : 'passed'),
        )
      } catch (err) {
        spinner.stop()
        console.error(err instanceof Error ? err.message : err)
        process.exitCode = 1
      } finally {
        process.removeListener('SIGINT', onInterrupt)
        process.removeListener('unhandledRejection', onLateRejection)
      }
    })
}
