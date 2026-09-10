import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadTestpilotConfig } from '@testpilot/core'
import { collectCases, readProjectLink } from '@testpilot/sdk'
import { detectAdapters, type AdapterInfo } from './adapter-detector'
import { collectEnvVarRefs } from './environment-initializer'
import { detectProject, type ProjectInfo } from './project-detector'

export type CheckStatus = 'ok' | 'warn' | 'error'

export interface DoctorItem {
  status: CheckStatus
  label: string
  hint?: string
}

export interface DoctorSection {
  name: string
  items: DoctorItem[]
}

export interface DoctorReport {
  sections: DoctorSection[]
  errors: number
  warnings: number
}

/**
 * TestPilot 健康检查(设计文档 §12)。
 * 返回结构化报告:Adapter 缺失为 warning,配置/用例/环境变量问题为 error;
 * Server 未配置时跳过 Server 段。
 */
export async function runDoctor(root: string): Promise<DoctorReport> {
  const sections: DoctorSection[] = []
  const push = (name: string, items: DoctorItem[]) => {
    if (items.length > 0) sections.push({ name, items })
  }
  const ok = (label: string): DoctorItem => ({ status: 'ok', label })
  const warn = (label: string, hint?: string): DoctorItem => ({ status: 'warn', label, hint })
  const error = (label: string, hint?: string): DoctorItem => ({ status: 'error', label, hint })

  // ---- Runtime ----
  const nodeMajor = Number(process.versions.node.split('.')[0])
  push('Runtime', [
    nodeMajor >= 22
      ? ok(`Node.js ${process.versions.node}`)
      : error(`Node.js ${process.versions.node}`, '需要 Node.js >= 22'),
  ])

  // ---- Project ----
  const info: ProjectInfo = await detectProject(root)
  const projectItems: DoctorItem[] = [
    ok(`Project ${info.name}(${info.type})`),
    info.git.commit
      ? ok(`Git repository(${info.git.branch ?? 'detached'} · ${info.git.commit.slice(0, 7)})`)
      : warn('Git repository 未检测到', 'Case Metadata 无法同步到 Server'),
    existsSync(join(root, '.testpilot', 'project.json'))
      ? ok('.testpilot/project.json')
      : error('.testpilot/project.json', '运行 npx csspilot init 生成'),
    existsSync(join(root, 'testpilot.yaml'))
      ? ok('testpilot.yaml')
      : error('testpilot.yaml', '运行 npx csspilot init 生成'),
  ]
  push('Project', projectItems)

  // ---- Test ----
  const config = await loadTestpilotConfig(root).catch(() => undefined)
  const casesDir = config?.casesDir ?? 'tests/e2e/cases'
  const cases = await collectCases([casesDir], { root }).catch(() => [])
  const invalidCount = cases.filter((item) => !item.valid).length
  const testDir = join(root, 'tests', 'e2e')
  push('Test', [
    existsSync(testDir) ? ok('tests/e2e') : error('tests/e2e', '运行 npx csspilot init 创建'),
    existsSync(join(root, casesDir))
      ? ok(`cases directory(${casesDir})`)
      : error(`cases directory(${casesDir})`, '运行 npx csspilot init 创建'),
    cases.length === 0
      ? warn('Case validation 跳过(未找到用例)', '在 tests/e2e/cases 创建 Case')
      : invalidCount === 0
        ? ok(`Case validation(${cases.length} 个用例全部有效)`)
        : error(`Case validation(${invalidCount}/${cases.length} 个用例校验失败)`, '运行 npx csspilot validate 查看详情'),
  ])

  // ---- Agent ----
  const skillDir = join(root, '.agents', 'skills', 'testpilot')
  push('Agent', [
    existsSync(join(skillDir, 'manifest.yaml'))
      ? ok('TestPilot Skill(.agents/skills/testpilot)')
      : error('TestPilot Skill', '运行 npx csspilot init 安装'),
    existsSync(join(skillDir, 'references', 'project.md'))
      ? ok('Project testing guide(references/)')
      : warn('Project testing guide 缺失', 'references/ 由 init 生成;可重新运行 npx csspilot init'),
  ])

  // ---- Adapters(缺失为 warning,不阻塞) ----
  const adapters: AdapterInfo[] = await detectAdapters(root, info.type)
  push(
    'Adapters',
    adapters.map((item) =>
      item.available
        ? ok(`${item.id}(${item.detail})`)
        : item.required
          ? warn(`${item.id} 不可用`, item.detail)
          : warn(`${item.id} 未安装(可选)`, item.detail),
    ),
  )

  // ---- Environment(配置里引用的环境变量) ----
  const refs = await collectEnvVarRefs(root)
  if (refs.length > 0) {
    push(
      'Environment',
      refs.map((name) =>
        process.env[name] !== undefined
          ? ok(name)
          : error(`${name} missing`, '在运行环境(.env / CI Secret)中设置'),
      ),
    )
  }

  // ---- Server(配置了才检查) ----
  const serverUrl = process.env.TESTPILOT_SERVER_URL ?? config?.server?.baseUrl
  if (serverUrl) {
    const link = await readProjectLink(root)
    const serverItems: DoctorItem[] = []
    try {
      const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/health`, {
        signal: AbortSignal.timeout(3000),
      })
      serverItems.push(res.ok ? ok(`Connected(${serverUrl})`) : error(`Server ${res.status}`, serverUrl))
    } catch (err) {
      serverItems.push(
        error(`Server 不可达(${serverUrl})`, err instanceof Error ? err.message : String(err)),
      )
    }
    if (link?.projectId) serverItems.push(ok(`Project association(${link.projectId})`))
    else serverItems.push(warn('Project association 缺失', '运行 npx csspilot init 重新关联'))
    push('Server', serverItems)
  }

  const all = sections.flatMap((section) => section.items)
  return {
    sections,
    errors: all.filter((item) => item.status === 'error').length,
    warnings: all.filter((item) => item.status === 'warn').length,
  }
}

const MARK: Record<CheckStatus, string> = { ok: '✔', warn: '⚠', error: '✗' }

/** 按设计文档 §12 的格式输出报告 */
export function printDoctor(report: DoctorReport): void {
  console.log('TestPilot Doctor')
  console.log('')
  for (const section of report.sections) {
    console.log(section.name)
    console.log('────────────────────────')
    for (const item of section.items) {
      const hint = item.hint ? `(${item.hint})` : ''
      console.log(`${MARK[item.status]} ${item.label}${hint}`)
    }
    console.log('')
  }
  console.log('Result')
  console.log('────────────────────────')
  console.log(`${report.errors} error${report.errors === 1 ? '' : 's'}`)
  console.log(`${report.warnings} warning${report.warnings === 1 ? '' : 's'}`)
}
