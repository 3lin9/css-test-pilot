import { captureSession } from './shot-capture.mjs'

const nodeTest = process.getBuiltinModule('node:test')

function parseTestArgs(args) {
  const [a, b, c] = args
  if (typeof a === 'function') return { fn: a }
  if (a && typeof a === 'object') return { options: a, fn: typeof b === 'function' ? b : undefined }
  if (typeof b === 'function') return { name: String(a), fn: b }
  if (typeof c === 'function') return { name: String(a), options: b, fn: c }
  return {}
}

function wrapTest(original) {
  function wrapped(...args) {
    const parsed = parseTestArgs(args)
    if (!parsed.fn) return original(...args)
    const title = parsed.name ?? 'test'
    const run = async (t) => {
      const state = globalThis.__TESTPILOT_SHOTS__
      if (state?.dir) {
        state.fileName = state.namer(state.script || 'miniapp', title)
        for (const mini of state.sessions) mini.__testpilotShot = false
      }
      try {
        return await parsed.fn(t)
      } finally {
        const current = globalThis.__TESTPILOT_SHOTS__
        if (current) {
          for (const mini of [...current.sessions]) await captureSession(mini)
          current.fileName = ''
        }
      }
    }
    if (parsed.name === undefined && parsed.options === undefined) return original(run)
    if (parsed.options === undefined) return original(parsed.name, run)
    if (parsed.name === undefined) return original(parsed.options, run)
    return original(parsed.name, parsed.options, run)
  }
  if (typeof original.skip === 'function') wrapped.skip = original.skip.bind(original)
  if (typeof original.todo === 'function') wrapped.todo = original.todo.bind(original)
  if (typeof original.only === 'function' && original.only !== original) {
    wrapped.only = wrapTest(original.only)
  }
  return wrapped
}

export const test = wrapTest(nodeTest.test)
export const it = wrapTest(nodeTest.it)
export const describe = nodeTest.describe
export const suite = nodeTest.suite
export const before = nodeTest.before
export const after = nodeTest.after
export const beforeEach = nodeTest.beforeEach
export const afterEach = nodeTest.afterEach
export const mock = nodeTest.mock
export const run = nodeTest.run
export const snapshot = nodeTest.snapshot
export default test
