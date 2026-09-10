import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ENV_REF_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * 收集 testpilot.yaml 中引用的环境变量名(如 ${TEST_BASE_URL} -> TEST_BASE_URL)。
 * 环境配置段只放引用不放明文(设计文档 §10);doctor 用此列表检查变量是否就绪。
 */
export async function collectEnvVarRefs(root: string): Promise<string[]> {
  let text: string
  try {
    text = await readFile(join(root, 'testpilot.yaml'), 'utf8')
  } catch {
    return []
  }
  const names = new Set<string>()
  for (const match of text.matchAll(ENV_REF_PATTERN)) {
    names.add(match[1])
  }
  return [...names].sort()
}
