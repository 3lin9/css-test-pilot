import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export type Level = 'INFO' | 'WARN' | 'ERROR'

/** 运行日志:逐行追加到文件 */
export class RunLogger {
  constructor(private readonly filePath: string) {}

  info(message: string): Promise<void> {
    return this.write('INFO', message)
  }

  warn(message: string): Promise<void> {
    return this.write('WARN', message)
  }

  error(message: string): Promise<void> {
    return this.write('ERROR', message)
  }

  private async write(level: Level, message: string): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const line = `${new Date().toISOString()} ${level} ${message}\n`
    await appendFile(this.filePath, line, 'utf8')
  }
}
