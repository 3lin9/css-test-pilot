import { describe, expect, test } from 'vitest'
import { diffLines, extractAssertionDiff, renderAssertionDiffHtml } from '@testpilot/reporter'

const escapeHtml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

describe('extractAssertionDiff(失败断言提取)', () => {
  test('Playwright expect 单行形态(toBe)', () => {
    const error = [
      'Error: expect(received).toBe(expected) // Object.is equality',
      '',
      'Expected: "登录成功"',
      'Received: "登录失败"',
      '',
      'Call log:',
      '  - expect.toHaveText with timeout 5000ms',
    ].join('\n')
    expect(extractAssertionDiff(error)).toEqual({ expected: '登录成功', received: '登录失败' })
  })

  test('Playwright expect 多行文本(引号内换行)', () => {
    const error = 'Expected: "line1\nline2"\nReceived: "line1\nline3"\n\nCall log:'
    expect(extractAssertionDiff(error)).toEqual({ expected: 'line1\nline2', received: 'line1\nline3' })
  })

  test('Playwright 对象形态(JSON 串不带引号剥离)', () => {
    const error = 'Expected: {"a": 1}\nReceived: {"a": 2}\n\n  8 | await expect(...) '
    expect(extractAssertionDiff(error)).toEqual({ expected: '{"a": 1}', received: '{"a": 2}' })
  })

  test('node:test assert 单行形态', () => {
    const error = "Expected values to be strictly equal:\n100 !== 99\n\n    at Test.<anonymous>"
    expect(extractAssertionDiff(error)).toEqual({ expected: '100', received: '99' })
  })

  test('无结构的失败(timeout / 元素未找到)返回 undefined', () => {
    expect(extractAssertionDiff(undefined)).toBeUndefined()
    expect(extractAssertionDiff('Timeout 15000ms exceeded while waiting for locator(".x")')).toBeUndefined()
    expect(extractAssertionDiff('page.goto: net::ERR_CONNECTION_REFUSED')).toBeUndefined()
  })
})

describe('diffLines(行级 LCS)', () => {
  test('差异行标记为 del/add,公共行为 same', () => {
    const lines = diffLines('a\nb\nc', 'a\nx\nc')
    expect(lines).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'x' },
      { type: 'same', text: 'c' },
    ])
  })

  test('单侧独有行成块追加', () => {
    const lines = diffLines('only-expected', 'l1\nl2\nl3')
    expect(lines.filter((line) => line.type === 'del')).toEqual([{ type: 'del', text: 'only-expected' }])
    expect(lines.filter((line) => line.type === 'add').map((line) => line.text)).toEqual(['l1', 'l2', 'l3'])
  })
})

describe('renderAssertionDiffHtml(报告对比块)', () => {
  test('渲染红删绿加表格', () => {
    const html = renderAssertionDiffHtml('Expected: "¥100"\nReceived: "¥99"', escapeHtml)
    expect(html).toContain('class="diff"')
    expect(html).toContain('断言对比')
    expect(html).toContain('<tr class="d-del">')
    expect(html).toContain('<tr class="d-add">')
    expect(html).toContain('¥100')
    expect(html).toContain('¥99')
  })

  test('HTML 值被转义,不产生注入面', () => {
    const html = renderAssertionDiffHtml('Expected: "<script>alert(1)</script>"\nReceived: "safe"', escapeHtml)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  test('两侧一致或无法提取时返回空串(报告回退 error 原文)', () => {
    expect(renderAssertionDiffHtml(undefined, escapeHtml)).toBe('')
    expect(renderAssertionDiffHtml('Timeout 15000ms exceeded', escapeHtml)).toBe('')
    const same = renderAssertionDiffHtml('Expected: "x"\nReceived: "x"', escapeHtml)
    expect(same).toBe('')
  })
})
