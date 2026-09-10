import type { AdapterFactory } from '@testpilot/adapter-core'
import { MiniAppAdapter } from './ide'
import { resolveMiniappConfig, type MiniappConfigInput } from './project'

export { MiniAppAdapter } from './ide'
export type { AutomatorProgram } from './ide'
export { resolveMiniappConfig } from './project'
export type { MiniappAdapterConfig, MiniappConfigInput } from './project'

/**
 * miniapp 端 adapter 工厂。
 * 未配置 projectPath 时延迟到 create() 才报错,保证纯 web 项目不受影响。
 */
export function wechatideAdapterFactory(input: MiniappConfigInput = {}): AdapterFactory {
  return {
    target: 'miniapp',
    create: async () => {
      const config = await resolveMiniappConfig(input)
      if (!config) {
        throw new Error(
          '小程序未配置:在 testpilot.yaml 设置 miniapp.projectPath(必要时配 cliPath),或设置环境变量 TESTPILOT_MINIPROGRAM_PROJECT_PATH',
        )
      }
      return new MiniAppAdapter(config)
    },
  }
}
