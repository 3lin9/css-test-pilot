import { EventEmitter } from 'node:events'
import { expect, test, vi } from 'vitest'
import { TestPilotError } from '@testpilot/core'
import { automatorLauncher } from '@testpilot/adapter-wechatide'

// 可控的 spawn / createConnection 假件(hoisted 供 vi.mock 工厂引用)
const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  createConnection: vi.fn(),
}))

// ide.ts 顶部依赖:automator 默认导入必须拒绝 launch 才会走 cli auto 降级路径
vi.mock('miniprogram-automator', () => ({
  default: {
    launch: vi.fn(async () => {
      throw new Error('spawn .bat blocked by Node')
    }),
    connect: vi.fn(async () => {
      throw new Error('connect refused')
    }),
  },
}))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:net', () => ({ default: { createConnection: mocks.createConnection } }))

function fakeChild(): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

function fakeSocket(): EventEmitter & { destroy: () => void } {
  const socket = new EventEmitter() as EventEmitter & { destroy: () => void }
  socket.destroy = () => {}
  return socket
}

test('拉起开发者工具 cli 失败 → ENVIRONMENT_UNAVAILABLE', async () => {
  const child = fakeChild()
  const socket = fakeSocket()
  mocks.spawn.mockReturnValue(child)
  mocks.createConnection.mockReturnValue(socket) // poll() 需要 socket.once 可用,但不触发其 error
  const pending = automatorLauncher.launch({ projectPath: 'p', cliPath: 'cli.bat' })
  // cli auto 降级在 automator.launch 拒绝后的微任务里才 spawn,等监听器挂上再 emit
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled())
  expect(mocks.spawn.mock.calls[0]?.[1]).toEqual(['--auto', 'p', '--auto-port', '9420'])
  child.emit('error', new Error('spawn ENOENT'))
  const err = await pending.then(
    () => null,
    (e) => e,
  )
  expect(err).toBeInstanceOf(TestPilotError)
  expect((err as TestPilotError).code).toBe('ENVIRONMENT_UNAVAILABLE')
  expect((err as Error).message).toContain('拉起开发者工具 cli 失败')
})

test('自动化端口等待超时 → ENVIRONMENT_UNAVAILABLE', async () => {
  vi.useFakeTimers()
  try {
    mocks.spawn.mockReset()
    mocks.createConnection.mockReset()
    const child = fakeChild()
    mocks.spawn.mockReturnValue(child)
    // 每次 poll 连接都连不上:新 socket 挂好 error 监听后自 emit(原生微任务,无竞态)
    mocks.createConnection.mockImplementation(() => {
      const s = fakeSocket()
      Promise.resolve().then(() => s.emit('error', new Error('ECONNREFUSED')))
      return s
    })
    const pending = automatorLauncher.launch({ projectPath: 'p', cliPath: 'cli.bat' })
    pending.catch(() => {}) // 拒绝发生在推时钟期间,先挂 handler 免被标记 unhandled;断言仍走下方 then
    // 冲刷微任务:automator.launch 拒绝 → startCliAuto + 首次 poll(连接失败 → 安排 500ms 重试)
    // 单次冲刷深度在全量并发负载下不可靠(偶发差一拍,首次 poll 不发生),循环推进直至连接出现
    for (let i = 0; i < 20 && mocks.createConnection.mock.calls.length === 0; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }
    // 推进假时钟越过 AUTO_PORT_FALLBACK_WAIT_MS(90s)并触发重试 poll(仍连不上 → 端口超时)
    await vi.advanceTimersByTimeAsync(91_000)
    // 500ms 节奏持续重试(次数是实现细节),失败前至少完成过一次重试
    expect(mocks.createConnection.mock.calls.length).toBeGreaterThanOrEqual(2)
    const err = await pending.then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(TestPilotError)
    expect((err as TestPilotError).code).toBe('ENVIRONMENT_UNAVAILABLE')
    expect((err as Error).message).toContain('自动化端口')
  } finally {
    vi.useRealTimers()
  }
})

test('新版 --auto 被 CLI 拒绝时回退到 auto --project', async () => {
  const children: Array<EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }> = []
  mocks.spawn.mockReset()
  mocks.createConnection.mockReset()
  mocks.spawn.mockImplementation(() => {
    const child = fakeChild()
    children.push(child)
    return child
  })
  mocks.createConnection.mockImplementation(() => fakeSocket())
  const pending = automatorLauncher.launch({ projectPath: 'p', cliPath: 'cli.bat' })
  pending.catch(() => {})
  await vi.waitFor(() => expect(children.length).toBe(1))
  children[0]?.emit('exit', 1)
  await vi.waitFor(() => expect(children.length).toBe(2))
  expect(mocks.spawn.mock.calls[1]?.[1]).toEqual(['auto', '--project', 'p', '--auto-port', '9420'])
  children[1]?.emit('error', new Error('spawn ENOENT'))
  const err = await pending.then(
    () => null,
    (error: unknown) => error,
  )
  expect(err).toBeInstanceOf(TestPilotError)
  expect((err as TestPilotError).code).toBe('ENVIRONMENT_UNAVAILABLE')
  expect((err as Error).message).toContain('兼容参数')
})
