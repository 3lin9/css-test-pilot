import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'

function dateStamp(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

/** 分配 runId:yyyymmdd-NNN,同日递增 */
export async function allocateRunId(runsRoot: string): Promise<string> {
  const stamp = dateStamp()
  const existing = await readdir(runsRoot).catch(() => [] as string[])
  let max = 0
  for (const name of existing) {
    const match = /^(\d{8})-(\d{3})$/.exec(name)
    if (match && match[1] === stamp) {
      max = Math.max(max, Number(match[2]))
    }
  }
  return `${stamp}-${String(max + 1).padStart(3, '0')}`
}

/** 创建 run 目录,返回绝对路径 */
export async function ensureRunDir(runsRoot: string, runId: string): Promise<string> {
  const runDir = join(runsRoot, runId)
  await mkdir(runDir, { recursive: true })
  return runDir
}
