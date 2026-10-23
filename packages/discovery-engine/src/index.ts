import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TestAdapter } from '@testpilot/adapter-core'
import { TestPilotError } from '@testpilot/core'
import type {
  LocatorCandidate,
  ProbeResult,
  UIObservation,
} from '@testpilot/observation-core'

export interface LocatorCacheEntry {
  candidate: LocatorCandidate
  route: string
  intent: string
  updatedAt: string
}

export interface LocatorCache {
  get(key: string): Promise<LocatorCacheEntry | undefined>
  set(key: string, entry: LocatorCacheEntry): Promise<void>
  delete(key: string): Promise<void>
}

export class MemoryLocatorCache implements LocatorCache {
  private readonly entries = new Map<string, LocatorCacheEntry>()

  async get(key: string): Promise<LocatorCacheEntry | undefined> {
    return this.entries.get(key)
  }

  async set(key: string, entry: LocatorCacheEntry): Promise<void> {
    this.entries.set(key, entry)
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key)
  }
}

/** 项目内持久化缓存；每次写入使用 rename，避免进程中断留下半截 JSON。 */
export class FileLocatorCache implements LocatorCache {
  constructor(private readonly file: string) {}

  async get(key: string): Promise<LocatorCacheEntry | undefined> {
    return (await this.read())[key]
  }

  async set(key: string, entry: LocatorCacheEntry): Promise<void> {
    const all = await this.read()
    all[key] = entry
    await this.write(all)
  }

  async delete(key: string): Promise<void> {
    const all = await this.read()
    delete all[key]
    await this.write(all)
  }

  private async read(): Promise<Record<string, LocatorCacheEntry>> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Record<string, LocatorCacheEntry>
    } catch {
      return {}
    }
  }

  private async write(entries: Record<string, LocatorCacheEntry>): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
    await rename(temporary, this.file)
  }
}

export interface ResolveLocatorResult {
  candidate: LocatorCandidate
  probe: ProbeResult
  source: 'cache' | 'observation'
  invalidatedCache: boolean
  observation?: UIObservation
}

/**
 * 复用缓存前必须 probe。缓存失效时重新观察并按“策略稳定性 + 意图匹配”排序，
 * 只返回 probe 确认可操作的候选。
 */
export async function resolveLocator(
  adapter: TestAdapter,
  cache: LocatorCache,
  route: string,
  intent: string,
): Promise<ResolveLocatorResult> {
  if (!adapter.probe || !adapter.observe) {
    throw new TestPilotError('UNSUPPORTED_ACTION', `当前 ${adapter.target} adapter 不支持自主观察`)
  }
  const key = locatorCacheKey(adapter.target, route, intent)
  const cached = await cache.get(key)
  let invalidatedCache = false
  if (cached) {
    const probe = await adapter.probe(cached.candidate)
    if (probe.actionable) {
      return { candidate: cached.candidate, probe, source: 'cache', invalidatedCache: false }
    }
    invalidatedCache = true
    await cache.delete(key)
  }

  const observation = await adapter.observe(intent)
  const candidates = observation.interactiveElements
    .filter((element) => element.visible && element.enabled && !element.covered)
    .flatMap((element) => element.candidates)
    .map((candidate) => ({
      candidate,
      rank: candidate.score + intentScore(intent, candidate.description),
    }))
    .sort((left, right) => right.rank - left.rank)

  for (const { candidate } of candidates) {
    const probe = await adapter.probe(candidate)
    if (!probe.actionable) continue
    await cache.set(key, {
      candidate,
      route,
      intent,
      updatedAt: new Date().toISOString(),
    })
    return { candidate, probe, source: 'observation', invalidatedCache, observation }
  }
  throw new TestPilotError(
    'ELEMENT_NOT_FOUND',
    `观察后仍未找到可操作元素:${adapter.target} ${route} "${intent}"`,
  )
}

export function locatorCacheKey(target: string, route: string, intent: string): string {
  return `${target}:${route}:${intent.trim()}`
}

function intentScore(intent: string, description: string): number {
  const wanted = intent.trim().toLocaleLowerCase()
  const actual = description.trim().toLocaleLowerCase()
  if (!wanted) return 0
  if (actual === wanted) return 30
  if (actual.includes(wanted) || wanted.includes(actual)) return 15
  const tokens = wanted.split(/[\s,，。/]+/).filter(Boolean)
  return tokens.reduce((score, token) => score + (actual.includes(token) ? 2 : 0), 0)
}
