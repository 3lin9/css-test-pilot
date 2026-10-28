import { NATIVE_CODE_PREFIX } from '@testpilot/core'

export { NATIVE_CODE_PREFIX }

export type NativeMarkCode = 'ENVIRONMENT_UNAVAILABLE' | 'PREREQ_VARIABLE_MISSING'

export interface NativeMarkedError extends Error {
  code: NativeMarkCode
}

function markedError(code: NativeMarkCode, message: string): NativeMarkedError {
  // 错误码同时放 message 前缀与 code 属性:框架(ndjson/JSON reporter)只可靠地保留 message
  const error = new Error(`${NATIVE_CODE_PREFIX}${code}] ${message}`) as NativeMarkedError
  error.code = code
  return error
}

/** 环境与前置问题 → blocked(run 汇总为 blocked,CI 退出码 2,非产品回归) */
export function blocked(message: string): NativeMarkedError {
  return markedError('ENVIRONMENT_UNAVAILABLE', message)
}

/** 前置数据/变量缺失,断言本轮没有真正执行 → inconclusive */
export function inconclusive(message: string): NativeMarkedError {
  return markedError('PREREQ_VARIABLE_MISSING', message)
}
