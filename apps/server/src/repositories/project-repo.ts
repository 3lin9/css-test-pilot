import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { projects } from '../db/schema'

export type ProjectRow = typeof projects.$inferSelect
export type ProjectInsert = typeof projects.$inferInsert

/** 按根目录查找本地项目;不存在返回 undefined */
export async function findProjectByRoot(db: Db, rootPath: string): Promise<ProjectRow | undefined> {
  const rows = await db.select().from(projects).where(eq(projects.rootPath, rootPath)).limit(1)
  return rows[0]
}

export async function getProjectRow(db: Db, id: number): Promise<ProjectRow | undefined> {
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1)
  return rows[0]
}

export async function listProjectRows(db: Db): Promise<ProjectRow[]> {
  return db.select().from(projects).orderBy(projects.id)
}

export async function insertProject(db: Db, values: ProjectInsert): Promise<ProjectRow> {
  const rows = await db.insert(projects).values(values).returning()
  return rows[0]
}

export async function updateProject(
  db: Db,
  id: number,
  patch: Partial<ProjectInsert>,
): Promise<void> {
  await db
    .update(projects)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(projects.id, id))
}
