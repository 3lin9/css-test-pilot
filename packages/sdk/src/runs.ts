import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { RUNS_DIR, RESULT_FILE, type RunSummary } from '@testpilot/core'
import { resolveRoot, type ProjectOptions } from './project'

export interface RunMeta {
  runId: string
  /** run 产物目录(绝对路径) */
  dir: string
  /** result.json 缺失时为 unknown(运行中或异常中断) */
  status: RunSummary['status'] | 'unknown'
  cancelled?: boolean
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  totals?: RunSummary['totals']
}

function runsRoot(root?: string): string {
  return join(resolveRoot(root), RUNS_DIR)
}

/**
 * 按 yyyymmdd-NNN 规则分配下一个 runId(序号三位,超过 999 自然进位到四位)。
 * 分配即占位:对 run 目录做独占 mkdir,EEXIST 说明已被并发分配(CLI 与 Server
 * 同时对同一项目 run 时不会撞号),换下一个序号重试。
 */
export async function allocateRunId(options: ProjectOptions = {}): Promise<string> {
  const base = runsRoot(options.root)
  await mkdir(base, { recursive: true })
  const now = new Date()
  const prefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  for (let n = 1; n <= 9999; n++) {
    const id = `${prefix}-${String(n).padStart(3, '0')}`
    try {
      await mkdir(join(base, id))
      return id
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error(`当日 run 数量超出分配上限(9999):${prefix}`)
}

/** 列出历史运行,按 runId 倒序(最近的在前);原生与旧 YAML run 同形态可读 */
export async function listRuns(options: ProjectOptions = {}): Promise<RunMeta[]> {
  const base = runsRoot(options.root)
  const entries = await readdir(base).catch(() => [] as string[])
  const metas: RunMeta[] = []
  for (const entry of entries.filter((name) => /^\d{8}-\d{3,4}$/.test(name)).sort().reverse()) {
    metas.push({ ...(await readRunMeta(base, entry)), runId: entry, dir: join(base, entry) })
  }
  return metas
}

/** 最近一次运行 ID;没有任何运行记录时返回 undefined */
export async function latestRunId(options: ProjectOptions = {}): Promise<string | undefined> {
  const runs = await listRuns(options)
  return runs[0]?.runId
}

/** 读取一次运行的汇总结果(result.json);文件缺失时抛错 */
export async function getRun(runId: string, options: ProjectOptions = {}): Promise<RunSummary> {
  const file = join(runsRoot(options.root), runId, RESULT_FILE)
  try {
    return JSON.parse(await readFile(file, 'utf8')) as RunSummary
  } catch {
    throw new Error(`读取运行结果失败:${file}(运行未完成或 runId 不存在)`)
  }
}

async function readRunMeta(base: string, runId: string): Promise<Omit<RunMeta, 'runId' | 'dir'>> {
  try {
    const summary = JSON.parse(
      await readFile(join(base, runId, RESULT_FILE), 'utf8'),
    ) as RunSummary
    return {
      status: summary.status,
      cancelled: summary.cancelled,
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      durationMs: summary.durationMs,
      totals: summary.totals,
    }
  } catch {
    return { status: 'unknown' }
  }
}
