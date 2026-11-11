/**
 * 失败断言的结构化对比:从 error message 提取 Expected / Received,
 * 做行级 LCS diff,渲染成红删绿加的对比块——“打开报告就能看懂现场”。
 *
 * 识别两类真实形态:
 *  - Playwright expect:  Expected: "..." / Received: "..."(toBe/toEqual/toHaveText 等)
 *  - node:test assert:   Expected values to be strictly equal:\nA !== B
 * 识别不了返回 undefined,报告回退展示 error 原文,不阻塞任何失败展示。
 */

export interface AssertionDiff {
  expected: string
  received: string
}

export interface DiffLine {
  type: 'same' | 'del' | 'add'
  text: string
}

/** Playwright expect:Expected: 值跨行时带引号换行;Received: 后被空行 / Call log: / Diff: / 文本结束截住 */
const PLAYWRIGHT_DIFF = /Expected:[ \t]*([\s\S]*?)\nReceived:[ \t]*([\s\S]*?)(?=\n\n|\n\s*Call log:|\n\s*Diff:|$)/

/** node:test assert.strictEqual 的单行形态 */
const NODE_DIFF = /Expected values to be strictly equal:\s*\n\s*(.+) !== (.+)/

/** 提取失败断言的期望值与实际值;结构对不上时返回 undefined */
export function extractAssertionDiff(error: string | undefined): AssertionDiff | undefined {
  if (!error) return undefined
  const pw = PLAYWRIGHT_DIFF.exec(error)
  if (pw) {
    const expected = unquote(pw[1]!)
    const received = unquote(pw[2]!)
    if (expected !== '' || received !== '') return { expected, received }
  }
  const node = NODE_DIFF.exec(error)
  if (node) return { expected: node[1]!, received: node[2]! }
  return undefined
}

/** Playwright 把值 JSON.stringify 后填进来:字符串带引号,去掉首尾引号让 diff 看到真实文本 */
function unquote(value: string): string {
  const text = value.trim()
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1)
  }
  return text
}

/** 经典 LCS 行 diff;单侧超过 maxLines 先截断(断言值不该长到需要流式) */
export function diffLines(expected: string, received: string, maxLines = 200): DiffLine[] {
  const a = expected.split('\n').slice(0, maxLines)
  const b = received.split('\n').slice(0, maxLines)
  const m = a.length
  const n = b.length
  // dp[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i]! })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: 'del', text: a[i]! })
      i++
    } else {
      out.push({ type: 'add', text: b[j]! })
      j++
    }
  }
  while (i < m) out.push({ type: 'del', text: a[i++]! })
  while (j < n) out.push({ type: 'add', text: b[j++]! })
  return out
}

/**
 * 渲染断言对比块;没有可提取的结构、或两侧完全一致(失败原因不在值本身)时返回 ''。
 * escapeHtml 由调用方传入,report.ts 的转义规则只有一份。
 */
export function renderAssertionDiffHtml(error: string | undefined, escapeHtml: (text: string) => string): string {
  const diff = extractAssertionDiff(error)
  if (!diff) return ''
  const lines = diffLines(diff.expected, diff.received)
  if (lines.length === 0 || lines.every((line) => line.type === 'same')) return ''
  const rows = lines
    .map(
      (line) =>
        `<tr class="d-${line.type}"><td class="d-sign">${line.type === 'del' ? '-' : line.type === 'add' ? '+' : ' '}</td><td>${escapeHtml(line.text) || '&nbsp;'}</td></tr>`,
    )
    .join('')
  return `<div class="diff"><div class="d-head">断言对比 <span class="muted">- 期望 / + 实际</span></div><table class="d-table">${rows}</table></div>`
}
