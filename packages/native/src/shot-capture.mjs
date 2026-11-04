import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** 模拟器截一张图。真机或会话已断时静默跳过,不改变用例结果。 */
export async function captureSession(mini) {
  const state = globalThis.__TESTPILOT_SHOTS__
  if (!state?.dir || !state.fileName || !mini || mini.__testpilotShot) return
  if (typeof mini.screenshot !== 'function') return
  try {
    await mkdir(state.dir, { recursive: true })
    await mini.screenshot({ path: join(state.dir, state.fileName) })
    mini.__testpilotShot = true
  } catch {
    // 真机模式没有截图
  }
}

/** 包住 close/disconnect,在会话关掉之前截图。 */
export function trackSession(mini) {
  const state = globalThis.__TESTPILOT_SHOTS__
  if (!state || !mini || mini.__testpilotTracked) return mini
  mini.__testpilotTracked = true
  state.sessions.add(mini)
  for (const method of ['close', 'disconnect']) {
    const orig = mini[method]
    if (typeof orig !== 'function') continue
    mini[method] = async (...args) => {
      await captureSession(mini)
      state.sessions.delete(mini)
      return orig.apply(mini, args)
    }
  }
  return mini
}
