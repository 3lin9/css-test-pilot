import { basename } from 'node:path'

const INVALID = /[<>:"/\\|?*\u0000-\u001f]/g

/**
 * 同一脚本里同名用例按出现顺序编号。
 * 运行器钩子和 ingest 必须用同一规则,文件名才能对上。
 */
export function createShotNamer() {
  const counts = new Map()
  return (scriptFile, rowId) => {
    const base = basename(scriptFile).replace(/\.[^.]+$/, '')
    const raw = `${base}--${rowId}`.replace(INVALID, '_').slice(0, 140)
    const n = (counts.get(raw) ?? 0) + 1
    counts.set(raw, n)
    const stem = n === 1 ? raw : `${raw}--${n}`
    return `${stem}.png`
  }
}
