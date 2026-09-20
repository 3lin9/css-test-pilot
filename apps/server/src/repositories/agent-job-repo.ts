import { and, asc, desc, eq } from 'drizzle-orm'
import { agentJobEvents, agentJobs } from '../db/schema'
import type { Db } from '../db'

export type AgentJobStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled'
export type AgentJobRow = typeof agentJobs.$inferSelect
export type AgentJobInsert = typeof agentJobs.$inferInsert
export type AgentJobEventRow = typeof agentJobEvents.$inferSelect

export async function insertAgentJob(db: Db, values: AgentJobInsert): Promise<AgentJobRow> {
  const rows = await db.insert(agentJobs).values(values).returning()
  return rows[0]!
}

export async function getAgentJobRow(db: Db, id: string): Promise<AgentJobRow | undefined> {
  const rows = await db.select().from(agentJobs).where(eq(agentJobs.id, id)).limit(1)
  return rows[0]
}

export async function listAgentJobRows(
  db: Db,
  filter: { projectId?: number; status?: AgentJobStatus } = {},
): Promise<AgentJobRow[]> {
  const conditions = []
  if (filter.projectId !== undefined) conditions.push(eq(agentJobs.projectId, filter.projectId))
  if (filter.status !== undefined) conditions.push(eq(agentJobs.status, filter.status))
  const query = db.select().from(agentJobs).$dynamic()
  if (conditions.length > 0) query.where(and(...conditions))
  return query.orderBy(desc(agentJobs.startedAt))
}

export async function updateAgentJob(
  db: Db,
  id: string,
  patch: Partial<
    Pick<
      AgentJobInsert,
      | 'status'
      | 'caseFile'
      | 'caseId'
      | 'runId'
      | 'message'
      | 'nextStepsJson'
      | 'finishedAt'
    >
  >,
): Promise<void> {
  await db.update(agentJobs).set(patch).where(eq(agentJobs.id, id))
}

export async function insertAgentJobEvent(
  db: Db,
  values: typeof agentJobEvents.$inferInsert,
): Promise<void> {
  await db.insert(agentJobEvents).values(values)
}

export async function listAgentJobEvents(db: Db, jobId: string): Promise<AgentJobEventRow[]> {
  return db
    .select()
    .from(agentJobEvents)
    .where(eq(agentJobEvents.jobId, jobId))
    .orderBy(asc(agentJobEvents.seq))
}
