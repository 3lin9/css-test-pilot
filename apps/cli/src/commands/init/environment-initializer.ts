import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ENV_REF_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * 收集 testpilot.yaml 中引用的环境变量名(如 ${TEST_BASE_URL} -> TEST_BASE_URL)。
 * 环境配置段只放引用不放明文(设计文档 §10);doctor 用此列表检查变量是否就绪。
 * 只扫描生效行:注释掉的段(如默认模板中的 web/miniapp 示例)不产生误报。
 */
export async function collectEnvVarRefs(root: string): Promise<string[]> {
  let text: string
  try {
    text = await readFile(join(root, 'testpilot.yaml'), 'utf8')
  } catch {
    return []
  }
  const names = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) continue
    for (const match of trimmed.matchAll(ENV_REF_PATTERN)) {
      names.add(match[1])
    }
  }
  return [...names].sort()
}
