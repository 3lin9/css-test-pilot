import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 保存用例录屏(webm),返回文件绝对路径 */
export async function saveVideo(dir: string, fileName: string, data: Buffer): Promise<string> {
  const file = join(dir, fileName)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, data)
  return file
}
