export type FailureCategory = 'assert' | 'element' | 'adapter' | 'env' | 'timeout' | 'other'

export const FAILURE_CATEGORIES: Array<{ id: FailureCategory; label: string }> = [
  { id: 'assert', label: '断言失败' },
  { id: 'element', label: '元素未找到' },
  { id: 'adapter', label: 'Adapter 问题' },
  { id: 'env', label: '环境 / 连接' },
  { id: 'timeout', label: '超时' },
  { id: 'other', label: '其他' },
]

export function categoryLabel(id: FailureCategory): string {
  return FAILURE_CATEGORIES.find((item) => item.id === id)?.label ?? id
}

/** 命中顺序即优先级:更具体的特征在前(如 "waiting for locator" 优先于通用超时) */
const RULES: Array<{ id: FailureCategory; pattern: RegExp }> = [
  { id: 'assert', pattern: /断言失败|AssertionError|expect\(.+\)\.to/i },
  { id: 'element', pattern: /未找到元素|等待元素超时|waiting for locator|waiting for selector|element not found/i },
  { id: 'adapter', pattern: /未注册 target|ADAPTER_NOT_FOUND|无法定位 TestPilot Skill/i },
  { id: 'env', pattern: /net::ERR|ECONNREFUSED|Connection closed|Failed to launch|服务端口|不可达|ENOTFOUND|EACCES/i },
  { id: 'timeout', pattern: /timeout|超时/i },
]

/** 从错误信息推断失败分类;无法识别归入 other */
export function classifyFailure(message: string | undefined): FailureCategory {
  if (!message) return 'other'
  for (const rule of RULES) {
    if (rule.pattern.test(message)) return rule.id
  }
  return 'other'
}

/** 错误码 → 分类(确定性映射,优先于 message regex);未知码返回 undefined 交给 legacy 路径 */
const CODE_CATEGORIES: Readonly<Record<string, FailureCategory>> = {
  ASSERTION_FAILED: 'assert',
  REQUEST_COUNT_MISMATCH: 'assert',
  STATUS_MISMATCH: 'assert',
  STEP_TIMEOUT: 'assert',
  ELEMENT_NOT_FOUND: 'element',
  ADAPTER_NOT_FOUND: 'adapter',
  UNSUPPORTED_ACTION: 'adapter',
  CONFIG_MISSING: 'adapter',
  ENVIRONMENT_UNAVAILABLE: 'env',
  FIXTURE_MISSING: 'env',
  ACCOUNT_UNAVAILABLE: 'env',
  PREREQ_VARIABLE_MISSING: 'other',
}

/** 从步骤/用例错误码直接映射分类;无码或未知码返回 undefined */
export function classifyFromCode(code: string | undefined): FailureCategory | undefined {
  if (code === undefined) return undefined
  return CODE_CATEGORIES[code]
}
