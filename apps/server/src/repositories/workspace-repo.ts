import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { environments, projects, workspaceBindings, workspaces } from '../db/schema'

export type WorkspaceRow = typeof workspaces.$inferSelect
export type WorkspaceInsert = typeof workspaces.$inferInsert
export type WorkspaceBindingRow = typeof workspaceBindings.$inferSelect
export type EnvironmentRow = typeof environments.$inferSelect

// ---- environments ----

export async function listEnvironments(db: Db, projectId: number): Promise<EnvironmentRow[]> {
  return db
    .select()
    .from(environments)
    .where(eq(environments.projectId, projectId))
    .orderBy(asc(environments.id))
}

export async function getEnvironmentRow(
  db: Db,
  id: number,
): Promise<EnvironmentRow | undefined> {
  const rows = await db.select().from(environments).where(eq(environments.id, id)).limit(1)
  return rows[0]
}

export async function insertEnvironment(
  db: Db,
  values: typeof environments.$inferInsert,
): Promise<EnvironmentRow> {
  const rows = await db.insert(environments).values(values).returning()
  return rows[0]
}

// ---- workspaces ----

export async function listWorkspaces(db: Db): Promise<WorkspaceRow[]> {
  return db.select().from(workspaces).orderBy(asc(workspaces.id))
}

export async function getWorkspaceRow(db: Db, id: number): Promise<WorkspaceRow | undefined> {
  const rows = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1)
  return rows[0]
}

export async function findWorkspaceByName(
  db: Db,
  name: string,
): Promise<WorkspaceRow | undefined> {
  const rows = await db.select().from(workspaces).where(eq(workspaces.name, name)).limit(1)
  return rows[0]
}

export async function insertWorkspace(
  db: Db,
  values: WorkspaceInsert,
): Promise<WorkspaceRow> {
  const rows = await db.insert(workspaces).values(values).returning()
  return rows[0]
}

// ---- workspace bindings ----

export interface BindingView {
  projectId: number
  projectName: string
  environmentId: number
  environmentName: string
  branch: string | null
  baseUrl: string | null
}

/** Workspace 的全部绑定(含项目与环境信息,供快照与展示) */
export async function listBindings(db: Db, workspaceId: number): Promise<BindingView[]> {
  const rows = await db
    .select({
      projectId: workspaceBindings.projectId,
      projectName: projects.name,
      environmentId: workspaceBindings.environmentId,
      environmentName: environments.name,
      branch: environments.branch,
      baseUrl: environments.baseUrl,
    })
    .from(workspaceBindings)
    .innerJoin(environments, eq(workspaceBindings.environmentId, environments.id))
    .innerJoin(projects, eq(workspaceBindings.projectId, projects.id))
    .where(eq(workspaceBindings.workspaceId, workspaceId))
    .orderBy(asc(workspaceBindings.id))
  return rows
}

export async function findBinding(
  db: Db,
  workspaceId: number,
  projectId: number,
): Promise<WorkspaceBindingRow | undefined> {
  const rows = await db
    .select()
    .from(workspaceBindings)
    .where(
      and(
        eq(workspaceBindings.workspaceId, workspaceId),
        eq(workspaceBindings.projectId, projectId),
      ),
    )
    .limit(1)
  return rows[0]
}

export async function insertBinding(
  db: Db,
  values: typeof workspaceBindings.$inferInsert,
): Promise<WorkspaceBindingRow> {
  const rows = await db.insert(workspaceBindings).values(values).returning()
  return rows[0]
}
