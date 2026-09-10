import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { loadTestpilotConfig, TESTPILOT_DIR, type TestpilotConfig } from '@testpilot/core'

/** SDK 根目录约定:所有项目内路径都相对该目录解析 */
export interface ProjectOptions {
  /** 业务项目根目录,默认 process.cwd() */
  root?: string
}

export function resolveRoot(root?: string): string {
  return resolve(root ?? process.cwd())
}

/** 读取业务项目的 testpilot.yaml(不存在时返回默认配置;testpilot.yaml 始终是 Source of Truth) */
export async function loadProjectConfig(root?: string): Promise<TestpilotConfig> {
  return loadTestpilotConfig(resolveRoot(root))
}

export interface ProjectInspection {
  root: string
  /** testpilot.yaml 是否存在(false 表示使用默认配置) */
  hasConfig: boolean
  config: TestpilotConfig
  casesDir: string
  casesDirExists: boolean
  artifactsDir: string
  runsDir: string
  /** .agents/skills/testpilot/ 是否已安装 */
  skillInstalled: boolean
  /** 按配置可用的执行端 */
  targets: Array<'web' | 'miniapp'>
}

/** 项目自检:Agent 的 inspect_project 工具与 CLI/Server 共用 */
export async function inspectProject(root?: string): Promise<ProjectInspection> {
  const dir = resolveRoot(root)
  const config = await loadTestpilotConfig(dir)
  const casesDir = join(dir, config.casesDir)
  const artifactsDir = join(dir, TESTPILOT_DIR, 'artifacts')

  const [hasConfig, casesDirExists, skillInstalled] = await Promise.all([
    exists(join(dir, 'testpilot.yaml')),
    exists(casesDir),
    exists(join(dir, '.agents', 'skills', 'testpilot')),
  ])

  return {
    root: dir,
    hasConfig,
    config,
    casesDir,
    casesDirExists,
    artifactsDir,
    runsDir: join(artifactsDir, 'runs'),
    skillInstalled,
    targets: config.miniapp ? ['web', 'miniapp'] : ['web'],
  }
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined
}

/** 本地项目与 TestPilot Server Project 的关联信息(.testpilot/project.json) */
export interface ProjectLink {
  projectId: string
  /** TestPilot Server 地址(sync-metadata / Web 关联时使用) */
  serverUrl?: string
  repositoryUrl?: string
  branch?: string
  /** project.json 结构版本(csspilot init >= 0.2 生成为 1) */
  version?: number
  /** 测试根目录(如 tests/e2e) */
  testDir?: string
  /** 用例目录(如 tests/e2e/cases) */
  caseDir?: string
  /** 默认执行端(playwright / wechatide) */
  defaultAdapter?: string
}

const PROJECT_LINK_FILE = join(TESTPILOT_DIR, 'project.json')

/** 读取项目关联信息;未执行过 init 关联时返回 undefined */
export async function readProjectLink(root?: string): Promise<ProjectLink | undefined> {
  const file = join(resolveRoot(root), PROJECT_LINK_FILE)
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as ProjectLink
    if (!raw.projectId) return undefined
    return raw
  } catch {
    return undefined
  }
}

/** 写入项目关联信息(init 时建立"业务项目 ↔ TestPilot Server Project"关联) */
export async function writeProjectLink(link: ProjectLink, root?: string): Promise<string> {
  const file = join(resolveRoot(root), PROJECT_LINK_FILE)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, `${JSON.stringify(link, null, 2)}\n`, 'utf8')
  return file
}
