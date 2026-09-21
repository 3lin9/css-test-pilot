import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { readProjectLink, writeProjectLink, type ProjectLink } from '@testpilot/sdk'
import type { AdapterInfo } from './adapter-detector'
import { adaptersFor, defaultAdapterFor, type ProjectInfo } from './project-detector'

export interface ConfigInitResult {
  yaml: 'created' | 'reused'
  runtimeDir: string
  projectLink: ProjectLink
  projectLinkFile: string
  envExample: 'created' | 'reused'
  gitignore: 'created' | 'updated' | 'exists'
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const TEST_DIR = 'tests/e2e'
const CASE_DIR = 'tests/e2e/cases'

/** 生成 testpilot.yaml 模板(环境配置只放 ${VAR} 引用不落明文;机器相关的路径/地址一律走环境变量) */
export function renderTestpilotYaml(info: ProjectInfo): string {
  const adapters = adaptersFor(info.type)
    .map((item) => `  - ${item}`)
    .join('\n')
  return `# TestPilot 项目配置(Source of Truth)
version: 1

project:
  name: ${info.name}

test:
  directory: ${TEST_DIR}
  caseDirectory: ${CASE_DIR}

# 环境配置:Case 用 environment: <名称> 引用;baseUrl 由环境变量注入,禁止写明文
environment:
  default: test
  test:
    baseUrl: \${TEST_BASE_URL}
  staging:
    baseUrl: \${STAGING_BASE_URL}

# Case 可见的项目变量白名单(值来自 .env / CI Secret;Case 用 \${variable.<name>} 引用)
# variables:
#   ppmProjectId: \${PPM_PROJECT_ID}

# 项目声明的执行端(实际可用性以 csspilot doctor 检测为准)
adapters:
${adapters}

# 默认 Workspace(多系统环境组合);Case 也可用 workspace 字段按需声明
# workspace:
#   default: my-workspace

# TestPilot Server(Control Plane)地址;init 关联项目与 sync-metadata 使用
# 也可用环境变量 TESTPILOT_SERVER_URL 覆盖
# server:
#   baseUrl: http://127.0.0.1:3000

# Web 端:navigate 相对 url 的基准地址(每人的地址不同,值放 .env)
# web:
#   baseUrl: \${WEB_BASE_URL}

# 小程序端:填入小程序项目目录后即可执行 target: miniapp 的步骤(路径每人不同,走 .env)
# miniapp:
#   projectPath: \${MINIAPP_PROJECT_PATH}
#   cliPath: \${MINIAPP_CLI_PATH}
`
}

/** 生成 .env.example 示例(提交到 Git;真实值放 .env,.env 不提交) */
export function renderDotEnvExample(): string {
  return `# TestPilot 环境变量示例:复制为 .env 并填入真实值(.env 含敏感信息,不要提交到 Git)
# 优先级:真实环境变量 > .env 文件;testpilot.yaml 中的 \${VAR} 引用运行时自动注入

# 环境配置(environment 段)
TEST_BASE_URL=http://127.0.0.1:8080
STAGING_BASE_URL=https://staging.example.com

# Web 端相对 url 的基准(取消 testpilot.yaml 中 web 段注释后生效)
# WEB_BASE_URL=http://127.0.0.1:8080

# 小程序端(取消 testpilot.yaml 中 miniapp 段注释后生效)
# MINIAPP_PROJECT_PATH=path/to/miniprogram
# MINIAPP_CLI_PATH=C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat

# TestPilot Server(Control Plane,可选)
# TESTPILOT_SERVER_URL=http://127.0.0.1:3000
`
}

/** 确保 .gitignore 包含指定条目(如 .env);文件不存在时创建 */
export async function ensureGitignoreEntry(
  root: string,
  entry: string,
  comment = 'TestPilot 本地环境变量',
): Promise<'created' | 'updated' | 'exists'> {
  const gitignorePath = join(root, '.gitignore')
  if (!(await exists(gitignorePath))) {
    await writeFile(gitignorePath, `# ${comment}\n${entry}\n`, 'utf8')
    return 'created'
  }
  const content = await readFile(gitignorePath, 'utf8')
  if (content.split(/\r?\n/).some((item) => item.trim() === entry)) {
    return 'exists'
  }
  const separator = content.endsWith('\n') || content === '' ? '' : '\n'
  await writeFile(gitignorePath, `${content}${separator}# ${comment}\n${entry}\n`, 'utf8')
  return 'updated'
}

/** 初始化 testpilot.yaml + .env.example + .testpilot/ 运行时目录 + project.json(全部幂等) */
export async function initTestPilotConfig(
  root: string,
  info: ProjectInfo,
  adapters: AdapterInfo[],
): Promise<ConfigInitResult> {
  // 1. testpilot.yaml(已存在则保留,绝不覆盖)
  const yamlPath = join(root, 'testpilot.yaml')
  let yaml: 'created' | 'reused' = 'reused'
  if (!(await exists(yamlPath))) {
    await writeFile(yamlPath, renderTestpilotYaml(info), 'utf8')
    yaml = 'created'
  }

  // 2. .env.example(已存在则保留)+ .gitignore 忽略 .env
  const envExamplePath = join(root, '.env.example')
  let envExample: 'created' | 'reused' = 'reused'
  if (!(await exists(envExamplePath))) {
    await writeFile(envExamplePath, renderDotEnvExample(), 'utf8')
    envExample = 'created'
  }
  const gitignore = await ensureGitignoreEntry(root, '.env')

  // 3. Runtime 目录
  const runtimeDir = join(root, '.testpilot', 'artifacts')
  await mkdir(runtimeDir, { recursive: true })
  const keep = join(runtimeDir, '.gitkeep')
  if (!(await exists(keep))) {
    await writeFile(keep, '', 'utf8')
  }

  // 4. project.json:已有链接只补缺失字段,不重置 projectId(设计文档 §17)
  const existing = await readProjectLink(root)
  const defaultAdapter = defaultAdapterFor(info.type)
  const serverUrl = process.env.TESTPILOT_SERVER_URL ?? undefined
  const link: ProjectLink = existing
    ? { ...existing, version: existing.version ?? 1 }
    : {
        ...(await createProjectOnServer(root, info, adapters, serverUrl)),
        version: 1,
        testDir: TEST_DIR,
        caseDir: CASE_DIR,
        defaultAdapter,
      }
  // 旧版 init 生成的链接补齐新字段
  if (link.testDir === undefined || link.caseDir === undefined || link.defaultAdapter === undefined) {
    link.testDir ??= TEST_DIR
    link.caseDir ??= CASE_DIR
    link.defaultAdapter ??= defaultAdapter
  }
  if (link.serverUrl === undefined && serverUrl) link.serverUrl = serverUrl
  const projectLinkFile = await writeProjectLink(link, root)

  return {
    yaml,
    runtimeDir: join(root, '.testpilot'),
    projectLink: link,
    projectLinkFile,
    envExample,
    gitignore,
  }
}

/** 在 Server 上注册项目并返回 projectId;Server 不可达时退化为本地模式 ID */
async function createProjectOnServer(
  root: string,
  info: ProjectInfo,
  _adapters: AdapterInfo[],
  serverUrl: string | undefined,
): Promise<ProjectLink> {
  const git = info.git
  const base: Pick<ProjectLink, 'repositoryUrl' | 'branch'> = { repositoryUrl: git.repositoryUrl, branch: git.branch }
  if (!serverUrl) return { ...base, projectId: `proj_${randomId()}` }

  try {
    const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: info.name || basename(root),
        rootPath: root,
        repositoryUrl: git.repositoryUrl,
        defaultBranch: git.branch,
      }),
    })
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
    const project = (await res.json()) as { id: number }
    return { ...base, serverUrl, projectId: `proj_${project.id}` }
  } catch (err) {
    console.error(`✗ 项目关联               Server(${serverUrl})不可达:${err instanceof Error ? err.message : err}`)
    return { ...base, serverUrl, projectId: `proj_${randomId()}` }
  }
}

function randomId(): string {
  return Math.random().toString(16).slice(2, 10)
}
