import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 保存 PNG 截图,返回文件绝对路径 */
export async function saveScreenshot(dir: string, fileName: string, data: Buffer): Promise<string> {
  const file = join(dir, fileName)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, data)
  return file
}
