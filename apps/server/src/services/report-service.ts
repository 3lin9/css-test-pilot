import { generateReport } from '@testpilot/sdk'
import type { Db } from '../db'
import { findReportByRun, insertReport } from '../repositories/report-repo'
import { getRunRow } from '../repositories/run-repo'
import { getProjectOrThrow } from './project-service'
import { getRunViewOrThrow } from './run-service'

export interface ReportView {
  runId: string
  generatedAt: string
  jsonPath: string
  htmlPath: string
}

/** 读取 run 的报告;首次访问时按需生成并登记元数据 */
export async function getOrGenerateReport(db: Db, runId: string): Promise<ReportView> {
  await getRunViewOrThrow(db, runId)

  const existing = await findReportByRun(db, runId)
  if (existing) return existing

  const runRow = (await getRunRow(db, runId))!
  const project = await getProjectOrThrow(db, runRow.projectId)
  if (!project.rootPath) {
    throw Object.assign(new Error(`项目 ${project.name} 未配置本地根目录,无法生成报告`), {
      statusCode: 422,
    })
  }
  const generated = await generateReport(runId, { root: project.rootPath })

  return insertReport(db, {
    runId,
    generatedAt: new Date().toISOString(),
    jsonPath: generated.json,
    htmlPath: generated.html,
  })
}
