import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { TestPilotAI } from './agent'
import { extractYamlBlock, inferCaseId, planCase } from './planner/heuristic'
import type { ProjectInspection } from '@testpilot/sdk'

async function makeRoot(withSkill = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'testpilot-agent-'))
  await mkdir(join(root, 'tests', 'e2e', 'cases'), { recursive: true })
  await writeFile(join(root, 'testpilot.yaml'), 'casesDir: tests/e2e/cases\n', 'utf8')
  if (withSkill) {
    await mkdir(join(root, '.agents', 'skills', 'testpilot'), { recursive: true })
    await writeFile(
      join(root, '.agents', 'skills', 'testpilot', 'SKILL.md'),
      '# TestPilot\n\n- Use DSL\n- Validate before run\n',
      'utf8',
    )
  }
  return root
}

function fakeInspection(root: string, targets: Array<'web' | 'miniapp'> = ['web']): ProjectInspection {
  return {
    root,
    hasConfig: true,
    config: { casesDir: 'tests/e2e/cases' } as ProjectInspection['config'],
    casesDir: join(root, 'tests', 'e2e', 'cases'),
    casesDirExists: true,
    artifactsDir: join(root, '.testpilot', 'artifacts'),
    runsDir: join(root, '.testpilot', 'artifacts', 'runs'),
    skillInstalled: false,
    targets,
  }
}

describe('agent:planner-heuristic', () => {
  test('提取 yaml 代码块', () => {
    const block = extractYamlBlock('说明\n```yaml\nid: a\nname: A\nsteps:\n  - target: web\n    action: screenshot\n```\n')
    expect(block).toContain('id: a')
  })

  test('推断 id 并避重', () => {
    expect(inferCaseId('id: order-pay\n下单', new Set())).toBe('order-pay')
    expect(inferCaseId('创建订单流程', new Set(['order-create']))).toBe('order-create-2')
  })

  test('无 yaml 时生成可校验脚手架', () => {
    const planned = planCase({
      prompt: '为用户登录生成冒烟用例',
      inspection: fakeInspection('/tmp/p'),
      existingIds: new Set(),
    })
    expect(planned.caseId).toBe('user-login')
    expect(planned.fromYamlBlock).toBe(false)
    expect(planned.source).toContain('target: web')
  })
})

describe('TestPilot AI:Planner + Analysis', () => {
  test('把 yaml 块写入业务项目 cases 目录,并走两层 Agent', async () => {
    const root = await makeRoot(true)
    const events: Array<{ type: string; message?: string; agent?: string }> = []
    const ai = new TestPilotAI({
      root,
      onEvent: (event) =>
        events.push({
          type: event.type,
          message: event.message,
          agent: typeof event.data?.agent === 'string' ? event.data.agent : undefined,
        }),
    })
    const result = await ai.run({
      prompt: `请写入用例:
\`\`\`yaml
id: agent-smoke
name: Agent 烟雾
tags:
  - smoke
steps:
  - target: web
    action: navigate
    url: /
  - target: web
    action: screenshot
\`\`\`
`,
    })
    expect(result.status).toBe('passed')
    expect(result.caseFile).toBe('tests/e2e/cases/agent-smoke.yaml')
    expect(result.caseId).toBe('agent-smoke')
    expect(result.analysis?.verdict).toBe('not-run')
    expect(result.nextSteps.some((step) => step.includes('sync-metadata'))).toBe(true)
    const source = await readFile(join(root, 'tests', 'e2e', 'cases', 'agent-smoke.yaml'), 'utf8')
    expect(source).toContain('id: agent-smoke')
    expect(events.some((item) => item.agent === 'planner')).toBe(true)
    expect(events.some((item) => item.type === 'case-written')).toBe(true)
    expect(events.some((item) => item.type === 'job-finished')).toBe(true)
    expect(events.some((item) => item.message?.includes('Analysis Agent') || item.message?.includes('未执行'))).toBe(
      true,
    )
  })

  test('自由文本生成草稿 Case', async () => {
    const root = await makeRoot()
    const ai = new TestPilotAI({ root })
    const result = await ai.run({ prompt: '请生成一个 Web 冒烟草稿用例' })
    expect(result.status).toBe('passed')
    expect(result.caseFile).toMatch(/^tests\/e2e\/cases\/.+\.yaml$/)
    expect(result.analysis?.verdict).toBe('not-run')
    const source = await readFile(join(root, result.caseFile!), 'utf8')
    expect(source).toContain('TODO')
  })
})
