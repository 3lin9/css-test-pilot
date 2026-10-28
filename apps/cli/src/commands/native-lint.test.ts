import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { lintNativeCases } from './native-lint'

async function makeProject(files: Record<string, string>): Promise<string> {
  const root = join(tmpdir(), `testpilot-lint-${Date.now()}`)
  for (const [file, content] of Object.entries(files)) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), content)
  }
  return root
}

test('lint:头注释/reviews 出处/env 引用三道卡', async () => {
  const root = await makeProject({
    'tests/e2e/reviews/order-coverage.md': '# 评审清单\n- TP-001 加购下单\n',
    'tests/e2e/web/order.spec.ts':
      '// 测试点: TP-001\n// 视角: charter:error-path\nconst base = process.env.TEST_BASE_URL\n',
    'tests/e2e/miniapp/member.test.ts':
      '// 测试点: TP-XXX\n// 视角: charter:nope\nconst path = process.env.MYSTERY_VAR\n',
  })
  await writeFile(join(root, '.env.testing'), 'TEST_BASE_URL=http://localhost\n')

  const report = await lintNativeCases([], { root })
  const byFile = new Map(report.files.map((item) => [item.file.replace(/\\/g, '/'), item.issues]))

  // 合规脚本零 issue:ID 在 reviews 清单、视角合法、env 已声明
  expect(byFile.get('tests/e2e/web/order.spec.ts')).toEqual([])

  const bad = byFile.get('tests/e2e/miniapp/member.test.ts') ?? []
  expect(bad.some((message) => message.includes('TP-XXX 不在 tests/e2e/reviews/ 清单中'))).toBe(true)
  expect(bad.some((message) => message.includes('charter:nope 不在枚举内'))).toBe(true)
  expect(bad.some((message) => message.includes('MYSTERY_VAR 未在'))).toBe(true)
  expect(report.issueCount).toBe(3)
})

test('lint:缺少头注释整条 evidence 链报错', async () => {
  const root = await makeProject({
    'tests/e2e/api/health.test.ts': 'import { test } from "node:test"\n',
  })
  const report = await lintNativeCases([], { root })
  const issues = report.files[0]?.issues ?? []
  expect(issues.some((message) => message.includes('缺少文件头 `// 测试点'))).toBe(true)
  expect(issues.some((message) => message.includes('缺少文件头 `// 视角'))).toBe(true)
})
