import type { TestpilotConfig } from '@testpilot/core'

export interface RunEnvironment {
  name: string
  extraEnv: Record<string, string>
}

/**
 * Resolve the selected environment from testpilot.yaml for native test processes.
 * TEST_BASE_URL 仍作为别名写入子进程,兼容旧模板和已有脚本。
 */
export function resolveRunEnvironment(config: TestpilotConfig, requested?: string): RunEnvironment | undefined {
  const environments = config.environment
  const defaultName = typeof environments?.default === 'string' ? environments.default : undefined
  const name = requested ?? defaultName
  if (!name) return undefined

  const entry = name === 'default' ? undefined : environments?.[name]
  if (entry === undefined) {
    const available = Object.keys(environments ?? {}).filter((key) => key !== 'default')
    const availableText = available.length > 0 ? `可用环境:${available.join(', ')}` : '未配置可用环境'
    throw new Error(`环境 "${name}" 未在 testpilot.yaml 中定义(${availableText})`)
  }

  const baseUrl = typeof entry === 'string' ? entry : entry.baseUrl
  if (baseUrl && /\$\{[^}]+\}/.test(baseUrl)) {
    throw new Error(`环境 "${name}" 的 baseUrl 引用了未设置的环境变量:${baseUrl}`)
  }

  return {
    name,
    extraEnv: {
      TESTPILOT_ENV: name,
      ...(baseUrl ? { TESTPILOT_BASE_URL: baseUrl, TEST_BASE_URL: baseUrl } : {}),
    },
  }
}
