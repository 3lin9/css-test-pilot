import type { Db } from '../db'
import type { AgentOrchestrator } from '../orchestrator/agent-orchestrator'
import {
  getAgentJobRow,
  insertAgentJob,
  listAgentJobEvents,
  listAgentJobRows,
  updateAgentJob,
  type AgentJobRow,
  type AgentJobStatus,
} from '../repositories/agent-job-repo'
import { getProjectOrThrow, type ProjectRow } from './project-service'

export interface CreateAgentJobInput {
  projectId?: number
  prompt: string
  runAfterCreate?: boolean
  overwrite?: boolean
  /** 相对项目根的 Case 路径提示 */
  file?: string
}

export class AgentJobConflictError extends Error {
  readonly statusCode = 409
  constructor(message: string) {
    super(message)
    this.name = 'AgentJobConflictError'
  }
}

export class AgentJobValidationError extends Error {
  readonly statusCode = 422
  constructor(message: string) {
    super(message)
    this.name = 'AgentJobValidationError'
  }
}

/** DB 用 0/1 存布尔;对外视图暴露为 boolean */
export interface AgentJobView extends Omit<AgentJobRow, 'runAfterCreate' | 'overwrite'> {
  nextSteps: string[]
  runAfterCreate: boolean
  overwrite: boolean
}

function toView(row: AgentJobRow): AgentJobView {
  let nextSteps: string[] = []
  if (row.nextStepsJson) {
    try {
      nextSteps = JSON.parse(row.nextStepsJson) as string[]
    } catch {
      nextSteps = []
    }
  }
  return {
    ...row,
    nextSteps,
    runAfterCreate: row.runAfterCreate === 1,
    overwrite: row.overwrite === 1,
  }
}

/** 分配 agent job id:agent-YYYYMMDD-HHMMSS-<rand> */
export function allocateAgentJobId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const rand = Math.random().toString(36).slice(2, 6)
  return `agent-${stamp}-${rand}`
}

/**
 * 创建 Agent Job:校验 rootPath → 落库 queued → 编排器在业务项目工作区后台执行。
 * 不写 Server Case Index;生成文件仅存在于 Git 工作区。
 */
export async function createAgentJob(
  db: Db,
  orchestrator: AgentOrchestrator,
  input: CreateAgentJobInput,
  defaultProject: ProjectRow,
): Promise<AgentJobView> {
  const prompt = input.prompt?.trim()
  if (!prompt) {
    throw new AgentJobValidationError('prompt 不能为空')
  }

  const project = input.projectId
    ? await getProjectOrThrow(db, input.projectId)
    : defaultProject

  if (!project.rootPath) {
    throw new AgentJobValidationError(
      `项目 ${project.name} 未配置本地根目录(rootPath);Agent 必须在业务项目工作区写 Case`,
    )
  }
  if (orchestrator.isProjectBusy(project.id)) {
    throw new AgentJobConflictError(`项目 ${project.name} 已有 Agent 任务在进行中`)
  }

  const id = allocateAgentJobId()
  const row = await insertAgentJob(db, {
    id,
    projectId: project.id,
    status: 'queued',
    prompt,
    runAfterCreate: input.runAfterCreate ? 1 : 0,
    overwrite: input.overwrite ? 1 : 0,
    fileHint: input.file ?? null,
    startedAt: new Date().toISOString(),
  })

  orchestrator.start(id, project, {
    prompt,
    runAfterCreate: !!input.runAfterCreate,
    overwrite: !!input.overwrite,
    file: input.file,
  })

  return toView(row)
}

export async function listAgentJobs(
  db: Db,
  filter: { projectId?: number; status?: AgentJobStatus } = {},
): Promise<AgentJobView[]> {
  const rows = await listAgentJobRows(db, filter)
  return rows.map(toView)
}

export async function getAgentJobOrThrow(db: Db, id: string): Promise<AgentJobView> {
  const row = await getAgentJobRow(db, id)
  if (!row) {
    throw Object.assign(new Error(`Agent Job 不存在:${id}`), { statusCode: 404 })
  }
  return toView(row)
}

export async function getAgentJobEventViews(db: Db, jobId: string) {
  await getAgentJobOrThrow(db, jobId)
  return listAgentJobEvents(db, jobId)
}

export async function cancelAgentJob(
  db: Db,
  orchestrator: AgentOrchestrator,
  id: string,
): Promise<AgentJobView> {
  const row = await getAgentJobOrThrow(db, id)
  if (row.status !== 'queued' && row.status !== 'running') {
    return row
  }
  const stopped = orchestrator.cancel(id)
  if (!stopped && row.status === 'queued') {
    await updateAgentJob(db, id, {
      status: 'cancelled',
      message: '任务已取消',
      finishedAt: new Date().toISOString(),
    })
  }
  return getAgentJobOrThrow(db, id)
}
