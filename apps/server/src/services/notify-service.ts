/**
 * Run 结果 webhook 通知:run 终态后向 TESTPILOT_WEBHOOK_URL 推 markdown 消息。
 * 企业微信与钉钉的群机器人共用同一 { msgtype: 'markdown' } 协议;钉钉的加签参数
 * 由用户拼进 URL 自理(timestamp & sign)。失败只记日志,绝不影响 run 状态。
 */

const WEBHOOK_TIMEOUT_MS = 5_000

export interface RunFinishedNotice {
  runId: string
  projectName: string
  status: string
  branch?: string | null
  durationMs?: number
  totals?: { passed?: number; failed?: number; blocked?: number; inconclusive?: number; skipped?: number }
}

function statusText(status: string): string {
  if (status === 'passed') return '✅ 通过'
  if (status === 'failed') return '❌ 失败'
  if (status === 'blocked') return '⚠️ 受阻(环境/前置)'
  if (status === 'inconclusive') return '❓ 未验证'
  return status
}

function renderMarkdown(notice: RunFinishedNotice): string {
  const totals = notice.totals
  const lines = [
    `**TestPilot 运行结束** ${statusText(notice.status)}`,
    `- 项目:${notice.projectName}`,
    `- 运行:${notice.runId}${notice.branch ? `(分支 ${notice.branch})` : ''}`,
  ]
  if (totals) {
    const parts: string[] = []
    if (totals.passed) parts.push(`通过 ${totals.passed}`)
    if (totals.failed) parts.push(`失败 ${totals.failed}`)
    if (totals.blocked) parts.push(`受阻 ${totals.blocked}`)
    if (totals.inconclusive) parts.push(`未验证 ${totals.inconclusive}`)
    if (totals.skipped) parts.push(`跳过 ${totals.skipped}`)
    if (parts.length > 0) lines.push(`- 结果:${parts.join(' / ')}`)
  }
  if (notice.durationMs !== undefined) {
    lines.push(`- 耗时:${Math.round(notice.durationMs / 1000)}s`)
  }
  return lines.join('\n')
}

/** fire-and-forget 通知;url 未配置时静默跳过 */
export async function notifyRunFinished(notice: RunFinishedNotice): Promise<void> {
  const url = process.env.TESTPILOT_WEBHOOK_URL
  if (!url) return
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content: renderMarkdown(notice) } }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.warn(`webhook 通知未成功:HTTP ${response.status}`)
    }
  } catch (err) {
    console.warn(`webhook 通知失败:${err instanceof Error ? err.message : err}`)
  } finally {
    clearTimeout(timer)
  }
}
