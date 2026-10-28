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

test('各端命令交给对应框架,不生成统一步骤', () => {
  const commands = planNativeCommands(
    [
      'E:/app/tests/e2e/web/order.spec.ts',
      'E:/app/tests/e2e/miniapp/list.test.ts',
      'E:/app/tests/e2e/api/create.test.js',
    ],
    'node',
  )
  expect(commands.map((item) => item.target)).toEqual(['api', 'web', 'miniapp'])
  expect(commands[0]).toMatchObject({ command: 'node', args: ['--test', 'E:/app/tests/e2e/api/create.test.js'] })
  expect(commands[1]).toMatchObject({ command: 'npx', args: ['playwright', 'test', 'E:/app/tests/e2e/web/order.spec.ts'] })
  expect(commands[2]?.args.slice(0, 3)).toEqual(['--test', '--experimental-strip-types', 'E:/app/tests/e2e/miniapp/list.test.ts'])
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
      return command.target === 'api' ? 0 : 1
    },
  })
  expect(seen.map((item) => item.target)).toEqual(['api', 'web'])
  expect(result.status).toBe('failed')
  expect(result.exitCode).toBe(1)
})
