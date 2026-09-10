import { Command } from 'commander'
import { TestPilotClient } from '@testpilot/sdk'

export function makeListCommand(): Command {
  return new Command('list')
    .description('列出测试用例')
    .option('--tag <tag>', '按标签过滤')
    .action(async (options: { tag?: string }) => {
      const client = new TestPilotClient()
      const infos = await client.listCases(undefined, options.tag).catch((err: Error) => {
        console.error(err.message)
        process.exitCode = 1
        return undefined
      })
      if (!infos) return

      if (infos.length === 0) {
        const config = await client.getConfig()
        console.error(`未找到用例目录 ${config.casesDir}`)
        console.error('提示:先运行 npx csspilot init 接入 TestPilot')
        process.exitCode = 1
        return
      }

      console.log('TestPilot Cases')
      console.log('')
      for (const item of infos) {
        if (item.valid) {
          const tags = item.case?.tags ?? []
          const tagLabel = tags.length > 0 ? `  [${tags.join(', ')}]` : ''
          console.log(`✓ ${item.case?.id}${tagLabel}`)
          console.log(`  ${item.file}`)
        } else {
          console.log(`✗ ${item.file}`)
          console.log(`  ${item.issues[0]?.message ?? '解析失败'}`)
        }
        console.log('')
      }

      const broken = infos.filter((item) => !item.valid).length
      const brokenNote = broken > 0 ? `,${broken} 个文件解析失败` : ''
      const visible = infos.length - broken
      console.log(`共 ${visible} 个用例${options.tag ? `(tag: ${options.tag})` : ''}${brokenNote}`)
    })
}
