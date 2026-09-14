import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RUNS_DIR, type RunSummary } from '@testpilot/core'
import {
  buildSummaryData,
  writeReports,
  writeSummaryReport,
  type HistoryPoint,
  type ReportFailureEntry,
  type SummaryReportData,
} from '@testpilot/reporter'
import { getRun, latestRunId, listRuns } from './runs'
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
  /** 历史趋势(最近 N 次 run,时间正序,不含当前) */
  history?: HistoryPoint[]
  /** 失败分类明细 */
  failures?: ReportFailureEntry[]
}

export interface SummaryReportResult {
  /** summary.html 绝对路径 */
  html: string
  /** summary.json 绝对路径 */
  json: string
  data: SummaryReportData
  window: { runs: number }
}

/**
 * 生成跨 run 汇总报告(summary.html + summary.json,写入 .testpilot/artifacts/)。
 * 统计窗口为最近 N 次(default 30)有 result.json 的运行;结果缺失/损坏的 run 自动跳过。
 */
export async function generateSummaryReport(
  options: { last?: number } & ProjectOptions = {},
): Promise<SummaryReportResult> {
  const root = resolveRoot(options.root)
  const limit = options.last && options.last > 0 ? options.last : 30
  const metas = await listRuns({ root })
  if (metas.length === 0) {
    throw new Error('统计窗口内没有任何运行记录(先运行 npx csspilot run)')
  }

  const runs: Array<{ runId: string; summary: RunSummary }> = []
  for (const meta of metas.slice(0, limit)) {
    try {
      runs.push({ runId: meta.runId, summary: await getRun(meta.runId, { root }) })
    } catch {
      // 结果缺失 / 损坏的 run 不计入汇总
    }
  }
  if (runs.length === 0) {
    throw new Error('统计窗口内的运行结果均不可读')
  }

  const data = buildSummaryData(runs)
  const artifactsDir = join(root, '.testpilot', 'artifacts')
  const written = await writeSummaryReport(artifactsDir, data)
  return { html: written.html, json: written.json, data, window: { runs: runs.length } }
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
