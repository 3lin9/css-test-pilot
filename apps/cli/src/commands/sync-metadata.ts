import { relative } from 'node:path'
import { Command } from 'commander'
import { TestPilotClient } from '@testpilot/sdk'
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
      const client = new TestPilotClient()

      // 1. 项目关联
      const link = await client.getProjectLink()
      if (!link) {
        console.error('未找到 .testpilot/project.json(先运行 npx csspilot init 关联项目)')
        process.exitCode = 1
        return
      }

      // 2. Server 地址
      const config = await client.getConfig().catch(() => undefined)
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

      // 4. 扫描 Case Metadata(无效文件跳过并提示)
      const infos = await client.listCases()
      const cases = infos
        .filter((item) => item.valid && item.case)
        .map((item) => ({
          id: item.case!.id,
          title: item.case!.name,
          file: relative(process.cwd(), item.file).split('\\').join('/'),
          tags: item.case!.tags ?? [],
        }))
      const skipped = infos.length - cases.length

      // 5. 快照同步
      try {
        const res = await fetch(
          `${serverUrl.replace(/\/$/, '')}/api/projects/${encodeURIComponent(link.projectId)}/cases/sync`,
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
        if (skipped > 0) console.log(`  (跳过 ${skipped} 个校验失败的用例文件)`)
      } catch (err) {
        console.error(`✗ 同步失败:${err instanceof Error ? err.message : err}`)
        process.exitCode = 1
      }
    })
}
