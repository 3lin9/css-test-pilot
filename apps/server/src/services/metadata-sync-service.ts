import Database from 'better-sqlite3'
import type { Db } from '../db'
import {
  insertCase,
  listCaseBranchRows,
  listCaseBranchRowsByBranch,
  listCaseRows,
  listProjectBranches,
  updateCase,
  upsertCaseBranch,
} from '../repositories/case-repo'
import { getProjectRow, updateProject } from '../repositories/project-repo'

export interface CaseSyncItem {
  /** DSL case id */
  id: string
  title?: string
  /** 相对项目根目录的文件路径(POSIX 分隔符) */
  file: string
  tags?: string[]
}

export interface CaseSyncPayload {
  repository?: string
  branch: string
  commit: string
  cases: CaseSyncItem[]
}

export interface CaseSyncResult {
  projectId: number
  branch: string
  commit: string
  added: number
  updated: number
  deleted: number
  activeTotal: number
}

export class SyncError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'SyncError'
  }
}

/** 单次同步的 Case 条目上限;防止超大 payload 拖垮同步 */
const MAX_SYNC_CASES = 2000

/**
 * 归一并用例文件路径:仅接受项目根目录内的相对 POSIX 路径。
 * 显式拒绝绝对路径、盘符与任何 .. 段 —— file 会用于拼接 rootPath 读取用例源文件,
 * 不设防会让任意文件读取成为可能。
 */
function normalizeFile(file: string): string {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  if (!normalized) throw new SyncError('case file 路径不能为空')
  if (/^([a-zA-Z]:)?\//.test(normalized)) {
    throw new SyncError(`case file 必须是项目内相对路径:${file}`)
  }
  if (normalized.split('/').includes('..')) {
    throw new SyncError(`case file 不允许包含 .. 段:${file}`)
  }
  return normalized
}

/**
 * 快照式 Case Metadata 同步(CI / Webhook 的正式入口),按分支作用域执行:
 * - 分支即测试环境:main 的同步不会影响 release 等其他分支上的成员状态
 * - 以本次 Git Commit 的完整 Case 列表为准,该分支快照中消失的 Case
 *   在此分支上标记 deleted(其他分支不受影响;历史 Run 仍可引用)
 * - 更新项目的 lastSyncedCommit / lastSyncedAt
 */
