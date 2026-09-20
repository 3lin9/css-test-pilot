import { relative } from 'node:path'
import type { TestPilotClient } from '@testpilot/sdk'
import { planCase } from '../planner/heuristic'
import { loadSkillContext } from '../skill/load-skill'
import {
  createCaseTool,
  inspectProjectTool,
  listCasesTool,
  runTool,
  validateTool,
} from '../tools'
import type { AgentToolContext } from '../types'

export interface PlannerInput {
  prompt: string
  overwrite?: boolean
  file?: string
  /** 规划完成后是否经 SDK 执行(仍不直连 Engine) */
  runAfterCreate?: boolean
}

export interface PlannerResult {
  status: 'passed' | 'failed' | 'cancelled'
  caseFile?: string
  caseId?: string
  runId?: string
  fromYamlBlock?: boolean
  message: string
  skillInstalled: boolean
}

/**
 * Planner Agent —— 规划测试任务:
 * 读 Skill → 发现项目 → 生成/写入 Case → validate → (可选) run
 * 不负责结果归因;那是 Analysis Agent 的职责。
 */
export class PlannerAgent {
  constructor(private readonly client: TestPilotClient) {}

  async plan(input: PlannerInput, ctx: AgentToolContext): Promise<PlannerResult> {
    ctx.emit({
      type: 'step',
      ts: iso(),
      message: 'Planner Agent:规划测试任务',
      data: { agent: 'planner' },
    })

    const skill = await loadSkillContext(this.client.root, ctx)
    ctx.emit({
      type: 'step',
      ts: iso(),
      message: skill.installed ? '已加载 TestPilot Skill' : 'Skill 未安装,使用内置约定',
      data: { agent: 'planner', skillInstalled: skill.installed },
    })

    ctx.emit({ type: 'step', ts: iso(), message: 'Project Discovery', data: { agent: 'planner' } })
    const inspection = await inspectProjectTool(this.client, ctx)
    const existing = await listCasesTool(this.client, ctx)
    const existingIds = new Set(
      existing.filter((item) => item.valid && item.case?.id).map((item) => item.case!.id),
    )

    ctx.emit({ type: 'step', ts: iso(), message: 'Case Generation', data: { agent: 'planner' } })
    const planned = planCase({
      prompt: input.prompt,
      inspection,
      existingIds,
      file: input.file,
    })

    const written = await createCaseTool(
      this.client,
      ctx,
      planned.file,
      planned.source,
      input.overwrite ?? false,
    )
    if (!written.written) {
      const issues = written.validation.issues.map((issue) => issue.message).join('; ')
      ctx.emit({
        type: 'error',
        ts: iso(),
        message: `Case 校验未通过,未落盘:${issues}`,
        data: { agent: 'planner' },
      })
      return {
        status: 'failed',
        message: `Case 校验失败,未写入:${issues || 'unknown'}`,
        skillInstalled: skill.installed,
      }
    }

    const caseFile = toPosix(relative(this.client.root, written.file))
    const caseId = written.validation.data?.id ?? planned.caseId

    ctx.emit({ type: 'step', ts: iso(), message: 'Validate', data: { agent: 'planner' } })
    const validated = await validateTool(this.client, ctx, [caseFile])
    const self = validated.find((item) => item.file === written.file) ?? validated[0]
    if (!self?.valid) {
      return {
        status: 'failed',
        caseFile,
        caseId,
        message: '写入后复检失败',
        skillInstalled: skill.installed,
        fromYamlBlock: planned.fromYamlBlock,
      }
    }

    if (!input.runAfterCreate) {
      const message = planned.fromYamlBlock
        ? `Planner 已将 YAML 写入 ${caseFile}`
        : `Planner 已生成草稿 Case ${caseFile}(占位 locator)`
      return {
        status: 'passed',
        caseFile,
        caseId,
        message,
        skillInstalled: skill.installed,
        fromYamlBlock: planned.fromYamlBlock,
      }
    }

    ctx.emit({
      type: 'step',
      ts: iso(),
      message: 'Run(经 SDK → Execution Engine)',
      data: { agent: 'planner' },
    })
    const runResult = await runTool(this.client, ctx, { paths: [caseFile] })
    const runId = runResult.summary.runId
    const status = runResult.summary.cancelled
      ? 'cancelled'
      : runResult.summary.status === 'passed'
        ? 'passed'
        : 'failed'

    return {
      status,
      caseFile,
      caseId,
      runId,
      fromYamlBlock: planned.fromYamlBlock,
      skillInstalled: skill.installed,
      message:
        status === 'cancelled'
          ? 'Planner 执行已取消'
          : `Planner 已生成 ${caseFile} 并触发 run ${runId}(${status})`,
    }
  }
}

function iso(): string {
  return new Date().toISOString()
}

function toPosix(path: string): string {
  return path.split('\\').join('/')
}
