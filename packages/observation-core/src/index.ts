import { createHash } from 'node:crypto'
import type { CaseLocator, StepTarget } from '@testpilot/dsl'

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface ElementFingerprint {
  role?: string
  name?: string
  testId?: string
  tag?: string
  stableAttributes: Record<string, string>
  ancestorPath: string[]
  textHash?: string
  box?: BoundingBox
}

export type LocatorStrategy =
  | 'testId'
  | 'role'
  | 'label'
  | 'placeholder'
  | 'attribute'
  | 'text'
  | 'css'

export interface LocatorCandidate {
  locator: CaseLocator
  strategy: LocatorStrategy
  score: number
  description: string
  fingerprint: ElementFingerprint
}

export interface ObservedElement {
  index: number
  tag?: string
  role?: string
  name?: string
  text?: string
  testId?: string
  label?: string
  placeholder?: string
  css?: string
  visible: boolean
  enabled: boolean
  editable: boolean
  covered?: boolean
  box?: BoundingBox
  fingerprint: ElementFingerprint
  candidates: LocatorCandidate[]
}

export interface ObservedRequest {
  method: string
  url: string
  resourceType?: string
}

export interface UIObservation {
  target: Extract<StepTarget, 'web' | 'miniapp'>
  route: string
  title?: string
  semanticTree: string
  /** 小程序为当前页面根节点 outerWxml；Web 通常不填，避免泄露完整 DOM。 */
  runtimeMarkup?: string
  screenshot?: Buffer
  interactiveElements: ObservedElement[]
  networkActivity?: ObservedRequest[]
  observedAt: string
  stateHash: string
}

export interface ProbeResult {
  candidate: LocatorCandidate
  matchedCount: number
  unique: boolean
  visible: boolean
  enabled: boolean
  editable: boolean
  covered: boolean
  actionable: boolean
  stateHash: string
  fingerprint?: ElementFingerprint
  reason?: string
}

export interface StabilityOptions {
  timeoutMs?: number
  quietWindowMs?: number
  pollMs?: number
}

export interface StabilityResult {
  stable: boolean
  durationMs: number
  samples: number
  stateHash: string
  reason?: string
}

export interface StateTransition {
  changed: boolean
  beforeHash: string
  afterHash: string
  stability: StabilityResult
}

export interface VerifiedLocator {
  phase: 'setup' | 'steps' | 'teardown'
  index: number
  target: 'web' | 'miniapp'
  locator: CaseLocator
  probe: ProbeResult
  transition?: StateTransition
}

export interface RehearsalEvidence {
  verifiedLocators: VerifiedLocator[]
  pageStateHashes: Record<string, string>
}

export interface ReadyCertificate {
  version: 1
  caseId: string
  caseFile: string
  commit: string
  environment?: string
  environmentHash: string
  caseHash: string
  datasetHash: string
  observedAt: string
  pageStateHashes: Record<string, string>
  verifiedLocators: VerifiedLocator[]
  status: 'ready'
}

/** 对对象键递归排序后计算 SHA-256，作为跨进程可复现指纹。 */
export function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

/** 页面状态不包含截图、采集时间和瞬时网络活动。 */
export function observationStateHash(observation: Omit<UIObservation, 'stateHash'> | UIObservation): string {
  return stableHash({
    target: observation.target,
    route: observation.route,
    title: observation.title,
    semanticTree: observation.semanticTree,
    runtimeMarkup: observation.runtimeMarkup,
    interactiveElements: observation.interactiveElements.map((element) => ({
      role: element.role,
      name: element.name,
      text: element.text,
      testId: element.testId,
      label: element.label,
      placeholder: element.placeholder,
      visible: element.visible,
      enabled: element.enabled,
      editable: element.editable,
      covered: element.covered,
      fingerprint: element.fingerprint,
    })),
  })
}

/** 缓存定位器复用前的同一元素校验。expected 中已知的稳定字段必须全部一致。 */
export function fingerprintMatches(
  expected: ElementFingerprint,
  actual: ElementFingerprint,
  boxTolerancePx = 8,
): boolean {
  for (const key of ['role', 'name', 'testId', 'tag', 'textHash'] as const) {
    if (expected[key] !== undefined && expected[key] !== actual[key]) return false
  }
  for (const [key, value] of Object.entries(expected.stableAttributes)) {
    if (actual.stableAttributes[key] !== value) return false
  }
  if (
    expected.ancestorPath.length > 0 &&
    expected.ancestorPath.join('>') !== actual.ancestorPath.join('>')
  ) {
    return false
  }
  if (expected.box && actual.box) {
    const fields = ['x', 'y', 'width', 'height'] as const
    if (fields.some((field) => Math.abs(expected.box![field] - actual.box![field]) > boxTolerancePx)) {
      return false
    }
  }
  return true
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  return value
}
