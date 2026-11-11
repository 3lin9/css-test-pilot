import { fileURLToPath } from 'node:url'

/**
 * shot-hook.mjs 的绝对路径(node --import 注入用)。
 * 按本模块自身位置解析:源码态与 vitest 下指向 packages/native/src/,
 * esbuild 打包后指向产物目录 —— 构建脚本需把 native/src/*.mjs 复制到产物旁。
 * 之前由 SDK 用相对路径跨包引用,脱离 monorepo 布局即断链,现已收口到本包内。
 */
export function shotHookPath(): string {
  return fileURLToPath(new URL('./shot-hook.mjs', import.meta.url))
}
