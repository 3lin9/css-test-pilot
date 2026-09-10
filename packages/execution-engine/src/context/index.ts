/** 用例级执行上下文:extract 提取的变量与模板解析 */
export class ExecutionContext {
  private readonly variables = new Map<string, string>()

  set(name: string, value: string): void {
    this.variables.set(name, value)
  }

  get(name: string): string | undefined {
    return this.variables.get(name)
  }

  /** 将字符串中的 ${name} 替换为已提取的变量值;未定义的引用保持原样(校验阶段已拦截) */
  resolve(template: string): string {
    return template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) =>
      this.variables.get(name) ?? match,
    )
  }
}
