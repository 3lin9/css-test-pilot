import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { RUN_ID_PATTERN } from '@testpilot/core'

export interface HistoryPoint {
  runId: string
  startedAt?: string
  status: 'passed' | 'failed' | 'unknown'
  passed: number
  failed: number
  durationMs?: number
  /** 该 run 失败/未验证的用例 ID(供"上次失败本次通过"的 flaky 嫌疑标记) */
  failedCaseIds?: string[]
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
    .filter((name) => RUN_ID_PATTERN.test(name) && name !== skipRunId)
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
        cases?: Array<{ caseId?: string; status?: string }>
      }
      const failedCaseIds = (summary.cases ?? [])
        .filter((item) => item.status === 'failed' || item.status === 'inconclusive')
        .map((item) => item.caseId ?? '')
        .filter(Boolean)
      points.push({
        runId,
        startedAt: summary.startedAt,
        status: summary.status ?? 'unknown',
        passed: summary.totals?.passed ?? 0,
        failed: summary.totals?.failed ?? 0,
        durationMs: summary.durationMs,
        ...(failedCaseIds.length > 0 ? { failedCaseIds } : {}),
      })
    } catch {
      // 无法解析的 run(运行中 / 损坏)不计入趋势
    }
  }
  return points
}
