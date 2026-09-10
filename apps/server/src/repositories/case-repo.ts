import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { cases } from '../db/schema'

export type CaseRow = typeof cases.$inferSelect
export type CaseInsert = typeof cases.$inferInsert

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
