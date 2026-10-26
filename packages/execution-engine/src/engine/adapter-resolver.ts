import { TestPilotError } from '@testpilot/core'
import { AdapterSession, type AdapterFactory } from '@testpilot/adapter-core'

/**
 * 会话键 -> adapter 工厂;运行时惰性创建会话,结束时统一关闭。
 * 键为 `target` 或 `target@system`(step.system 指定业务系统时),运行期字符串。
 */
export class AdapterResolver {
  private readonly factories = new Map<string, AdapterFactory>()
  private readonly sessions = new Map<string, AdapterSession>()

  register(factory: AdapterFactory): void {
    this.factories.set(factory.target, factory)
  }

  /** 取得(或创建)会话键的 adapter */
  async session(target: string): Promise<AdapterSession> {
    let session = this.sessions.get(target)
    if (!session) {
      const factory = this.factories.get(target)
      if (!factory) {
        throw new TestPilotError(
          'ADAPTER_NOT_FOUND',
          `未注册 "${target}" 的 adapter:检查步骤的 target/system 是否与 testpilot.yaml systems 声明一致`,
        )
      }
      session = new AdapterSession(target, factory)
      this.sessions.set(target, session)
    }
    return session
  }

  async closeAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.close()
    }
    this.sessions.clear()
  }
}
