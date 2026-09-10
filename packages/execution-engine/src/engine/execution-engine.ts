import type { CaseResult } from '@testpilot/core'
import type { TestCase } from '@testpilot/dsl'
import type { ArtifactManager } from '../artifacts'
import { ExecutionContext } from '../context'
import type { EventBus } from '../events'
import type { AdapterResolver } from './adapter-resolver'
import { executeStep } from './step-executor'

export interface RunCaseOptions {
  runId: string
  file: string
  artifacts: ArtifactManager
  bus: EventBus
  resolver: AdapterResolver
}

/** 引擎核心:顺序执行单条用例的全部步骤;失败后剩余步骤标记 skipped */
export class ExecutionEngine {
  async runCase(data: TestCase, options: RunCaseOptions): Promise<CaseResult> {
    const { runId, file, artifacts, bus, resolver } = options
    const startedAt = new Date()
    const context = new ExecutionContext()
    const steps: CaseResult['steps'] = []
    let caseError: string | undefined

    await bus.emit({ type: 'case-started', runId, caseId: data.id, file, ts: startedAt.toISOString() })
    await artifacts.logger.info(`case ${data.id} started (${file})`)

    for (const [index, step] of data.steps.entries()) {
      await bus.emit({
        type: 'step-started',
        runId,
        caseId: data.id,
        index,
        target: step.target,
        action: step.action,
        ts: new Date().toISOString(),
      })

      let result: CaseResult['steps'][number]
      try {
        const adapter = await (await resolver.session(step.target)).get()
        result = await executeStep(step, index, adapter, context, artifacts, {
          screenshotName: `${data.id}-step-${String(index).padStart(2, '0')}`,
        })
      } catch (err) {
        // 会话创建失败 / adapter 未注册等用例级错误
        result = {
          index,
          target: step.target,
          action: step.action,
          status: 'failed',
          durationMs: 0,
          error: err instanceof Error ? err.message : String(err),
        }
      }

      steps.push(result)
      await artifacts.logger.info(`step ${index} ${step.action} -> ${result.status}${result.error ? ` - ${result.error}` : ''}`)
      await bus.emit({
        type: 'step-finished',
        runId,
        caseId: data.id,
        index,
        target: step.target,
        action: step.action,
        status: result.status,
        durationMs: result.durationMs,
        error: result.error,
        ts: new Date().toISOString(),
      })

      if (result.status === 'failed') {
        caseError = result.error
        for (const [skipIndex, skippedStep] of data.steps.entries()) {
          if (skipIndex <= index) continue
          steps.push({
            index: skipIndex,
            target: skippedStep.target,
            action: skippedStep.action,
            status: 'skipped',
            durationMs: 0,
          })
        }
        break
      }
    }

    const finishedAt = new Date()
    const status = caseError ? 'failed' : 'passed'
    await bus.emit({
      type: 'case-finished',
      runId,
      caseId: data.id,
      status,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      ts: finishedAt.toISOString(),
    })
    await artifacts.logger.info(`case ${data.id} ${status}`)

    const caseResult: CaseResult = {
      caseId: data.id,
      caseName: data.name,
      file,
      status,
      steps,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    }
    if (caseError) caseResult.error = caseError
    return caseResult
  }
}
