import type { CaseResult } from '@testpilot/core'
import type { TestCase, StepTarget } from '@testpilot/dsl'
import type { TestAdapter } from '@testpilot/adapter-core'
import type { ArtifactManager } from '../artifacts'
import { ExecutionContext } from '../context'
import type { EventBus } from '../events'
import type { AdapterResolver } from './adapter-resolver'
import { executeStep } from './step-executor'

export interface RunCaseOptions {
  runId: string
  file: string
  templateId: string
  rowId: string
  rowIndex: number
  initialVariables: Record<string, string>
  missingDependencies: string[]
  artifacts: ArtifactManager
  bus: EventBus
  resolver: AdapterResolver
  /** accountRef -> 凭据原文;Case 声明 accountRef 时注入为 ${account.*} 变量 */
  accounts?: Record<string, string>
}

/** 引擎核心:顺序执行单条用例的全部步骤;失败后剩余步骤标记 skipped */
export class ExecutionEngine {
  async runCase(data: TestCase, options: RunCaseOptions): Promise<CaseResult> {
    const { runId, file, artifacts, bus, resolver, rowId, rowIndex } = options
    const startedAt = new Date()
    const context = new ExecutionContext()
    context.seed(options.initialVariables)
    // Case 声明了 accountRef 且运行方提供对应凭据时,注入模板变量
    if (data.accountRef && options.accounts?.[data.accountRef] !== undefined) {
      context.seedAccount(options.accounts[data.accountRef])
    }
    const steps: CaseResult['steps'] = []
    const warnings: string[] = []
    const evidenceAdapters = new Map<StepTarget, TestAdapter>()
    let caseError: string | undefined
    const executionId = safeArtifactName(`${data.id}-${rowId}`)

    await bus.emit({
      type: 'case-started',
      runId,
      caseId: data.id,
      rowId,
      file,
      ts: startedAt.toISOString(),
    })
    await artifacts.logger.info(`case ${data.id}#${rowId} started (${file})`)

    if (options.missingDependencies.length > 0) {
      const finishedAt = new Date()
      const skipped: CaseResult = {
        caseId: data.id,
        caseName: data.name,
        file,
        rowId,
        rowIndex,
        status: 'skipped',
        skipReason: 'dependency-not-ready',
        missingDependencies: options.missingDependencies,
        steps,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      }
      await bus.emit({
        type: 'case-finished',
        runId,
        caseId: data.id,
        rowId,
        status: 'skipped',
        durationMs: skipped.durationMs,
        ts: finishedAt.toISOString(),
      })
      await artifacts.logger.info(
        `case ${data.id}#${rowId} skipped: missing ${options.missingDependencies.join(', ')}`,
      )
      return skipped
    }

    const runPhase = async (
      phase: 'setup' | 'steps' | 'teardown',
      phaseSteps: readonly TestCase['steps'][number][],
    ): Promise<boolean> => {
      let passed = true
      for (const [index, step] of phaseSteps.entries()) {
        await bus.emit({
          type: 'step-started',
          runId,
          caseId: data.id,
          rowId,
          phase,
          index,
          target: step.target,
          action: step.action,
          ts: new Date().toISOString(),
        })

        let result: CaseResult['steps'][number]
        try {
          const adapter = await (await resolver.session(step.target)).get()
          if (adapter.startEvidence && !evidenceAdapters.has(step.target)) {
            try {
              await adapter.startEvidence(executionId)
              evidenceAdapters.set(step.target, adapter)
            } catch (err) {
              await artifacts.logger.info(
                `evidence start failed for ${step.target}: ${err instanceof Error ? err.message : String(err)}`,
              )
            }
          }
          result = await executeStep(step, index, adapter, context, artifacts, {
            screenshotName: `${executionId}-${phase}-${String(index).padStart(2, '0')}`,
          })
        } catch (err) {
          result = {
            index,
            target: step.target,
            action: step.action,
            status: 'failed',
            durationMs: 0,
            error: err instanceof Error ? err.message : String(err),
          }
        }
        result.phase = phase
        if (phase === 'teardown' && result.status === 'failed') {
          result.status = 'warning'
          warnings.push(result.error ?? `teardown step ${index} failed`)
        }

        steps.push(result)
        await artifacts.logger.info(
          `${phase} step ${index} ${step.action} -> ${result.status}${result.error ? ` - ${result.error}` : ''}`,
        )
        await bus.emit({
          type: 'step-finished',
          runId,
          caseId: data.id,
          rowId,
          phase,
          index,
          target: step.target,
          action: step.action,
          status: result.status,
          durationMs: result.durationMs,
          error: result.error,
          ts: new Date().toISOString(),
        })

        if (result.status === 'failed') {
          passed = false
          caseError = result.error
          for (const [skipIndex, skippedStep] of phaseSteps.entries()) {
            if (skipIndex <= index) continue
            steps.push({
              index: skipIndex,
              phase,
              target: skippedStep.target,
              action: skippedStep.action,
              status: 'skipped',
              durationMs: 0,
            })
          }
          break
        }
      }
      return passed
    }

    const setupPassed = await runPhase('setup', data.setup ?? [])
    if (setupPassed) {
      await runPhase('steps', data.steps)
    } else {
      for (const [index, step] of data.steps.entries()) {
        steps.push({
          index,
          phase: 'steps',
          target: step.target,
          action: step.action,
          status: 'skipped',
          durationMs: 0,
        })
      }
    }
    await runPhase('teardown', data.teardown ?? [])

    const finishedAt = new Date()
    const status = caseError ? 'failed' : 'passed'
    const caseResult: CaseResult = {
      caseId: data.id,
      caseName: data.name,
      file,
      rowId,
      rowIndex,
      status,
      steps,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    }
    if (caseError) caseResult.error = caseError
    if (warnings.length > 0) caseResult.warnings = warnings

    // 收尾用例级取证(video/trace),失败不影响测试结果
    for (const [target, adapter] of evidenceAdapters) {
      if (!adapter.stopEvidence) continue
      try {
        const evidence = await adapter.stopEvidence(executionId)
        if (evidence.video) {
          caseResult.video = await artifacts.saveVideo(`${executionId}-${target}.webm`, evidence.video)
        }
        if (evidence.trace) {
          caseResult.trace = await artifacts.saveTrace(`${executionId}-${target}.zip`, evidence.trace)
        }
      } catch (err) {
        await artifacts.logger.info(
          `evidence stop failed for ${target}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    await bus.emit({
      type: 'case-finished',
      runId,
      caseId: data.id,
      rowId,
      status,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      ts: finishedAt.toISOString(),
    })
    await artifacts.logger.info(`case ${data.id}#${rowId} ${status}`)
    return caseResult
  }
}

function safeArtifactName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'case'
}
