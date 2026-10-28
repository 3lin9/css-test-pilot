import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { inspectMiniappRuntime, loadTestpilotConfig } from '@testpilot/core'
import { collectNativeCases, readProjectLink, targetForNativeFile } from '@testpilot/sdk'
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
  const nativeScripts = await collectNativeCases([], { root }).catch(() => [])
  const nativeCount = nativeScripts.length
  const testDir = join(root, 'tests', 'e2e')
  push('Test', [
    existsSync(testDir) ? ok('tests/e2e') : error('tests/e2e', '运行 npx csspilot init 创建'),
    nativeCount === 0
      ? warn('原生脚本未找到', '按测试点写入 tests/e2e/web/*.spec.ts、tests/e2e/miniapp/*.test.ts 或 tests/e2e/api/*.test.ts')
      : ok(`原生脚本(${nativeCount} 个)`),
    ...(nativeScripts.some((file) => targetForNativeFile(file) === 'web')
      ? [
          existsSync(join(root, 'node_modules', '@playwright', 'test'))
            ? ok('@playwright/test(web runner)')
            : warn('@playwright/test 未安装', 'npm i -D @playwright/test && npx playwright install'),
        ]
      : []),
    ...(nativeScripts.some((file) => targetForNativeFile(file) === 'miniapp')
      ? [
          existsSync(join(root, 'node_modules', 'miniprogram-automator'))
            ? ok('miniprogram-automator(miniapp runner)')
            : warn('miniprogram-automator 未安装', 'npm i -D miniprogram-automator'),
        ]
      : []),
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

  // ---- Miniapp IDE(配置了小程序项目才检查;登录态/appid/服务端口问题阻断 run) ----
  const miniappProjectPath = config?.miniapp?.projectPath
  if (miniappProjectPath) {
    const report = await inspectMiniappRuntime({
      projectPath: miniappProjectPath,
      cliPath: process.env.WECHAT_DEVTOOLS_CLI ?? config?.miniapp?.cliPath,
    })
    const miniappItems: DoctorItem[] = [
      ...(report.cliPath ? [ok(`开发者工具 CLI(${report.cliPath})`)] : []),
      ...(report.loggedIn === true ? [ok('开发者工具已登录')] : []),
      ...(report.appid && report.appid !== 'touristappid' ? [ok(`小程序 appid(${report.appid})`)] : []),
      ...report.issues.map((issue) => error(issue.summary, issue.hint)),
    ]
    push('Miniapp IDE', miniappItems)
  }

  // ---- Environment(配置引用的环境变量;凭据不进脚本,放 .env.testing / CI Secret) ----
  const serverConfigured = (process.env.TESTPILOT_SERVER_URL ?? config?.server?.baseUrl) !== undefined
  const refs = await collectEnvVarRefs(root)
  const envItems: DoctorItem[] = refs.map((name) =>
    process.env[name] !== undefined
      ? ok(name)
      : error(`${name} missing`, '在 .env.testing(旧版本为 .env,请迁移)或 CI Secret 中设置'),
  )
  if (envItems.length > 0) push('Environment', envItems)

  // ---- Systems(systems 声明的额外业务系统:miniapp 路径必须存在,web/api baseUrl 尽力探测) ----
  const systems = config?.systems ?? {}
  if (Object.keys(systems).length > 0) {
    const systemItems: DoctorItem[] = await Promise.all(
      Object.entries(systems).map(async ([name, system]) => {
        const label = `${name}(${system.type})`
        if (system.type === 'miniapp') {
          const abs = join(root, system.projectPath ?? '')
          return existsSync(abs) ? ok(`${label} ${system.projectPath}`) : error(`${label} projectPath 不存在`, abs)
        }
        if (!system.baseUrl) return warn(`${label} 未配置 baseUrl`)
        try {
          await fetch(system.baseUrl, { signal: AbortSignal.timeout(3000) })
          return ok(`${label} ${system.baseUrl}`)
        } catch {
          return warn(`${label} baseUrl 不可达`, `${system.baseUrl}(系统可能未启动,不阻塞)`)
        }
      }),
    )
    push('Systems', systemItems)
  }

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
