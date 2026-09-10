import type { Db } from '../db'
import { insertCase, listCaseRows, updateCase } from '../repositories/case-repo'
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
 * 快照式 Case Metadata 同步(CI / Webhook 的正式入口):
 * 以本次 Git Commit 的完整 Case 列表为准,
 * 快照中没有的 active Case 标记为 deleted(历史 Run 仍可引用),
 * 并更新项目的 lastSyncedCommit / lastSyncedAt。
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

  let added = 0
  let updated = 0
  const incomingFiles = new Set<string>()

  for (const item of payload.cases) {
    const filePath = normalizeFile(item.file)
    incomingFiles.add(filePath)
    const values = {
      caseId: item.id,
      name: item.title ?? item.id,
      filePath,
      tagsJson: JSON.stringify(item.tags ?? []),
      valid: 1,
      status: 'active' as const,
      branch: payload.branch,
      commit: payload.commit,
      checkedAt: now,
    }
    const row = byFile.get(filePath)
    if (!row) {
      await insertCase(db, { projectId, ...values })
      added++
      continue
    }
    const changed =
      row.status !== 'active' ||
      row.caseId !== values.caseId ||
      row.commit !== values.commit ||
      row.name !== values.name ||
      row.tagsJson !== values.tagsJson
    if (changed) {
      await updateCase(db, row.id, values)
      updated++
    }
  }

  let deleted = 0
  for (const row of existing) {
    if (row.status === 'active' && !incomingFiles.has(row.filePath)) {
      await updateCase(db, row.id, {
        status: 'deleted',
        branch: payload.branch,
        commit: payload.commit,
        checkedAt: now,
      })
      deleted++
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

/** 项目的 Git 同步状态(Web 项目概览展示) */
export async function getSyncStatus(db: Db, projectId: number) {
  const project = await requireProject(db, projectId)
  const activeCases = await listCaseRows(db, projectId, { status: 'active' })
  return {
    projectId,
    branch: project.defaultBranch,
    lastSyncedCommit: project.lastSyncedCommit,
    lastSyncedAt: project.lastSyncedAt,
    caseCount: activeCases.length,
  }
}
