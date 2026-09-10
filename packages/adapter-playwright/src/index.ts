import type { AdapterFactory } from '@testpilot/adapter-core'
import { launchBrowser } from './browser'
import type { BrowserBundle, PlaywrightAdapterOptions } from './browser'
import { PlaywrightAdapter } from './page'

export { launchBrowser, resolveHeadless, stepTimeout } from './browser'
export type { BrowserBundle, PlaywrightAdapterOptions } from './browser'
export { PlaywrightAdapter } from './page'

/** web 端 adapter 工厂:引擎首次遇到 web 步骤时创建并持有 */
export function playwrightAdapterFactory(options: PlaywrightAdapterOptions = {}): AdapterFactory {
  return {
    target: 'web',
    create: async () => {
      const bundle: BrowserBundle = await launchBrowser(options)
      return new PlaywrightAdapter(bundle, options)
    },
  }
}
