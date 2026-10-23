import { Command } from 'commander'
import { TestPilotClient } from '@testpilot/sdk'

export function makeDiscoverCommand(): Command {
  return new Command('discover')
    .description('只读观察真实界面并 probe 当前可达页面的 locator')
    .argument('[paths...]', '用例文件或目录,默认按项目配置')
    .option('--target <target>', '意图发现模式:web 或 miniapp')
    .option('--url <url>', '意图发现模式:页面 URL/小程序路由')
    .option('--intent <intent>', '意图发现模式:要定位的元素描述')
    .action(async (
      paths: string[] | undefined,
      options: { target?: string; url?: string; intent?: string },
    ) => {
      const client = new TestPilotClient()
      try {
        if (options.intent || options.target || options.url) {
          if (
            (options.target !== 'web' && options.target !== 'miniapp') ||
            !options.url ||
            !options.intent
          ) {
            throw new Error('意图发现必须同时提供 --target web|miniapp、--url 与 --intent')
          }
          const resolved = await client.discoverIntent({
            target: options.target,
            url: options.url,
            intent: options.intent,
          })
          console.log(
            `✓ ${resolved.source === 'cache' ? '缓存 probe 通过' : '重新观察并验证'}:${JSON.stringify(resolved.candidate.locator)}`,
          )
          if (resolved.invalidatedCache) console.log('旧缓存已失效并替换')
          return
        }
        const result = await client.discoverCases({ paths })
        let failed = 0
        let deferred = 0
        for (const item of result.cases) {
          console.log(`▶ ${item.caseId}`)
          for (const probe of item.probes) {
            const label = `${probe.phase}[${probe.index}] ${probe.target}`
            if (probe.skippedReason) {
              deferred++
              console.log(`  ↷ ${label} — ${probe.skippedReason}`)
            } else if (probe.error || !probe.result?.actionable) {
              failed++
              console.log(`  ✗ ${label} — ${probe.error ?? probe.result?.reason ?? 'probe 未通过'}`)
            } else {
              console.log(`  ✓ ${label} — 唯一、可见、可操作`)
            }
          }
        }
        console.log(`观察产物:${result.artifactDir}`)
        console.log(`probe 失败 ${failed}，待 Rehearse 验证 ${deferred}`)
        if (failed > 0) process.exitCode = 1
      } catch (err) {
        console.error(err instanceof Error ? err.message : err)
        process.exitCode = 1
      }
    })
}
