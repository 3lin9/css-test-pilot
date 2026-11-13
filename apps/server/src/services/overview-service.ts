import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RESULT_FILE, RUN_ID_PATTERN, RUNS_DIR } from '@testpilot/core'
import type { Db } from '../db'
import { listCaseRows } from '../repositories/case-repo'
import type { ProjectRow } from './project-service'

/** 单次 run 里某用例的结果(用例级历史迷你条的一个点) */
export interface OverviewCasePoint {
  runId: string
  startedAt: string
  status: string
}

/** 用例级跨 run 聚合:历史序列 + 最近状态 + 失败次数 */
export interface OverviewCase {
  caseId: string
  caseName: string
  file: string
  /** 时间正序(最新在右);只含能解析出该用例的 run */
  history: OverviewCasePoint[]
  lastStatus?: string
  lastRunId?: string
  lastRunAt?: string
  failCount: number
}

export interface OverviewRun {
  runId: string
  startedAt?: string
  status: string
  passed: number
  failed: number
  durationMs?: number
}

export interface ProjectOverview {
  generatedAt: string
  /** 时间正序(最新在右),最多 limit 次 */
  runs: OverviewRun[]
  cases: OverviewCase[]
  /** 失败次数最多的用例(回归热点);不含 blocked/skipped */
  topFailures: Array<{ caseId: string; caseName: string; file: string; failCount: number }>
  /**
   * 清淤清单:active 用例中最近 staleDays 天没在任何 run 里跑过的(含从未跑过)。
   * lastRunAt 缺失 = 从未跑过。
   */
  staleCases: Array<{ caseId: string; caseName: string; file: string; lastRunAt?: string }>
}

/**
 * 项目跨 run 汇总(第二档:⑧跨 run 汇总 + ⑨用例级历史 + 清淤视图共用)。
 * 从 run 目录逐个读 result.json 聚合;解析失败的 run(运行中/损坏)静默跳过;
 * 远端项目(无本地根目录)无法读产物,422。
 */
export async function buildProjectOverview(
  db: Db,
  project: ProjectRow,
  options: { limit?: number; staleDays?: number } = {},
): Promise<ProjectOverview> {
  const { limit = 20, staleDays = 14 } = options
  if (!project.rootPath) {
    throw Object.assign(new Error(`项目 ${project.name} 未配置本地根目录,无法汇总运行产物`), {
      statusCode: 422,
    })
  }

  const runsRoot = join(project.rootPath, RUNS_DIR)
  const entries = (await readdir(runsRoot).catch(() => [] as string[]))
    .filter((name) => RUN_ID_PATTERN.test(name))
    .sort()
    .slice(-limit)

  const runs: OverviewRun[] = []
  const byCase = new Map<string, OverviewCase>()
  for (const runId of entries) {
    try {
      const summary = JSON.parse(
        await readFile(join(runsRoot, runId, RESULT_FILE), 'utf8'),
      ) as {
        startedAt?: string
        status?: string
        durationMs?: number
        totals?: { passed?: number; failed?: number }
        cases?: Array<{
          caseId?: string
          caseName?: string
          file?: string
          status?: string
        }>
      }
      const startedAt = summary.startedAt ?? ''
      runs.push({
        runId,
        startedAt: summary.startedAt,
        status: summary.status ?? 'unknown',
        passed: summary.totals?.passed ?? 0,
        failed: summary.totals?.failed ?? 0,
        durationMs: summary.durationMs,
      })
      for (const item of summary.cases ?? []) {
        if (!item.caseId) continue
        const trend = byCase.get(item.caseId) ?? {
          caseId: item.caseId,
          caseName: item.caseName ?? item.caseId,
          file: item.file ?? '',
          history: [],
          failCount: 0,
        }
        trend.history.push({ runId, startedAt, status: item.status ?? 'unknown' })
        // 最新状态以最后一次出现为准(run 目录名时间有序)
        trend.lastRunId = runId
        trend.lastRunAt = startedAt || undefined
        trend.lastStatus = item.status
        if (item.status === 'failed' || item.status === 'inconclusive') trend.failCount += 1
        byCase.set(item.caseId, trend)
      }
    } catch {
      // 无法解析的 run(运行中/损坏)不计入
    }
  }

  const cases = [...byCase.values()]
  const topFailures = [...cases]
    .filter((item) => item.failCount > 0)
    .sort((a, b) => b.failCount - a.failCount)
    .slice(0, 10)
    .map((item) => ({
      caseId: item.caseId,
      caseName: item.caseName,
      file: item.file,
      failCount: item.failCount,
    }))

  // 清淤:active 用例全集 - 窗口内跑过的
  const staleCutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000
  const activeCases = await listCaseRows(db, project.id, { status: 'active' })
  const staleCases = activeCases
    .filter((row) => {
      const lastRunAt = byCase.get(row.caseId)?.lastRunAt
      // 从未跑过,或最近一次出现早于窗口起点
      return !lastRunAt || new Date(lastRunAt).getTime() < staleCutoff
    })
    .map((row) => ({
      caseId: row.caseId,
      caseName: row.name ?? row.caseId,
      file: row.filePath,
      lastRunAt: byCase.get(row.caseId)?.lastRunAt,
    }))

  return { generatedAt: new Date().toISOString(), runs, cases, topFailures, staleCases }
}
