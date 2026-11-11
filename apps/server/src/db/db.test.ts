import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import Database from 'better-sqlite3'
import { defaultDbPath, migrateLegacyDatabase, openDatabase } from './index'

/** drizzle 实例的底层 better-sqlite3 连接(测试里直接执行/关闭) */
function clientOf(db: unknown): Database.Database {
  return (db as { $client: Database.Database }).$client
}

describe('server:db', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'testpilot-db-'))
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('默认位置在用户主目录 ~/.testpilot,不在业务项目内', () => {
    const p = defaultDbPath()
    expect(p).toBe(join(homedir(), '.testpilot', 'server.db'))
  })

  test('schema 版本不匹配:备份旧库文件后重建,旧数据完整留档', () => {
    const file = join(dir, 'server.db')
    // 手工造一个旧版本库并写入数据
    const old = new Database(file)
    old.exec('CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT)')
    old.prepare('INSERT INTO runs (id, status) VALUES (?, ?)').run('20260101-001', 'passed')
    old.pragma('user_version = 1')
    old.close()

    const db = openDatabase({ dbPath: file })
    // 旧数据所在的整库文件被留档
    const backups = readdirSync(dir).filter((f) => f.includes('.bak-v'))
    expect(backups).toHaveLength(1)
    const backupDb = new Database(join(dir, backups[0]), { readonly: true })
    const preserved = backupDb.prepare('SELECT status FROM runs WHERE id = ?').get('20260101-001')
    expect(preserved).toMatchObject({ status: 'passed' })
    backupDb.close()
    // 新库结构可用
    expect(existsSync(file)).toBe(true)
    clientOf(db).exec('SELECT 1')
    clientOf(db).close()
  })

  test('同版本重复打开:不产生备份', () => {
    const file = join(dir, 'server.db')
    clientOf(openDatabase({ dbPath: file })).close()
    clientOf(openDatabase({ dbPath: file })).close()
    expect(readdirSync(dir).filter((f) => f.includes('.bak-v'))).toHaveLength(0)
  })

  test('legacy 迁移:项目内旧库搬到目标位置,原文件改名 .migrated;目标已存在时不覆盖', () => {
    const legacyDir = join(dir, 'proj', '.testpilot')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'server.db'), 'legacy-data')
    const target = join(dir, 'home', '.testpilot', 'server.db')

    migrateLegacyDatabase(join(dir, 'proj'), target)

    expect(existsSync(target)).toBe(true)
    expect(existsSync(`${join(legacyDir, 'server.db')}.migrated`)).toBe(true)

    // 目标已存在时不覆盖
    writeFileSync(target, 'newer-data')
    migrateLegacyDatabase(join(dir, 'proj'), target)
    expect(readFileSync(target, 'utf8')).toBe('newer-data')
  })
})
