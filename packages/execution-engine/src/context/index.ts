import { TestPilotError } from '@testpilot/core'

/** 用例级执行上下文:extract 提取的变量与模板解析 */
export class ExecutionContext {
  private readonly variables = new Map<string, string>()

  set(name: string, value: string): void {
    this.variables.set(name, value)
  }

  get(name: string): string | undefined {
    return this.variables.get(name)
  }

  seed(values: Record<string, string>): void {
    for (const [name, value] of Object.entries(values)) {
      this.variables.set(name, value)
    }
  }

  /**
   * 将字符串中的 ${name} 替换为已提取的变量值;未定义的引用抛 TestPilotError——
   * 校验阶段已静态拦截"从未声明"的引用,运行时未命中即数据未兑现
   * (前置 extract 未执行或 fixture/dataset/凭据缺失),按三态归 unverified/account 桶。
   * 名字允许点号,用于引擎注入的 account.username 一类凭据变量(用户 extract 变量名不含点号)。
   */
  resolve(template: string): string {
    return template.replace(/\$\{([A-Za-z_][A-Za-z0-9_.]*)\}/g, (_match, name: string) => {
      const value = this.variables.get(name)
      if (value !== undefined) return value
      throw new TestPilotError(
        name.startsWith('account') ? 'ACCOUNT_UNAVAILABLE' : 'PREREQ_VARIABLE_MISSING',
        `变量 "${name}" 未定义(前置 extract 未执行或 fixture/dataset/凭据缺失)`,
      )
    })
  }

  /**
   * 注入 accountRef 凭据:值为 JSON 对象时按 `${account.<字段>}` 展开为字符串,
   * 非 JSON 值整条注入为 `${account}`。凭据不进日志/取证,只进模板解析。
   */
  seedAccount(rawValue: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawValue)
    } catch {
      parsed = undefined
    }
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (value === null || value === undefined) continue
        this.variables.set(
          `account.${key}`,
          typeof value === 'object' ? JSON.stringify(value) : String(value),
        )
      }
      return
    }
    this.variables.set('account', rawValue)
  }
}
