import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectInfo } from './project-detector'

export interface TestStructureResult {
  web: 'created' | 'reused'
  miniapp: 'created' | 'reused'
  api: 'created' | 'reused'
  data: 'created' | 'reused'
  reviews: 'created' | 'reused'
}

/**
 * 初始化 tests/e2e/{web,miniapp,api,data,reviews};已有目录直接复用,不迁移不删除。
 * 不建 cases/(YAML 链路已退役);项目里残留的 cases/*.yaml 不受影响,由用户决定迁移或删除。
 */
export async function initTestStructure(root: string, _info: ProjectInfo): Promise<TestStructureResult> {
  const dirs = {
    web: join(root, 'tests', 'e2e', 'web'),
    miniapp: join(root, 'tests', 'e2e', 'miniapp'),
    api: join(root, 'tests', 'e2e', 'api'),
    data: join(root, 'tests', 'e2e', 'data'),
    reviews: join(root, 'tests', 'e2e', 'reviews'),
  } as const

  const existed: Record<keyof typeof dirs, boolean> = {
    web: existsSync(dirs.web),
    miniapp: existsSync(dirs.miniapp),
    api: existsSync(dirs.api),
    data: existsSync(dirs.data),
    reviews: existsSync(dirs.reviews),
  }

  for (const dir of Object.values(dirs)) {
    await mkdir(dir, { recursive: true })
  }

  return {
    web: existed.web ? 'reused' : 'created',
    miniapp: existed.miniapp ? 'reused' : 'created',
    api: existed.api ? 'reused' : 'created',
    data: existed.data ? 'reused' : 'created',
    reviews: existed.reviews ? 'reused' : 'created',
  }
}
