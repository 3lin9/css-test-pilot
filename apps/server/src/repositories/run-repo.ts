import { and, asc, desc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { runEvents, runs } from '../db/schema'

export type RunStatus = 'running' | 'passed' | 'failed' | 'cancelled'
export type RunRow = typeof runs.$inferSelect
export type RunInsert = typeof runs.$inferInsert

export async function insertRun(db: Db, values: RunInsert): Promise<RunRow> {
  const rows = await db.insert(runs).values(values).returning()
  return rows[0]
}

export async function getRunRow(db: Db, id: string): Promise<RunRow | undefined> {
  const rows = await db.select().from(runs).where(eq(runs.id, id)).limit(1)
  return rows[0]
}

export async function listRunRows(
  db: Db,
  filter: { projectId?: number; status?: RunStatus } = {},
): Promise<RunRow[]> {
  const conditions = []
  if (filter.projectId !== undefined) conditions.push(eq(runs.projectId, filter.projectId))
  if (filter.status !== undefined) conditions.push(eq(runs.status, filter.status))
  const query = db.select().from(runs).$dynamic()
  if (conditions.length > 0) query.where(and(...conditions))
  return query.orderBy(desc(runs.startedAt), desc(runs.id))
}

export async function updateRun(
  db: Db,
  id: string,
  patch: Partial<RunInsert>,
): Promise<void> {
  await db.update(runs).set(patch).where(eq(runs.id, id))
}

export type RunEventRow = typeof runEvents.$inferSelect

export async function insertRunEvent(
  db: Db,
  values: typeof runEvents.$inferInsert,
): Promise<RunEventRow> {
  const rows = await db.insert(runEvents).values(values).returning()
  return rows[0]
}

export async function listRunEvents(db: Db, runId: string): Promise<RunEventRow[]> {
  return db.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(asc(runEvents.seq))
}
