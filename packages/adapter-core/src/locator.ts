import type { CaseLocator } from '@testpilot/dsl'

/** 人类可读的 locator 描述,用于日志与控制台输出 */
export function describeLocator(locator: CaseLocator | undefined): string {
  if (!locator) return '-'
  if (locator.text !== undefined) return `text="${locator.text}"`
  if (locator.css !== undefined) return `css="${locator.css}"`
  return '-'
}
