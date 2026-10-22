import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Command } from 'commander'
import { ENV_TESTING_FILE } from '@testpilot/core'
import { ensureGitignoreEntry, renderDotEnvTesting } from './init/config-initializer'
import { syncSkillFiles } from './init/skill-installer'

/** 提取 env 文件中出现过的变量名(含注释掉的行,便于发现模板新增项) */
function varNames(content: string): Set<string> {
  return new Set([...content.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]!))
}

/**
 * 把项目中的 TestPilot 接入物同步到当前 CLI 版本:
 *   - Skill 主体(.agents/skills/testpilot 的 SKILL.md / manifest / rules / workflows)
 *   - .env.testing(缺失时生成模板;已存在则保留用户填写的真实值,只提示新增变量)
 *   - .gitignore 忽略 .env.testing
 * 绝不触碰用户资产:.env.testing(真实凭据)、前端项目自身的 .env、tests/e2e/cases/、.testpilot/、references/、testpilot.yaml。
 */
export function makeUpdateCommand(): Command {
  const update = new Command('update')
    .description('同步 TestPilot 接入物到当前 CLI 版本(Skill / .env.testing;不触碰 .env 与用例)')
    .option('--force', 'Skill 版本一致时也强制覆盖本地修改', false)
    .action(async (options: { force?: boolean }) => {
      const root = process.cwd()
      const dest = join('.agents', 'skills', 'testpilot')

      // 1. Skill 主体(版本一致时跳过;--force 强制)
      const skill = await syncSkillFiles(root, { force: options.force })
      switch (skill.core) {
        case 'created':
          console.log(`✓ Skill 安装       ${dest}(v${skill.bundledVersion ?? '?'})`)
          break
        case 'updated':
          console.log(
            `✓ Skill 更新       ${dest} v${skill.installedVersion ?? '?'} -> v${skill.bundledVersion ?? '?'}`,
          )
          break
        default:
          console.log(`✓ Skill 已是最新   v${skill.bundledVersion ?? '?'}`)
      }

      // 2. .env.testing:已存在绝不覆盖(用户真实值);缺失时生成,并提示模板新增变量
      const envPath = join(root, ENV_TESTING_FILE)
      const template = renderDotEnvTesting()
      const existing = await readFile(envPath, 'utf8').catch(() => undefined)
      if (existing === undefined) {
        await writeFile(envPath, template, 'utf8')
        console.log(`✓ ${ENV_TESTING_FILE}  已生成(直接填入真实值,CLI 自动加载)`)
      } else {
        console.log(`✓ ${ENV_TESTING_FILE}  已存在,保留用户内容`)
        const missing = [...varNames(template)].filter((name) => !varNames(existing).has(name))
        if (missing.length > 0) {
          console.log(`  提示:当前版本模板新增变量,可按需补入:${missing.join(', ')}`)
        }
      }

      // 3. .gitignore 忽略 .env.testing(旧版本写入的 .env 条目保留,前端项目本就应忽略 .env)
      const gitignore = await ensureGitignoreEntry(root, ENV_TESTING_FILE)
      await ensureGitignoreEntry(root, '.env')
      console.log(
        gitignore === 'exists'
          ? `✓ .gitignore       已忽略 ${ENV_TESTING_FILE}`
          : `✓ .gitignore       已追加忽略 ${ENV_TESTING_FILE}`,
      )

      console.log('提示:提交 .agents/skills/ 的变更,团队与 AI 即可使用最新能力')
    })

  return update
}
