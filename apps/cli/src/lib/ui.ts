/**
 * 零依赖终端 UI 助手:16 色 ANSI + 行内 spinner。
 * 颜色遵循 NO_COLOR / FORCE_COLOR 约定,非 TTY(CI 日志、管道)自动降级为纯文本;
 * 产物里不引第三方颜色库,保持运行时依赖只有 playwright 与 miniprogram-automator。
 */

/** FORCE_COLOR=1 强制启用(管道/CI 也能出颜色);否则仅 TTY 且未设 NO_COLOR 时启用。 */
const FORCE_COLOR = process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0'
const ENABLED = FORCE_COLOR || (process.stdout.isTTY === true && process.env.NO_COLOR === undefined)

/** ANSI 转义引导符,用 char code 构造,避免源码里出现不可见控制字节。 */
const ESC = String.fromCharCode(27)

const CODE = {
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  gray: 90,
} as const

export type PaintCode = keyof typeof CODE

/** 给文本包 ANSI 颜色;颜色未启用或文本为空时原样返回。 */
export function paint(text: string, ...codes: PaintCode[]): string {
  if (!ENABLED || text === '') return text
  const prefix = codes.map((code) => `${ESC}[${CODE[code]}m`).join('')
  return `${prefix}${text}${ESC}[0m`
}

export const okMark = (): string => paint('✔', 'green')
export const failMark = (): string => paint('✗', 'red')
export const warnMark = (): string => paint('⚠', 'yellow')
export const infoMark = (): string => paint('ℹ', 'cyan')

export interface Spinner {
  /** 停止并清行;重复调用安全。 */
  stop(): void
}

/**
 * run 等长耗时命令的行内 spinner。spawn 期间框架输出进文件/缓冲,终端无回显,
 * spinner 让等待可见;非 TTY(CI 日志)不启用,避免污染日志。
 */
export function startSpinner(label: string): Spinner {
  if (process.stdout.isTTY !== true) return { stop: () => {} }
  const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let frame = 0
  const timer = setInterval(() => {
    process.stdout.write(`\r${FRAMES[frame++ % FRAMES.length]} ${label}`)
  }, 100)
  const stop = (): void => {
    clearInterval(timer)
    process.stdout.write(`\r${ESC}[2K`)
  }
  return { stop }
}
