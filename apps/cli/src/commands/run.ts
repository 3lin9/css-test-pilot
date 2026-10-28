import { join } from 'node:path'
import { Command } from 'commander'
import { isYamlCasePath, runNativeCases } from '@testpilot/sdk'

/** run 的退出码契约:0=全过/跳过,1=产品失败或证据不足,2=环境/前置阻塞(非产品回归) */
export function exitCodeForSummary(status: 'passed' | 'failed' | 'blocked' | 'skipped' | 'inconclusive'): 0 | 1 | 2 {
  if (status === 'failed' || status === 'inconclusive') return 1
  if (status === 'blocked') return 2
  return 0
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

      try {
        const result = await runNativeCases({ paths: requested, ingest: true })
        if (result.files.length === 0) {
          console.error('未找到原生用例。请写入 tests/e2e/web/*.spec.ts、tests/e2e/miniapp/*.test.ts 或 tests/e2e/api/*.test.ts。')
          process.exitCode = 1
          return
        }
        if (result.summary) {
          const totals = result.summary.totals
          console.log(
            `Run ${result.runId}: ${result.summary.status.toUpperCase()} — 用例 ✓${totals.passed} ✗${totals.failed} ⊘${totals.blocked ?? 0} ?${totals.inconclusive ?? 0} ↷${totals.skipped ?? 0}`,
          )
          console.log(`产物目录:${join('.testpilot', 'artifacts', 'runs', result.runId ?? '')}`)
          console.log('查看报告:npx csspilot report')
        } else {
          console.log(`原生脚本 ${result.files.length} 个:${result.status.toUpperCase()}`)
        }
        process.exitCode = exitCodeForSummary(
          result.summary?.status ?? (result.status === 'failed' ? 'failed' : 'passed'),
        )
      } catch (err) {
        console.error(err instanceof Error ? err.message : err)
        process.exitCode = 1
      }
    })
}
