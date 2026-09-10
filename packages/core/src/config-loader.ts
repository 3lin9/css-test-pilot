import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { DEFAULT_CASES_DIR } from './constants'

const configSchema = z.strictObject({
  casesDir: z.string().min(1).optional(),
  web: z.strictObject({ baseUrl: z.string().min(1).optional() }).optional(),
  miniapp: z
    .strictObject({
      projectPath: z.string().min(1).optional(),
      cliPath: z.string().min(1).optional(),
    })
    .optional(),
})

export interface TestpilotConfig {
  casesDir: string
  web?: { baseUrl?: string }
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
    casesDir: result.data.casesDir ?? DEFAULT_CASES_DIR,
    web: result.data.web,
    miniapp: result.data.miniapp,
  }
}
