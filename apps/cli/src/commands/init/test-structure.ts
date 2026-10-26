import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectInfo } from './project-detector'

export interface TestStructureResult {
  cases: 'created' | 'reused'
  data: 'created' | 'reused'
  reviews: 'created' | 'reused'
}

/**
 * 初始化 tests/e2e/{cases,data,reviews};已有目录直接复用,不迁移不删除(设计文档 §6)。
 * 不再创建 fixtures/ 目录:fixture 与 dataset 统一放 data/ 下,以 fixture.* / dataset.* 命名空间区分。
 */
export async function initTestStructure(root: string, _info: ProjectInfo): Promise<TestStructureResult> {
  const dirs = {
    cases: join(root, 'tests', 'e2e', 'cases'),
    data: join(root, 'tests', 'e2e', 'data'),
    reviews: join(root, 'tests', 'e2e', 'reviews'),
  } as const

  const existed: Record<keyof typeof dirs, boolean> = {
    cases: existsSync(dirs.cases),
    data: existsSync(dirs.data),
    reviews: existsSync(dirs.reviews),
  }

  for (const dir of Object.values(dirs)) {
    await mkdir(dir, { recursive: true })
  }

  return {
    cases: existed.cases ? 'reused' : 'created',
    data: existed.data ? 'reused' : 'created',
    reviews: existed.reviews ? 'reused' : 'created',
  }
}
