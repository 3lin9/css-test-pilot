import type { StepTarget } from '@testpilot/dsl'
import type { AdapterFactory, TestAdapter } from './adapter'

/**
 * 一个 target 的适配器会话:首次使用时创建并 launch,运行结束后统一 close。
 */
export class AdapterSession {
  private adapter: TestAdapter | undefined

  constructor(
    readonly target: StepTarget,
    private readonly factory: AdapterFactory,
  ) {}

  get opened(): boolean {
    return this.adapter !== undefined
  }

  /** 惰性创建;已创建则复用 */
  async get(): Promise<TestAdapter> {
    if (!this.adapter) {
      this.adapter = await this.factory.create()
      await this.adapter.launch()
    }
    return this.adapter
  }

  async close(): Promise<void> {
    if (this.adapter) {
      await this.adapter.close().catch(() => undefined)
      this.adapter = undefined
    }
  }
}
