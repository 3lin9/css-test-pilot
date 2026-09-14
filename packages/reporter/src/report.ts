import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { CaseResult, RunSummary, StepResult } from '@testpilot/core'
import { categoryLabel, classifyFailure, FAILURE_CATEGORIES, type FailureCategory } from './classify'
import { collectHistory, type HistoryPoint } from './history'
import { toSummaryView, type ReportSummaryView } from './summary'

export interface WrittenReports {
  json: string
  html: string
}

export interface ReportFailureEntry {
  category: FailureCategory
  label: string
  caseId: string
  index: number
  message: string
}

export interface ReportCase extends CaseResult {
  steps: Array<StepResult & { category?: FailureCategory }>
  categories: FailureCategory[]
}

export interface ReportData {
  generatedAt: string
  summary: Omit<RunSummary, 'cases'> & { cases: ReportCase[] }
  history: HistoryPoint[]
  failures: ReportFailureEntry[]
  view: ReportSummaryView
  categoryLabels: Record<string, string>
}

const HISTORY_LIMIT = 12

/**
 * 生成 report.json(结构化,含历史趋势与失败分类)+ report.html(自包含单文件交互式报告)。
 * 历史趋势默认聚合 runs 目录下最近 12 次运行;截图/视频等附件使用相对路径,报告与 run 目录一起分发。
 */
export async function writeReports(
  runDir: string,
  summary: RunSummary,
  options: { history?: HistoryPoint[]; historyLimit?: number } = {},
): Promise<WrittenReports> {
  const dir = resolve(runDir)
  const generatedAt = new Date().toISOString()
  const history =
    options.history ?? (await collectHistory(dirname(dir), summary.runId, options.historyLimit ?? HISTORY_LIMIT))

  const failures: ReportFailureEntry[] = []
  const cases: ReportCase[] = summary.cases.map((item) => {
    const categories = new Set<FailureCategory>()
    const steps = item.steps.map((step) => {
      const category = step.status === 'failed' ? classifyFailure(step.error) : undefined
      if (category) {
        categories.add(category)
        failures.push({
          category,
          label: categoryLabel(category),
          caseId: item.caseId,
          index: step.index,
          message: step.error ?? '',
        })
      }
      return { ...step, category }
    })
    return { ...item, steps, categories: [...categories] }
  })

  const categoryLabels: Record<string, string> = {}
  for (const item of FAILURE_CATEGORIES) categoryLabels[item.id] = item.label

  const data: ReportData = {
    generatedAt,
    summary: { ...summary, cases },
    history,
    failures,
    view: toSummaryView(summary),
    categoryLabels,
  }

  const jsonPath = join(dir, 'report.json')
  const htmlPath = join(dir, 'report.html')
  await writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf8')
  await writeFile(htmlPath, renderHtml(data), 'utf8')
  return { json: jsonPath, html: htmlPath }
}

function categoryChips(data: ReportData): string {
  const counts = new Map<FailureCategory, number>()
  for (const failure of data.failures) {
    counts.set(failure.category, (counts.get(failure.category) ?? 0) + 1)
  }
  const chips = [
    '<span class="chip active" data-group="status" data-value="all">全部状态</span>',
    '<span class="chip" data-group="status" data-value="failed">仅失败</span>',
  ]
  for (const item of FAILURE_CATEGORIES) {
    const count = counts.get(item.id) ?? 0
    if (count > 0) {
      chips.push(
        `<span class="chip" data-group="cat" data-value="${item.id}">${escapeHtml(item.label)}(${count})</span>`,
      )
    }
  }
  return chips.join('\n')
}

