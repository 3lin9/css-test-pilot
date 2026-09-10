import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface CiDetection {
  githubWorkflows: boolean
  gitlabCi: boolean
  /** 是否已有 testpilot 工作流(csspilot ci init 幂等依据) */
  hasTestpilotWorkflow: boolean
}

export interface CiInitResult {
  created: boolean
  file: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** 检测已有 CI 配置(init 只提示,不修改;设计文档 §13) */
export async function detectCi(root: string): Promise<CiDetection> {
  const workflow = join(root, '.github', 'workflows', 'testpilot.yml')
  return {
    githubWorkflows: await exists(join(root, '.github', 'workflows')),
    gitlabCi: await exists(join(root, '.gitlab-ci.yml')),
    hasTestpilotWorkflow: await exists(workflow),
  }
}

const CI_TEMPLATE = `# csspilot ci init 生成;Git Push -> TestPilot Server 的正式同步边界
name: TestPilot

on:
  push:
    branches: [main]

jobs:
  testpilot:
    runs-on: ubuntu-latest
    env:
      TESTPILOT_SERVER_URL: \${{ secrets.TESTPILOT_SERVER_URL }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Validate cases
        run: npx -y csspilot@latest validate

      # sync-metadata 是 Git Push -> Server 的正式同步边界;未配置 Server 时跳过
      - name: Sync case metadata
        if: \${{ env.TESTPILOT_SERVER_URL != '' }}
        run: npx -y csspilot@latest sync-metadata

      # 需要在 CI 里跑用例时再启用(Server 触发或本地触发均可)
      # - name: Run cases
      #   run: npx -y csspilot@latest run
`

/** 生成 .github/workflows/testpilot.yml(已有则跳过;设计文档 §13) */
export async function initCi(root: string): Promise<CiInitResult> {
  const file = join(root, '.github', 'workflows', 'testpilot.yml')
  if (await exists(file)) {
    return { created: false, file }
  }
  await mkdir(join(root, '.github', 'workflows'), { recursive: true })
  await writeFile(file, CI_TEMPLATE, 'utf8')
  return { created: true, file }
}
