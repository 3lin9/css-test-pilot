import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { trackSession } from './shot-capture.mjs'

function loadReal() {
  const script = globalThis.__TESTPILOT_SHOTS__?.script
  const parent = script ? resolve(script) : fileURLToPath(import.meta.url)
  return createRequire(parent)('miniprogram-automator')
}

const real = loadReal()

async function launch(options) {
  return trackSession(await real.launch.call(real, options))
}

async function connect(options) {
  return trackSession(await real.connect.call(real, options))
}

const api = { ...real, launch, connect }
export default api
export { launch, connect }
