import { existsSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { inspectProject, TestPilotClient } from '@testpilot/sdk'
import type { Db } from '../db'
import {
  findProjectByRoot,
  getProjectRow,
  insertProject,
  listProjectRows,
  updateProject,
  type ProjectRow,
} from '../repositories/project-repo'

export type { ProjectRow }

export interface CreateProjectInput {
  name: string
  /** 本地根目录(提供时项目可本地执行;纯索引项目可省略) */
  rootPath?: string
  repositoryUrl?: string
  defaultBranch?: string
}

export class ProjectConflictError extends Error {
  readonly statusCode = 409
  constructor(message: string) {
    super(message)
    this.name = 'ProjectConflictError'
  }
}

/** 启动时注册本地默认项目(按根目录幂等);配置变化时同步元数据 */
export async function registerProject(db: Db, root: string): Promise<ProjectRow> {
  const inspection = await inspectProject(root)
  const existing = await findProjectByRoot(db, inspection.root)
  const now = new Date().toISOString()

  const patch = {
    name: basename(inspection.root),
    casesDir: inspection.config.casesDir,
    skillInstalled: inspection.skillInstalled ? 1 : 0,
  }
  if (existing) {
    await updateProject(db, existing.id, patch)
    return (await getProjectRow(db, existing.id))!
  }
  return insertProject(db, {
    ...patch,
    rootPath: inspection.root,
    createdAt: now,
    updatedAt: now,
  })
}

/** 注册远端项目(init / API 创建);同一 rootPath 幂等 */
export async function createProject(
  db: Db,
  input: CreateProjectInput,
): Promise<ProjectRow> {
  if (!input.name || input.name.trim().length === 0) {
    throw Object.assign(new Error('项目名称不能为空'), { statusCode: 400 })
  }

  let inspection: Awaited<ReturnType<typeof inspectProject>> | undefined
  if (input.rootPath) {
    inspection = await inspectProject(input.rootPath).catch(() => undefined)
  }

  if (inspection) {
    const existing = await findProjectByRoot(db, inspection.root)
    if (existing) {
      throw new ProjectConflictError(
        `该根目录已注册为项目 ${existing.name}(#${existing.id})`,
      )
    }
  }

  const now = new Date().toISOString()
  return insertProject(db, {
    name: input.name.trim(),
    rootPath: inspection?.root ?? input.rootPath ?? null,
    casesDir: inspection?.config.casesDir ?? null,
    skillInstalled: inspection?.skillInstalled ? 1 : 0,
    repositoryUrl: input.repositoryUrl ?? null,
    defaultBranch: input.defaultBranch ?? null,
    createdAt: now,
    updatedAt: now,
  })
}

export async function listProjectsWithCounts(db: Db): Promise<
  Array<ProjectRow & { caseCount: number }>
> {
  const { listCaseRows } = await import('../repositories/case-repo')
  const rows = await listProjectRows(db)
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      caseCount: (await listCaseRows(db, row.id, { status: 'active' })).length,
    })),
  )
}

export async function getProjectOrThrow(db: Db, id: number): Promise<ProjectRow> {
  const row = await getProjectRow(db, id)
  if (!row) {
    throw Object.assign(new Error(`项目不存在:${id}`), { statusCode: 404 })
  }
  return row
}

/** 打开本地目录:校验存在后按 rootPath 幂等注册(与 csspilot init 的项目关联同思路) */
export async function openLocalProject(db: Db, rootPath: string): Promise<ProjectRow> {
  const trimmed = rootPath?.trim()
  if (!trimmed) {
    throw Object.assign(new Error('请提供本地目录路径'), { statusCode: 400 })
  }
  const root = resolve(trimmed)
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw Object.assign(new Error(`本地目录不存在或不是文件夹:${root}`), { statusCode: 422 })
  }
  return registerProject(db, root)
}

/** 可本地执行的项目的 SDK 客户端 */
export function clientFor(project: ProjectRow): TestPilotClient {
  if (!project.rootPath) {
    throw Object.assign(
      new Error(`项目 ${project.name} 未配置本地根目录,无法执行本地运行`),
      { statusCode: 422 },
    )
  }
  return new TestPilotClient({ root: project.rootPath })
}
