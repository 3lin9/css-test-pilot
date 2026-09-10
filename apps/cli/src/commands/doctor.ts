import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Command } from 'commander'
import { findWechatDevToolsCli, DEFAULT_CASES_DIR } from '@testpilot/core'
import { collectCaseFiles } from '@testpilot/sdk'

interface PlaywrightLike {
  chromium: { executablePath(): string }
}

export function makeDoctorCommand(): Command {
  return new Command('doctor')
    .description('检查本地环境(Node / Playwright / WeChat DevTools / 项目配置)')
    .action(async () => {
      let problems = 0
      const ok = (label: string) => console.log(`✓ ${label}`)
      const fail = (label: string, hint?: string) => {
        problems++
        console.log(`✗ ${label}${hint ? `(${hint})` : ''}`)
      }

      console.log('TestPilot Doctor')
      console.log('')

      // 基础环境
      const nodeMajor = Number(process.versions.node.split('.')[0])
      if (nodeMajor >= 22) ok(`Node.js ${process.versions.node}`)
      else fail(`Node.js ${process.versions.node}`, '需要 Node.js >= 22')
      ok('TestPilot CLI (0.1.0)')

      if (existsSync('testpilot.yaml')) ok('testpilot.yaml')
      else fail('testpilot.yaml', '运行 npx csspilot init 生成')

      const caseFiles = await collectCaseFiles([DEFAULT_CASES_DIR]).catch(() => [])
      if (caseFiles.length > 0) ok(`${DEFAULT_CASES_DIR} (${caseFiles.length} 个用例)`)
      else fail(DEFAULT_CASES_DIR, '未找到用例')

      if (existsSync('.agents/skills/testpilot/manifest.yaml')) ok('TestPilot Skill (.agents/skills/testpilot)')
      else fail('TestPilot Skill', '运行 npx csspilot init 安装')

      // Web
      console.log('')
      console.log('Web')
      const playwright = resolvePlaywright()
      if (!playwright) {
        fail('Playwright', 'pnpm add -D playwright 或 @playwright/test')
        fail('Chromium')
      } else {
        ok(`Playwright (${playwright.version})`)
        if (chromiumInstalled(playwright.module)) ok('Chromium')
        else fail('Chromium', 'pnpm exec playwright install chromium')
      }

      // Mini Program
      console.log('')
      console.log('Mini Program')
      const devtools = await findWechatDevToolsCli()
      if (devtools) ok(`WeChat Developer Tools (${devtools})`)
      else fail('WeChat Developer Tools', '未找到,可设置 WECHAT_DEVTOOLS_CLI 指向 cli 可执行文件')

      console.log('')
      console.log(problems === 0 ? 'Environment looks good.' : `发现 ${problems} 个问题,见上表。`)
    })
}

/** 从当前项目解析 playwright / @playwright/test,均未安装则返回 undefined */
function resolvePlaywright(): { module: PlaywrightLike; version: string } | undefined {
  const require = createRequire(join(process.cwd(), 'package.json'))
  for (const name of ['playwright', '@playwright/test'] as const) {
    try {
      const module = require(name) as PlaywrightLike
      const version = require(`${name}/package.json`).version as string
      return { module, version }
    } catch {
      continue
    }
  }
  return undefined
}

function chromiumInstalled(module: PlaywrightLike): boolean {
  try {
    const path = module.chromium.executablePath()
    return path !== '' && existsSync(path)
  } catch {
    return false
  }
}
