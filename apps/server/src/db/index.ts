import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export interface DbOptions {
  /** 业务项目根目录;数据库默认放在 <root>/.testpilot/server.db */
  root?: string
  dbPath?: string
}

/** 当前 schema 版本;结构变更时递增,V0.1 阶段直接重建(尚无需要保留的存量数据) */
const SCHEMA_VERSION = 3

/** 打开 SQLite 并确保表结构存在(版本不匹配时重建) */
export function openDatabase(options: DbOptions = {}): Db {
  const root = resolve(options.root ?? process.cwd())
  const file = resolve(options.dbPath ?? join(root, '.testpilot', 'server.db'))
  mkdirSync(dirname(file), { recursive: true })

  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  ensureSchema(sqlite)

  return drizzle(sqlite, { schema })
}

function ensureSchema(sqlite: Database.Database): void {
  const current = sqlite.pragma('user_version', { simple: true }) as number
  if (current !== SCHEMA_VERSION) {
    sqlite.exec(`
      DROP TABLE IF EXISTS reports;
      DROP TABLE IF EXISTS run_events;
      DROP TABLE IF EXISTS runs;
      DROP TABLE IF EXISTS workspace_bindings;
      DROP TABLE IF EXISTS workspaces;
      DROP TABLE IF EXISTS case_branches;
      DROP TABLE IF EXISTS cases;
      DROP TABLE IF EXISTS environments;
      DROP TABLE IF EXISTS projects;
    `)
  }

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

    CREATE TABLE IF NOT EXISTS run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(id),
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      ts TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS run_events_run_seq ON run_events (run_id, seq);

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
