import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

/** 运行期事件(以 NDJSON 落盘到 events.ndjson) */
export type RunEvent =
  | { type: 'run-started'; runId: string; totalCases: number; ts: string }
  | { type: 'case-started'; runId: string; caseId: string; file: string; ts: string }
  | {
      type: 'step-started'
      runId: string
      caseId: string
      index: number
      target: string
      action: string
      ts: string
    }
  | {
      type: 'step-finished'
      runId: string
      caseId: string
      index: number
      target: string
      action: string
      status: string
      durationMs: number
      error?: string
      ts: string
    }
  | { type: 'case-finished'; runId: string; caseId: string; status: string; durationMs: number; ts: string }
  | {
      type: 'run-finished'
      runId: string
      status: string
      totals: { cases: number; passed: number; failed: number }
      ts: string
    }

export type RunEventSubscriber = (event: RunEvent) => void | Promise<void>

/** 进程内事件总线:NDJSON 落盘 / 控制台输出都通过订阅实现 */
export class EventBus {
  private readonly subscribers: RunEventSubscriber[] = []

  subscribe(subscriber: RunEventSubscriber): void {
    this.subscribers.push(subscriber)
  }

  async emit(event: RunEvent): Promise<void> {
    for (const subscriber of this.subscribers) {
      await subscriber(event)
    }
  }
}

/** 订阅器:事件逐行 JSON 追加写入文件 */
export function ndjsonSubscriber(filePath: string): RunEventSubscriber {
  return async (event) => {
    await mkdir(dirname(filePath), { recursive: true })
    await appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8')
  }
}
