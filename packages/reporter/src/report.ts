import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CaseResult, RunSummary, StepResult } from '@testpilot/core'
import { toSummaryView } from './summary'

export interface WrittenReports {
  json: string
  html: string
}

/** 在 run 目录内生成 report.json + report.html,返回文件绝对路径 */
export async function writeReports(runDir: string, summary: RunSummary): Promise<WrittenReports> {
  const dir = resolve(runDir)
  const jsonPath = join(dir, 'report.json')
  const htmlPath = join(dir, 'report.html')
  const payload = { generatedAt: new Date().toISOString(), summary }

  await writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8')
  await writeFile(htmlPath, renderHtml(summary), 'utf8')
  return { json: jsonPath, html: htmlPath }
}

export function renderHtml(summary: RunSummary): string {
  const view = toSummaryView(summary)
  const casesHtml = summary.cases.map((item) => caseHtml(item)).join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>TestPilot Report ${escapeHtml(summary.runId)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; color: #1f2328; }
  h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 24px; }
  .badge { padding: 2px 10px; border-radius: 10px; color: #fff; font-size: 13px; }
  .passed { background: #1a7f37; } .failed { background: #cf222e; } .skipped { background: #6e7781; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; font-size: 13px; }
  th, td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; }
  td.num { text-align: right; }
  .error { color: #cf222e; white-space: pre-wrap; }
  a { color: #0969da; }
  code { background: #f6f8fa; padding: 1px 4px; border-radius: 4px; }
</style>
</head>
<body>
<h1>TestPilot 报告 <span class="badge ${summary.status}">${summary.status}</span></h1>
<p>run <code>${escapeHtml(summary.runId)}</code> · 用例 ${view.cases.passed}✓ / ${view.cases.failed}✗ · 步骤 ${view.steps.passed}✓ ${view.steps.failed}✗ ${view.steps.skipped}↷ · 耗时 ${(view.durationMs / 1000).toFixed(1)}s</p>
${casesHtml}
</body>
</html>`
}

function caseHtml(item: CaseResult): string {
  const rows = item.steps.map((step) => stepHtml(step)).join('\n')
  const errorLine = item.error ? `<p class="error">${escapeHtml(item.error)}</p>` : ''
  const links: string[] = []
  if (item.video) links.push(`<a href="${escapeHtml(item.video)}">视频</a>`)
  if (item.trace) links.push(`<a href="${escapeHtml(item.trace)}">Trace</a>`)
  const linksLine = links.length > 0 ? `<p>${links.join(' · ')}</p>` : ''
  return `
<h2>${escapeHtml(item.caseId)} · ${escapeHtml(item.caseName)} <span class="badge ${item.status}">${item.status}</span></h2>
${errorLine}
${linksLine}
<table>
  <tr><th>#</th><th>target</th><th>action</th><th>状态</th><th>耗时</th><th>详情</th></tr>
  ${rows}
</table>`
}

function stepHtml(step: StepResult): string {
  const details: string[] = []
  if (step.error) details.push(`<span class="error">${escapeHtml(step.error)}</span>`)
  if (step.extracted) {
    for (const [name, value] of Object.entries(step.extracted)) {
      details.push(`变量 ${escapeHtml(name)} = <code>${escapeHtml(value)}</code>`)
    }
  }
  if (step.screenshot) details.push(`<a href="${escapeHtml(step.screenshot)}">截图</a>`)
  return `<tr>
  <td class="num">${step.index}</td>
  <td>${escapeHtml(step.target)}</td>
  <td>${escapeHtml(step.action)}</td>
  <td><span class="badge ${step.status}">${step.status}</span></td>
  <td class="num">${step.durationMs}ms</td>
  <td>${details.join('<br />') || '-'}</td>
</tr>`
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
