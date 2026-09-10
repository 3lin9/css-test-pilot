import { basename, relative } from 'node:path'
import { TestPilotClient } from '@testpilot/sdk'
import type { Db } from '../db'
import { getProjectRow, type ProjectRow } from '../repositories/project-repo'
import {
  findCaseByCaseId,
  getCaseRow,
  insertCase,
  listActiveCaseBranchRowsByProject,
  listCaseBranchRows,
  listCaseRows,
  type CaseRow,
  type CaseStatus,
} from '../repositories/case-repo'

export interface CaseView {
  id: number
  projectId: number
  caseId: string
  name: string | null
  filePath: string
  tags: string[]
  valid: boolean
  /** active | deleted;快照同步中消失的 Case 保留为 deleted,历史 Run 仍可引用 */
  status: CaseStatus
  /** 该 Case 存在的分支列表(分支即测试环境) */
  branches: string[]
  branch: string | null
  commit: string | null
  checkedAt: string
}

function toView(row: CaseRow, branches: string[]): CaseView {
  return {
    id: row.id,
    projectId: row.projectId,
    caseId: row.caseId,
    name: row.name,
    filePath: row.filePath,
    tags: JSON.parse(row.tagsJson) as string[],
    valid: row.valid === 1,
    status: row.status as CaseStatus,
    branches,
    branch: row.branch,
    commit: row.commit,
    checkedAt: row.checkedAt,
  }
}

async function requireProject(db: Db, projectId: number): Promise<ProjectRow> {
  const row = await getProjectRow(db, projectId)
  if (!row) {
    throw Object.assign(new Error(`项目不存在:${projectId}`), { statusCode: 404 })
  }
  return row
}

/** Case 视图的分支聚合:一次查询项目全部分支成员,按 Case 分组 */
async function branchMap(db: Db, projectId: number): Promise<Map<number, string[]>> {
  const rows = await listActiveCaseBranchRowsByProject(db, projectId)
  const map = new Map<number, string[]>()
  for (const row of rows) {
    const list = map.get(row.caseRowId) ?? []
    list.push(row.branch)
    map.set(row.caseRowId, list)
  }
  return map
}

/**
 * 读取 Case Index(只查库,不同步文件系统)。
 * Git 是 Case 的 Source of Truth;索引进唯一入口是 POST /api/projects/:id/cases/sync。
 */
export async function listCaseViews(
  db: Db,
  projectId: number,
  filter: { status?: CaseStatus } = {},
): Promise<CaseView[]> {
  await requireProject(db, projectId)
  const branches = await branchMap(db, projectId)
  return (await listCaseRows(db, projectId, filter)).map((row) =>
    toView(row, branches.get(row.id) ?? []),
  )
}

export async function getCaseViewById(db: Db, id: number): Promise<CaseView> {
  const row = await getCaseRow(db, id)
  if (!row) {
    throw Object.assign(new Error(`Case 不存在:${id}`), { statusCode: 404 })
  }
  const memberships = await listCaseBranchRows(db, row.id)
  return toView(
    row,
    memberships.filter((m) => m.status === 'active').map((m) => m.branch),
  )
}

/** 按 DSL case id 查询(project 内唯一) */
export async function getCaseViewByCaseId(
  db: Db,
  projectId: number,
  caseId: string,
): Promise<CaseView> {
  const row = await findCaseByCaseId(db, projectId, caseId)
  if (!row) {
    throw Object.assign(new Error(`Case 不存在:${caseId}`), { statusCode: 404 })
  }
  const memberships = await listCaseBranchRows(db, row.id)
  return toView(
    row,
    memberships.filter((m) => m.status === 'active').map((m) => m.branch),
  )
}

/** 读取 Case DSL 原文(仅限有本地根目录的项目;Web 不修改 Case 源文件) */
export async function readCaseSource(db: Db, id: number): Promise<CaseView & { source: string }> {
  const view = await getCaseViewById(db, id)
  const project = await requireProject(db, view.projectId)
  if (!project.rootPath) {
    throw Object.assign(new Error(`项目 ${project.name} 未配置本地根目录,无法读取 Case 源文件`), {
      statusCode: 422,
    })
  }
  const client = new TestPilotClient({ root: project.rootPath })
  const detail = await client.readCase(view.filePath)
  return { ...view, source: detail.source }
}

/** 本地扫描(仅供 init 后的首次索引等本地场景;CI 正式入口是 cases/sync) */
export async function scanLocalCases(db: Db, projectId: number): Promise<CaseView[]> {
  const project = await requireProject(db, projectId)
  if (!project.rootPath) {
    throw Object.assign(new Error(`项目 ${project.name} 未配置本地根目录`), { statusCode: 422 })
  }
  const client = new TestPilotClient({ root: project.rootPath })
  const infos = await client.listCases()
  const now = new Date().toISOString()

  for (const info of infos) {
    const filePath = relative(project.rootPath, info.file).replace(/\\/g, '/')
    const existing = await findCaseByCaseId(db, projectId, info.case?.id ?? basename(filePath))
    if (existing) continue
    await insertCase(db, {
      projectId,
      caseId: info.case?.id ?? basename(filePath),
      name: info.case?.name ?? null,
      filePath,
      tagsJson: JSON.stringify(info.case?.tags ?? []),
      valid: info.valid ? 1 : 0,
      status: 'active',
      checkedAt: now,
    })
  }
  const branches = await branchMap(db, projectId)
  return (await listCaseRows(db, projectId)).map((row) => toView(row, branches.get(row.id) ?? []))
}
