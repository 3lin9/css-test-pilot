// TestPilot 汇总报告样稿生成器:生成 docs/samples/summary.html(自包含单文件,纯演示数据)
// 产品化时,本文件的渲染模板与聚合逻辑将迁移为 `csspilot summary` 命令的实现参考。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'summary.html')

// ---------- 演示数据(种子随机,输出稳定) ----------
let seed = 20260911
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const pct = (n) => `${(n * 100).toFixed(1)}%`
const round1 = (n) => Math.round(n * 10) / 10
const esc = (s) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const CASES = [
  { id: 'order-create', name: '下单主流程', platform: '双端', module: '订单' },
  { id: 'login', name: '用户登录', platform: 'web', module: '账号' },
  { id: 'refund', name: '退款流程', platform: '双端', module: '订单' },
  { id: 'search-empty', name: '空结果搜索', platform: 'web', module: '搜索' },
  { id: 'miniapp-pay', name: '小程序支付', platform: 'miniapp', module: '支付' },
  { id: 'admin-export', name: '后台报表导出', platform: 'web', module: '后台' },
]

const PROFILE = {
  'order-create': { failRate: 0.2, cats: ['element', 'timeout', 'assert'] },
  login: { failRate: 0 },
  refund: { failRate: 0, special: 'recent-broken', cats: ['env'] },
  'search-empty': { failRate: 0 },
  'miniapp-pay': { failRate: 0.12, cats: ['assert'] },
  'admin-export': { failRate: 0.3, onlyBranch: 'release-1.2', cats: ['assert', 'element'] },
}

const runs = []
const start = new Date('2026-08-13T09:00:00+08:00')
for (let i = 0; i < 30; i++) {
  const date = new Date(start.getTime() + i * 24 * 3600 * 1000)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  runs.push({
    runId: `${y}${m}${d}-00${(i % 2) + 1}`,
    date: `${y}-${m}-${d}`,
    branch: i >= 20 && i <= 23 ? 'release-1.2' : 'main',
    durationMs: Math.round((34 + rnd() * 18) * 1000),
  })
}

const executions = []
for (const [index, run] of runs.entries()) {
  for (const item of CASES) {
    const profile = PROFILE[item.id] ?? { failRate: 0 }
    let failed = rnd() < profile.failRate
    if (profile.special === 'recent-broken' && index >= runs.length - 3) failed = true
    if (failed && profile.failRate === 0) failed = false
    executions.push({
      runId: run.runId,
      date: run.date,
      branch: run.branch,
      caseId: item.id,
      caseName: item.name,
      platform: item.platform,
      module: item.module,
      status: failed ? 'failed' : 'passed',
      category: failed ? pick(profile.cats ?? ['other']) : undefined,
      durationMs: Math.round((3 + rnd() * 12) * 1000),
    })
  }
}

// ---------- 聚合 ----------
const runsView = runs.map((run, index) => {
  const rows = executions.filter((item) => item.runId === run.runId)
  const passed = rows.filter((item) => item.status === 'passed').length
  const failed = rows.length - passed
  return { ...run, index, total: rows.length, passed, failed, passRate: rows.length ? passed / rows.length : 0 }
})

const caseStats = CASES.map((item) => {
  const rows = executions.filter((exec) => exec.caseId === item.id)
  const failedRows = rows.filter((row) => row.status === 'failed')
  const last = rows.at(-1)
  return {
    ...item,
    runs: rows.length,
    passed: rows.length - failedRows.length,
    failed: failedRows.length,
    passRate: rows.length ? (rows.length - failedRows.length) / rows.length : 0,
    lastStatus: last?.status ?? 'unknown',
    lastCategory: failedRows.at(-1)?.category,
    flaky: failedRows.length > 0 && rows.length - failedRows.length > 0,
  }
})

const flakyList = caseStats.filter((item) => item.flaky).sort((a, b) => b.failed - a.failed)
const catCounts = {}
for (const row of executions) {
  if (row.category) catCounts[row.category] = (catCounts[row.category] ?? 0) + 1
}
const CAT_LABEL = { assert: '断言失败', element: '元素未找到', env: '环境 / 连接', timeout: '超时', adapter: 'Adapter', other: '其他' }
const catList = Object.entries(catCounts).sort((a, b) => b[1] - a[1])
const catTotal = catList.reduce((sum, item) => sum + item[1], 0)

const totalExec = executions.length
const totalPassed = executions.filter((item) => item.status === 'passed').length
const overallRate = totalExec ? totalPassed / totalExec : 0
const avgDuration = round1(runs.reduce((sum, run) => sum + run.durationMs, 0) / runs.length / 1000)
const branchStats = ['main', 'release-1.2']
  .map((branch) => {
    const rows = runsView.filter((run) => run.branch === branch)
    const exec = executions.filter((item) => item.branch === branch)
    return {
      branch,
      runs: rows.length,
      passRate: exec.length ? exec.filter((item) => item.status === 'passed').length / exec.length : 0,
    }
  })
  .filter((item) => item.runs > 0)

