import { relative } from 'node:path'
import { Command } from 'commander'
import { collectNativeCases, loadProjectConfig, readProjectLink } from '@testpilot/sdk'
import { readNativeCaseHeader } from '@testpilot/reporter'
import { readGitInfo } from '../lib/git'

interface SyncResultBody {
  projectId: number
  branch: string
  commit: string
  added: number
  updated: number
  deleted: number
  activeTotal: number
}

/**
 * CI 专用:把当前 Git Commit 的 Case Metadata 快照同步到 TestPilot Server。
 * Git Push 是 Case Metadata 进入团队共享 Server 的正式同步边界,
 * 不建议开发者手动执行(本地未 push 的 Case 不应进入团队视图)。
 */
export function makeSyncMetadataCommand(): Command {
  return new Command('sync-metadata')
    .description('同步 Case Metadata 快照到 TestPilot Server(CI / git push 后使用)')
    .option('--server <url>', 'TestPilot Server 地址(默认取 project.json 或 testpilot.yaml)')
    .action(async (options: { server?: string }) => {
      // 1. 项目关联
      const link = await readProjectLink()
      if (!link) {
        console.error('未找到 .testpilot/project.json(先运行 npx csspilot init 关联项目)')
        process.exitCode = 1
        return
      }

      // 2. Server 地址
      const config = await loadProjectConfig().catch(() => undefined)
      const serverUrl =
        options.server ??
        process.env.TESTPILOT_SERVER_URL ??
        link.serverUrl ??
        config?.server?.baseUrl
      if (!serverUrl) {
        console.error('未配置 TestPilot Server 地址(testpilot.yaml server.baseUrl 或 TESTPILOT_SERVER_URL)')
        process.exitCode = 1
        return
      }

      // 3. Git 上下文:Git Push 是同步边界,没有 commit 就没有同步
      const git = await readGitInfo(process.cwd())
      if (!git.commit || !git.branch) {
        console.error('当前目录不是 Git 仓库(或没有任何提交);sync-metadata 以 Git Commit 为同步单元')
        process.exitCode = 1
        return
      }

      // 4. 扫描原生脚本元数据(头注释 evidence 链:测试点 ID + 视角)
      const nativeFiles = await collectNativeCases([], { root: process.cwd() }).catch(() => [])
      const cases = (
        await Promise.all(
          nativeFiles.map(async (file) => {
            const header = await readNativeCaseHeader(file)
            if (!header.testPointId) return undefined
            return {
              id: header.testPointId,
              title: header.testPointId,
              file: relative(process.cwd(), file).split('\\').join('/'),
              tags: header.perspective ? [header.perspective] : [],
            }
          }),
        )
      ).filter((item): item is NonNullable<typeof item> => item !== undefined)

      // 5. 快照同步(projectId 形如 proj_2,Server 使用数字 ID)
      const numericId = /(\d+)$/.exec(link.projectId ?? '')?.[1]
      if (!numericId) {
        console.error(
          `项目关联 ${link.projectId} 不是 Server 注册的项目(本地模式);请重新运行 npx csspilot init 并配置 server.baseUrl`,
        )
        process.exitCode = 1
        return
      }
      try {
        const res = await fetch(
          `${serverUrl.replace(/\/$/, '')}/api/projects/${numericId}/cases/sync`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              repository: git.repositoryUrl,
              branch: git.branch,
              commit: git.commit,
              cases,
            }),
          },
        )
        if (!res.ok) {
          throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
        }
        const result = (await res.json()) as SyncResultBody
        console.log(`✓ 已同步 ${serverUrl}`)
        console.log(`  分支/提交:${result.branch} · ${result.commit.slice(0, 7)}`)
        console.log(
          `  新增 ${result.added} · 更新 ${result.updated} · 删除 ${result.deleted},当前 active 共 ${result.activeTotal} 个`,
        )
        console.log(`  (含 ${cases.length} 个原生脚本测试点)`)
      } catch (err) {
        console.error(`✗ 同步失败:${err instanceof Error ? err.message : err}`)
        process.exitCode = 1
      }
    })
}
