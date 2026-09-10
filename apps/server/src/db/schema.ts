import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

/**
 * Control Plane 元数据(V0.1 增量设计 v4)。
 * - Git 是 Case 的 Source of Truth;Server 只存 Case Metadata / Index,不是第二个 Git
 * - Git Push -> CI -> sync-metadata 是 Case 进入 Server 的正式同步边界
 * - 截图、视频、trace 等大文件留在业务项目 .testpilot/artifacts/,不入库
 */

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** 业务项目根目录(本地执行时使用;纯远端注册的项目可为空) */
  rootPath: text('root_path'),
  casesDir: text('cases_dir'),
  /** .agents/skills/testpilot/ 是否已安装(0/1) */
  skillInstalled: integer('skill_installed').notNull().default(0),
  repositoryUrl: text('repository_url'),
  defaultBranch: text('default_branch'),
  /** 最近一次 metadata sync 的 Git 快照 */
  lastSyncedCommit: text('last_synced_commit'),
  lastSyncedAt: text('last_synced_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/** 项目级测试环境(TEST / STAGING / PROD);真正决定运行行为的是"项目 + 环境" */
export const environments = sqliteTable('environments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id),
  name: text('name').notNull(),
  /** 该环境对应的 Git 分支:分支即测试环境(如 TEST→main,STAGING→release) */
  branch: text('branch'),
  baseUrl: text('base_url'),
  /** 任意 JSON 变量 */
  varsJson: text('vars_json'),
  createdAt: text('created_at').notNull(),
})

/**
 * Case Metadata 索引。Git push 后由 sync-metadata 以快照方式同步:
 * 不在本次快照中的 active Case 标记为 deleted(历史 Run 仍可引用)。
 */
export const cases = sqliteTable(
  'cases',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
    /** DSL 里的 case id */
    caseId: text('case_id').notNull(),
    name: text('name'),
    /** 相对项目根目录的用例文件路径(POSIX 分隔符) */
    filePath: text('file_path').notNull(),
    tagsJson: text('tags_json').notNull().default('[]'),
    /** 最近一次校验是否通过(0/1) */
    valid: integer('valid').notNull().default(1),
    /** active | deleted;分支维度的成员状态聚合(active = 至少存在于一个已同步分支) */
    status: text('status').notNull().default('active'),
    branch: text('branch'),
    commit: text('commit_sha'),
    checkedAt: text('checked_at').notNull(),
  },
  (table) => [unique('cases_project_file_unique').on(table.projectId, table.filePath)],
)

/**
 * Case 的分支成员表:同一个 Case 可同时存在于多个分支(分支即测试环境)。
 * 快照同步按分支作用域更新——main 的同步不影响 release 上的成员状态。
 */
export const caseBranches = sqliteTable(
  'case_branches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    caseRowId: integer('case_row_id')
      .notNull()
      .references(() => cases.id),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
    branch: text('branch').notNull(),
    commit: text('commit_sha'),
    /** active | deleted(仅表示该 Case 在此分支上是否存在) */
    status: text('status').notNull().default('active'),
    checkedAt: text('checked_at').notNull(),
  },
  (table) => [unique('case_branch_unique').on(table.caseRowId, table.branch)],
)

/**
 * Test Workspace:一次测试运行所使用的多系统测试环境组合。
 * 绑定的是 Project Environment,不是 Project 本身。
 */
export const workspaces = sqliteTable('workspaces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const workspaceBindings = sqliteTable(
  'workspace_bindings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
    environmentId: integer('environment_id')
      .notNull()
      .references(() => environments.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => [unique('workspace_binding_unique').on(table.workspaceId, table.projectId)],
)

export const runs = sqliteTable('runs', {
  /** 引擎分配的 runId(yyyymmdd-NNN) */
  id: text('id').primaryKey(),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id),
  status: text('status').notNull(), // running | passed | failed | cancelled
  trigger: text('trigger').notNull().default('api'),
  /** 执行时的 Git 上下文(本地非 git 项目可为空) */
  branch: text('branch'),
  commit: text('commit_sha'),
  /** 使用的测试环境组合 */
  workspaceId: integer('workspace_id').references(() => workspaces.id),
  /** 运行时 Workspace 快照(JSON);Workspace 后续可改,历史 Run 必须可还原 */
  workspaceSnapshotJson: text('workspace_snapshot_json'),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  durationMs: integer('duration_ms'),
  totalsJson: text('totals_json'),
  message: text('message'),
})

export const runEvents = sqliteTable('run_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id),
  seq: integer('seq').notNull(),
  type: text('type').notNull(),
  payloadJson: text('payload_json').notNull(),
  ts: text('ts').notNull(),
})

export const reports = sqliteTable('reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id')
    .notNull()
    .unique()
    .references(() => runs.id),
  generatedAt: text('generated_at').notNull(),
  /** 绝对路径(文件本体在 .testpilot/artifacts/) */
  jsonPath: text('json_path').notNull(),
  htmlPath: text('html_path').notNull(),
})
