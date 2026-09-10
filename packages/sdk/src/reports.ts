import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RUNS_DIR, type RunSummary } from '@testpilot/core'
import { writeReports } from '@testpilot/reporter'
import { latestRunId } from './runs'
import { resolveRoot, type ProjectOptions } from './project'

export interface GeneratedReport {
  runId: string
  /** report.json 绝对路径 */
  json: string
  /** report.html 绝对路径 */
  html: string
}

/** 为指定 run(默认最近一次)生成 JSON + HTML 报告,写入 run 目录 */
export async function generateReport(
  runId: string | undefined,
  options: ProjectOptions = {},
): Promise<GeneratedReport> {
  const id = runId ?? (await latestRunId(options))
  if (!id) {
    throw new Error('未找到运行记录(先运行一次用例)')
  }

  const runDir = join(resolveRoot(options.root), RUNS_DIR, id)
  let summary: RunSummary
  try {
    summary = JSON.parse(await readFile(join(runDir, 'result.json'), 'utf8')) as RunSummary
  } catch {
    throw new Error(`读取运行结果失败:${join(runDir, 'result.json')}(运行未完成或 runId 不存在)`)
  }

  const written = await writeReports(runDir, summary)
  return { runId: id, json: written.json, html: written.html }
}

export interface ReportPayload {
  generatedAt: string
  summary: RunSummary
}

/** 读取已生成的报告(report.json);尚未生成时返回 undefined */
export async function readReport(
  runId: string,
  options: ProjectOptions = {},
): Promise<ReportPayload | undefined> {
  const file = join(resolveRoot(options.root), RUNS_DIR, runId, 'report.json')
  const source = await readFile(file, 'utf8').catch(() => undefined)
  return source ? (JSON.parse(source) as ReportPayload) : undefined
}
