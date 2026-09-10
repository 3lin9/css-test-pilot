import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { caseBranches, cases } from '../db/schema'

export type CaseRow = typeof cases.$inferSelect
export type CaseInsert = typeof cases.$inferInsert
export type CaseBranchRow = typeof caseBranches.$inferSelect

export type CaseStatus = 'active' | 'deleted'

export async function findCaseByFile(
  db: Db,
  projectId: number,
  filePath: string,
): Promise<CaseRow | undefined> {
  const rows = await db
    .select()
    .from(cases)
    .where(and(eq(cases.projectId, projectId), eq(cases.filePath, filePath)))
    .limit(1)
  return rows[0]
}

export async function findCaseByCaseId(
  db: Db,
  projectId: number,
  caseId: string,
): Promise<CaseRow | undefined> {
  const rows = await db
    .select()
    .from(cases)
    .where(and(eq(cases.projectId, projectId), eq(cases.caseId, caseId)))
    .limit(1)
  return rows[0]
}

export async function getCaseRow(db: Db, id: number): Promise<CaseRow | undefined> {
  const rows = await db.select().from(cases).where(eq(cases.id, id)).limit(1)
  return rows[0]
}

export async function listCaseRows(
  db: Db,
  projectId: number,
  filter: { status?: CaseStatus } = {},
): Promise<CaseRow[]> {
  const conditions = [eq(cases.projectId, projectId)]
  if (filter.status !== undefined) conditions.push(eq(cases.status, filter.status))
  return db
    .select()
    .from(cases)
    .where(and(...conditions))
    .orderBy(asc(cases.filePath))
}

export async function insertCase(db: Db, values: CaseInsert): Promise<CaseRow> {
  const rows = await db.insert(cases).values(values).returning()
  return rows[0]
}

export async function updateCase(
  db: Db,
  id: number,
  patch: Partial<CaseInsert>,
): Promise<void> {
  await db.update(cases).set(patch).where(eq(cases.id, id))
}

// ---- 分支成员(Case × Branch):分支即测试环境,同一 Case 可存在于多个分支 ----

export async function findCaseBranch(
  db: Db,
  caseRowId: number,
  branch: string,
): Promise<CaseBranchRow | undefined> {
  const rows = await db
    .select()
    .from(caseBranches)
    .where(and(eq(caseBranches.caseRowId, caseRowId), eq(caseBranches.branch, branch)))
    .limit(1)
  return rows[0]
}

export async function upsertCaseBranch(
  db: Db,
  values: typeof caseBranches.$inferInsert,
): Promise<CaseBranchRow> {
  const existing = await findCaseBranch(db, values.caseRowId, values.branch)
  if (existing) {
    await db.update(caseBranches).set(values).where(eq(caseBranches.id, existing.id))
    return { ...existing, ...values } as CaseBranchRow
  }
  const rows = await db.insert(caseBranches).values(values).returning()
  return rows[0]
}

/** 列出项目在某个分支上的全部分支成员记录(快照对比用) */
export async function listCaseBranchRowsByBranch(
  db: Db,
  projectId: number,
  branch: string,
): Promise<CaseBranchRow[]> {
  return db
    .select()
    .from(caseBranches)
    .where(and(eq(caseBranches.projectId, projectId), eq(caseBranches.branch, branch)))
}

/** 某个 Case 的全部分支成员 */
export async function listCaseBranchRows(db: Db, caseRowId: number): Promise<CaseBranchRow[]> {
  return db.select().from(caseBranches).where(eq(caseBranches.caseRowId, caseRowId))
}

export interface BranchSyncInfo {
  branch: string
  commit: string | null
  caseCount: number
  lastSyncedAt: string
}

/** 项目的全部分支成员(active),用于聚合 Case 视图的 branches 字段 */
export async function listActiveCaseBranchRowsByProject(
  db: Db,
  projectId: number,
): Promise<CaseBranchRow[]> {
  return db
    .select()
    .from(caseBranches)
    .where(and(eq(caseBranches.projectId, projectId), eq(caseBranches.status, 'active')))
}

/** 按分支聚合项目的同步状态(分支即测试环境,Web 按此展示) */
export async function listProjectBranches(db: Db, projectId: number): Promise<BranchSyncInfo[]> {
  const rows = await listActiveCaseBranchRowsByProject(db, projectId)
  const byBranch = new Map<string, BranchSyncInfo>()
  for (const row of rows) {
    const info = byBranch.get(row.branch) ?? {
      branch: row.branch,
      commit: row.commit,
      caseCount: 0,
      lastSyncedAt: row.checkedAt,
    }
    info.caseCount++
    if (row.commit) info.commit = row.commit
    if (row.checkedAt > info.lastSyncedAt) info.lastSyncedAt = row.checkedAt
    byBranch.set(row.branch, info)
  }
  return [...byBranch.values()].sort((a, b) => a.branch.localeCompare(b.branch))
}
