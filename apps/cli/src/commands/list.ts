import { readFile } from 'node:fs/promises'
import { Command } from 'commander'
import { loadTestpilotConfig } from '@testpilot/core'
import { parseCase } from '@testpilot/dsl'
import { collectCaseFiles } from '../lib/cases'

interface CaseSummary {
  id: string
  file: string
  tags: string[]
}

export function makeListCommand(): Command {
  return new Command('list')
    .description('列出测试用例')
    .option('--tag <tag>', '按标签过滤')
    .action(async (options: { tag?: string }) => {
      const tag = options.tag
      const config = await loadTestpilotConfig().catch((err: Error) => {
        console.error(err.message)
        process.exitCode = 1
        return undefined
      })
      if (!config) return

      const files = await collectCaseFiles([config.casesDir])
      if (files.length === 0) {
        console.error(`未找到用例目录 ${config.casesDir}`)
        console.error('提示:先运行 npx testpilot init 接入 TestPilot')
        process.exitCode = 1
        return
      }

      const cases: CaseSummary[] = []
      const broken: Array<{ file: string; message: string }> = []
      for (const file of files) {
        const source = await readFile(file, 'utf8')
        const parsed = parseCase(source)
        if (parsed.ok) {
          cases.push({ id: parsed.data.id, file, tags: parsed.data.tags ?? [] })
        } else {
          broken.push({ file, message: parsed.issues[0]?.message ?? '解析失败' })
        }
      }

      const visible = tag ? cases.filter((item) => item.tags.includes(tag)) : cases

      console.log('TestPilot Cases')
      console.log('')
      for (const item of visible) {
        const tagLabel = item.tags.length > 0 ? `  [${item.tags.join(', ')}]` : ''
        console.log(`✓ ${item.id}${tagLabel}`)
        console.log(`  ${item.file}`)
        console.log('')
      }
      for (const item of broken) {
        console.log(`✗ ${item.file}`)
        console.log(`  ${item.message}`)
        console.log('')
      }

      const brokenNote = broken.length > 0 ? `,${broken.length} 个文件解析失败` : ''
      console.log(`共 ${visible.length} 个用例${tag ? `(tag: ${tag})` : ''}${brokenNote}`)
    })
}
