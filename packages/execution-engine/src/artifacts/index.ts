import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  RunLogger,
  saveScreenshot,
  saveTrace as writeTraceFile,
  saveVideo as writeVideoFile,
} from '@testpilot/evidence'

/** 运行产物管理:统一维护 run 目录内的 screenshots / videos / traces / logs */
export class ArtifactManager {
  readonly screenshotsDir: string
  readonly videosDir: string
  readonly tracesDir: string
  readonly logsDir: string
  readonly logger: RunLogger

  constructor(readonly runDir: string) {
    this.screenshotsDir = join(runDir, 'screenshots')
    this.videosDir = join(runDir, 'videos')
    this.tracesDir = join(runDir, 'traces')
    this.logsDir = join(runDir, 'logs')
    this.logger = new RunLogger(join(this.logsDir, 'run.log'))
  }

  async prepare(): Promise<void> {
    await mkdir(this.screenshotsDir, { recursive: true })
    await mkdir(this.logsDir, { recursive: true })
  }

  /** 保存步骤截图,返回相对 run 目录的路径(screenshots/xxx.png,统一正斜杠供报告链接使用) */
  async saveStepScreenshot(fileName: string, data: Buffer): Promise<string> {
    await saveScreenshot(this.screenshotsDir, fileName, data)
    return `screenshots/${fileName}`
  }

  /** 保存用例录屏,返回相对 run 目录的路径(videos/xxx.webm) */
  async saveVideo(fileName: string, data: Buffer): Promise<string> {
    await writeVideoFile(this.videosDir, fileName, data)
    return `videos/${fileName}`
  }

  /** 保存用例 trace 包,返回相对 run 目录的路径(traces/xxx.zip) */
  async saveTrace(fileName: string, data: Buffer): Promise<string> {
    await writeTraceFile(this.tracesDir, fileName, data)
    return `traces/${fileName}`
  }

  /** 保存失败用例的运行时诊断(console 尾部/异常/页面栈/systemInfo),返回相对 run 目录的路径 */
  async saveDiagnostics(fileName: string, data: unknown): Promise<string> {
    await mkdir(this.logsDir, { recursive: true })
    await writeFile(join(this.logsDir, fileName), JSON.stringify(data, null, 2), 'utf8')
    return `logs/${fileName}`
  }
}
