import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { TestCase } from '@testpilot/dsl'
import {
  buildReadyCertificate,
  readReadyCertificate,
  validateReadyCertificate,
  writeReadyCertificate,
} from '../../packages/sdk/src/ready'

const testCase: TestCase = {
  id: 'checkout',
  name: '提交订单',
  environment: 'test',
  steps: [
    {
      target: 'web',
      action: 'click',
      locator: { testId: 'submit-order' },
    },
  ],
}

describe('Ready Certificate', () => {
  test('写入后可读取且相同输入验证通过', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-ready-'))
    const certificate = await buildReadyCertificate({
      root,
      file: join(root, 'tests/e2e/cases/checkout.yaml'),
      data: testCase,
      config: { casesDir: 'tests/e2e/cases' },
      datasetRows: [{ dataset: { id: 'row-1' } }],
      evidence: {
        pageStateHashes: { 'web:/checkout': 'state-1' },
        verifiedLocators: [],
      },
    })
    await writeReadyCertificate(root, certificate)

    await expect(readReadyCertificate(root, 'checkout')).resolves.toEqual(certificate)
    await expect(
      validateReadyCertificate(root, certificate, {
        file: join(root, 'tests/e2e/cases/checkout.yaml'),
        data: testCase,
        config: { casesDir: 'tests/e2e/cases' },
        datasetRows: [{ dataset: { id: 'row-1' } }],
      }),
    ).resolves.toEqual([])
  })

  test('Case 或数据变化会使证书失效', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-ready-stale-'))
    const certificate = await buildReadyCertificate({
      root,
      file: 'checkout.yaml',
      data: testCase,
      config: { casesDir: 'cases' },
      datasetRows: [{ dataset: { id: 'row-1' } }],
      evidence: { pageStateHashes: {}, verifiedLocators: [] },
    })
    const issues = await validateReadyCertificate(root, certificate, {
      file: 'checkout.yaml',
      data: { ...testCase, name: '已修改' },
      config: { casesDir: 'cases' },
      datasetRows: [{ dataset: { id: 'row-2' } }],
    })
    expect(issues).toEqual(expect.arrayContaining(['case-hash-mismatch', 'dataset-hash-mismatch']))
  })
})
