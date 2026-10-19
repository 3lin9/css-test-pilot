import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { TestPilotError } from '@testpilot/core'
import { loadCaseDataFile } from '@testpilot/sdk'

test('loadCaseDataFile:数据文件不存在 → FIXTURE_MISSING', async () => {
  const root = await mkdtemp(join(tmpdir(), 'testpilot-sdk-'))
  await mkdir(join(root, 'data'))
  try {
    await loadCaseDataFile('data/missing.json', { root, dataDir: join(root, 'data') })
    expect.unreachable()
  } catch (err) {
    expect(err).toBeInstanceOf(TestPilotError)
    expect((err as TestPilotError).code).toBe('FIXTURE_MISSING')
  }
})
