import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

const WRAP_TEST = new URL('./shot-node-test.mjs', import.meta.url).href
const WRAP_AUTO = new URL('./shot-automator.mjs', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'node:test') return { url: WRAP_TEST, shortCircuit: true }
  if (specifier === 'miniprogram-automator') return { url: WRAP_AUTO, shortCircuit: true }
  // node --test 在 Windows 上把脚本绝对路径交给 resolve。转成 file URL 再交给默认解析。
  if (isAbsolute(specifier)) return nextResolve(pathToFileURL(specifier).href, context)
  return nextResolve(specifier, context)
}
