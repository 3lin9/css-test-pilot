import { join } from 'node:path'
import { Command } from 'commander'
import { exitCodeForRunStatus, RUNS_DIR, SHOTS_DIR } from '@testpilot/core'
import { collectNativeCases, isYamlCasePath, loadProjectConfig, resolveRoot, runNativeCases } from '@testpilot/sdk'
import { failMark, infoMark, okMark, paint, startSpinner } from '../lib/ui'
import { lintNativeCases, type NativeLintReport } from './native-lint'
import { resolveRunEnvironment } from './run-environment'

const STATUS_PAINT: Record<string, (text: string) => string> = {
  passed: (text) => paint(text, 'green'),
  failed: (text) => paint(text, 'red'),
  blocked: (text) => paint(text, 'yellow'),
  inconclusive: (text) => paint(text, 'yellow'),
  skipped: (text) => paint(text, 'gray'),
}

/**
 * 启动框架前的轻量预检,与 `csspilot validate` 同一道 lint:
 * 文件头测试点、视角枚举、reviews 清单出处、process.env 已声明。
 * 没有可执行脚本时不报 lint 问题,交给后续 run 提示「未找到」。
 */
export async function preflightNativeRun(
  paths: readonly string[] = [],
  options: { root?: string } = {},
): Promise<NativeLintReport> {
  const root = resolveRoot(options.root)
  const targets = await collectNativeCases(paths, { root }).catch(() => [])
  if (targets.length === 0) return { files: [], issueCount: 0 }
  return lintNativeCases(targets, { root })
}

export function makeRunCommand(): Command {
  return new Command('run')
    .description('执行各端原生测试脚本(启动前做与 validate 相同的轻量预检)')
    .argument('[paths...]', '脚本文件或目录,默认收集 tests/e2e/{web,miniapp,api}')
    .option('--grep <pattern>', '按测试名过滤(web=playwright --grep;miniapp/api=node --test --test-name-pattern)')
    .option('--env <name>', '选择 testpilot.yaml 中的运行环境(默认 environment.default)')
    .action(async (paths: string[] | undefined, options: { grep?: string; env?: string }) => {
      const requested = paths ?? []
      const yamlRequested = requested.filter((file) => isYamlCasePath(file))
      if (yamlRequested.length > 0) {
        console.error(`YAML 用例链路已退役(${yamlRequested.join(', ')})。`)
        console.error('请按 skills/testpilot/rules/native.md 迁移为各端原生脚本;新用例一律写原生脚本。')
        process.exitCode = 1
        return
      }

      const preflight = await preflightNativeRun(requested)
      if (preflight.issueCount > 0) {
        for (const item of preflight.files) {
          if (item.issues.length === 0) continue
          console.error(`${failMark()} ${item.file}`)
          for (const issue of item.issues) console.error(paint(`    - ${issue}`, 'dim'))
        }
        console.error('预检未通过,未启动测试框架。请先修正后执行 npx csspilot validate。')
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
        const environment = resolveRunEnvironment(await loadProjectConfig(), options.env)
        if (environment) console.log(`执行环境:${environment.name}`)
        const result = await runNativeCases({
          paths: requested,
          grep: options.grep,
          extraEnv: environment?.extraEnv,
          ingest: true,
          signal: controller.signal,
        })
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
          console.log(`产物目录:${join(RUNS_DIR, result.runId ?? '')}`)
          console.log(`截图目录:${join(SHOTS_DIR, result.runId ?? '')}`)
          console.log('查看报告:npx csspilot report')
          if (result.summary.status === 'failed' || result.summary.status === 'inconclusive') {
            console.log(`${infoMark()} 失败用例已保留 trace,回放:npx csspilot report --trace`)
          }
        } else {
          console.log(`原生脚本 ${result.files.length} 个:${result.status.toUpperCase()}`)
        }
        process.exitCode = exitCodeForRunStatus(
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
