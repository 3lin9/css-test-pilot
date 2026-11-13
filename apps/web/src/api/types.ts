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

export type RunStatus = 'running' | 'passed' | 'failed' | 'blocked' | 'inconclusive' | 'skipped' | 'cancelled'

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
  /** 显式指定的业务系统(testpilot.yaml systems 名称) */
  system?: string
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

/** UI 观测:用例执行期间采集的浏览器控制台消息(敏感值已脱敏) */
export interface ConsoleEntry {
  level: string
  text: string
}

/** UI 观测:已完成的网络请求(条数与 URL 长度有上限) */
export interface NetworkEntry {
  method: string
  url: string
  status: number
  durationMs?: number
}

export interface CaseResult {
  caseId: string
  caseName: string
  file: string
  rowId?: string
  rowIndex?: number
  status: 'passed' | 'failed' | 'blocked' | 'inconclusive' | 'skipped'
  /** 第一个失败步骤的错误码(三态判定依据) */
  errorCode?: string
  steps: StepResult[]
  startedAt: string
  finishedAt: string
  durationMs: number
  error?: string
  video?: string
  /** 失败用例的 Playwright trace 包(相对 run 目录;报告页可一键回放) */
  trace?: string
  skipReason?: 'dependency-not-ready'
  missingDependencies?: string[]
  warnings?: string[]
  /** UI 观测:控制台消息(testpilot-console 附件经 ingest 归一) */
  consoleLog?: ConsoleEntry[]
  /** UI 观测:网络请求(testpilot-network 附件经 ingest 归一) */
  networkLog?: NetworkEntry[]
}

export interface RunSummary {
  runId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  status: 'passed' | 'failed' | 'blocked' | 'inconclusive' | 'skipped'
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

/** 环境凭据列表项(值只写不回显,仅返回 key) */
export interface SecretKeyEntry {
  secretKey: string
  updatedAt: string
}

// ---- 项目跨 run 汇总(GET /api/projects/:id/overview) ----

/** 用例级历史迷你条的一个点(一次 run 里该用例的结果) */
export interface OverviewCasePoint {
  runId: string
  startedAt: string
  status: string
}

/** 用例级跨 run 聚合:历史序列 + 最近状态 + 失败次数 */
export interface OverviewCase {
  caseId: string
  caseName: string
  file: string
  /** 时间正序(最新在右) */
  history: OverviewCasePoint[]
  lastStatus?: string
  lastRunId?: string
  lastRunAt?: string
  failCount: number
}

export interface OverviewRun {
  runId: string
  startedAt?: string
  status: string
  passed: number
  failed: number
  durationMs?: number
}

export interface ProjectOverview {
  generatedAt: string
  runs: OverviewRun[]
  cases: OverviewCase[]
  /** 失败次数最多的用例(回归热点) */
  topFailures: Array<{ caseId: string; caseName: string; file: string; failCount: number }>
  /** 清淤清单:最近 14 天没跑过的 active 用例(lastRunAt 缺失 = 从未跑过) */
  staleCases: Array<{ caseId: string; caseName: string; file: string; lastRunAt?: string }>
}
