import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { RUNS_DIR, type CaseResult, type RunSummary, type StepResult } from '@testpilot/core'
import { verdictFromErrorCode, type Verdict } from '@testpilot/core'
import { categoryLabel, classifyFromCode, classifyFailure, FAILURE_CATEGORIES, type FailureCategory } from './classify'
import { renderAssertionDiffHtml } from './diff'
import { collectHistory, type HistoryPoint } from './history'
import { toSummaryView, type ReportSummaryView } from './summary'
import { escapeHtml } from './escape-html'

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
  /** 三态判定:product(产品)/ infra(环境与前置)/ unverified(未验证);无码历史数据归 product */
  verdict: Verdict
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
 * 历史趋势默认聚合 runs 目录下最近 12 次运行;截图在体积上限内内联成 data URI(报告可单发分享),
 * 超限或缺失回退相对路径;trace 用例带"Trace Viewer 一键命令"。
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
      // 错误码映射确定性优先;历史数据无码时回退 message regex
      const category =
        classifyFromCode(step.errorCode) ?? (step.status === 'failed' ? classifyFailure(step.error) : undefined)
      if (category) {
        categories.add(category)
        failures.push({
          category,
          label: categoryLabel(category),
          caseId: item.caseId,
          index: step.index,
          message: step.error ?? '',
          verdict: verdictFromErrorCode(step.errorCode ?? item.errorCode),
        })
      }
      return { ...step, category }
    })
    return { ...item, steps, categories: [...categories] }
  })

  const categoryLabels: Record<string, string> = {}
  for (const item of FAILURE_CATEGORIES) categoryLabels[item.id] = item.label

  const inline = await inlineScreenshots(cases, dir)

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
  await writeFile(htmlPath, renderHtml(data, inline), 'utf8')
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

