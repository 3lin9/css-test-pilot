import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  collectNativeCases,
  planNativeCommands,
  runNativeCases,
  targetForNativeFile,
  type NativeCommand,
} from '@testpilot/sdk'

test('按目录和扩展名识别原生脚本', () => {
  expect(targetForNativeFile('tests/e2e/web/order-create.spec.ts')).toBe('web')
  expect(targetForNativeFile('tests/e2e/miniapp/order-create.test.ts')).toBe('miniapp')
  expect(targetForNativeFile('tests/e2e/api/order-create.test.js')).toBe('api')
  expect(targetForNativeFile('tests/e2e/cases/order-create.yaml')).toBeUndefined()
  expect(targetForNativeFile('tests/e2e/web/helper.ts')).toBeUndefined()
})

test('各端命令交给对应框架,不生成统一步骤;web 用业务项目本地 Playwright CLI 且不走 shell', () => {
  const commands = planNativeCommands(
    [
      'E:/app/tests/e2e/web/order.spec.ts',
      'E:/app/tests/e2e/miniapp/list.test.ts',
      'E:/app/tests/e2e/api/create.test.js',
    ],
    'node',
    () => 'E:/app/node_modules/@playwright/test/cli.js',
  )
  expect(commands.map((item) => item.target)).toEqual(['api', 'web', 'miniapp'])
  expect(commands[0]).toMatchObject({ command: 'node', args: ['--test', 'E:/app/tests/e2e/api/create.test.js'] })
  expect(commands[1]).toMatchObject({
    command: 'node',
    args: ['E:/app/node_modules/@playwright/test/cli.js', 'test', 'E:/app/tests/e2e/web/order.spec.ts'],
  })
  // 所有命令都不经 shell:用例路径含空格/元字符也安全
  for (const command of commands) expect(command).not.toHaveProperty('shell')
  expect(commands[2]?.args.slice(0, 3)).toEqual(['--test', '--experimental-strip-types', 'E:/app/tests/e2e/miniapp/list.test.ts'])
})

test('web 端未安装 @playwright/test 时给出安装指引', () => {
  expect(() =>
    planNativeCommands(['E:/app/tests/e2e/web/order.spec.ts'], 'node', () => {
      throw new Error('未找到 @playwright/test;请先在业务项目安装:npm i -D @playwright/test')
    }),
  ).toThrow('@playwright/test')
})

test('收集约定目录中的脚本并按端执行', async () => {
  const root = join(tmpdir(), `testpilot-native-${Date.now()}`)
  await mkdir(join(root, 'tests/e2e/web'), { recursive: true })
  await mkdir(join(root, 'tests/e2e/api'), { recursive: true })
  await writeFile(join(root, 'tests/e2e/web/home.spec.ts'), 'test')
  await writeFile(join(root, 'tests/e2e/api/health.test.ts'), 'test')
  await writeFile(join(root, 'tests/e2e/web/notes.md'), 'ignore')

  const files = await collectNativeCases([], { root })
  expect(files.map((file) => file.replace(/\\/g, '/'))).toEqual([
    join(root, 'tests/e2e/api/health.test.ts').replace(/\\/g, '/'),
    join(root, 'tests/e2e/web/home.spec.ts').replace(/\\/g, '/'),
  ])

  const seen: NativeCommand[] = []
  const result = await runNativeCases({
    root,
    spawnImpl: async (command) => {
      seen.push(command)
      return { code: command.target === 'api' ? 0 : 1, stdout: '' }
    },
  })
  expect(seen.map((item) => item.target)).toEqual(['api', 'web'])
  expect(result.status).toBe('failed')
  expect(result.exitCode).toBe(1)
})
