import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { RunSummary } from '@testpilot/core'
import { categoryLabel, classifyFailure, FAILURE_CATEGORIES, type FailureCategory } from './classify'

export interface SummaryRunInput {
  runId: string
  summary: RunSummary
}

export interface SummaryCase {
  caseId: string
  rowId?: string
  caseName: string
  /** 用例步骤中出现过的执行端(如 web / miniapp / api) */
  platforms: string[]
  runs: number
  passed: number
  failed: number
  passRate: number
  lastStatus: 'passed' | 'failed' | 'skipped' | 'unknown'
  lastCategory?: FailureCategory
  /** 窗口内又过又挂(Flaky) */
  flaky: boolean
}

export interface SummaryRunPoint {
  runId: string
  startedAt?: string
  status: string
  passed: number
  failed: number
  passRate: number
}

export interface SummaryReportData {
  window: { runs: number; from?: string; to?: string }
  kpis: {
    runs: number
    executions: number
    overallRate: number
    avgDurationMs: number
    flakyCount: number
  }
  runs: SummaryRunPoint[]
  cases: SummaryCase[]
  platforms: string[]
  categories: Array<{ id: FailureCategory; label: string; count: number }>
  categoryLabels: Record<string, string>
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function pct(value: number): string {
  return (value * 100).toFixed(1) + '%'
}

/** 聚合最近 N 次 run 的结果:整体 KPI、趋势点、用例维度统计(含 Flaky 判定) */
export function buildSummaryData(runs: readonly SummaryRunInput[]): SummaryReportData {
  const executions: Array<{
    runId: string
    caseId: string
    rowId?: string
    identity: string
    caseName: string
    status: 'passed' | 'failed' | 'skipped'
    category?: FailureCategory
    platforms: string[]
  }> = []
  const runPoints: SummaryRunPoint[] = []

  for (const { runId, summary } of runs) {
    for (const item of summary.cases) {
      const platforms = [...new Set(item.steps.map((step) => step.target))]
      const failedStep = item.steps.find((step) => step.status === 'failed')
      const category = item.status === 'failed' ? classifyFailure(failedStep?.error) : undefined
      executions.push({
        runId,
        caseId: item.caseId,
        rowId: item.rowId,
        identity: item.rowId && item.rowId !== 'default' ? `${item.caseId}#${item.rowId}` : item.caseId,
        caseName: item.caseName,
        status: item.status,
        category,
        platforms,
      })
    }
    runPoints.push({
      runId,
      startedAt: summary.startedAt,
      status: summary.status,
      passed: summary.totals.passed,
      failed: summary.totals.failed,
      passRate: summary.totals.cases > 0 ? summary.totals.passed / summary.totals.cases : 0,
    })
  }

  const byCase = new Map<string, SummaryCase>()
  for (const exec of executions) {
    let agg = byCase.get(exec.identity)
    if (!agg) {
      agg = {
        caseId: exec.caseId,
        rowId: exec.rowId,
        caseName: exec.caseName,
        platforms: [],
        runs: 0,
        passed: 0,
        failed: 0,
        passRate: 0,
        lastStatus: 'unknown',
        flaky: false,
      }
      byCase.set(exec.identity, agg)
    }
    agg.runs++
    if (exec.status === 'passed') agg.passed++
    else if (exec.status === 'failed') agg.failed++
    for (const platform of exec.platforms) {
      if (!agg.platforms.includes(platform)) agg.platforms.push(platform)
    }
  }
  for (const agg of byCase.values()) {
    // 输入按时间正序,最后一条即该用例的最近状态
    const identity = agg.rowId && agg.rowId !== 'default' ? `${agg.caseId}#${agg.rowId}` : agg.caseId
    const last = [...executions].reverse().find((exec) => exec.identity === identity)
    agg.lastStatus = last?.status ?? 'unknown'
    agg.lastCategory = last?.category
    agg.passRate = agg.runs > 0 ? agg.passed / agg.runs : 0
    agg.flaky = agg.failed > 0 && agg.passed > 0
  }

  const cases = [...byCase.values()]
  const flaky = cases.filter((item) => item.flaky)
  const categories = FAILURE_CATEGORIES.map((item) => ({
    id: item.id,
    label: item.label,
    count: executions.filter((exec) => exec.status === 'failed' && exec.category === item.id).length,
  })).filter((item) => item.count > 0)

  const durations = runs.map((item) => item.summary.durationMs).filter((value) => typeof value === 'number')

  return {
    window: {
      runs: runs.length,
      from: runPoints[0]?.startedAt,
      to: runPoints.at(-1)?.startedAt,
    },
    kpis: {
      runs: runs.length,
      executions: executions.length,
      overallRate:
        executions.length > 0
          ? executions.filter((exec) => exec.status === 'passed').length / executions.length
          : 0,
      avgDurationMs:
        durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
      flakyCount: flaky.length,
    },
    runs: runPoints,
    cases,
    platforms: [...new Set(cases.flatMap((item) => item.platforms))].sort(),
    categories,
    categoryLabels: Object.fromEntries(FAILURE_CATEGORIES.map((item) => [item.id, item.label])),
  }
}

function renderSummaryTrend(runs: SummaryRunPoint[]): string {
  if (runs.length === 0) return '<p class="muted">统计窗口内没有运行数据</p>'
  const barW = 30
  const gap = 8
  const chartH = 96
  const width = runs.length * (barW + gap) + gap
  const height = chartH + 30
  const max = Math.max(1, ...runs.map((run) => run.passed + run.failed))
  const bars = runs
    .map((run, index) => {
      const x = gap + index * (barW + gap)
      const passedH = (run.passed / max) * chartH
      const failedH = (run.failed / max) * chartH
      const passedY = chartH - passedH
      const failedY = passedY - failedH
      const total = run.passed + run.failed
      const rate = total > 0 ? Math.round((run.passed / total) * 100) : 0
      const label = run.runId.replace(/^\d{8}-/, '')
      return (
        '<g><title>' +
        escapeHtml(run.runId) +
        ': ✓' +
        run.passed +
        ' ✗' +
        run.failed +
        '</title>'
        + '<rect x="' + x + '" y="' + passedY.toFixed(1) + '" width="' + barW + '" height="' + passedH.toFixed(1) + '" fill="#1a7f37" rx="2"></rect>'
        + '<rect x="' + x + '" y="' + failedY.toFixed(1) + '" width="' + barW + '" height="' + failedH.toFixed(1) + '" fill="#cf222e" rx="2"></rect>'
        + '<text x="' + (x + barW / 2) + '" y="' + (chartH + 12) + '" font-size="8" fill="#59636e" text-anchor="middle">' + escapeHtml(label) + '</text>'
        + '<text x="' + (x + barW / 2) + '" y="' + (chartH + 24) + '" font-size="8" fill="#59636e" text-anchor="middle">' + rate + '%</text></g>'
      )
    })
    .join('\n')
  return (
    '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg">' + bars + '</svg>'
  )
}

/** 渲染汇总报告单文件 HTML(自包含,无外部依赖;交互:平台筛选 / 分类下钻 / 搜索 / 表头排序) */
export function renderSummaryHtml(data: SummaryReportData): string {
  const kpis = data.kpis
  const rateText = pct(kpis.overallRate)
  const trendSvg = renderSummaryTrend(data.runs)
  const catBars = data.categories
    .map(
      (item) =>
        '<div class="hbar-row" data-cat="' +
        item.id +
        '" title="点击筛选用例明细"><span class="hbar-label">' +
        escapeHtml(item.label) +
        '</span><span class="hbar-track"><span class="hbar" style="width:' +
        (kpis.executions > 0 ? Math.round((item.count / kpis.executions) * 100) : 0) +
        '%"></span></span><span class="hbar-num">' +
        item.count +
        '</span></div>',
    )
    .join('\n')
  const catHtml = catBars || '<p class="muted">统计窗口内无失败</p>'
  const flaky = data.cases.filter((item) => item.flaky)
  const flakyRows = flaky
    .map(
      (item) =>
        '<tr data-platform="' +
        escapeHtml(item.platforms.join(' ')) +
        '" data-q="' +
        escapeHtml(item.caseId + ' ' + item.caseName) +
        '"><td><code class="flaky-link" data-q="' +
        escapeHtml(item.caseId) +
        '">' +
        escapeHtml(item.caseId) +
        '</code></td><td>' +
        escapeHtml(item.caseName) +
        '</td><td>' +
        escapeHtml(item.platforms.join(' + ')) +
        '</td><td class="num">' +
        item.failed +
        ' / ' +
        item.runs +
        '</td><td class="num">' +
        pct(item.passRate) +
        '</td><td><span class="badge ' +
        item.lastStatus +
        '">' +
        item.lastStatus +
        '</span></td></tr>',
    )
    .join('\n')
  const platformChips = ['all', ...data.platforms]
    .map(
      (platform) =>
        '<span class="chip' +
        (platform === 'all' ? ' active' : '') +
        '" data-platform="' +
        platform +
        '">' +
        (platform === 'all' ? '全部平台' : platform) +
        '</span>',
    )
    .join('\n')
  const detailRows = data.cases
    .map(
      (item) =>
        '<tr data-platform="' +
        escapeHtml(item.platforms.join(' ')) +
        '" data-cat="' +
        escapeHtml(item.lastCategory ?? '') +
        '" data-q="' +
        escapeHtml(item.caseId + ' ' + item.caseName) +
        '" data-pass="' +
        item.passRate +
        '" data-runs="' +
        item.runs +
        '" data-failed="' +
        item.failed +
        '"><td><code>' +
        escapeHtml(item.caseId) +
        '</code></td><td>' +
        escapeHtml(item.caseName) +
        '</td><td>' +
        escapeHtml(item.platforms.join(' + ')) +
        '</td><td class="num">' +
        item.runs +
        '</td><td class="num">' +
        item.passed +
        '</td><td class="num">' +
        item.failed +
        '</td><td><span class="mini-track"><span class="mini ' +
        (item.failed > 0 ? 'warn' : 'ok') +
        '" style="width:' +
        Math.round(item.passRate * 60) +
        'px"></span></span> ' +
        pct(item.passRate) +
        '</td><td>' +
        (item.lastCategory ? escapeHtml(categoryLabel(item.lastCategory)) : '-') +
        '</td><td><span class="badge ' +
        item.lastStatus +
        '">' +
        item.lastStatus +
        '</span></td></tr>',
    )
    .join('\n')
  const range = (data.window.from ?? '').slice(0, 10) + ' → ' + (data.window.to ?? '').slice(0, 10)

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>TestPilot 汇总报告</title>
<style>
  :root { --ok:#1a7f37; --fail:#cf222e; --line:#d0d7de; --muted:#59636e; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", sans-serif; margin: 0; color: #1f2328; background: #f6f8fa; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 20px 16px 56px; }
  h1 { font-size: 21px; margin: 8px 0; } h2 { font-size: 15px; margin: 26px 0 8px; }
  .meta { color: var(--muted); font-size: 12px; margin: 4px 0 12px; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin: 14px 0; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 12px 18px; min-width: 140px; }
  .card b { font-size: 22px; display: block; } .card span { color: var(--muted); font-size: 12px; }
  .row2 { display: flex; gap: 14px; flex-wrap: wrap; align-items: stretch; }
  .panel { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
  .panel h3 { margin: 0 0 8px; font-size: 13px; color: var(--muted); font-weight: 500; }
  .trend { overflow-x: auto; flex: 1; min-width: 320px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; background: #fff; }
  th, td { border-bottom: 1px solid var(--line); padding: 7px 10px; text-align: left; }
  th { color: var(--muted); font-weight: 500; cursor: pointer; white-space: nowrap; }
  th.num, td.num { text-align: right; }
  code { background: #eef1f4; padding: 1px 5px; border-radius: 4px; font-size: 12px; cursor: pointer; }
  .badge { display: inline-block; padding: 1px 9px; border-radius: 10px; color: #fff; font-size: 11px; }
  .passed { background: #1a7f37; } .failed { background: #cf222e; } .unknown { background: #6e7781; }
  .toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 10px 0; }
  .chip { border: 1px solid var(--line); background: #fff; border-radius: 14px; padding: 3px 12px; font-size: 12px; cursor: pointer; }
  .chip.active { background: #0969da; color: #fff; border-color: #0969da; }
  input#q { flex: 1; min-width: 160px; padding: 5px 10px; border: 1px solid var(--line); border-radius: 6px; font-size: 13px; }
  #count { color: var(--muted); font-size: 12px; margin-left: auto; }
  .hbar-row { display: flex; align-items: center; gap: 10px; margin: 7px 0; cursor: pointer; }
  .hbar-label { width: 90px; font-size: 13px; } .hbar-num { width: 30px; text-align: right; font-size: 13px; }
  .hbar-track { flex: 1; background: #eef1f4; border-radius: 5px; height: 12px; overflow: hidden; }
  .hbar { display: block; height: 100%; background: var(--fail); }
  .mini-track { display: inline-block; width: 60px; height: 7px; background: #eef1f4; border-radius: 4px; overflow: hidden; vertical-align: middle; }
  .mini { display: block; height: 100%; } .mini.ok { background: var(--ok); } .mini.warn { background: #bf8700; }
  .muted { color: var(--muted); } .hide { display: none !important; }
</style>
</head>
<body>
<div class="wrap">
  <h1>TestPilot 汇总报告</h1>
  <p class="meta">统计范围:最近 ${data.window.runs} 次运行(${escapeHtml(range)})· 生成于 ${new Date().toISOString().slice(0, 10)}</p>

  <div class="cards">
    <div class="card"><b>${kpis.runs}</b><span>运行次数</span></div>
    <div class="card"><b>${kpis.executions}</b><span>用例执行次数</span></div>
    <div class="card"><b>${rateText}</b><span>整体通过率</span></div>
    <div class="card"><b>${(kpis.avgDurationMs / 1000).toFixed(1)}s</b><span>平均运行耗时</span></div>
    <div class="card"><b>${kpis.flakyCount}</b><span>Flaky 用例</span></div>
  </div>

  <h2>趋势(每次运行结果与通过率,悬浮看详情)</h2>
  <div class="panel trend">${trendSvg}</div>

  <h2>失败分类分布(点击筛选明细)</h2>
  <div class="panel">${catHtml}</div>

  <h2>Flaky 榜(又过又挂;点用例名定位明细)</h2>
  <div class="panel"><table>
    <tr><th>用例</th><th>名称</th><th>平台</th><th class="num">失败 / 参与</th><th class="num">通过率</th><th>最近状态</th></tr>
    ${flakyRows || '<tr><td colspan="6" class="muted">统计窗口内无 Flaky 用例</td></tr>'}
  </table></div>

  <h2>用例明细</h2>
  <div class="toolbar">
    ${platformChips}
    <input id="q" placeholder="搜索用例 id / 名称…" />
    <span id="count"></span>
  </div>
  <table id="detail">
    <thead><tr>
      <th>用例</th><th>名称</th><th>平台</th>
      <th class="num" data-sort="runs">运行次数</th><th class="num" data-sort="passed">通过</th><th class="num" data-sort="failed">失败</th>
      <th data-sort="passRate">通过率 ▾</th><th>最近分类</th><th>最近状态</th>
    </tr></thead>
    <tbody>${detailRows}</tbody>
  </table>
</div>

<script id="summary-data" type="application/json">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>
<script>
(function () {
  var rows = Array.prototype.slice.call(document.querySelectorAll('#detail tbody tr'));
  var state = { platform: 'all', cat: 'all', q: '', sortKey: 'passRate', sortDir: -1 };

  function apply() {
    var shown = 0;
    rows.forEach(function (row) {
      var show = true;
      if (state.platform !== 'all' && row.getAttribute('data-platform').split(' ').indexOf(state.platform) === -1) show = false;
      if (state.cat !== 'all' && (row.getAttribute('data-cat') || '') !== state.cat) show = false;
      if (state.q && row.getAttribute('data-q').toLowerCase().indexOf(state.q.toLowerCase()) === -1) show = false;
      row.classList.toggle('hide', !show);
      if (show) shown++;
    });
    document.getElementById('count').textContent = shown + ' / ' + rows.length + ' 用例';
  }

  document.querySelectorAll('.chip[data-platform]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      document.querySelectorAll('.chip[data-platform]').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      state.platform = chip.getAttribute('data-platform');
      apply();
    });
  });
  document.querySelectorAll('.hbar-row').forEach(function (bar) {
    bar.addEventListener('click', function () {
      state.cat = bar.getAttribute('data-cat');
      apply();
    });
  });
  var q = document.getElementById('q');
  q.addEventListener('input', function () { state.q = q.value.trim(); apply(); });

  document.querySelectorAll('#detail th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      state.sortDir = state.sortKey === key ? -state.sortDir : -1;
      state.sortKey = key;
      var sorted = rows.slice().sort(function (a, b) {
        return (Number(a.getAttribute('data-' + key)) - Number(b.getAttribute('data-' + key))) * state.sortDir;
      });
      var tbody = document.querySelector('#detail tbody');
      sorted.forEach(function (row) { tbody.appendChild(row); });
    });
  });

  apply();
})();
</script>
</body>
</html>`
}

/** 汇总报告落盘到 TestPilot artifacts 目录(summary.html + summary.json),返回绝对路径 */
export async function writeSummaryReport(
  artifactsDir: string,
  data: SummaryReportData,
): Promise<{ html: string; json: string }> {
  const dir = resolve(artifactsDir)
  await mkdir(dir, { recursive: true })
  const htmlPath = join(dir, 'summary.html')
  const jsonPath = join(dir, 'summary.json')
  await writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf8')
  await writeFile(htmlPath, renderSummaryHtml(data), 'utf8')
  return { html: htmlPath, json: jsonPath }
}
