import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export interface DbOptions {
  /**
   * 业务项目根目录。数据库不再落在业务项目内(避免 server.db 连同凭据被业务仓库提交),
   * root 仅用于迁移历史遗留的 per-project 旧库。
   */
  root?: string
  dbPath?: string
}

/** 当前 schema 版本;结构变更时递增。版本不匹配时把旧库整体备份后重建,绝不静默清数据 */
const SCHEMA_VERSION = 5

/** Control Plane 数据库默认位置:用户主目录 ~/.testpilot/server.db(可用 TESTPILOT_DB_PATH 或 dbPath 覆盖) */
export function defaultDbPath(): string {
  const override = process.env.TESTPILOT_DB_PATH
  if (override) return override
  return join(homedir(), '.testpilot', 'server.db')
}

/**
 * 一次性迁移:数据库曾按项目存放于 <root>/.testpilot/server.db,现已统一收归
 * ~/.testpilot。全局位置为空且项目内存在旧库时,把旧库搬到全局位置(原文件改名保留)。
 */
export function migrateLegacyDatabase(root: string, target: string): void {
  const legacy = join(resolve(root), '.testpilot', 'server.db')
  if (!existsSync(legacy) || existsSync(target)) return
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(legacy, target)
  renameSync(legacy, `${legacy}.migrated`)
}

/** 打开 SQLite 并确保表结构存在;版本不匹配时备份旧库文件后重建 */
export function openDatabase(options: DbOptions = {}): Db {
  const file = resolve(options.dbPath ?? defaultDbPath())
  if (!options.dbPath && options.root) {
    migrateLegacyDatabase(options.root, file)
  }
  mkdirSync(dirname(file), { recursive: true })

  let sqlite = new Database(file)
  const current = sqlite.pragma('user_version', { simple: true }) as number
  if (current !== SCHEMA_VERSION && current !== 0) {
    // 版本不匹配(升级/降级/旧结构):备份整个库文件(含 WAL/SHM)后以全新空库重建,
    // 历史 run/case 索引/凭据保留在备份文件里,不再直接 DROP
    sqlite.close()
    backupDatabaseFiles(file, current)
    sqlite = new Database(file)
  }

  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  ensureSchema(sqlite)

  return drizzle(sqlite, { schema })
}

/** 把数据库改名留档(如 server.db.bak-v3-20261111T...)后空出原路径;WAL 数据先 checkpoint 进主文件 */
function backupDatabaseFiles(file: string, fromVersion: number): void {
  const checkpointDb = new Database(file)
  checkpointDb.pragma('wal_checkpoint(TRUNCATE)')
  checkpointDb.close()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  renameSync(file, `${file}.bak-v${fromVersion}-${stamp}`)
  for (const extra of [`${file}-wal`, `${file}-shm`]) {
    if (existsSync(extra)) unlinkSync(extra)
  }
}

function ensureSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      root_path TEXT,
      cases_dir TEXT,
      skill_installed INTEGER NOT NULL DEFAULT 0,
      repository_url TEXT,
      default_branch TEXT,
      last_synced_commit TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS environments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      branch TEXT,
      base_url TEXT,
      vars_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      case_id TEXT NOT NULL,
      name TEXT,
      file_path TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      valid INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      branch TEXT,
      commit_sha TEXT,
      checked_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cases_project_file_unique ON cases (project_id, file_path);

    CREATE TABLE IF NOT EXISTS case_branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_row_id INTEGER NOT NULL REFERENCES cases(id),
      project_id INTEGER NOT NULL REFERENCES projects(id),
      branch TEXT NOT NULL,
      commit_sha TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      checked_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS case_branch_unique ON case_branches (case_row_id, branch);
    CREATE INDEX IF NOT EXISTS case_branch_project_branch ON case_branches (project_id, branch, status);

    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
      project_id INTEGER NOT NULL REFERENCES projects(id),
      environment_id INTEGER NOT NULL REFERENCES environments(id),
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS workspace_binding_unique ON workspace_bindings (workspace_id, project_id);

    -- 环境级凭据(accountRef 解析;加表不破坏旧库,无需 bump SCHEMA_VERSION)
    CREATE TABLE IF NOT EXISTS environment_secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      environment_id INTEGER NOT NULL REFERENCES environments(id),
      secret_key TEXT NOT NULL,
      secret_value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS environment_secret_unique ON environment_secrets (environment_id, secret_key);

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      status TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'api',
      branch TEXT,
      commit_sha TEXT,
      workspace_id INTEGER REFERENCES workspaces(id),
      workspace_snapshot_json TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      totals_json TEXT,
      message TEXT
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
      generated_at TEXT NOT NULL,
      json_path TEXT NOT NULL,
      html_path TEXT NOT NULL
    );
  `)

  sqlite.pragma(`user_version = ${SCHEMA_VERSION}`)
}