// ---------- 渲染 ----------
const donut = (() => {
  const r = 52
  const c = 2 * Math.PI * r
  const ok = (c * overallRate).toFixed(1)
  return `<svg width="130" height="130" viewBox="0 0 130 130">
  <circle cx="65" cy="65" r="${r}" fill="none" stroke="#e7ebef" stroke-width="14"></circle>
  <circle cx="65" cy="65" r="${r}" fill="none" stroke="var(--ok)" stroke-width="14" stroke-linecap="round"
    stroke-dasharray="${ok} ${c.toFixed(1)}" transform="rotate(-90 65 65)"></circle>
  <text x="65" y="61" text-anchor="middle" font-size="20" font-weight="600" fill="var(--ok)">${pct(overallRate)}</text>
  <text x="65" y="80" text-anchor="middle" font-size="11" fill="var(--muted)">用例通过率</text>
</svg>`
})()

const trend = (() => {
  const barW = 26
  const gap = 8
  const chartH = 96
  const width = runsView.length * (barW + gap) + gap
  const height = chartH + 30
  const max = Math.max(1, ...runsView.map((run) => run.total))
  const bars = runsView
    .map((run, index) => {
      const x = gap + index * (barW + gap)
      const passedH = (run.passed / max) * chartH
      const failedH = (run.failed / max) * chartH
      const passedY = chartH - passedH
      const failedY = passedY - failedH
      const rate = run.total ? Math.round((run.passed / run.total) * 100) : 0
      return `<g>
  <title>${esc(`${run.runId}(${run.branch}): ✓${run.passed} ✗${run.failed}`)}</title>
  <rect x="${x}" y="${passedY.toFixed(1)}" width="${barW}" height="${passedH.toFixed(1)}" fill="var(--ok)" rx="2"></rect>
  <rect x="${x}" y="${failedY.toFixed(1)}" width="${barW}" height="${failedH.toFixed(1)}" fill="var(--fail)" rx="2"></rect>
  <text x="${x + barW / 2}" y="${chartH + 12}" font-size="8" fill="var(--muted)" text-anchor="middle">${esc(run.date.slice(5))}</text>
  <text x="${x + barW / 2}" y="${chartH + 24}" font-size="8" fill="var(--muted)" text-anchor="middle">${rate}%</text>
</g>`
    })
    .join('\n')
  const line = runsView
    .map((run, index) => `${gap + index * (barW + gap) + barW / 2},${(chartH - (run.passed / run.total) * chartH + 4).toFixed(1)}`)
    .join(' ')
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <polyline points="${line}" fill="none" stroke="#0969da" stroke-width="1.5" stroke-dasharray="3 2"></polyline>
  ${bars}
</svg>`
})()

const catBars = catList
  .map(([id, count]) => {
    const widthPct = catTotal ? Math.round((count / catTotal) * 100) : 0
    return `<div class="hbar-row" data-cat="${esc(id)}" title="点击筛选用例明细">
  <span class="hbar-label">${esc(CAT_LABEL[id] ?? id)}</span>
  <span class="hbar-track"><span class="hbar" style="width:${widthPct}%"></span></span>
  <span class="hbar-num">${count}</span>
</div>`
  })
  .join('\n')

const branchRows = branchStats
  .map(
    (item) =>
      `<tr><td><code>${esc(item.branch)}</code></td><td class="num">${item.runs}</td><td class="num">${pct(item.passRate)}</td></tr>`,
  )
  .join('\n')

const flakyRows = flakyList
  .map(
    (item) => `<tr data-platform="${esc(item.platform)}" data-q="${esc(item.id + ' ' + item.name)}">
  <td><code class="flaky-link" data-q="${esc(item.id)}">${esc(item.id)}</code></td><td>${esc(item.name)}</td><td>${esc(item.platform)}</td>
  <td class="num">${item.failed} / ${item.runs}</td>
  <td class="num">${pct(item.passRate)}</td>
  <td><span class="badge ${item.lastStatus}">${item.lastStatus}</span></td>
</tr>`,
  )
  .join('\n')

const detailRows = caseStats
  .map(
    (item) => `<tr data-cat="${esc(item.lastCategory ?? '')}" data-platform="${esc(item.platform)}" data-q="${esc(item.id + ' ' + item.name + ' ' + item.module)}"
  data-pass="${item.passRate}" data-runs="${item.runs}" data-failed="${item.failed}">
  <td><code>${esc(item.id)}</code></td><td>${esc(item.name)}</td><td>${esc(item.platform)}</td><td>${esc(item.module)}</td>
  <td class="num">${item.runs}</td><td class="num">${item.passed}</td><td class="num">${item.failed}</td>
  <td><span class="mini-track"><span class="mini ${item.failed > 0 ? 'warn' : 'ok'}" style="width:${Math.round(item.passRate * 60)}px"></span></span> ${pct(item.passRate)}</td>
  <td>${item.lastCategory ? esc(CAT_LABEL[item.lastCategory] ?? item.lastCategory) : '-'}</td>
  <td><span class="badge ${item.lastStatus}">${item.lastStatus}</span></td>
</tr>`,
  )
  .join('\n')

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>TestPilot 汇总报告(样稿)</title>
<style>
  :root { --ok:#1a7f37; --fail:#cf222e; --warn:#bf8700; --skip:#6e7781; --line:#d0d7de; --muted:#59636e; }
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
  .passed { background: var(--ok); } .failed { background: var(--fail); } .skipped { background: var(--skip); }
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
  .mini { display: block; height: 100%; } .mini.ok { background: var(--ok); } .mini.warn { background: var(--warn); }
  .muted { color: var(--muted); } .hide { display: none !important; }
  .sample-tag { display: inline-block; background: #fff8c5; border: 1px solid #d4a72c66; color: #7d4e00; padding: 2px 10px; border-radius: 10px; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>TestPilot 汇总报告 <span class="sample-tag">样稿(演示数据)</span></h1>
  <p class="meta">统计范围:最近 ${runsView.length} 次运行(${esc(runsView[0].date)} → ${esc(runsView.at(-1).date)})· branch:main / release-1.2 · workspace:mall-test · 交互可点:趋势悬浮、分类条、Flaky 用例名、表头排序、平台筛选、搜索</p>

  <div class="cards">
    <div class="card"><b>${runsView.length}</b><span>运行次数</span></div>
    <div class="card"><b>${totalExec}</b><span>用例执行次数</span></div>
    <div class="card"><b>${pct(overallRate)}</b><span>整体通过率</span></div>
    <div class="card"><b>${avgDuration}s</b><span>平均运行耗时</span></div>
    <div class="card"><b>${flakyList.length}</b><span>Flaky 用例</span></div>
  </div>

  <div class="row2">
    <div class="panel">${donut}</div>
    <div class="panel trend"><h3>每次运行结果与通过率(悬浮看详情)</h3>${trend}</div>
  </div>

  <h2>失败分类分布(点击筛选明细)</h2>
  <div class="panel">${catBars || '<p class="muted">窗口内无失败</p>'}</div>

  <h2>Flaky 榜(又过又挂;点用例名定位明细)</h2>
  <div class="panel"><table>
    <tr><th>用例</th><th>名称</th><th>平台</th><th class="num">失败 / 参与</th><th class="num">通过率</th><th>最近状态</th></tr>
    ${flakyRows || '<tr><td colspan="6" class="muted">无 Flaky 用例</td></tr>'}
  </table></div>

  <h2>分支维度</h2>
  <div class="panel"><table>
    <tr><th>branch</th><th class="num">运行次数</th><th class="num">通过率</th></tr>
    ${branchRows}
  </table></div>

  <h2>用例明细</h2>
  <div class="toolbar">
    <span class="chip active" data-platform="all">全部平台</span>
    <span class="chip" data-platform="web">web</span>
    <span class="chip" data-platform="miniapp">miniapp</span>
    <span class="chip" data-platform="双端">双端</span>
    <input id="q" placeholder="搜索用例 id / 名称 / 模块…" />
    <span id="count"></span>
  </div>
  <table id="detail">
    <thead><tr>
      <th>用例</th><th>名称</th><th>平台</th><th>模块</th>
      <th class="num" data-sort="runs">运行次数</th><th class="num" data-sort="passed">通过</th><th class="num" data-sort="failed">失败</th>
      <th data-sort="passRate">通过率 ▾</th><th>最近分类</th><th>最近状态</th>
    </tr></thead>
    <tbody>${detailRows}</tbody>
  </table>
</div>

<script id="summary-data" type="application/json">${JSON.stringify({ runs: runsView, executions }).replaceAll('<', '\\u003c')}</script>
<script>
(function () {
  var rows = Array.prototype.slice.call(document.querySelectorAll('#detail tbody tr'));
  var state = { platform: 'all', cat: 'all', q: '', sortKey: 'passRate', sortDir: -1 };

  function apply() {
    var shown = 0;
    rows.forEach(function (row) {
      var show = true;
      if (state.platform !== 'all' && row.getAttribute('data-platform') !== state.platform) show = false;
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
  document.querySelectorAll('.flaky-link').forEach(function (link) {
    link.addEventListener('click', function () {
      q.value = link.getAttribute('data-q');
      state.q = q.value;
      apply();
      document.getElementById('detail').scrollIntoView({ behavior: 'smooth' });
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

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, html, 'utf8')
console.log('generated:', out, `(${Math.round(html.length / 1024)} KB)`)
