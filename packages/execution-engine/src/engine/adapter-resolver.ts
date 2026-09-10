import { TestPilotError } from '@testpilot/core'
import { AdapterSession, type AdapterFactory } from '@testpilot/adapter-core'
import type { StepTarget } from '@testpilot/dsl'

/** target -> adapter 工厂;运行时惰性创建会话,结束时统一关闭 */
export class AdapterResolver {
  private readonly factories = new Map<StepTarget, AdapterFactory>()
  private readonly sessions = new Map<StepTarget, AdapterSession>()

  register(factory: AdapterFactory): void {
    this.factories.set(factory.target, factory)
  }

  /** 取得(或创建)target 的会话 */
  async session(target: StepTarget): Promise<AdapterSession> {
    let session = this.sessions.get(target)
    if (!session) {
      const factory = this.factories.get(target)
      if (!factory) {
        throw new TestPilotError('ADAPTER_NOT_FOUND', `未注册 target "${target}" 的 adapter,该端步骤无法执行`)
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