export function renderHtml(data: ReportData): string {
  const view = toSummaryView(data.summary)
  const summary = data.summary
  const trendSvg = renderTrend(data)
  const casesHtml = summary.cases.map((item) => caseHtml(item)).join('\n')
  const chips = categoryChips(data)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>TestPilot Report ${escapeHtml(summary.runId)}</title>
<style>
  :root { --ok:#1a7f37; --fail:#cf222e; --skip:#6e7781; --line:#d0d7de; --muted:#59636e; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", sans-serif; margin: 0; color: #1f2328; background: #f6f8fa; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 20px 16px 48px; }
  h1 { font-size: 20px; margin: 8px 0; } h2 { font-size: 15px; margin: 24px 0 8px; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 10px; color: #fff; font-size: 12px; }
  .passed { background: var(--ok); } .failed { background: var(--fail); } .skipped { background: var(--skip); }
  code { background: #eef1f4; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin: 14px 0; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 10px 16px; min-width: 130px; }
  .card b { font-size: 20px; display: block; }
  .card span { color: var(--muted); font-size: 12px; }
  .toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 10px 0; }
  .chip { border: 1px solid var(--line); background: #fff; border-radius: 14px; padding: 3px 12px; font-size: 12px; cursor: pointer; }
  .chip.active { background: #0969da; color: #fff; border-color: #0969da; }
  input#q { flex: 1; min-width: 180px; padding: 5px 10px; border: 1px solid var(--line); border-radius: 6px; font-size: 13px; }
  .btn { border: 1px solid var(--line); background: #fff; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
  #count { color: var(--muted); font-size: 12px; margin-left: auto; }
  details.case { background: #fff; border: 1px solid var(--line); border-radius: 8px; margin: 10px 0; }
  details.case > summary { cursor: pointer; padding: 10px 14px; font-size: 14px; list-style: none; }
  details.case > summary::-webkit-details-marker { display: none; }
  details.case > summary:hover { background: #f6f8fa; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border-top: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
  td.num { text-align: right; white-space: nowrap; }
  .error { color: var(--fail); white-space: pre-wrap; }
  a { color: #0969da; text-decoration: none; }
  .trend { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 12px; overflow-x: auto; }
  .muted { color: var(--muted); }
  .hide { display: none !important; }
  .meta { color: var(--muted); font-size: 12px; margin: 6px 0; }
</style>
</head>
<body>
<div class="wrap">
  <h1>TestPilot 测试报告 <span class="badge ${summary.status}">${summary.status}</span></h1>
  <p class="meta">run <code>${escapeHtml(summary.runId)}</code> · 生成于 ${escapeHtml(data.generatedAt)} · 耗时 ${(view.durationMs / 1000).toFixed(1)}s</p>

  <div class="cards">
    <div class="card"><b>${view.cases.passed}<span style="color:var(--ok)"> ✓</span></b><span>通过用例</span></div>
    <div class="card"><b>${view.cases.failed}<span style="color:var(--fail)"> ✗</span></b><span>失败用例</span></div>
    <div class="card"><b>${view.steps.passed}<span style="color:var(--ok)"> ✓</span></b><span>通过步骤</span></div>
    <div class="card"><b>${view.steps.failed}<span style="color:var(--fail)"> ✗</span></b><span>失败步骤</span></div>
    <div class="card"><b>${view.steps.skipped} ↷</b><span>跳过步骤</span></div>
  </div>

  <h2>历史趋势(最近 ${data.history.length + 1} 次运行)</h2>
  <div class="trend">${trendSvg}</div>

  <h2>失败分类</h2>
  <div class="toolbar" id="cat-chips">${chips}</div>

  <h2>用例</h2>
  <div class="toolbar">
    <input id="q" placeholder="搜索用例 id / 名称 / 文件…" />
    <button class="btn" id="expand">展开全部</button>
    <button class="btn" id="collapse">收起全部</button>
    <span id="count"></span>
  </div>
  <div id="cases">${casesHtml}</div>
</div>

<script id="report-data" type="application/json">${embedJson(data)}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('report-data').textContent);
  var state = { status: 'all', cat: 'all', q: '' };
  var labels = data.categoryLabels || {};

  function setChip(group, value) {
    document.querySelectorAll('.chip[data-group="' + group + '"]').forEach(function (chip) {
      chip.classList.toggle('active', chip.getAttribute('data-value') === value);
    });
  }

  function matches(card) {
    if (state.status !== 'all' && card.getAttribute('data-status') !== state.status) return false;
    if (state.cat !== 'all' && (',' + (card.getAttribute('data-cats') || '') + ',').indexOf(',' + state.cat + ',') === -1) return false;
    if (state.q) {
      var text = (card.getAttribute('data-search') || '').toLowerCase();
      if (text.indexOf(state.q.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function apply() {
    var cards = document.querySelectorAll('details.case');
    var shown = 0;
    cards.forEach(function (card) {
      var show = matches(card);
      card.classList.toggle('hide', !show);
      if (show) shown++;
    });
    var count = document.getElementById('count');
    if (count) count.textContent = shown + ' / ' + cards.length + ' 用例';
  }

  document.querySelectorAll('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var group = chip.getAttribute('data-group');
      var value = chip.getAttribute('data-value');
      if (group === 'status') state.status = value;
      if (group === 'cat') state.cat = value;
      setChip(group, value);
      apply();
    });
  });
  var q = document.getElementById('q');
  if (q) q.addEventListener('input', function () { state.q = q.value.trim(); apply(); });
  var expand = document.getElementById('expand');
  if (expand) expand.addEventListener('click', function () {
    document.querySelectorAll('details.case').forEach(function (c) { c.open = true; });
  });
  var collapse = document.getElementById('collapse');
  if (collapse) collapse.addEventListener('click', function () {
    document.querySelectorAll('details.case').forEach(function (c) { c.open = false; });
  });

  function failedSteps(card) {
    return data.summary.cases.find(function (c) { return c.caseId === card; });
  }
  apply();
})();
</script>
</body>
</html>`
}

function caseHtml(item: ReportCase): string {
  const rows = item.steps.map((step) => stepHtml(step)).join('\n')
  const errorLine = item.error ? `<p class="error">${escapeHtml(item.error)}</p>` : ''
  const links: string[] = []
  if (item.video) links.push(`<a href="${escapeHtml(item.video)}">视频</a>`)
  if (item.trace) links.push(`<a href="${escapeHtml(item.trace)}">Trace</a>`)
  const linksLine = links.length > 0 ? `<p>${links.join(' · ')}</p>` : ''
  const search = escapeHtml(`${item.caseId} ${item.caseName} ${item.file}`).replaceAll('"', '&quot;')
  const cats = escapeHtml(item.categories.join(','))
  return `
<details class="case" data-status="${item.status}" data-cats="${cats}" data-search="${search}">
  <summary>
    <span class="badge ${item.status}">${item.status}</span>
    <b>${escapeHtml(item.caseId)}</b> · ${escapeHtml(item.caseName)}
    <span class="muted">· ${item.steps.length} 步 · ${(item.durationMs / 1000).toFixed(1)}s</span>
  </summary>
  ${errorLine}
  ${linksLine}
  <table>
    <tr><th>#</th><th>target</th><th>action</th><th>状态</th><th>耗时</th><th>详情</th></tr>
    ${rows}
  </table>
</details>`
}

function stepHtml(step: StepResult & { category?: FailureCategory }): string {
  const details: string[] = []
  if (step.error) details.push(`<span class="error">${escapeHtml(step.error)}</span>`)
  if (step.category) details.push(`<span class="muted">分类: ${escapeHtml(categoryLabel(step.category))}</span>`)
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

function renderTrend(data: ReportData): string {
  const points: Array<{ runId: string; passed: number; failed: number; status: string }> = [
    ...data.history.map((h) => ({ runId: h.runId, passed: h.passed, failed: h.failed, status: h.status })),
    {
      runId: data.summary.runId,
      passed: data.summary.totals.passed,
      failed: data.summary.totals.failed,
      status: data.summary.status,
    },
  ]
  if (points.length === 0) return '<p class="muted">暂无历史数据</p>'

  const max = Math.max(1, ...points.map((p) => p.passed + p.failed))
  const barW = 34
  const gap = 14
  const chartH = 90
  const labelH = 34
  const width = points.length * (barW + gap) + gap
  const height = chartH + labelH

  const bars = points
    .map((point, index) => {
      const total = point.passed + point.failed
      const scale = (count: number) => (total === 0 ? 0 : (count / max) * chartH)
      const passedH = scale(point.passed)
      const failedH = scale(point.failed)
      const x = gap + index * (barW + gap)
      const passedY = chartH - passedH
      const failedY = passedY - failedH
      const tip = `${point.runId}: ✓${point.passed} ✗${point.failed}`
      return `<g>
  <title>${escapeHtml(tip)}</title>
  <rect x="${x}" y="${chartH + 4}" width="${barW}" height="1" fill="var(--line)"></rect>
  ${passedH > 0 ? `<rect x="${x}" y="${passedY.toFixed(1)}" width="${barW}" height="${passedH.toFixed(1)}" fill="var(--ok)" rx="2"></rect>` : ''}
  ${failedH > 0 ? `<rect x="${x}" y="${failedY.toFixed(1)}" width="${barW}" height="${failedH.toFixed(1)}" fill="var(--fail)" rx="2"></rect>` : ''}
  <text x="${x + barW / 2}" y="${chartH + 20}" font-size="9" fill="var(--muted)" text-anchor="middle">${escapeHtml(shortId(point.runId))}</text>
</g>`
    })
    .join('\n')

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`
}

function shortId(runId: string): string {
  return runId.replace(/^\d{8}-/, '')
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function embedJson(data: ReportData): string {
  return JSON.stringify(data).replaceAll('<', '\\u003c')
}
