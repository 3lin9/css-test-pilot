import type { CaseResult, RunSummary } from '@testpilot/core'

/** XML 文本转义(元素文本与属性值同一套:五实体全覆盖) */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * JUnit XML 映射(供 Jenkins/GitLab 等测试结果插件解析):
 * - failed / inconclusive → <failure>(inconclusive 是"没测到",但 CI 需要看到未通过)
 * - blocked → <skipped>(环境/前置受阻,非产品回归,不应标红 CI)
 * - skipped → <skipped>
 * - passed → 空 testcase
 * 按脚本文件分组 <testsuite>,time 单位为秒(JUnit 惯例)。
 */
export function buildJunitXml(summary: RunSummary): string {
  const failures = summary.totals.failed + (summary.totals.inconclusive ?? 0)
  const skipped = (summary.totals.blocked ?? 0) + (summary.totals.skipped ?? 0)
  const suites = new Map<string, CaseResult[]>()
  for (const item of summary.cases) {
    const key = item.file || '(无文件)'
    const list = suites.get(key) ?? []
    list.push(item)
    suites.set(key, list)
  }

  const suiteXml = [...suites.entries()]
    .map(([file, cases]) => {
      const suiteFailures = cases.filter((item) => item.status === 'failed' || item.status === 'inconclusive').length
      const suiteSkipped = cases.filter((item) => item.status === 'blocked' || item.status === 'skipped').length
      const time = cases.reduce((sum, item) => sum + (item.durationMs ?? 0), 0) / 1000
      const caseXml = cases.map(caseXmlOf).join('\n      ')
      return [
        `    <testsuite name="${escapeXml(file)}" tests="${cases.length}" failures="${suiteFailures}" skipped="${suiteSkipped}" time="${time.toFixed(3)}" timestamp="${escapeXml(summary.startedAt)}">`,
        `      ${caseXml}`,
        `    </testsuite>`,
      ].join('\n')
    })
    .join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="csspilot ${escapeXml(summary.runId)}" tests="${summary.cases.length}" failures="${failures}" skipped="${skipped}" time="${(summary.durationMs / 1000).toFixed(3)}">`,
    suiteXml,
    '</testsuites>',
    '',
  ].join('\n')
}

function caseXmlOf(item: CaseResult): string {
  const time = ((item.durationMs ?? 0) / 1000).toFixed(3)
  const name = `${item.caseId}${item.rowId && item.rowId !== item.caseName ? ` [${item.rowId}]` : ''}`
  const open = `<testcase name="${escapeXml(name)}" classname="${escapeXml(item.file)}" time="${time}"`
  if (item.status === 'passed') return `${open}/>`
  const message = item.error ?? item.skipReason ?? ''
  if (item.status === 'failed' || item.status === 'inconclusive') {
    const type = item.status === 'inconclusive' ? 'inconclusive' : (item.errorCode ?? 'assertion')
    return `${open}>\n        <failure message="${escapeXml(message)}" type="${escapeXml(type)}">${escapeXml(message)}</failure>\n      </testcase>`
  }
  const note =
    item.status === 'blocked' ? `环境/前置受阻:${message}` : (item.skipReason ?? 'skipped')
  return `${open}>\n        <skipped message="${escapeXml(note)}"/>\n      </testcase>`
}
