/** TestPilot 统一错误基类:携带机器可读错误码 */
export class TestPilotError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options ? { cause: options.cause } : undefined)
    this.name = 'TestPilotError'
    this.code = code
  }
}
