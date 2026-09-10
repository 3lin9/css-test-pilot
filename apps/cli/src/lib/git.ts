import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface GitInfo {
  branch?: string
  commit?: string
  repositoryUrl?: string
}

/** 读取本地项目的 Git 上下文;非 git 项目返回空对象 */
export async function readGitInfo(root: string): Promise<GitInfo> {
  const run = async (args: string[]): Promise<string | undefined> => {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd: root })
      return stdout.trim() || undefined
    } catch {
      return undefined
    }
  }
  const [branch, commit, repositoryUrl] = await Promise.all([
    run(['rev-parse', '--abbrev-ref', 'HEAD']),
    run(['rev-parse', 'HEAD']),
    run(['remote', 'get-url', 'origin']),
  ])
  return { branch, commit, repositoryUrl }
}
