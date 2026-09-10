import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { reports } from '../db/schema'

export interface ReportRow {
  id: number
  runId: string
  generatedAt: string
  jsonPath: string
  htmlPath: string
}

export async function findReportByRun(db: Db, runId: string): Promise<ReportRow | undefined> {
  const rows = await db.select().from(reports).where(eq(reports.runId, runId)).limit(1)
  return rows[0]
}

export async function insertReport(db: Db, values: Omit<ReportRow, 'id'>): Promise<ReportRow> {
  const rows = await db.insert(reports).values(values).returning()
  return rows[0]
}
