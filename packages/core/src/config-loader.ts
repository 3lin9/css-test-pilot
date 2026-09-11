import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { DEFAULT_CASES_DIR } from './constants'

/** 环境条目:环境名 -> { baseUrl };baseUrl 支持 ${ENV_VAR} 引用,值由运行环境注入 */
const environmentEntrySchema = z.strictObject({ baseUrl: z.string().min(1).optional() }).optional()

const configSchema = z.strictObject({
  /** 配置文件版本(csspilot init 生成为 1) */
  version: z.number().optional(),
  /** 旧式用例目录字段;与 test.caseDirectory 等价,二选一 */
  casesDir: z.string().min(1).optional(),
  project: z.strictObject({ name: z.string().min(1).optional() }).optional(),
  test: z
    .strictObject({
      directory: z.string().min(1).optional(),
      caseDirectory: z.string().min(1).optional(),
    })
    .optional(),
  /** 环境配置:default 指定默认环境名,其余键为环境名 -> { baseUrl } */
  environment: z.record(z.string(), z.union([z.string().min(1), environmentEntrySchema])).optional(),
  /** 项目声明的执行端(playwright / wechatide);仅作声明,实际可用性以 doctor 检测为准 */
  adapters: z.array(z.string().min(1)).optional(),
  workspace: z.strictObject({ default: z.string().min(1).optional() }).optional(),
  /** TestPilot Control Plane 地址(sync-metadata / init 关联项目时使用) */
  server: z.strictObject({ baseUrl: z.string().min(1).optional() }).optional(),
  web: z.strictObject({ baseUrl: z.string().min(1).optional() }).optional(),
  /** API 执行端(target: api):相对 url 的基准地址与超时 */
  api: z
    .strictObject({
      baseUrl: z.string().min(1).optional(),
      timeoutMs: z.number().int().positive().optional(),
    })
    .optional(),
  miniapp: z
    .strictObject({
      projectPath: z.string().min(1).optional(),
      cliPath: z.string().min(1).optional(),
    })
    .optional(),
})

export interface TestpilotConfig {
  version?: number
  casesDir: string
  testDirectory?: string
  projectName?: string
  environment?: Record<string, string | { baseUrl?: string } | undefined>
  adapters?: string[]
  workspace?: { default?: string }
  server?: { baseUrl?: string }
  web?: { baseUrl?: string }
  api?: { baseUrl?: string; timeoutMs?: number }
  miniapp?: { projectPath?: string; cliPath?: string }
}

/** 读取并校验业务项目的 testpilot.yaml;文件不存在时返回默认配置 */
export async function loadTestpilotConfig(cwd: string = process.cwd()): Promise<TestpilotConfig> {
  const file = join(cwd, 'testpilot.yaml')
  let raw: unknown
  try {
    raw = parseYaml(await readFile(file, 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { casesDir: DEFAULT_CASES_DIR }
    }
    throw new Error(`解析 testpilot.yaml 失败:${err instanceof Error ? err.message : String(err)}`)
  }

  const result = configSchema.safeParse(raw ?? {})
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
      .join('; ')
    throw new Error(`testpilot.yaml 配置不合法:${detail}`)
  }
  return {
    version: result.data.version,
    // 用例目录:旧字段 casesDir 优先,其次 test.caseDirectory,最后默认值
    casesDir: result.data.casesDir ?? result.data.test?.caseDirectory ?? DEFAULT_CASES_DIR,
    testDirectory: result.data.test?.directory,
    projectName: result.data.project?.name,
    environment: result.data.environment,
    adapters: result.data.adapters,
    workspace: result.data.workspace,
    server: result.data.server,
    web: result.data.web,
    api: result.data.api,
    miniapp: result.data.miniapp,
  }
}
