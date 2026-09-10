import type { Db } from '../db'
import {
  insertCase,
  listCaseBranchRows,
  listCaseBranchRowsByBranch,
  listCaseRows,
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

function normalizeFile(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '')
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

  const now = new Date().toISOString()
  const existing = await listCaseRows(db, projectId)
  const byFile = new Map(existing.map((row) => [row.filePath, row]))
  const branchMembers = await listCaseBranchRowsByBranch(db, projectId, payload.branch)

  let added = 0
  let updated = 0
  const incomingFiles = new Set<string>()
  const touchedCaseRows = new Set<number>()

  for (const item of payload.cases) {
    const filePath = normalizeFile(item.file)
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
  let deleted = 0
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
  const { listProjectBranches } = await import('../repositories/case-repo')
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
