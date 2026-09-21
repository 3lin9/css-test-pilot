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
   * 将字符串中的 ${name} 替换为已提取的变量值;未定义的引用保持原样(校验阶段已拦截)。
   * 名字允许点号,用于引擎注入的 account.username 一类凭据变量(用户 extract 变量名不含点号)。
   */
  resolve(template: string): string {
    return template.replace(/\$\{([A-Za-z_][A-Za-z0-9_.]*)\}/g, (match, name: string) =>
      this.variables.get(name) ?? match,
    )
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
