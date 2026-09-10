import { existsSync } from 'node:fs'
import { access, cp, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'

const TESTPILOT_YAML_TEMPLATE = `# TestPilot 项目配置
# validate / list / run 默认在这个目录查找 *.yaml 用例
casesDir: tests/e2e/cases

# Web 端:navigate 相对 url 的基准地址
# web:
#   baseUrl: http://127.0.0.1:8080

# 小程序端:填入小程序项目目录后即可执行 target: miniapp 的步骤
# miniapp:
#   projectPath: path/to/miniprogram
#   cliPath: C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat
`

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** 定位 Skill 源目录:环境变量 -> 包内打包产物(dist/skills) -> monorepo 开发态 */
function resolveSkillSourceDir(): string | undefined {
  const fromEnv = process.env.TESTPILOT_SKILL_DIR
  if (fromEnv) return fromEnv
  const bundled = fileURLToPath(new URL('./skills/testpilot', import.meta.url))
  if (existsSync(bundled)) return bundled
  // monorepo 开发态:apps/cli/src/commands -> 仓库根 skills/testpilot
  const inRepo = fileURLToPath(new URL('../../../../skills/testpilot', import.meta.url))
  return existsSync(inRepo) ? inRepo : undefined
}

export function makeInitCommand(): Command {
  return new Command('init')
    .description('把 TestPilot 接入当前业务项目')
    .action(async () => {
      const cwd = process.cwd()

      // 1. 安装 Skill
      const skillDest = join(cwd, '.ai', 'skills', 'testpilot')
      if (await exists(join(skillDest, 'manifest.yaml'))) {
        console.log('✓ Skill 安装       .ai/skills/testpilot/(已存在,跳过)')
      } else {
        const skillSrc = resolveSkillSourceDir()
        if (!skillSrc) {
          console.error('✗ 无法定位 TestPilot Skill 源目录')
          console.error('  可通过环境变量 TESTPILOT_SKILL_DIR 指定 skills/testpilot 路径后重试')
          process.exitCode = 1
          return
        }
        await mkdir(dirname(skillDest), { recursive: true })
        await cp(skillSrc, skillDest, { recursive: true })
        console.log('✓ Skill 安装       .ai/skills/testpilot/')
      }

      // 2. Runtime 目录
      await mkdir(join(cwd, '.testpilot', 'artifacts'), { recursive: true })
      const keep = join(cwd, '.testpilot', 'artifacts', '.gitkeep')
      if (!(await exists(keep))) {
        await writeFile(keep, '', 'utf8')
      }
      console.log('✓ Runtime 目录     .testpilot/')

      // 3. 测试目录(创建 / 复用)
      for (const dir of ['tests/e2e/cases', 'tests/e2e/fixtures', 'tests/e2e/data']) {
        await mkdir(join(cwd, dir), { recursive: true })
      }
      console.log('✓ 测试目录         tests/e2e/{cases,fixtures,data}')

      // 4. 项目配置
      const configPath = join(cwd, 'testpilot.yaml')
      if (await exists(configPath)) {
        console.log('✓ 项目配置         testpilot.yaml(已存在,跳过)')
      } else {
        await writeFile(configPath, TESTPILOT_YAML_TEMPLATE, 'utf8')
        console.log('✓ 项目配置         testpilot.yaml')
      }

      console.log('')
      console.log('下一步:')
      console.log('  1. 让 AI 阅读 .ai/skills/testpilot/SKILL.md')
      console.log('  2. 在 tests/e2e/cases/ 创建 Case(遵循 SKILL.md 与 rules/)')
      console.log('  3. npx testpilot validate')
      console.log('  4. npx testpilot run')
    })
}
