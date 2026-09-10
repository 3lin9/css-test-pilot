import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { allocateRunId } from '@testpilot/sdk'
import type { Db } from '../db'
import type { RunOrchestrator } from '../orchestrator/run-orchestrator'
import {
  getRunRow,
  insertRun,
  listRunEvents,
  listRunRows,
  updateRun,
  type RunRow,
  type RunStatus,
} from '../repositories/run-repo'
import {
  findWorkspaceByName,
  getWorkspaceRow,
  listBindings,
  type BindingView,
} from '../repositories/workspace-repo'
import { clientFor, getProjectOrThrow, type ProjectRow } from './project-service'

const execFileAsync = promisify(execFile)

export interface CreateRunInput {
  projectId?: number
  /** 用例文件/目录(相对项目根) */
  paths?: string[]
  tag?: string
  /** Git 上下文(CI 触发时显式传入;缺省从本地项目 git 读取) */
  branch?: string
  commit?: string
  /** 测试环境组合(Workspace id;缺省时尝试按 Case 声明的 workspace 名解析) */
  workspaceId?: number
}

export class RunConflictError extends Error {
  readonly statusCode = 409
  constructor(message: string) {
    super(message)
    this.name = 'RunConflictError'
  }
}

export class RunValidationError extends Error {
  readonly statusCode = 422
  constructor(message: string) {
    super(message)
    this.name = 'RunValidationError'
  }
}

export interface GitInfo {
  branch?: string
  commit?: string
  repositoryUrl?: string
}

/** 读取本地项目的 Git 上下文;非 git 项目返回空对象 */
export async function readGitInfo(root: string): Promise<GitInfo> {
  const run = async (args: string[]): Promise<string | undefined> => {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd: root })
      return stdout.trim() || undefined
    } catch {
      return undefined
    }
  }
  const [branch, commit, repositoryUrl] = await Promise.all([
    run(['rev-parse', '--abbrev-ref', 'HEAD']),
    run(['rev-parse', 'HEAD']),
    run(['remote', 'get-url', 'origin']),
  ])
  return { branch, commit, repositoryUrl }
}

/**
 * 创建运行:项目空闲检查 -> 用例预检 -> 解析 Git 上下文与 Workspace 快照 ->
 * 服务端分配 runId 先行落库 -> 编排器后台执行。
 * Run 记录执行时的 project / git(commit, branch)/ workspace snapshot,保证历史可追溯。
 */
export async function createRun(
  db: Db,
  orchestrator: RunOrchestrator,
  input: CreateRunInput,
  defaultProject: ProjectRow,
): Promise<RunRow> {
  const project = input.projectId
    ? await getProjectOrThrow(db, input.projectId)
    : defaultProject

  if (orchestrator.isProjectBusy(project.id)) {
    throw new RunConflictError(`项目 ${project.name} 已有运行在进行中`)
  }
  if (!project.rootPath) {
    throw new RunValidationError(`项目 ${project.name} 未配置本地根目录,无法执行本地运行`)
  }

  // 预检:必须存在可执行用例,避免 202 之后立刻失败
  const client = clientFor(project)
  const cases = await client.listCases(input.paths, input.tag)
  if (cases.filter((item) => item.valid).length === 0) {
    const detail = cases.length === 0 ? '未找到用例文件' : '所有用例校验失败,无可执行用例'
    throw new RunValidationError(`${detail}(project: ${project.name})`)
  }

  // Git 上下文:请求显式给出(CI)优先,否则读本地 git
  const git = await readGitInfo(project.rootPath)
  const branch = input.branch ?? git.branch ?? null
  const commit = input.commit ?? git.commit ?? null

  // Workspace:显式 workspaceId 优先;否则按 Case 声明的 workspace 名解析
  const declared = cases.find((item) => item.case?.workspace)?.case?.workspace
  let workspaceId: number | null = null
  let snapshotJson: string | null = null
  if (input.workspaceId !== undefined) {
    workspaceId = input.workspaceId
  } else if (declared) {
    const byName = await findWorkspaceByName(db, declared)
    if (byName) workspaceId = byName.id
  }
  if (workspaceId !== null) {
    const snapshot = await buildWorkspaceSnapshot(db, workspaceId)
    snapshotJson = snapshot ? JSON.stringify(snapshot) : null
  }

  const runId = await allocateRunId({ root: project.rootPath })
  const row = await insertRun(db, {
    id: runId,
    projectId: project.id,
    status: 'running',
    trigger: 'api',
    branch,
    commit,
    workspaceId,
    workspaceSnapshotJson: snapshotJson,
    startedAt: new Date().toISOString(),
  })
  orchestrator.start(runId, project, { paths: input.paths, tag: input.tag })
  return row
}

export interface WorkspaceSnapshot {
  workspaceId: number
  name: string
  bindings: Array<BindingView & { projectName?: string }>
}

/** 运行时快照:Workspace 后续可能被修改,历史 Run 依据快照还原当时的环境组合 */
export async function buildWorkspaceSnapshot(
  db: Db,
  workspaceId: number,
): Promise<WorkspaceSnapshot | undefined> {
  const workspace = await getWorkspaceRow(db, workspaceId)
  if (!workspace) return undefined
  const bindings = await listBindings(db, workspaceId)
  return {
    workspaceId,
    name: workspace.name,
    bindings,
  }
}

export async function listRunViews(
  db: Db,
  filter: { projectId?: number; status?: RunStatus } = {},
): Promise<RunRow[]> {
  return listRunRows(db, filter)
}

export async function getRunViewOrThrow(db: Db, id: string): Promise<RunRow> {
  const row = await getRunRow(db, id)
  if (!row) {
    throw Object.assign(new Error(`运行不存在:${id}`), { statusCode: 404 })
  }
  return row
}

export async function getRunEventViews(db: Db, id: string) {
  await getRunViewOrThrow(db, id)
  return listRunEvents(db, id)
}

export async function cancelRun(
  db: Db,
  orchestrator: RunOrchestrator,
  id: string,
): Promise<RunRow> {
  const row = await getRunViewOrThrow(db, id)
  if (row.status !== 'running') {
    throw new RunConflictError(`运行 ${id} 状态为 ${row.status},无法取消`)
  }
  const stopped = orchestrator.cancel(id)
  if (!stopped) {
    // 进程重启后 DB 里的 running 已无对应活动运行:直接标记取消
    await updateRun(db, id, {
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
      message: 'server 重启后清理的僵尸运行',
    })
  }
  return (await getRunRow(db, id))!
}
