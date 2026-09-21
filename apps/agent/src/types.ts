/** Agent 任务事件:供 Server 持久化与 Web 流式展示 */
export type AgentEventType =
  | 'job-started'
  | 'step'
  | 'tool-call'
  | 'tool-result'
  | 'case-written'
  | 'validation'
  | 'run-started'
  | 'run-finished'
  | 'job-finished'
  | 'error'

export interface AgentEvent {
  type: AgentEventType
  ts: string
  message?: string
  data?: Record<string, unknown>
}

export type AgentEventHandler = (event: AgentEvent) => void

export interface AgentJobInput {
  /** 自然语言或含 ```yaml``` 的需求描述 */
  prompt: string
  /** 写入后是否立刻执行(默认 false;草稿 Case 通常需先补 locator) */
  runAfterCreate?: boolean
  /** 覆盖已存在的同名 Case 文件 */
  overwrite?: boolean
  /** 显式指定相对路径;缺省由 planner 推断 */
  file?: string
  signal?: AbortSignal
}

export interface AnalysisReport {
  runId?: string
  /** 归因结论 */
  verdict:
    | 'passed'
    | 'skipped'
    | 'cancelled'
    | 'not-run'
    | 'draft-placeholder'
    | 'case-issue'
    | 'env-issue'
    | 'timeout'
    | 'product-bug-or-unknown'
  summary: string
  failedSteps: Array<{
    caseId: string
    index: number
    target: string
    action: string
    error?: string
    screenshot?: string
  }>
  suggestions: string[]
  reportHtml?: string
  reportJson?: string
  totals?: {
    cases: number
    passed: number
    failed: number
    steps: number
    stepsPassed: number
    stepsFailed: number
    stepsSkipped: number
  }
  status?: 'passed' | 'failed' | 'skipped' | 'cancelled'
}

export interface AgentJobResult {
  status: 'passed' | 'failed' | 'cancelled'
  /** 写入的 Case 相对路径(POSIX) */
  caseFile?: string
  caseId?: string
  /** 本地执行产生的 runId(仅 runAfterCreate 时) */
  runId?: string
  message: string
  /** 下一步:commit / push / sync-metadata */
  nextSteps: string[]
  /** Analysis Agent 产出 */
  analysis?: AnalysisReport
}

export interface AgentToolContext {
  emit: AgentEventHandler
  signal?: AbortSignal
}
