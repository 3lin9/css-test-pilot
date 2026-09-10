import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { TestPilotClient } from '@testpilot/sdk'
import type { RunSummary } from '@testpilot/core'
import type { Db } from '../db'
import { getRunRow } from '../repositories/run-repo'
import { getProjectRow } from '../repositories/project-repo'

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.ndjson': 'application/x-ndjson',
  '.html': 'text/html; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
}

export class ArtifactError extends Error {
  readonly statusCode: number
  constructor(message: string, statusCode = 404) {
    super(message)
    this.name = 'ArtifactError'
    this.statusCode = statusCode
  }
}

export interface ArtifactFile {
  /** 相对 run 目录的路径(POSIX 分隔符) */
  path: string
  size: number
}

async function requireRunDir(db: Db, runId: string): Promise<string> {
  const run = await getRunRow(db, runId)
  if (!run) {
    throw new ArtifactError(`运行不存在:${runId}`)
  }
  const project = await getProjectRow(db, run.projectId)
  if (!project?.rootPath) {
    throw new ArtifactError(`项目 ${project?.name ?? run.projectId} 未配置本地根目录,无法访问产物`, 422)
  }
  const runDir = resolve(project.rootPath, '.testpilot', 'artifacts', 'runs', runId)
  const info = await stat(runDir).catch(() => undefined)
  if (!info?.isDirectory()) {
    throw new ArtifactError(`运行产物目录不存在:${runId}`)
  }
  return runDir
}

/** 列出 run 目录内的全部文件(相对路径;上限 500 防御异常产物) */
export async function listRunArtifacts(db: Db, runId: string): Promise<ArtifactFile[]> {
  const runDir = await requireRunDir(db, runId)
  const files: ArtifactFile[] = []
  await walk(runDir, '', files)
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

async function walk(dir: string, prefix: string, out: ArtifactFile[]): Promise<void> {
  if (out.length >= 500) return
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await walk(full, rel, out)
    } else {
      const info = await stat(full).catch(() => undefined)
      if (info) out.push({ path: rel, size: info.size })
    }
  }
}

export interface ArtifactContent {
  stream: NodeJS.ReadableStream
  contentType: string
  /** 建议以附件下载(trace/video 等二进制) */
  download: boolean
}

/** 读取 run 内的单个产物;拒绝越出 run 目录的路径 */
export async function readRunArtifact(
  db: Db,
  runId: string,
  filePath: string,
): Promise<ArtifactContent> {
  const runDir = await requireRunDir(db, runId)
  const normalized = filePath.replace(/\\/g, '/')
  const absolute = resolve(runDir, normalized)
  if (absolute !== runDir && !absolute.startsWith(runDir + sep)) {
    throw new ArtifactError('非法的产物路径', 400)
  }
  const info = await stat(absolute).catch(() => undefined)
  if (!info?.isFile()) {
    throw new ArtifactError(`产物不存在:${normalized}`)
  }

  const ext = extname(absolute).toLowerCase()
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream'
  const download = !contentType.startsWith('text/') && contentType !== 'application/json'
  return { stream: createReadStream(absolute), contentType, download }
}

/** 读取一次运行的汇总结果(引擎写盘的 result.json) */
export async function getRunSummary(db: Db, runId: string): Promise<RunSummary> {
  const run = await getRunRow(db, runId)
  if (!run) {
    throw new ArtifactError(`运行不存在:${runId}`)
  }
  const project = await getProjectRow(db, run.projectId)
  if (!project?.rootPath) {
    throw new ArtifactError(`项目未配置本地根目录,无法读取运行结果`, 422)
  }
  const client = new TestPilotClient({ root: project.rootPath })
  return client.getRun(runId)
}
