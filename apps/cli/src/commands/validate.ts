import { Command } from 'commander'
import { TestPilotClient } from '@testpilot/sdk'

export function makeValidateCommand(): Command {
  return new Command('validate')
    .description('校验用例 DSL')
    .argument('[paths...]', '用例文件或目录,默认按项目配置')
    .option('--runtime', '静态校验通过后启动真实环境执行只读 observe/probe')
    .action(async (paths: string[] | undefined, options: { runtime?: boolean }) => {
      const client = new TestPilotClient()
      const infos = await client.listCases(paths).catch((err: Error) => {
        console.error(err.message)
        process.exitCode = 1
        return undefined
      })
      if (!infos) return

      if (infos.length === 0) {
        console.error(`未找到用例文件(查找:${(paths ?? []).join(', ') || '项目配置的 casesDir'})`)
        console.error('提示:先运行 npx csspilot init 接入 TestPilot')
        process.exitCode = 1
        return
      }

      let failed = 0
      for (const item of infos) {
        if (item.valid) {
          console.log(`✓ ${item.case?.id ?? '(unknown)'}  ${item.file}`)
        } else {
          failed++
          console.log(`✗ ${item.file}`)
          for (const issue of item.issues) {
            const prefix = issue.code === 'yaml' ? '' : `${issue.path}: `
            console.log(`    - ${prefix}${issue.message}`)
          }
        }
      }

      console.log('')
      console.log(`${infos.length - failed}/${infos.length} 个用例通过校验`)
      if (failed > 0) {
        process.exitCode = 1
        return
      }
      if (options.runtime) {
        try {
          const discovery = await client.discoverCases({ paths })
          const probes = discovery.cases.flatMap((item) => item.probes)
          const runtimeFailed = probes.filter(
            (probe) => probe.error || probe.skippedReason || !probe.result?.actionable,
          )
          console.log(
            `运行时校验:${probes.length - runtimeFailed.length}/${probes.length} 个 locator 已在真实界面验证`,
          )
          console.log(`观察产物:${discovery.artifactDir}`)
          if (runtimeFailed.length > 0) process.exitCode = 1
        } catch (err) {
          console.error(err instanceof Error ? err.message : err)
          process.exitCode = 1
        }
      }
    })
}
