import { existsSync } from 'node:fs'
import { access, cp, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTestpilotConfig } from '@testpilot/core'
import type { AdapterInfo } from './adapter-detector'
import type { ProjectInfo } from './project-detector'

export interface SkillInstallResult {
  /** Skill 主体(SKILL.md / manifest / rules / workflows) */
  core: 'created' | 'reused'
  /** 项目级 Agent 上下文(references/) */
  references: 'created' | 'reused'
  dest: string
}

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
  // 打包形态:esbuild 单文件产物 dist/bin.js -> dist/skills/testpilot
  const bundled = fileURLToPath(new URL('./skills/testpilot', import.meta.url))
  if (existsSync(bundled)) return bundled
  // 开发态:src/commands/init/skill-installer.ts -> 仓库根 skills/testpilot
  const inRepo = fileURLToPath(new URL('../../../../../skills/testpilot', import.meta.url))
  return existsSync(inRepo) ? inRepo : undefined
}

/** 安装 Skill 并生成项目级 Agent 上下文(设计文档 §7-8);全部步骤幂等 */
export async function installSkill(
  root: string,
  info: ProjectInfo,
  adapters: AdapterInfo[],
): Promise<SkillInstallResult> {
  const dest = join(root, '.agents', 'skills', 'testpilot')

  // 1. Skill 主体(静态源文件,整目录复制)
  let core: 'created' | 'reused' = 'reused'
  if (!(await exists(join(dest, 'manifest.yaml')))) {
    const src = resolveSkillSourceDir()
    if (!src) {
      throw new Error(
        '无法定位 TestPilot Skill 源目录;可通过环境变量 TESTPILOT_SKILL_DIR 指定 skills/testpilot 路径',
      )
    }
    await mkdir(dirname(dest), { recursive: true })
    await cp(src, dest, { recursive: true })
    core = 'created'
  }

  // 2. 项目级上下文 references/(按检测结果生成;已存在则保留,不覆盖用户改动)
  // 默认环境/工作区从 testpilot.yaml 实际配置读取(init 刚生成或用户已有)
  const config = await loadTestpilotConfig(root).catch(() => undefined)
  const defaultEnvironment =
    typeof config?.environment?.default === 'string' ? config.environment.default : '未设置'
  const defaultWorkspace = config?.workspace?.default ?? '未设置(可在 yaml workspace.default 配置)'
  const refsDir = join(dest, 'references')
  const files: Array<[name: string, render: () => string]> = [
    ['project.md', () => renderProjectMd(info, adapters, defaultEnvironment, defaultWorkspace)],
    ['test-conventions.md', renderTestConventionsMd],
    ['adapters.md', () => renderAdaptersMd(adapters)],
  ]
  let references: 'created' | 'reused' = 'reused'
  for (const [name, render] of files) {
    const file = join(refsDir, name)
    if (await exists(file)) continue
    await mkdir(refsDir, { recursive: true })
    await writeFile(file, render(), 'utf8')
    references = 'created'
  }

  return { core, references, dest }
}

function renderProjectMd(
  info: ProjectInfo,
  adapters: AdapterInfo[],
  defaultEnvironment: string,
  defaultWorkspace: string,
): string {
  const available = adapters.filter((item) => item.available).map((item) => item.id)
  return `# Project

自动生成于 \`csspilot init\`,描述本项目的 TestPilot 接入信息;Agent 优先从这里了解项目。

- Project name: ${info.name}
- Project type: ${info.type}
- Language: ${info.language}
- Package manager: ${info.packageManager}
- Test directory: tests/e2e
- Case directory: tests/e2e/cases
- Available adapters: ${available.length > 0 ? available.join(', ') : '(none detected)'}
- Default environment: ${defaultEnvironment}
- Default workspace: ${defaultWorkspace}
`
}

function renderTestConventionsMd(): string {
  return `# Test Conventions

本项目 E2E 测试约定,Agent 生成/修改 Case 时必须遵守:

1. E2E Case 位于 tests/e2e/cases
2. Case 使用 TestPilot DSL
3. 不允许直接调用 Playwright
4. 不允许直接调用 WeChatIDE
5. 不允许在 Case 中写明文密码(用 accountRef 引用)
6. 优先复用已有 Case
7. 新增 Case 必须通过 csspilot validate
8. Case ID 必须唯一
`
}

function renderAdaptersMd(adapters: AdapterInfo[]): string {
  const lines = adapters.map(
    (item) =>
      `- ${item.id}: ${item.available ? '可用' : '不可用'}${item.required ? '(项目需要)' : '(可选)'} — ${item.detail}`,
  )
  return `# Adapters

执行端检测结果(以 \`csspilot doctor\` 最新输出为准):

${lines.join('\n')}

Agent 永远不直接操作 Adapter;Case 经 Execution Engine 调度到对应 Adapter 执行。
`
}
