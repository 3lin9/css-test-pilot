import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentToolContext } from '../types'

export interface SkillContext {
  /** Skill 是否已安装到业务项目 */
  installed: boolean
  /** SKILL.md 绝对路径 */
  skillPath?: string
  /** 摘录的能力约定(截断,供事件与分析引用) */
  summary: string
}

/**
 * 读取业务项目中的 TestPilot Skill。
 * Agent 只读 Skill 规范,不直连 Adapter;执行一律经 SDK。
 */
export async function loadSkillContext(
  root: string,
  ctx: AgentToolContext,
): Promise<SkillContext> {
  const skillPath = join(root, '.agents', 'skills', 'testpilot', 'SKILL.md')
  ctx.emit({
    type: 'tool-call',
    ts: new Date().toISOString(),
    message: 'load_skill',
    data: { skillPath },
  })

  try {
    await access(skillPath)
    const raw = await readFile(skillPath, 'utf8')
    const summary = summarizeSkill(raw)
    ctx.emit({
      type: 'tool-result',
      ts: new Date().toISOString(),
      message: 'load_skill',
      data: { installed: true, summary },
    })
    return { installed: true, skillPath, summary }
  } catch {
    const summary =
      'Skill 未安装:请先 csspilot init。约定:Evidence-first、经 SDK/CLI 执行、不直连 Playwright/WeChatIDE。'
    ctx.emit({
      type: 'tool-result',
      ts: new Date().toISOString(),
      message: 'load_skill',
      data: { installed: false, summary },
    })
    return { installed: false, summary }
  }
}

function summarizeSkill(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('```'))
  const bullets = lines.filter((line) => line.startsWith('- ')).slice(0, 8)
  const head = lines.find((line) => line.startsWith('# ')) ?? 'TestPilot Skill'
  return [head, ...bullets].join(' | ').slice(0, 400)
}
