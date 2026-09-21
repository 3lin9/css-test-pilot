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
  /** Case 可见的项目变量白名单;值可通过 ${ENV_VAR} 从运行环境注入 */
  variables: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).optional(),
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
  variables?: Record<string, string>
  adapters?: string[]
  workspace?: { default?: string }
  server?: { baseUrl?: string }
  web?: { baseUrl?: string }
  api?: { baseUrl?: string; timeoutMs?: number }
  miniapp?: { projectPath?: string; cliPath?: string }
}

/** 将值中的 ${ENV_VAR} 替换为进程环境变量;未设置的引用保持原样(doctor / inspect 负责标记缺失) */
function interpolateEnvRefs(value: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => process.env[name] ?? match)
}

/**
 * 加载业务项目根目录的 .env 文件到进程环境(Node 内建 process.loadEnvFile)。
 * 已存在的环境变量优先,不会被文件覆盖;.env 缺失或不可解析时静默跳过。
 * `.env` 通常包含敏感信息,应加入 .gitignore。
 */
export function loadProjectEnvFile(root: string = process.cwd()): void {
  try {
    process.loadEnvFile(join(root, '.env'))
  } catch {
    // .env 不存在 / 不可解析:跳过(引用了未定义变量时由 doctor / inspect 标记)
  }
}

/** 读取并校验业务项目的 testpilot.yaml;文件不存在时返回默认配置 */
export async function loadTestpilotConfig(cwd: string = process.cwd()): Promise<TestpilotConfig> {
  loadProjectEnvFile(cwd)
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

  const parsed = result.data

  // 环境配置段只放 ${ENV_VAR} 引用不放明文(§10);此处注入进程环境变量。
  // environment 的 default 键是环境名,不做插值。
  const environment = parsed.environment
    ? Object.fromEntries(
        Object.entries(parsed.environment).map(([name, entry]) => {
          if (name === 'default' || typeof entry === 'string') {
            return [name, entry]
          }
          if (entry === undefined) {
            return [name, undefined]
          }
          return [
            name,
            { baseUrl: entry.baseUrl === undefined ? undefined : interpolateEnvRefs(entry.baseUrl) },
          ]
        }),
      )
    : undefined

  return {
    version: parsed.version,
    // 用例目录:旧字段 casesDir 优先,其次 test.caseDirectory,最后默认值
    casesDir: parsed.casesDir ?? parsed.test?.caseDirectory ?? DEFAULT_CASES_DIR,
    testDirectory: parsed.test?.directory,
    projectName: parsed.project?.name,
    environment,
    variables: parsed.variables
      ? Object.fromEntries(
          Object.entries(parsed.variables).map(([name, value]) => [name, interpolateEnvRefs(value)]),
        )
      : undefined,
    adapters: parsed.adapters,
    workspace: parsed.workspace,
    server: parsed.server
      ? {
          baseUrl:
            parsed.server.baseUrl === undefined
              ? undefined
              : interpolateEnvRefs(parsed.server.baseUrl),
        }
      : undefined,
    web: parsed.web
      ? {
          baseUrl:
            parsed.web.baseUrl === undefined ? undefined : interpolateEnvRefs(parsed.web.baseUrl),
        }
      : undefined,
    api: parsed.api
      ? {
          baseUrl: parsed.api.baseUrl === undefined ? undefined : interpolateEnvRefs(parsed.api.baseUrl),
          timeoutMs: parsed.api.timeoutMs,
        }
      : undefined,
    miniapp: parsed.miniapp
      ? {
          projectPath:
            parsed.miniapp.projectPath === undefined
              ? undefined
              : interpolateEnvRefs(parsed.miniapp.projectPath),
          cliPath:
            parsed.miniapp.cliPath === undefined ? undefined : interpolateEnvRefs(parsed.miniapp.cliPath),
        }
      : undefined,
  }
}
