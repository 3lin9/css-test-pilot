import { existsSync, readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectInfo } from './project-detector'

export interface TestStructureResult {
  cases: 'created' | 'reused'
  fixtures: 'created' | 'reused'
  data: 'created' | 'reused'
}

/** 初始化 tests/e2e/{cases,fixtures,data};已有目录直接复用,不迁移不删除(设计文档 §6) */
export async function initTestStructure(root: string, _info: ProjectInfo): Promise<TestStructureResult> {
  const dirs = {
    cases: join(root, 'tests', 'e2e', 'cases'),
    fixtures: join(root, 'tests', 'e2e', 'fixtures'),
    data: join(root, 'tests', 'e2e', 'data'),
  } as const

  const existed: Record<keyof typeof dirs, boolean> = {
    cases: existsSync(dirs.cases),
    fixtures: existsSync(dirs.fixtures),
    data: existsSync(dirs.data),
  }

  for (const dir of Object.values(dirs)) {
    await mkdir(dir, { recursive: true })
  }
  // 新建的空目录放 .gitkeep,避免 git 不跟踪;已有内容的目录不碰
  for (const [name, dir] of Object.entries(dirs) as Array<[keyof typeof dirs, string]>) {
    if (!existed[name] && readdirSync(dir).length === 0) {
      await writeFile(join(dir, '.gitkeep'), '', 'utf8').catch(() => undefined)
    }
  }

  return {
    cases: existed.cases ? 'reused' : 'created',
    fixtures: existed.fixtures ? 'reused' : 'created',
    data: existed.data ? 'reused' : 'created',
  }
}
