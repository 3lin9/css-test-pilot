/**
 * 跨包共享的运行结果模型。
 * target / action 使用 string,避免 core 反向依赖 dsl;引擎填充时来自 DSL 枚举。
 */

export type StepStatus = 'passed' | 'failed' | 'skipped'
export type CaseStatus = 'passed' | 'failed'
export type RunStatus = CaseStatus

export interface StepResult {
  index: number
  target: string
  action: string
  status: StepStatus
  durationMs: number
  error?: string
  /** 相对 run 目录的截图路径 */
  screenshot?: string
  /** extract 步骤捕获的变量 */
  extracted?: Record<string, string>
  /** api target 的请求取证(敏感头已脱敏) */
  http?: HttpEvidence
}

/** api target:request 步骤的取证信息(体积截断,凭据脱敏) */
export interface HttpEvidence {
  method: string
  url: string
  status: number
  requestHeaders?: Record<string, string>
  requestBody?: string
  responseSnippet?: string
}

export interface CaseResult {
  caseId: string
  caseName: string
  file: string
  status: CaseStatus
  steps: StepResult[]
  startedAt: string
  finishedAt: string
  durationMs: number
  /** 用例级错误(如 adapter 缺失) */
  error?: string
  /** 相对 run 目录的用例录屏(仅支持录制的 adapter 产出) */
  video?: string
  /** 相对 run 目录的 trace 包(如 Playwright trace.zip) */
  trace?: string
}

export interface RunTotals {
  cases: number
  passed: number
  failed: number
  steps: number
  stepsPassed: number
  stepsFailed: number
  stepsSkipped: number
}

export interface RunSummary {
  runId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  status: RunStatus
  /** 因取消信号提前结束:已完成用例保留,未开始的用例不再执行 */
  cancelled?: boolean
  cases: CaseResult[]
  totals: RunTotals
}
