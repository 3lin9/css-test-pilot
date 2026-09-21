import { existsSync, readFileSync } from 'node:fs'
import { access, cp, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTestpilotConfig } from '@testpilot/core'
import type { AdapterInfo } from './adapter-detector'
import type { ProjectInfo } from './project-detector'

export interface SkillInstallResult {
  /** Skill 主体(SKILL.md / manifest / rules / workflows):created 首次安装 / reused 已是最新 / updated 版本升级 */
  core: 'created' | 'reused' | 'updated'
  /** 版本升级时记录 from -> to(installed manifest 的 version) */
  coreVersion?: { from?: string; to?: string }
  /** 项目级 Agent 上下文(references/) */
  references: 'created' | 'reused'
  dest: string
}

export interface SkillSyncResult {
  core: 'created' | 'current' | 'updated'
  /** 更新前的已安装版本 */
  installedVersion?: string
  /** 当前 CLI 内置的 Skill 版本 */
  bundledVersion?: string
  dest: string
}

/** Skill 主体文件:版本升级时由内置源覆盖;references/ 属于项目上下文,永不被覆盖 */
const CORE_FILES = ['SKILL.md', 'manifest.yaml']
const CORE_DIRS = ['rules', 'workflows']

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** 读取 Skill 目录 manifest.yaml 的 version;缺失返回 undefined */
export function readManifestVersion(dir: string): string | undefined {
  const manifestPath = join(dir, 'manifest.yaml')
  if (!existsSync(manifestPath)) return undefined
  return /^version:\s*([^\s#]+)/m.exec(readFileSync(manifestPath, 'utf8'))?.[1]
}

/** 定位 Skill 源目录:环境变量 -> 包内打包产物(dist/skills) -> monorepo 开发态 */
export function resolveSkillSourceDir(): string | undefined {
  const fromEnv = process.env.TESTPILOT_SKILL_DIR
  if (fromEnv) return fromEnv
  // 打包形态:esbuild 单文件产物 dist/bin.js -> dist/skills/testpilot
  const bundled = fileURLToPath(new URL('./skills/testpilot', import.meta.url))
  if (existsSync(bundled)) return bundled
  // 开发态:src/commands/init/skill-installer.ts -> 仓库根 skills/testpilot
  const inRepo = fileURLToPath(new URL('../../../../../skills/testpilot', import.meta.url))
  return existsSync(inRepo) ? inRepo : undefined
}

/** 覆盖 Skill 主体文件(不触碰 references/) */
async function copyCoreFiles(src: string, dest: string): Promise<void> {
  for (const name of CORE_FILES) {
    await cp(join(src, name), join(dest, name), { recursive: true, force: true })
  }
  for (const dir of CORE_DIRS) {
    if (existsSync(join(src, dir))) {
      await cp(join(src, dir), join(dest, dir), { recursive: true, force: true })
    }
  }
}

/**
 * 把 .agents/skills/testpilot 同步到当前 CLI 内置的 Skill 版本:
 * - 未安装:整目录安装
 * - 已安装且 manifest version 与内置不一致:覆盖主体文件(SKILL.md / manifest / rules / workflows),
 *   references/ 项目上下文不受影响
 * - 版本一致且未强制:跳过
 */
export async function syncSkillFiles(
  root: string,
  options: { force?: boolean } = {},
): Promise<SkillSyncResult> {
  const dest = join(root, '.agents', 'skills', 'testpilot')
  const bundledVersion = readManifestVersion(resolveSkillSourceDir() ?? '')

  // 未安装:整目录安装
  if (!(await exists(join(dest, 'manifest.yaml')))) {
    const src = resolveSkillSourceDir()
    if (!src) {
      throw new Error(
        '无法定位 TestPilot Skill 源目录;可通过环境变量 TESTPILOT_SKILL_DIR 指定 skills/testpilot 路径',
      )
    }
    await mkdir(dirname(dest), { recursive: true })
    await cp(src, dest, { recursive: true })
    return { core: 'created', bundledVersion, dest }
  }

  const installedVersion = readManifestVersion(dest)
  const bundled = resolveSkillSourceDir()
  if (!bundled) {
    // 无法比较版本(极少见):保持现状
    return { core: 'current', installedVersion, dest }
  }
  if (!options.force && installedVersion === bundledVersion) {
    return { core: 'current', installedVersion, bundledVersion, dest }
  }

  await copyCoreFiles(bundled, dest)
  return {
    core: 'updated',
    installedVersion,
    bundledVersion,
    dest,
  }
}

/** 安装 Skill 并生成项目级 Agent 上下文(设计文档 §7-8);全部步骤幂等,版本变化时自动升级 */
export async function installSkill(
  root: string,
  info: ProjectInfo,
  adapters: AdapterInfo[],
): Promise<SkillInstallResult> {
  const dest = join(root, '.agents', 'skills', 'testpilot')
  const sync = await syncSkillFiles(root)
  const core: SkillInstallResult['core'] =
    sync.core === 'created' ? 'created' : sync.core === 'updated' ? 'updated' : 'reused'
  const coreVersion =
    sync.core === 'updated' || sync.core === 'created'
      ? { from: sync.installedVersion, to: sync.bundledVersion }
      : undefined

  // 项目级上下文 references/(按检测结果生成;已存在则保留,不覆盖用户改动)
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

  return coreVersion ? { core, coreVersion, references, dest } : { core, references, dest }
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
9. fixture/dataset 使用 YAML 或 JSON,统一位于 tests/e2e/data
10. 需求规则矩阵与 QA 覆盖映射写入 tests/e2e/reviews/<需求>-coverage.md
11. 只在步骤模板相同时使用 data-driven Case,每行保持一个可判定规则/数据点
12. requires 只声明项目证据支持的依赖,不得套用账号/优惠券/PPM 等默认字段
13. Case 不得读取任意环境变量;先在 testpilot.yaml variables 白名单映射后使用 \${variable.*}
14. setup/teardown 优先 API;teardown 失败作为 warning,不改变主流程结果
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
