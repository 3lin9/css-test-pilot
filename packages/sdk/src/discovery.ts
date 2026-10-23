import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import type { ProbeResult, UIObservation } from '@testpilot/observation-core'
import type { CaseLocator, StepTarget, TestCase } from '@testpilot/dsl'
import { AdapterResolver } from '@testpilot/execution-engine'
import { describeLocator } from '@testpilot/adapter-core'
import type { AdapterFactory } from '@testpilot/adapter-core'
import { createDefaultAdapters } from './runs'
import { collectCases } from './cases'
import { loadProjectConfig, resolveRoot, type ProjectOptions } from './project'
import {
  FileLocatorCache,
  resolveLocator,
  type ResolveLocatorResult,
} from '@testpilot/discovery-engine'

export interface DiscoveryOptions extends ProjectOptions {
  paths?: readonly string[]
  /** 覆盖默认 adapter；测试与自定义运行环境使用。 */
  adapters?: readonly AdapterFactory[]
}

export interface DiscoverySnapshot extends Omit<UIObservation, 'screenshot'> {
  screenshot?: string
}

export interface DiscoveryProbe {
  phase: 'setup' | 'steps' | 'teardown'
  index: number
  target: Extract<StepTarget, 'web' | 'miniapp'>
  locator: CaseLocator
  result?: ProbeResult
  error?: string
  skippedReason?: string
}

export interface CaseDiscoveryResult {
  caseId: string
  file: string
  snapshots: DiscoverySnapshot[]
  probes: DiscoveryProbe[]
}

export interface DiscoveryResult {
  artifactDir: string
  cases: CaseDiscoveryResult[]
}

export interface DiscoverIntentOptions extends ProjectOptions {
  target: Extract<StepTarget, 'web' | 'miniapp'>
  url: string
  intent: string
  adapters?: readonly AdapterFactory[]
}

/**
 * 按自然语言意图发现一个可操作 locator。缓存命中也必须先 probe；
 * probe 失效时 resolveLocator 会删除缓存、重新 observe 并写回新候选。
 */
export async function discoverIntent(
  options: DiscoverIntentOptions,
): Promise<ResolveLocatorResult> {
  const root = resolveRoot(options.root)
  const config = await loadProjectConfig(root)
  const resolver = new AdapterResolver()
  for (const factory of options.adapters ?? createDefaultAdapters(config)) resolver.register(factory)
  try {
    const adapter = await (await resolver.session(options.target)).get()
    await adapter.navigate(options.url)
    if (adapter.waitForStable) await adapter.waitForStable()
    const cache = new FileLocatorCache(join(root, '.testpilot', 'cache', 'locators.json'))
    return await resolveLocator(adapter, cache, options.url, options.intent)
  } finally {
    await resolver.closeAll()
  }
}

/**
 * Discover 严格只执行 launch/navigate/observe/probe。遇到首个有副作用动作后，
 * 后续 locator 不假装处于正确页面状态，而是标记需 Rehearse 验证。
 */
export async function discoverCases(options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
  const root = resolveRoot(options.root)
  const config = await loadProjectConfig(root)
  const inputs =
    options.paths && options.paths.length > 0
      ? options.paths.map((input) => (isAbsolute(input) ? input : join(root, input)))
      : [join(root, config.casesDir)]
  const infos = (await collectCases(inputs, { root })).filter(
    (item): item is typeof item & { case: TestCase } => item.valid && item.case !== undefined,
  )
  const artifactDir = join(
    root,
    '.testpilot',
    'artifacts',
    'discovery',
    new Date().toISOString().replace(/[:.]/g, '-'),
  )
  await mkdir(artifactDir, { recursive: true })
  const resolver = new AdapterResolver()
  for (const factory of options.adapters ?? createDefaultAdapters(config)) resolver.register(factory)
  const results: CaseDiscoveryResult[] = []

  try {
    for (const info of infos) {
      const result: CaseDiscoveryResult = {
        caseId: info.case.id,
        file: info.file,
        snapshots: [],
        probes: [],
      }
      const divergedTargets = new Set<StepTarget>()
      for (const [phase, steps] of [
        ['setup', info.case.setup ?? []],
        ['steps', info.case.steps],
        ['teardown', info.case.teardown ?? []],
      ] as const) {
        for (const [index, step] of steps.entries()) {
          if (step.target === 'api') continue
          const adapter = await (await resolver.session(step.target)).get()
          const causesDivergence = isSideEffect(step.action)
          if (!adapter.observe || !adapter.probe) {
            result.probes.push({
              phase,
              index,
              target: step.target,
              locator: step.locator ?? { css: '-' },
              error: `当前 ${step.target} adapter 不支持 observe/probe`,
            })
            continue
          }
          if (step.action === 'launch') {
            await adapter.launch()
          } else if (step.action === 'navigate' && step.url && !step.url.includes('${')) {
            await adapter.navigate(step.url)
            if (adapter.waitForStable) await adapter.waitForStable()
            result.snapshots.push(
              await saveObservation(
                artifactDir,
                info.case.id,
                step.target,
                result.snapshots.length,
                await adapter.observe(),
              ),
            )
          }

          if (!step.locator) {
            if (causesDivergence) divergedTargets.add(step.target)
            continue
          }
          const probe: DiscoveryProbe = {
            phase,
            index,
            target: step.target,
            locator: step.locator,
          }
          if (divergedTargets.has(step.target)) {
            probe.skippedReason = '前序有副作用动作未在 Discover 执行；交由 Rehearse 验证'
          } else {
            try {
              probe.result = await adapter.probe({
                locator: step.locator,
                strategy: locatorStrategy(step.locator),
                score: 0,
                description: describeLocator(step.locator),
                fingerprint: { stableAttributes: {}, ancestorPath: [] },
              })
            } catch (err) {
              probe.error = err instanceof Error ? err.message : String(err)
            }
          }
          result.probes.push(probe)
          if (causesDivergence) divergedTargets.add(step.target)
        }
      }
      results.push(result)
    }
  } finally {
    await resolver.closeAll()
  }
  await writeFile(
    join(artifactDir, 'discovery.json'),
    `${JSON.stringify({ artifactDir, cases: results }, null, 2)}\n`,
    'utf8',
  )
  return { artifactDir, cases: results }
}

async function saveObservation(
  artifactDir: string,
  caseId: string,
  target: string,
  index: number,
  observation: UIObservation,
): Promise<DiscoverySnapshot> {
  const { screenshot, ...serializable } = observation
  let screenshotPath: string | undefined
  if (screenshot) {
    const filename = `${caseId}-${target}-${String(index).padStart(2, '0')}.png`
    await writeFile(join(artifactDir, filename), screenshot)
    screenshotPath = filename
  }
  return { ...serializable, screenshot: screenshotPath }
}

function locatorStrategy(locator: CaseLocator) {
  if (locator.testId !== undefined) return 'testId' as const
  if (locator.role !== undefined) return 'role' as const
  if (locator.label !== undefined) return 'label' as const
  if (locator.placeholder !== undefined) return 'placeholder' as const
  if (locator.text !== undefined) return 'text' as const
  return 'css' as const
}

function isSideEffect(action: TestCase['steps'][number]['action']): boolean {
  return !['launch', 'navigate', 'wait', 'assert', 'extract', 'screenshot'].includes(action)
}

export function displayDiscoveryFile(root: string, file: string): string {
  return relative(root, file).split('\\').join('/')
}
