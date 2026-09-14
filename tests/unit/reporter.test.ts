import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { RunSummary } from '@testpilot/core'
import { buildSummaryData, classifyFailure, writeReports, writeSummaryReport } from '@testpilot/reporter'

function summaryFixture(runId: string, status: 'passed' | 'failed'): RunSummary {
  return {
    runId,
    startedAt: '2026-09-11T08:00:00.000Z',
    finishedAt: '2026-09-11T08:00:30.000Z',
    durationMs: 30_000,
    status,
    cases: [
      {
        caseId: 'login',
        caseName: '登录',
        file: 'login.yaml',
        status,
        steps: [
          { index: 0, target: 'web', action: 'navigate', status: 'passed', durationMs: 10 },
          {
            index: 1,
            target: 'web',
            action: 'assert',
            status: status === 'failed' ? 'failed' : 'passed',
            durationMs: 20,
            error:
              status === 'failed'
                ? 'Timeout 15000ms exceeded while waiting for locator(".x")'
                : undefined,
          },
        ],
        startedAt: '2026-09-11T08:00:00.000Z',
        finishedAt: '2026-09-11T08:00:30.000Z',
        durationMs: 30_000,
      },
    ],
    totals: {
      cases: 1,
      passed: status === 'passed' ? 1 : 0,
      failed: status === 'failed' ? 1 : 0,
      steps: 2,
      stepsPassed: status === 'passed' ? 2 : 1,
      stepsFailed: status === 'failed' ? 1 : 0,
      stepsSkipped: 0,
    },
  }
}

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

/** 一个 runs 根目录 + 写入指定 run 的 result.json,返回 runDir */
async function putRun(root: string, id: string, summary?: RunSummary): Promise<string> {
  const runDir = join(root, '.testpilot', 'artifacts', 'runs', id)
  await mkdir(runDir, { recursive: true })
  if (summary) {
    await writeFile(join(runDir, 'result.json'), JSON.stringify(summary), 'utf8')
  }
  return runDir
}

describe('classifyFailure(失败分类)', () => {
  test('断言失败', () => {
    expect(classifyFailure('断言失败:期望包含 "1001",实际为 ""')).toBe('assert')
  })

  test('元素未找到 / 等待超时定位', () => {
    expect(classifyFailure('未找到元素:.submit-btn')).toBe('element')
    expect(classifyFailure('Timeout 15000ms exceeded while waiting for locator(".x")')).toBe('element')
  })

  test('环境 / 连接类', () => {
    expect(classifyFailure('page.goto: net::ERR_CONNECTION_REFUSED')).toBe('env')
    expect(classifyFailure('Failed to launch wechat web devTools')).toBe('env')
  })

  test('Adapter 缺失 / 通用超时 / 其他', () => {
    expect(classifyFailure('未注册 target "miniapp" 的 adapter')).toBe('adapter')
    expect(classifyFailure('wait 需要提供 locator 或 timeout')).toBe('timeout')
    expect(classifyFailure(undefined)).toBe('other')
  })
})

describe('writeReports(单文件交互式报告)', () => {
  test('生成 report.json + 交互式 HTML,含历史趋势与失败分类', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-reporter-'))
    roots.push(root)
    const prevRun = await putRun(root, '20260910-001', summaryFixture('20260910-001', 'failed'))
    void prevRun
    const currentRun = await putRun(root, '20260911-002', summaryFixture('20260911-002', 'failed'))

    const written = await writeReports(currentRun, summaryFixture('20260911-002', 'failed'))

    // report.json:history 不含当前 run;failures 带分类;Case 聚合分类
    const payload = JSON.parse(await readFile(written.json, 'utf8')) as {
      history: Array<{ runId: string; failed: number }>
      failures: Array<{ category: string; caseId: string }>
      summary: { runId: string; cases: Array<{ categories: string[] }> }
    }
    expect(payload.history.map((item) => item.runId)).toEqual(['20260910-001'])
    expect(payload.failures[0]).toMatchObject({ category: 'element', caseId: 'login' })
    expect(payload.summary.cases[0]?.categories).toContain('element')

    // report.html:自包含单文件,内嵌数据 + 趋势 SVG + 分类 chips + 步骤树
    const html = await readFile(written.html, 'utf8')
    expect(html).toContain('report-data')
    expect(html).toContain('<svg')
    expect(html).toContain('失败分类')
    expect(html).toContain('历史趋势')
    expect(html).toContain('20260910-001')
    expect(html).toContain('login')
    expect(html).toContain('details class="case"')
  })

  test('历史聚合上限与时间正序', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-reporter-'))
    roots.push(root)
    for (const id of ['20260910-001', '20260910-002', '20260910-003']) {
      await putRun(root, id, summaryFixture(id, 'passed'))
    }
    const currentRun = await putRun(root, '20260911-001', summaryFixture('20260911-001', 'passed'))

    const written = await writeReports(currentRun, summaryFixture('20260911-001', 'passed'), {
      historyLimit: 2,
    })
    const payload = JSON.parse(await readFile(written.json, 'utf8')) as {
      history: Array<{ runId: string }>
    }
    expect(payload.history.map((item) => item.runId)).toEqual(['20260910-002', '20260910-003'])
  })
})

describe('buildSummaryData + writeSummaryReport(汇总报告)', () => {
  test('聚合 KPI / Flaky 判定 / 平台归集 / 失败分类', () => {
    const runs = [
      { runId: '20260910-001', summary: summaryFixture('20260910-001', 'passed') },
      { runId: '20260910-002', summary: summaryFixture('20260910-002', 'failed') },
    ]
    const data = buildSummaryData(runs)

    expect(data.window.runs).toBe(2)
    expect(data.kpis.executions).toBe(2)
    expect(data.kpis.overallRate).toBeCloseTo(0.5)
    expect(data.kpis.flakyCount).toBe(1)

    const login = data.cases.find((item) => item.caseId === 'login')
    expect(login?.flaky).toBe(true)
    expect(login?.platforms).toEqual(['web'])
    expect(login?.lastCategory).toBe('element')
    expect(data.platforms).toContain('web')
    expect(data.categories.find((item) => item.id === 'element')?.count).toBe(1)
    expect(data.runs.map((item) => item.runId)).toEqual(['20260910-001', '20260910-002'])
  })

  test('writeSummaryReport 落盘 summary.html / summary.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-summary-'))
    const data = buildSummaryData([
      { runId: '20260910-001', summary: summaryFixture('20260910-001', 'passed') },
    ])
    const artifactsDir = join(root, '.testpilot', 'artifacts')
    const written = await writeSummaryReport(artifactsDir, data)

    const html = await readFile(written.html, 'utf8')
    expect(html).toContain('汇总报告')
    expect(html).toContain('Flaky')
    expect(html).toContain('<svg')
    const json = JSON.parse(await readFile(written.json, 'utf8'))
    expect(json.kpis.runs).toBe(1)
  })
})
