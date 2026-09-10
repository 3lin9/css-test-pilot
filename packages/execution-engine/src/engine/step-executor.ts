import type { TestAdapter } from '@testpilot/adapter-core'
import type { StepResult } from '@testpilot/core'
import type { TestStep } from '@testpilot/dsl'
import type { ArtifactManager } from '../artifacts'
import type { ExecutionContext } from '../context'

export interface StepExecutorOptions {
  /** 截图文件名(不含扩展名) */
  screenshotName: string
}

/**
 * 执行单步:解析模板变量 -> 调用 adapter -> 捕获变量 / 截图。
 * 永不抛出:错误进入 StepResult.error,失败时尽力截图取证。
 */
export async function executeStep(
  step: TestStep,
  index: number,
  adapter: TestAdapter,
  context: ExecutionContext,
  artifacts: ArtifactManager,
  options: StepExecutorOptions,
): Promise<StepResult> {
  const startedAt = Date.now()
  const result: StepResult = {
    index,
    target: step.target,
    action: step.action,
    status: 'passed',
    durationMs: 0,
  }

  try {
    // locator 支持 ${var} 模板解析(动态元素定位,如 .order-row-${orderId})
    const locator = step.locator
      ? {
          text: step.locator.text !== undefined ? context.resolve(step.locator.text) : undefined,
          css: step.locator.css !== undefined ? context.resolve(step.locator.css) : undefined,
        }
      : undefined

    switch (step.action) {
      case 'launch':
        // 会话已负责首次 launch;这里保持幂等语义
        await adapter.launch()
        break
      case 'navigate':
        await adapter.navigate(context.resolve(step.url ?? ''))
        break
      case 'click':
        await adapter.click(locator!)
        break
      case 'input':
        await adapter.input(locator!, context.resolve(step.value ?? ''))
        break
      case 'select':
        await adapter.select(locator!, context.resolve(step.value ?? ''))
        break
      case 'wait':
        await adapter.wait(locator, step.timeout)
        break
      case 'assert':
        await adapter.assert(locator!, context.resolve(step.expected ?? ''))
        break
      case 'extract': {
        const value = await adapter.extract(locator!)
        if (step.variable) {
          context.set(step.variable, value)
          result.extracted = { [step.variable]: value }
        }
        break
      }
      case 'screenshot': {
        const data = await adapter.screenshot()
        result.screenshot = await artifacts.saveStepScreenshot(`${options.screenshotName}.png`, data)
        break
      }
      default: {
        const exhaustive: never = step.action
        throw new Error(`不支持的 action:${String(exhaustive)}`)
      }
    }
  } catch (err) {
    result.status = 'failed'
    result.error = err instanceof Error ? err.message : String(err)
    try {
      const data = await adapter.screenshot()
      result.screenshot = await artifacts.saveStepScreenshot(`${options.screenshotName}-failed.png`, data)
    } catch {
      // 截图失败不影响错误信息
    }
  }

  result.durationMs = Date.now() - startedAt
  return result
}
