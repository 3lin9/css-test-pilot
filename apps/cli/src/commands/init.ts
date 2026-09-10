import { existsSync } from 'node:fs'
import { access, cp, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { readProjectLink, writeProjectLink, TestPilotClient } from '@testpilot/sdk'
import { readGitInfo } from '../lib/git'

const TESTPILOT_YAML_TEMPLATE = `# TestPilot 项目配置
# validate / list / run 默认在这个目录查找 *.yaml 用例
casesDir: tests/e2e/cases

# TestPilot Server(Control Plane)地址;init 关联项目与 sync-metadata 使用
# 也可用环境变量 TESTPILOT_SERVER_URL 覆盖
# server:
#   baseUrl: http://127.0.0.1:3000

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
      const client = new TestPilotClient({ root: cwd })

      // 1. 安装 Skill
      const skillDest = join(cwd, '.agents', 'skills', 'testpilot')
      if (await exists(join(skillDest, 'manifest.yaml'))) {
        console.log('✓ Skill 安装       .agents/skills/testpilot/(已存在,跳过)')
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
        console.log('✓ Skill 安装       .agents/skills/testpilot/')
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

      // 5. Git 仓库检测
      const git = await readGitInfo(cwd)
      if (git.commit) {
        console.log(`✓ Git 仓库         ${git.branch ?? '(detached)'} · ${git.commit.slice(0, 7)}`)
      } else {
        console.log('✗ Git 仓库         未检测到(git init 后 Case Metadata 才能同步到 Server)')
      }

      // 6. 关联 TestPilot Project(.testpilot/project.json)
      await linkProject(client, cwd, git)

      console.log('')
      console.log('下一步:')
      console.log('  1. 让 AI 阅读 .agents/skills/testpilot/SKILL.md')
      console.log('  2. 在 tests/e2e/cases/ 创建 Case(遵循 SKILL.md 与 rules/)')
      console.log('  3. npx csspilot validate')
      console.log('  4. npx csspilot run')
    })
}

async function linkProject(
  client: TestPilotClient,
  cwd: string,
  git: Awaited<ReturnType<typeof readGitInfo>>,
): Promise<void> {
  const existing = await readProjectLink(cwd)
  if (existing) {
    console.log(`✓ 项目关联         ${existing.projectId}(.testpilot/project.json 已存在,跳过)`)
    return
  }

  const config = await client.getConfig().catch(() => undefined)
  const serverUrl = process.env.TESTPILOT_SERVER_URL ?? config?.server?.baseUrl
  let projectId: string | undefined

  if (serverUrl) {
    try {
      const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: basename(cwd),
          rootPath: cwd,
          repositoryUrl: git.repositoryUrl,
          defaultBranch: git.branch,
        }),
      })
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
      const project = (await res.json()) as { id: number }
      projectId = `proj_${project.id}`
      console.log(`✓ 项目关联         ${projectId}(Server:${serverUrl})`)
    } catch (err) {
      console.error(
        `✗ 项目关联         Server(${serverUrl})不可达:${err instanceof Error ? err.message : err}`,
      )
    }
  }

  if (!projectId) {
    projectId = `proj_${Math.random().toString(16).slice(2, 10)}`
    console.log(`✓ 项目关联         ${projectId}(本地模式;配置 server.baseUrl 后 CI 可同步)`)
  }

  const file = await writeProjectLink(
    { projectId, ...(serverUrl ? { serverUrl } : {}), repositoryUrl: git.repositoryUrl, branch: git.branch },
    cwd,
  )
  console.log(`                   ${file}`)
}
