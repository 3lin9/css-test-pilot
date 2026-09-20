import type { TestPilotClient } from '@testpilot/sdk'
import type { AgentToolContext } from '../types'

function now(): string {
  return new Date().toISOString()
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw Object.assign(new Error('Agent 任务已取消'), { cancelled: true })
  }
}

/** testpilot.inspect_project */
export async function inspectProjectTool(client: TestPilotClient, ctx: AgentToolContext) {
  ensureNotAborted(ctx.signal)
  ctx.emit({ type: 'tool-call', ts: now(), message: 'inspect_project' })
  const inspection = await client.inspect()
  ctx.emit({
    type: 'tool-result',
    ts: now(),
    message: 'inspect_project',
    data: {
      root: inspection.root,
      casesDir: inspection.casesDir,
      skillInstalled: inspection.skillInstalled,
      targets: inspection.targets,
    },
  })
  return inspection
}

/** testpilot.list_cases */
export async function listCasesTool(client: TestPilotClient, ctx: AgentToolContext) {
  ensureNotAborted(ctx.signal)
  ctx.emit({ type: 'tool-call', ts: now(), message: 'list_cases' })
  const cases = await client.listCases()
  ctx.emit({
    type: 'tool-result',
    ts: now(),
    message: 'list_cases',
    data: {
      total: cases.length,
      valid: cases.filter((item) => item.valid).length,
      ids: cases.filter((item) => item.valid).map((item) => item.case?.id),
    },
  })
  return cases
}

/** testpilot.read_case */
export async function readCaseTool(client: TestPilotClient, ctx: AgentToolContext, file: string) {
  ensureNotAborted(ctx.signal)
  ctx.emit({ type: 'tool-call', ts: now(), message: 'read_case', data: { file } })
  const result = await client.readCase(file)
  ctx.emit({
    type: 'tool-result',
    ts: now(),
    message: 'read_case',
    data: { file: result.file, ok: result.validation.ok },
  })
  return result
}

/** testpilot.create_case — 经 SDK writeCase(先校验后落盘) */
export async function createCaseTool(
  client: TestPilotClient,
  ctx: AgentToolContext,
  file: string,
  source: string,
  overwrite = false,
) {
  ensureNotAborted(ctx.signal)
  ctx.emit({
    type: 'tool-call',
    ts: now(),
    message: 'create_case',
    data: { file, overwrite },
  })
  const result = await client.writeCase(file, source, { overwrite })
  ctx.emit({
    type: 'tool-result',
    ts: now(),
    message: 'create_case',
    data: {
      file: result.file,
      written: result.written,
      ok: result.validation.ok,
      issues: result.validation.issues,
    },
  })
  if (result.written) {
    ctx.emit({
      type: 'case-written',
      ts: now(),
      message: result.file,
      data: { caseId: result.validation.data?.id },
    })
  }
  return result
}

/** testpilot.validate — 校验指定文件或全部 */
export async function validateTool(
  client: TestPilotClient,
  ctx: AgentToolContext,
  paths?: string[],
) {
  ensureNotAborted(ctx.signal)
  ctx.emit({ type: 'tool-call', ts: now(), message: 'validate', data: { paths } })
  const infos = await client.listCases(paths)
  const failed = infos.filter((item) => !item.valid)
  ctx.emit({
    type: 'validation',
    ts: now(),
    message: `${infos.length - failed.length}/${infos.length} 通过`,
    data: {
      total: infos.length,
      failed: failed.map((item) => ({
        file: item.file,
        issues: item.issues,
      })),
    },
  })
  return infos
}

/** testpilot.run */
export async function runTool(
  client: TestPilotClient,
  ctx: AgentToolContext,
  options: { paths?: string[]; tag?: string } = {},
) {
  ensureNotAborted(ctx.signal)
  ctx.emit({ type: 'tool-call', ts: now(), message: 'run', data: options })
  ctx.emit({ type: 'run-started', ts: now(), message: '开始执行' })
  const result = await client.runCases({
    paths: options.paths,
    tag: options.tag,
    signal: ctx.signal,
  })
  ctx.emit({
    type: 'run-finished',
    ts: now(),
    message: result.summary.status,
    data: {
      runId: result.summary.runId,
      status: result.summary.status,
      totals: result.summary.totals,
    },
  })
  return result
}

/** testpilot.get_run */
export async function getRunTool(client: TestPilotClient, ctx: AgentToolContext, runId: string) {
  ensureNotAborted(ctx.signal)
  ctx.emit({ type: 'tool-call', ts: now(), message: 'get_run', data: { runId } })
  const summary = await client.getRun(runId)
  ctx.emit({
    type: 'tool-result',
    ts: now(),
    message: 'get_run',
    data: { runId: summary.runId, status: summary.status },
  })
  return summary
}

/** testpilot.get_report */
export async function getReportTool(client: TestPilotClient, ctx: AgentToolContext, runId?: string) {
  ensureNotAborted(ctx.signal)
  ctx.emit({ type: 'tool-call', ts: now(), message: 'get_report', data: { runId } })
  const report = await client.generateReport(runId)
  ctx.emit({
    type: 'tool-result',
    ts: now(),
    message: 'get_report',
    data: { json: report.json, html: report.html },
  })
  return report
}
