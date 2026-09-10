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
  cases: CaseResult[]
  totals: RunTotals
}
