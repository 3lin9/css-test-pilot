import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 保存 Playwright trace 压缩包(zip),返回文件绝对路径;`npx playwright show-trace <file>` 查看 */
export async function saveTrace(dir: string, fileName: string, data: Buffer): Promise<string> {
  const file = join(dir, fileName)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, data)
  return file
}
