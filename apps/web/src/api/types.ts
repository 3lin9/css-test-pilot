/** 与 Control Plane API 对应的类型(Web 只读,不定义写模型) */

export interface Project {
  id: number
  name: string
  rootPath: string | null
  casesDir: string | null
  skillInstalled: number
  repositoryUrl: string | null
  defaultBranch: string | null
  lastSyncedCommit: string | null
  lastSyncedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectWithCount extends Project {
  caseCount: number
}

export interface CaseView {
  id: number
  projectId: number
  caseId: string
  name: string | null
  filePath: string
  tags: string[]
  valid: boolean
  status: 'active' | 'deleted'
  /** 该 Case 存在的分支(分支即测试环境) */
  branches: string[]
  branch: string | null
  commit: string | null
  checkedAt: string
}

export interface BranchSyncStatus {
  branch: string
  commit: string | null
  caseCount: number
  lastSyncedAt: string
}

export interface SyncStatus {
  projectId: number
  branch: string | null
  lastSyncedCommit: string | null
  lastSyncedAt: string | null
  caseCount: number
  /** 按分支聚合的同步状态(分支即测试环境) */
  branches: BranchSyncStatus[]
}

export type RunStatus = 'running' | 'passed' | 'failed' | 'skipped' | 'cancelled'

export interface Run {
  id: string
  projectId: number
  status: RunStatus
  trigger: string
  branch: string | null
  commit: string | null
  workspaceId: number | null
  workspaceSnapshotJson: string | null
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  totalsJson: string | null
  message: string | null
}

export interface RunEvent {
  seq: number
  type: string
  ts: string
  event: Record<string, unknown> & { type: string }
}

export interface StepResult {
  index: number
  target: string
  action: string
  status: 'passed' | 'failed' | 'skipped' | 'warning'
  phase?: 'setup' | 'steps' | 'teardown'
  durationMs: number
  error?: string
  screenshot?: string
  extracted?: Record<string, string>
  /** api target 的请求取证(敏感头已脱敏) */
  http?: {
    method: string
    url: string
    status: number
    requestHeaders?: Record<string, string>
    requestBody?: string
    responseSnippet?: string
  }
  requestAssertions?: Array<{
    method?: string
    urlContains: string
    count: number
    actualCount: number
    windowMs: number
    requests: Array<{ method: string; url: string }>
  }>
}

export interface CaseResult {
  caseId: string
  caseName: string
  file: string
  rowId?: string
  rowIndex?: number
  status: 'passed' | 'failed' | 'skipped'
  steps: StepResult[]
  startedAt: string
  finishedAt: string
  durationMs: number
  error?: string
  video?: string
  trace?: string
  skipReason?: 'dependency-not-ready'
  missingDependencies?: string[]
  warnings?: string[]
}

export interface RunSummary {
  runId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  status: 'passed' | 'failed' | 'skipped'
  cancelled?: boolean
  cases: CaseResult[]
  totals: {
    templates?: number
    cases: number
    passed: number
    failed: number
    skipped?: number
    warnings?: number
    steps: number
    stepsPassed: number
    stepsFailed: number
    stepsSkipped: number
    stepsWarning?: number
  }
}

export interface ArtifactFile {
  path: string
  size: number
}

/** Workspace 绑定:一个项目在此 Workspace 中使用的环境 */
export interface WorkspaceBinding {
  projectId: number
  projectName: string
  environmentId: number
  environmentName: string
  /** 环境绑定的 Git 分支(分支即测试环境) */
  branch: string | null
  baseUrl: string | null
}

export interface Workspace {
  id: number
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkspaceWithBindings extends Workspace {
  bindings: WorkspaceBinding[]
}

export type WorkspaceDetail = WorkspaceWithBindings

export interface Environment {
  id: number
  projectId: number
  name: string
  /** 该环境对应的 Git 分支(分支即测试环境) */
  branch: string | null
  baseUrl: string | null
  createdAt: string
}

export type AgentJobStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled'

export interface AgentJob {
  id: string
  projectId: number
  status: AgentJobStatus
  prompt: string
  runAfterCreate: boolean
  overwrite: boolean
  fileHint: string | null
  caseFile: string | null
  caseId: string | null
  runId: string | null
  message: string | null
  nextSteps: string[]
  startedAt: string
  finishedAt: string | null
}

export interface AgentJobEvent {
  seq: number
  type: string
  ts: string
  event: Record<string, unknown> & {
    type: string
    message?: string
    data?: Record<string, unknown>
  }
}
