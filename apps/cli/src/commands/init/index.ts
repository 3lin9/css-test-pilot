import { join } from 'node:path'
import { Command } from 'commander'
import { detectAdapters, type AdapterInfo } from './adapter-detector'
import { detectCi } from './ci-initializer'
import { initTestPilotConfig, type ConfigInitResult } from './config-initializer'
import { printDoctor, runDoctor, type DoctorReport } from './doctor'
import { detectProject, type ProjectInfo } from './project-detector'
import { installSkill, type SkillInstallResult } from './skill-installer'
import { initTestStructure, type TestStructureResult } from './test-structure'

export interface InitSummary {
  project: ProjectInfo
  adapters: AdapterInfo[]
  config: ConfigInitResult
  testStructure: TestStructureResult
  skill: SkillInstallResult
  doctor: DoctorReport
}

export interface InitOptions {
  /** 显式指定 Server 地址;null 表示强制本地模式(跳过 Server 注册) */
  serverUrl?: string | null
}

/**
 * csspilot init:把普通业务项目接入 TestPilot(设计文档 §3-4)。
 * 全程幂等:已有文件一律保留,不覆盖、不重置 projectId、不重复安装。
 */
export async function runInit(root: string, options: InitOptions = {}): Promise<InitSummary> {
  if (options.serverUrl !== undefined) {
    if (options.serverUrl === null) delete process.env.TESTPILOT_SERVER_URL
    else process.env.TESTPILOT_SERVER_URL = options.serverUrl
  }

  // 1. 项目识别(§5)
  const project = await detectProject(root)
  console.log(`✔ Project:          ${project.name}`)
  console.log(`✔ Type:             ${project.type}`)
  console.log(`✔ Language:         ${project.language}`)
  console.log(`✔ Package Manager:  ${project.packageManager}`)
  console.log(project.git.commit ? `✔ Git repository    ${project.git.branch ?? '(detached)'}` : '✗ Git repository    未检测到')

  // 2. Adapter 检测(§11;不可用只提示,不阻塞)
  const adapters = await detectAdapters(root, project.type)
  console.log('')
  console.log('Testing adapters:')
  for (const adapter of adapters) {
    const mark = adapter.available ? '✓' : '✗'
    console.log(`${mark} ${adapter.id}${adapter.available ? '' : ' not detected'} — ${adapter.detail}`)
  }

  // 3. TestPilot 配置(§9:testpilot.yaml + .testpilot/ + project.json;已有则保留)
  console.log('')
  const config = await initTestPilotConfig(root, project, adapters)
  console.log(
    config.yaml === 'created'
      ? '✓ 项目配置          testpilot.yaml'
      : '✓ 项目配置          testpilot.yaml(已存在,保留)',
  )
  console.log(`✓ Runtime 目录      ${join('.testpilot', 'artifacts')}`)
  const serverMode = config.projectLink.serverUrl ? `Server:${config.projectLink.serverUrl}` : '本地模式'
  console.log(`✓ 项目关联          ${config.projectLink.projectId}(${serverMode})`)
  console.log(
    config.envExample === 'created'
      ? '✓ 环境变量示例      .env.example(复制为 .env 填入真实值)'
      : '✓ 环境变量示例      .env.example(已存在,保留)',
  )
  console.log(
    config.gitignore === 'exists'
      ? '✓ Git 忽略          .env(已在 .gitignore)'
      : `✓ Git 忽略          .env(已写入 .gitignore)`,
  )

  // 4. 测试目录(§6)
  const testStructure = await initTestStructure(root, project)
  const reuseNote = project.existingE2eDirs.filter((dir) => dir !== 'tests/e2e')
  console.log(
    testStructure.cases === 'reused'
      ? '✓ 测试目录          tests/e2e(已存在,复用)'
      : '✓ 测试目录          tests/e2e/{cases,fixtures,data,reviews}',
  )
  if (reuseNote.length > 0) {
    console.log(`  ⚠ 检测到其他 E2E 目录:${reuseNote.join(', ')}(保留不动,未强制迁移)`)
  }

  // 5. Agent Skill + 项目级上下文(§7-8)
  const skill = await installSkill(root, project, adapters)
  if (skill.core === 'updated') {
    console.log(
      `✓ Skill 更新        .agents/skills/testpilot/(v${skill.coreVersion?.from ?? '?'} -> v${skill.coreVersion?.to ?? '?'})`,
    )
  } else {
    console.log(
      skill.core === 'created'
        ? `✓ Skill 安装        ${join('.agents', 'skills', 'testpilot')}`
        : '✓ Skill 安装        .agents/skills/testpilot/(已存在,跳过)',
    )
  }
  console.log(
    skill.references === 'created'
      ? '✓ Agent 上下文      references/{project,test-conventions,adapters}.md'
      : '✓ Agent 上下文      references/(已存在,保留)',
  )

  // 6. 环境配置(§10):模板已含 ${VAR} 引用,提示变量来源
  console.log('✓ 环境配置          environment 段(test/staging),baseUrl 由 TEST_BASE_URL 等变量注入')

  // 7. CI 准备(§13):只检测提示,不修改
  const ci = await detectCi(root)
  if (ci.hasTestpilotWorkflow) {
    console.log('✓ CI               .github/workflows/testpilot.yml(已存在)')
  } else if (ci.githubWorkflows || ci.gitlabCi) {
    console.log('⚠ CI               检测到已有 CI 配置,未改动;可运行 npx csspilot ci init 生成 TestPilot 工作流')
  } else {
    console.log('ℹ CI               未检测到 CI;可运行 npx csspilot ci init 生成模板')
  }

  // 8. 自动 Doctor(§12)
  console.log('')
  const doctor = await runDoctor(root)
  printDoctor(doctor)

  console.log('下一步:')
  console.log('  1. 让 AI 阅读 .agents/skills/testpilot/SKILL.md(项目上下文见 references/)')
  console.log('     可选:按所用 Agent 复制到 .cursor/skills/、.claude/skills/ 等目录')
  console.log('  2. 在 tests/e2e/cases/ 创建 Case(遵循 references/test-conventions.md)')
  console.log('  3. npx csspilot validate && npx csspilot run')

  return { project, adapters, config, testStructure, skill, doctor }
}

export function makeInitCommand(): Command {
  return new Command('init')
    .description('把 TestPilot 接入当前业务项目(幂等,可重复执行)')
    .option('--server <url>', 'TestPilot Server 地址(默认读 TESTPILOT_SERVER_URL / testpilot.yaml)')
    .action(async (options: { server?: string }) => {
      try {
        await runInit(process.cwd(), options.server ? { serverUrl: options.server } : {})
      } catch (err) {
        console.error(`✗ init 失败:${err instanceof Error ? err.message : String(err)}`)
        process.exitCode = 1
      }
    })
}
