import { basename, relative } from 'node:path'
import type { ProjectInspection } from '@testpilot/sdk'

export interface PlannedCase {
  /** 相对项目根的 POSIX 路径 */
  file: string
  source: string
  caseId: string
  name: string
  /** 是否来自 prompt 内嵌 YAML(而非脚手架) */
  fromYamlBlock: boolean
}

export interface PlanInput {
  prompt: string
  inspection: ProjectInspection
  /** 已有 case id,用于避重 */
  existingIds: Set<string>
  /** 显式文件路径覆盖 */
  file?: string
}

/** 从 prompt 提取 ```yaml ... ``` 代码块 */
export function extractYamlBlock(prompt: string): string | undefined {
  const match = /```ya?ml\s*([\s\S]*?)```/i.exec(prompt)
  return match?.[1]?.trim() || undefined
}

/** 从自由文本推断 kebab-case id */
export function inferCaseId(prompt: string, existing: Set<string>): string {
  const explicit =
    /^id:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/im.exec(prompt)?.[1] ??
    /(?:用例|case)\s*[：:]\s*([a-z0-9]+(?:-[a-z0-9]+)*)/i.exec(prompt)?.[1]
  if (explicit) return uniqueId(explicit, existing)

  const titleLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#') && !line.startsWith('```'))
  const slug = slugify(titleLine ?? 'new-case')
  return uniqueId(slug || 'new-case', existing)
}

function uniqueId(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base
  let index = 2
  while (existing.has(`${base}-${index}`)) index++
  return `${base}-${index}`
}

function slugify(text: string): string {
  const ascii = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  // 无可用 ascii 时按语义兜底
  if (!ascii) {
    if (/订单|下单|order/i.test(text)) return 'order-create'
    if (/登录|login/i.test(text)) return 'user-login'
    if (/支付|pay/i.test(text)) return 'order-pay'
    if (/退款|refund/i.test(text)) return 'order-refund'
    if (/冒烟|smoke/i.test(text)) return 'smoke-draft'
    return `case-${Date.now().toString(36).slice(-6)}`
  }
  return ascii
}

function inferName(prompt: string, caseId: string): string {
  const explicit = /^name:\s*(.+)\s*$/im.exec(prompt)?.[1]?.trim()
  if (explicit) return explicit
  const first = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#') && !line.startsWith('```') && !/^id:/i.test(line))
  if (first && first.length <= 40) return first.replace(/^请?(为|帮我|生成).{0,6}/, '').trim() || caseId
  return `[草稿] ${caseId}`
}

function inferTags(prompt: string): string[] {
  const line = /^tags:\s*(.+)\s*$/im.exec(prompt)?.[1]
  if (line) {
    return line
      .split(/[,，\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
  }
  return ['draft', 'agent']
}

/**
 * V0.1 启发式 Planner:
 * 1) prompt 含 yaml 代码块 → 直接采用(仍经 SDK 校验)
 * 2) 否则生成可校验的草稿脚手架(占位 locator,evidence-first:需人工补真实定位)
 * 不做 Multi-Agent / 不直连 Playwright。
 */
export function planCase(input: PlanInput): PlannedCase {
  const yamlBlock = extractYamlBlock(input.prompt)
  if (yamlBlock) {
    const id = /^id:\s*([^\s#]+)/m.exec(yamlBlock)?.[1] ?? inferCaseId(input.prompt, input.existingIds)
    const name = /^name:\s*(.+)$/m.exec(yamlBlock)?.[1]?.trim() ?? id
    const file =
      input.file ??
      relativePosix(input.inspection.casesDir, input.inspection.root, `${id}.yaml`)
    return { file, source: ensureTrailingNewline(yamlBlock), caseId: id, name, fromYamlBlock: true }
  }

  const caseId = inferCaseId(input.prompt, input.existingIds)
  const name = inferName(input.prompt, caseId)
  const tags = inferTags(input.prompt)
  const useMiniapp = input.inspection.targets.includes('miniapp')
  const source = useMiniapp
    ? renderHybridScaffold(caseId, name, tags, input.prompt)
    : renderWebScaffold(caseId, name, tags, input.prompt)
  const file =
    input.file ?? relativePosix(input.inspection.casesDir, input.inspection.root, `${caseId}.yaml`)
  return { file, source, caseId, name, fromYamlBlock: false }
}

function relativePosix(casesDirAbs: string, root: string, filename: string): string {
  const abs = `${casesDirAbs.replace(/\\/g, '/')}/${filename}`
  const rel = relative(root, abs).split('\\').join('/')
  return rel.startsWith('..') ? `tests/e2e/cases/${filename}` : rel
}

function ensureTrailingNewline(source: string): string {
  return source.endsWith('\n') ? source : `${source}\n`
}

function renderWebScaffold(id: string, name: string, tags: string[], prompt: string): string {
  return `# Agent 草稿:locator 为占位符,请按真实页面补齐后再 run / commit
# 需求摘要: ${oneLine(prompt)}
id: ${id}
name: ${name}
tags:
${tags.map((tag) => `  - ${tag}`).join('\n')}

steps:
  - target: web
    action: navigate
    url: /

  - target: web
    action: wait
    locator:
      css: "body"

  - target: web
    action: screenshot

  - target: web
    action: assert
    locator:
      css: "[data-testid='TODO-assert-target']"
    expected: "TODO"
`
}

function renderHybridScaffold(id: string, name: string, tags: string[], prompt: string): string {
  return `# Agent 草稿:跨端脚手架;小程序/Web locator 均为占位,需 Evidence-first 补齐
# 需求摘要: ${oneLine(prompt)}
id: ${id}
name: ${name}
tags:
${tags.map((tag) => `  - ${tag}`).join('\n')}

steps:
  - target: miniapp
    action: launch

  - target: miniapp
    action: navigate
    url: /pages/index/index

  - target: miniapp
    action: click
    locator:
      css: ".TODO-submit-btn"

  - target: miniapp
    action: extract
    locator:
      css: ".TODO-order-id"
    variable: orderId

  - target: web
    action: navigate
    url: /orders

  - target: web
    action: assert
    locator:
      css: ".TODO-order-row"
    expected: "\${orderId}"

  - target: web
    action: screenshot
`
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 120)
}

/** 测试辅助:从绝对路径得到展示用文件名 */
export function displayName(file: string): string {
  return basename(file)
}