export async function syncProjectCases(
  db: Db,
  projectId: number,
  payload: CaseSyncPayload,
): Promise<CaseSyncResult> {
  const project = await requireProject(db, projectId)
  if (!payload.branch || !payload.commit) {
    throw new SyncError('sync payload 需要提供 branch 与 commit')
  }
  if (!Array.isArray(payload.cases)) {
    throw new SyncError('sync payload 需要提供 cases 数组')
  }
  if (payload.cases.length > MAX_SYNC_CASES) {
    throw new SyncError(`cases 数量超过上限 ${MAX_SYNC_CASES}:${payload.cases.length}`)
  }

  const now = new Date().toISOString()
  const existing = await listCaseRows(db, projectId)
  const byFile = new Map(existing.map((row) => [row.filePath, row]))
  const branchMembers = await listCaseBranchRowsByBranch(db, projectId, payload.branch)

  // 写库前先完整校验所有条目:任何非法输入直接 400,绝不留下半同步状态
  const normalizedCases = payload.cases.map((item) => {
    if (!item || typeof item.file !== 'string' || typeof item.id !== 'string' || !item.id) {
      throw new SyncError('cases[].id 与 cases[].file 必须是非空字符串')
    }
    return { item, filePath: normalizeFile(item.file) }
  })

  let added = 0
  let updated = 0
  let deleted = 0
  const incomingFiles = new Set<string>()
  const touchedCaseRows = new Set<number>()

  // better-sqlite3 的 drizzle transaction 不接受 async 回调,改用底层连接的显式事务
  // (BEGIN IMMEDIATE 锁写;单连接上语句按序执行,await 间隙不会插入其他请求的写)
  const sqlite = (db as unknown as { $client: Database.Database }).$client
  sqlite.exec('BEGIN IMMEDIATE')
  try {
    for (const { item, filePath } of normalizedCases) {
      incomingFiles.add(filePath)

      let caseRow = byFile.get(filePath)
      if (!caseRow) {
        caseRow = await insertCase(db, {
          projectId,
          caseId: item.id,
          name: item.title ?? item.id,
          filePath,
          tagsJson: JSON.stringify(item.tags ?? []),
          valid: 1,
          status: 'active',
          branch: payload.branch,
          commit: payload.commit,
          checkedAt: now,
        })
        added++
      } else {
        const changed =
          caseRow.status !== 'active' ||
          caseRow.caseId !== item.id ||
          caseRow.name !== (item.title ?? item.id) ||
          caseRow.tagsJson !== JSON.stringify(item.tags ?? [])
        if (changed) {
          await updateCase(db, caseRow.id, {
            caseId: item.id,
            name: item.title ?? item.id,
            tagsJson: JSON.stringify(item.tags ?? []),
            status: 'active',
            branch: payload.branch,
            commit: payload.commit,
            checkedAt: now,
          })
          updated++
        }
      }
      touchedCaseRows.add(caseRow.id)

      // 分支成员:在本分支的快照中 -> active
      await upsertCaseBranch(db, {
        caseRowId: caseRow.id,
        projectId,
        branch: payload.branch,
        commit: payload.commit,
        status: 'active',
        checkedAt: now,
      })
    }

    // 分支内删除:本分支的上一次快照有、本次没有的 Case -> 该分支成员 deleted
    for (const member of branchMembers) {
      if (member.status === 'active' && !touchedCaseRows.has(member.caseRowId)) {
        await upsertCaseBranch(db, {
          caseRowId: member.caseRowId,
          projectId,
          branch: payload.branch,
          commit: payload.commit,
          status: 'deleted',
          checkedAt: now,
        })
        deleted++
      }
    }

    // 聚合 Case 状态:所有分支成员都是 deleted 时,Case 整体才是 deleted
    for (const caseRow of existing) {
      if (touchedCaseRows.has(caseRow.id)) continue
      const memberships = await listCaseBranchRows(db, caseRow.id)
      const activeAnywhere = memberships.some((m) => m.status === 'active')
      const nextStatus = activeAnywhere ? 'active' : 'deleted'
      if (caseRow.status !== nextStatus) {
        await updateCase(db, caseRow.id, {
          status: nextStatus,
          branch: payload.branch,
          commit: payload.commit,
          checkedAt: now,
        })
      }
    }

    await updateProject(db, projectId, {
      repositoryUrl: payload.repository ?? project.repositoryUrl,
      defaultBranch: project.defaultBranch ?? payload.branch,
      lastSyncedCommit: payload.commit,
      lastSyncedAt: now,
    })
    sqlite.exec('COMMIT')
  } catch (err) {
    sqlite.exec('ROLLBACK')
    throw err
  }

  const activeRows = await listCaseRows(db, projectId, { status: 'active' })
  return {
    projectId,
    branch: payload.branch,
    commit: payload.commit,
    added,
    updated,
    deleted,
    activeTotal: activeRows.length,
  }
}

async function requireProject(db: Db, projectId: number) {
  const row = await getProjectRow(db, projectId)
  if (!row) {
    throw Object.assign(new Error(`项目不存在:${projectId}`), { statusCode: 404 })
  }
  return row
}

export interface BranchSyncStatus {
  branch: string
  commit: string | null
  caseCount: number
  lastSyncedAt: string
}

/** 项目的 Git 同步状态:按分支聚合(分支即测试环境),供 Web 项目概览展示 */
export async function getSyncStatus(db: Db, projectId: number) {
  const project = await requireProject(db, projectId)
  const branches = await listProjectBranches(db, projectId)
  const activeCases = await listCaseRows(db, projectId, { status: 'active' })
  return {
    projectId,
    branch: project.defaultBranch,
    lastSyncedCommit: project.lastSyncedCommit,
    lastSyncedAt: project.lastSyncedAt,
    caseCount: activeCases.length,
    branches,
  }
}