export function renderHtml(data: ReportData, inline: Record<string, string> = {}): string {
  const view = toSummaryView(data.summary)
  const summary = data.summary
  const trendSvg = renderTrend(data)
  const timelineHtml = renderTimeline(summary.cases)
  const casesHtml = groupedCasesHtml(summary.cases, inline, summary.runId)
  const chips = categoryChips(data)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>csspilot Report ${escapeHtml(summary.runId)}</title>
<style>
  :root { --ok:#1a7f37; --fail:#cf222e; --warn:#9a6700; --skip:#6e7781; --blocked:#8250df; --inconclusive:#9a6700; --line:#d0d7de; --muted:#59636e; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", sans-serif; margin: 0; color: #1f2328; background: #f6f8fa; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 20px 16px 48px; }
  /* 中文粗体下 15px 与 20px 视觉拉不开层级(报告标题曾被误读为比分节标题小),标题统一抬到 26px 与 Web 端 page-title 对齐 */
  h1 { font-size: 26px; margin: 10px 0 6px; } h2 { font-size: 15px; font-weight: 600; color: #1f2328; margin: 26px 0 8px; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 10px; color: #fff; font-size: 12px; }
  .passed { background: var(--ok); } .failed { background: var(--fail); } .warning { background: var(--warn); } .skipped { background: var(--skip); } .blocked { background: var(--blocked); } .inconclusive { background: var(--inconclusive); }
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
  section.template { border-left: 3px solid var(--line); padding-left: 12px; margin: 14px 0; }
  section.template > h3 { font-size: 14px; margin: 0 0 6px; }
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
  img.shot { display: block; max-width: min(720px, 100%); margin: 8px 0; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
  .tracebox { background: #fff; border: 1px solid var(--line); border-left: 3px solid #0969da; border-radius: 8px; padding: 10px 14px; margin: 8px 0; }
  .tracebox.fail { border-left-color: var(--fail); background: #fff7f7; }
  .tracebox .cmd { display: flex; gap: 8px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
  .tracebox .cmd code { flex: 1; min-width: 240px; user-select: all; }
  .tracebox video.vid { display: block; max-width: min(720px, 100%); margin: 8px 0 4px; border: 1px solid var(--line); border-radius: 6px; background: #000; }
  .diff { background: #fff; border: 1px solid var(--line); border-left: 3px solid var(--fail); border-radius: 8px; padding: 10px 14px; margin: 8px 0; }
  .diff .d-head { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
  table.d-table { font-family: ui-monospace, Consolas, monospace; font-size: 12px; border-collapse: collapse; width: 100%; }
  table.d-table td { padding: 1px 8px; white-space: pre-wrap; word-break: break-all; }
  table.d-table td.d-sign { width: 16px; padding: 1px 2px; user-select: none; text-align: center; }
  tr.d-del { background: #ffebe9; } tr.d-del .d-sign { color: var(--fail); font-weight: 700; }
  tr.d-add { background: #e6ffec; } tr.d-add .d-sign { color: var(--ok); font-weight: 700; }
  .timeline { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; }
  .tl-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; cursor: pointer; font-size: 12px; }
  .tl-row:hover { background: #f6f8fa; }
  .tl-label { flex: 0 0 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tl-track { flex: 1; background: #f6f8fa; border-radius: 4px; height: 12px; overflow: hidden; }
  .tl-bar { display: block; height: 100%; border-radius: 4px; }
  .tl-bar.passed { background: var(--ok); } .tl-bar.failed { background: var(--fail); } .tl-bar.blocked { background: var(--blocked); } .tl-bar.inconclusive { background: var(--warn); } .tl-bar.skipped { background: var(--skip); }
  .tl-dur { flex: 0 0 48px; text-align: right; color: var(--muted); }
  details.obs { border: 1px solid var(--line); border-radius: 6px; margin: 8px 0; background: #fff; }
  details.obs > summary { cursor: pointer; padding: 6px 10px; font-size: 13px; }
  ul.console { list-style: none; margin: 0; padding: 4px 10px; font-size: 12px; font-family: ui-monospace, Consolas, monospace; max-height: 260px; overflow: auto; }
  ul.console li { display: flex; gap: 8px; padding: 1px 0; border-top: 1px dashed #f0f2f4; }
  ul.console .lv { flex: 0 0 70px; color: var(--muted); text-transform: uppercase; }
  ul.console .lv-error, ul.console .lv-pageerror { color: var(--fail); }
  ul.console .lv-warning { color: var(--warn); }
  table.net { font-size: 12px; }
  table.net td.url { word-break: break-all; }
  td.net-bad { color: var(--fail); font-weight: 600; }
</style>
</head>
<body>
<div class="wrap">
  <h1>csspilot 测试报告 <span class="badge ${summary.status}">${summary.status}</span></h1>
  <p class="meta">run <code>${escapeHtml(summary.runId)}</code> · 生成于 ${escapeHtml(data.generatedAt)} · 耗时 ${(view.durationMs / 1000).toFixed(1)}s</p>

  <div class="cards">
    <div class="card"><b>${view.cases.passed}<span style="color:var(--ok)"> ✓</span></b><span>通过用例</span></div>
    <div class="card"><b>${view.cases.failed}<span style="color:var(--fail)"> ✗</span></b><span>失败用例</span></div>
    <div class="card"><b>${view.cases.skipped} ↷</b><span>跳过数据行</span></div>
    <div class="card"><b>${view.cases.warnings} ⚠</b><span>清理警告</span></div>
    <div class="card"><b>${view.steps.passed}<span style="color:var(--ok)"> ✓</span></b><span>通过步骤</span></div>
    <div class="card"><b>${view.steps.failed}<span style="color:var(--fail)"> ✗</span></b><span>失败步骤</span></div>
    <div class="card"><b>${view.steps.skipped} ↷</b><span>跳过步骤</span></div>
  </div>

  <h2>历史趋势(最近 ${data.history.length + 1} 次运行)</h2>
  <div class="trend">${trendSvg}</div>

  <h2>运行时间线</h2>
  <div class="timeline">${timelineHtml}</div>

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

  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy') || '';
      var done = function (okc) {
        btn.textContent = okc ? '已复制' : '复制失败,请手动选择';
        setTimeout(function () { btn.textContent = '复制命令'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } else done(false);
    });
  });
  document.querySelectorAll('[data-tl]').forEach(function (row) {
    row.addEventListener('click', function () {
      var cid = row.getAttribute('data-cid');
      if (!cid) return;
      // CSS.escape 全现代浏览器可用(Chrome 46+,2015);此前手写 fallback 在模板字符串里连环转义出错
      var el = document.querySelector('details.case[data-cid="' + CSS.escape(cid) + '"]');
      if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
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

function groupedCasesHtml(
  cases: ReportCase[],
  inline: Record<string, string>,
  runId: string,
): string {
  const groups = new Map<string, ReportCase[]>()
  for (const item of cases) {
    const current = groups.get(item.caseId) ?? []
    current.push(item)
    groups.set(item.caseId, current)
  }
  return [...groups.entries()]
    .map(
      ([caseId, rows]) => `<section class="template">
  <h3>${escapeHtml(caseId)} <span class="muted">· ${rows.length} 个数据行</span></h3>
  ${rows.map((item) => caseHtml(item, inline, runId)).join('\n')}
</section>`,
    )
    .join('\n')
}

function caseHtml(item: ReportCase, inline: Record<string, string>, runId: string): string {
  const rows = item.steps.map((step) => stepHtml(step)).join('\n')
  const errorLine = item.error ? `<p class="error">${escapeHtml(item.error)}</p>` : ''
  // 失败断言的结构化对比(Playwright expect / node assert),一眼看到期望与实际的差异
  const failedStep = item.steps.find((step) => step.status === 'failed' && step.error)
  const diffBlock = renderAssertionDiffHtml(failedStep?.error ?? item.error, escapeHtml)
  const skipLine = item.skipReason
    ? `<p class="muted">${escapeHtml(item.skipReason)}${item.missingDependencies?.length ? `: ${escapeHtml(item.missingDependencies.join(', '))}` : ''}</p>`
    : ''
  const warningLine = item.warnings?.length
    ? `<p class="error">⚠ ${item.warnings.map(escapeHtml).join('<br />⚠ ')}</p>`
    : ''
  const search = escapeHtml(`${item.caseId} ${item.rowId ?? 'default'} ${item.caseName} ${item.file}`).replaceAll('"', '&quot;')
  const cats = escapeHtml(item.categories.join(','))
  const shots = item.steps
    .map((step) => step.screenshot)
    .filter((shot): shot is string => Boolean(shot))
  const shotBlock = shots
    .map((shot) => {
      const href = escapeHtml(inline[shot] ?? screenshotHref(shot))
      return `<p><a href="${href}">截图</a><img class="shot" src="${href}" alt="截图" /></p>`
    })
    .join('\n')
  const hasObs = (item.consoleLog?.length ?? 0) > 0 || (item.networkLog?.length ?? 0) > 0
  const evidenceBox = evidenceBoxHtml(item, runId, hasObs)
  const consoleBlock = item.consoleLog?.length
    ? `<details class="obs"><summary>控制台(${item.consoleLog.length} 条)</summary><ul class="console">${item.consoleLog
        .map((entry) => `<li><span class="lv lv-${escapeHtml(entry.level)}">${escapeHtml(entry.level)}</span><span>${escapeHtml(entry.text)}</span></li>`)
        .join('')}</ul></details>`
    : ''
  const networkBlock = item.networkLog?.length
    ? `<details class="obs"><summary>网络请求(${item.networkLog.length})</summary><table class="net"><tr><th>Method</th><th>Status</th><th>耗时</th><th>URL</th></tr>${item.networkLog
        .map(
          (entry) =>
            `<tr><td>${escapeHtml(entry.method)}</td><td class="${entry.status >= 400 ? 'net-bad' : ''}">${entry.status}</td><td class="num">${entry.durationMs != null ? `${entry.durationMs}ms` : '-'}</td><td class="url">${escapeHtml(entry.url)}</td></tr>`,
        )
        .join('')}</table></details>`
    : ''
  return `
<details class="case" ${shots.length > 0 ? 'open' : ''} data-status="${item.status}" data-cats="${cats}" data-cid="${escapeHtml(item.caseId)}" data-search="${search}">
  <summary>
    <span class="badge ${item.status}">${item.status}</span>
    <b>数据行 ${escapeHtml(item.rowId ?? 'default')}</b> · ${escapeHtml(item.caseName)}
    <span class="muted">· ${item.steps.length} 步 · ${(item.durationMs / 1000).toFixed(1)}s${shots.length > 0 ? ' · 有截图' : ''}</span>
  </summary>
  ${errorLine}
  ${diffBlock}
  ${skipLine}
  ${warningLine}
  ${evidenceBox}
  ${shotBlock}
  ${consoleBlock}
  ${networkBlock}
  <table>
    <tr><th>#</th><th>阶段</th><th>target</th><th>action</th><th>状态</th><th>耗时</th><th>详情</th></tr>
    ${rows}
  </table>
</details>`
}

/**
 * 失败证据盒:trace 一键回放命令 + 失败视频内联播放,失败用例红色高亮。
 * trace.zip 是 Playwright 的护城河(时间线 / DOM 快照逐帧 / 网络 / 控制台),show-trace 一步打开;
 * 视频由业务项目 playwright.config 的 use.video='retain-on-failure' 开启后经 ingest 复制进 run 目录。
 */
function evidenceBoxHtml(item: ReportCase, runId: string, hasObs: boolean): string {
  if (!item.trace && !item.video) return ''
  const parts: string[] = []
  if (item.trace) {
    const rel = `${RUNS_DIR.replace(/\\/g, '/')}/${runId}/${item.trace.replace(/\\/g, '/')}`
    const cmd = `npx playwright show-trace ${rel}`
    const hint = hasObs
      ? ''
      : '<p class="muted">提示:用例从 tests/e2e/web/fixtures.ts 导入 test/expect(init 自动生成)后,报告会直接内嵌控制台与网络面板。</p>'
    parts.push(
      `<div><b>Trace Viewer</b> <span class="muted">时间线 · DOM 快照逐帧回放 · 网络请求 · 控制台,都在 trace 包里。在项目根目录执行:</span></div>
  <div class="cmd"><code>${escapeHtml(cmd)}</code><button class="btn" data-copy="${escapeHtml(cmd)}">复制命令</button></div>
  ${hint}`,
    )
  }
  if (item.video) {
    const href = escapeHtml(item.video)
    parts.push(
      `<video class="vid" controls preload="none" src="${href}"></video><p class="muted"><a href="${href}">下载视频</a>(失败录制,可拖动进度条看每一步)</p>`,
    )
  }
  const highlighted = item.status === 'failed' || item.status === 'inconclusive'
  return `<div class="tracebox${highlighted ? ' fail' : ''}">
  ${parts.join('\n  ')}
</div>`
}

/** 运行时间线:按用例执行顺序与耗时铺条形图,点击滚动到对应用例详情。 */
function renderTimeline(cases: ReportCase[]): string {
  if (cases.length === 0) return '<p class="muted">暂无用例</p>'
  const total = Math.max(1, cases.reduce((sum, item) => sum + item.durationMs, 0))
  const rows = cases
    .map((item) => {
      const pct = Math.max(1.5, (item.durationMs / total) * 100)
      const label = item.rowId ? `${item.caseId} · ${item.rowId}` : item.caseId
      const tip = `${label} ${(item.durationMs / 1000).toFixed(1)}s,点击查看详情`
      return `<div class="tl-row" data-tl data-cid="${escapeHtml(item.caseId)}" title="${escapeHtml(tip)}"><span class="tl-label">${escapeHtml(label)}</span><span class="tl-track"><span class="tl-bar ${item.status}" style="width:${pct.toFixed(1)}%"></span></span><span class="tl-dur">${(item.durationMs / 1000).toFixed(1)}s</span></div>`
    })
    .join('\n')
  return `${rows}
<p class="muted">按用例执行顺序累计展示;web 端多 worker 并行时与真实并发有偏差,逐步回放请用 Trace Viewer。</p>`
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
  if (step.screenshot) details.push(`<a href="${escapeHtml(screenshotHref(step.screenshot))}">截图</a>`)
  for (const assertion of step.requestAssertions ?? []) {
    details.push(
      `请求 ${escapeHtml(assertion.method ?? '*')} <code>${escapeHtml(assertion.urlContains)}</code>: ${assertion.actualCount}/${assertion.count}`,
    )
  }
  return `<tr>
  <td class="num">${step.index}</td>
  <td>${escapeHtml(step.phase ?? 'steps')}</td>
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

/** 报告在 runs/<runId>/,截图在 artifacts/shots/<runId>/ */
function screenshotHref(screenshot: string): string {
  const normalized = screenshot.replace(/\\/g, '/')
  if (normalized.startsWith('shots/')) return `../../${normalized}`
  return screenshot
}

/** 单图内联上限:超过则保留相对链接,防 HTML 体积失控。 */
const INLINE_SHOT_LIMIT = 800 * 1024

const SHOT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

/**
 * 把 run 的截图内联成 data URI(报告单文件即可分享,不再依赖 artifacts 目录)。
 * 截图路径相对 .testpilot/artifacts(shots/<runId>/x.png),基准目录是 runDir 的上两级;
 * 文件缺失或超过体积上限时跳过,渲染侧回退相对链接。
 */
async function inlineScreenshots(cases: ReportCase[], runDir: string): Promise<Record<string, string>> {
  const base = resolve(runDir, '..', '..')
  const paths = new Set<string>()
  for (const item of cases) {
    for (const step of item.steps) if (step.screenshot) paths.add(step.screenshot)
  }
  const inline: Record<string, string> = {}
  for (const shot of paths) {
    const ext = shot.slice(shot.lastIndexOf('.')).toLowerCase()
    const mime = SHOT_MIME[ext]
    if (!mime) continue
    const abs = resolve(base, shot.replace(/\\/g, '/'))
    const buf = await readFile(abs).catch(() => undefined)
    if (!buf || buf.length === 0 || buf.length > INLINE_SHOT_LIMIT) continue
    inline[shot] = `data:${mime};base64,${buf.toString('base64')}`
  }
  return inline
}

function shortId(runId: string): string {
  return runId.replace(/^\d{8}-/, '')
}

function embedJson(data: ReportData): string {
  return JSON.stringify(data).replaceAll('<', '\\u003c')
}
