import { register } from 'node:module'
import { createShotNamer } from './shot-name.mjs'

function scriptFromArgv(argv) {
  for (let i = argv.length - 1; i >= 0; i--) {
    const arg = argv[i] ?? ''
    if (arg.startsWith('-')) continue
    if (/\.(?:test|spec)\.[cm]?[jt]s$/.test(arg)) return arg
  }
  return ''
}

globalThis.__TESTPILOT_SHOTS__ = {
  dir: process.env.TESTPILOT_SHOTS_DIR ?? '',
  script: scriptFromArgv(process.argv),
  fileName: '',
  sessions: new Set(),
  namer: createShotNamer(),
}

const registered = register(new URL('./shot-loader.mjs', import.meta.url), import.meta.url)
if (registered && typeof registered.then === 'function') await registered
