import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Command } from 'commander'
import { ensureGitignoreEntry, renderDotEnvExample } from './init/config-initializer'
import { syncSkillFiles } from './init/skill-installer'

/**
 * 把项目中的 TestPilot 接入物同步到当前 CLI 版本:
 *   - Skill 主体(.agents/skills/testpilot 的 SKILL.md / manifest / rules / workflows)
 *   - .env.example(工具拥有的示例文件)
 *   - .gitignore 忽略 .env
 * 绝不触碰用户资产:.env(真实凭据)、tests/e2e/cases/、.testpilot/、references/、testpilot.yaml。
 */
export function makeUpdateCommand(): Command {
  const update = new Command('update')
    .description('同步 TestPilot 接入物到当前 CLI 版本(Skill / .env.example;不触碰 .env 与用例)')
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

      // 2. .env.example(工具拥有的示例文件;真正的 .env 是用户资产,绝不覆盖)
      await writeFile(join(root, '.env.example'), renderDotEnvExample(), 'utf8')
      console.log('✓ .env.example     已同步为当前版本的示例(.env 不受影响)')

      // 3. .gitignore 忽略 .env
      const gitignore = await ensureGitignoreEntry(root, '.env')
      console.log(
        gitignore === 'exists' ? '✓ .gitignore       已忽略 .env' : '✓ .gitignore       已追加忽略 .env',
      )

      console.log('提示:提交 .agents/skills/ 与 .env.example 的变更,团队与 AI 即可使用最新能力')
    })

  return update
}
