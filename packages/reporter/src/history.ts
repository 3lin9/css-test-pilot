import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface HistoryPoint {
  runId: string
  startedAt?: string
  status: 'passed' | 'failed' | 'unknown'
  passed: number
  failed: number
  durationMs?: number
}

/**
 * 汇总 runs 目录下最近 limit 次 run 的结果(排除 skipRunId,时间正序)。
 * 用于报告的历史趋势与 Flaky 识别;解析失败的 run 静默跳过。
 */
export async function collectHistory(
  runsRoot: string,
  skipRunId: string | undefined,
  limit = 12,
): Promise<HistoryPoint[]> {
  const entries = (await readdir(runsRoot).catch(() => [] as string[]))
    .filter((name) => /^\d{8}-\d{3}$/.test(name) && name !== skipRunId)
    .sort()
    .slice(-limit)

  const points: HistoryPoint[] = []
  for (const runId of entries) {
    try {
      const summary = JSON.parse(await readFile(join(runsRoot, runId, 'result.json'), 'utf8')) as {
        startedAt?: string
        status?: HistoryPoint['status']
        durationMs?: number
        totals?: { passed?: number; failed?: number }
      }
      points.push({
        runId,
        startedAt: summary.startedAt,
        status: summary.status ?? 'unknown',
        passed: summary.totals?.passed ?? 0,
        failed: summary.totals?.failed ?? 0,
        durationMs: summary.durationMs,
      })
    } catch {
      // 无法解析的 run(运行中 / 损坏)不计入趋势
    }
  }
  return points
}
