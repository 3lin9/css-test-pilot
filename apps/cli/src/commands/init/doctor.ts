import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadTestpilotConfig } from '@testpilot/core'
import { collectCases, readProjectLink } from '@testpilot/sdk'
import { detectAdapters, type AdapterInfo } from './adapter-detector'
import { collectEnvVarRefs } from './environment-initializer'
import { detectProject, type ProjectInfo } from './project-detector'
import { readManifestVersion, resolveSkillSourceDir } from './skill-installer'

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

  // ---- Runtime(§12:Node / Package Manager / Git) ----
  const info: ProjectInfo = await detectProject(root)
  const runtimeItems: DoctorItem[] = []
  const nodeMajor = Number(process.versions.node.split('.')[0])
  runtimeItems.push(
    nodeMajor >= 22
      ? ok(`Node.js ${process.versions.node}`)
      : error(`Node.js ${process.versions.node}`, '需要 Node.js >= 22'),
  )
  if (info.packageManager !== 'npx') runtimeItems.push(ok(`Package Manager ${info.packageManager}`))
  else runtimeItems.push(warn('Package Manager 未识别', '未发现 pnpm/yarn/npm lockfile'))
  runtimeItems.push(
    info.git.commit ? ok('Git') : warn('Git 未检测到', 'Case Metadata 无法同步到 Server'),
  )
  push('Runtime', runtimeItems)

  // ---- Project ----
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
  const cases = await collectCases([join(root, casesDir)], { root }).catch(() => [])
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
  const installedSkillVersion = readManifestVersion(skillDir)
  const skillSource = resolveSkillSourceDir()
  const bundledSkillVersion = skillSource ? readManifestVersion(skillSource) : undefined
  const skillItems: DoctorItem[] = [
    installedSkillVersion
      ? ok(`TestPilot Skill(.agents/skills/testpilot,v${installedSkillVersion})`)
      : error('TestPilot Skill', '运行 npx csspilot init 安装'),
    existsSync(join(skillDir, 'references', 'project.md'))
      ? ok('Project testing guide(references/)')
      : warn('Project testing guide 缺失', 'references/ 由 init 生成;可重新运行 npx csspilot init'),
  ]
  if (installedSkillVersion && bundledSkillVersion && installedSkillVersion !== bundledSkillVersion) {
    skillItems.push(
      warn(
        `Skill 可更新(v${installedSkillVersion} -> v${bundledSkillVersion})`,
        '运行 npx csspilot update 并提交 .agents/skills/ 变更',
      ),
    )
  }
  push('Agent', skillItems)

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

  // ---- Environment(配置引用的环境变量 + Case 声明的账号凭据,§12 Required secrets) ----
  const refs = await collectEnvVarRefs(root)
  const envItems: DoctorItem[] = refs.map((name) =>
    process.env[name] !== undefined
      ? ok(name)
      : error(`${name} missing`, '在运行环境(.env / CI Secret)中设置'),
  )

  // accountRef 凭据:本地用 TESTPILOT_ACCOUNT_<REF> 提供;Server 触发时按环境凭据解析,缺失只警告
  const serverConfigured = (process.env.TESTPILOT_SERVER_URL ?? config?.server?.baseUrl) !== undefined
  const accountRefs = [
    ...new Set(cases.map((item) => item.case?.accountRef).filter((ref): ref is string => !!ref)),
  ]
  for (const ref of accountRefs) {
    const envName = `TESTPILOT_ACCOUNT_${ref.toUpperCase().replace(/-/g, '_')}`
    if (process.env[envName] !== undefined) envItems.push(ok(`${envName}(账号 ${ref})`))
    else if (!serverConfigured)
      envItems.push(
        warn(
          `账号 ${ref} 凭据缺失`,
          `本地运行设置 ${envName};或配置 Server 后按环境凭据解析`,
        ),
      )
  }
  if (envItems.length > 0) push('Environment', envItems)

  // ---- Server(配置了才检查) ----
  const serverUrl = serverConfigured ? (process.env.TESTPILOT_SERVER_URL ?? config?.server?.baseUrl) : undefined
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
