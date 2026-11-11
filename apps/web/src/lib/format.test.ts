import { expect, test } from 'vitest'
import { formatDuration, formatSize, formatTime, shortCommit } from './format'

test('formatDuration:空值与毫秒/秒分界', () => {
  expect(formatDuration(null)).toBe('-')
  expect(formatDuration(undefined)).toBe('-')
  expect(formatDuration(0)).toBe('0ms')
  expect(formatDuration(860)).toBe('860ms')
  expect(formatDuration(1000)).toBe('1.0s')
  expect(formatDuration(15500)).toBe('15.5s')
})

test('formatTime:空值返回占位,ISO 转本地时区展示', () => {
  expect(formatTime(null)).toBe('-')
  expect(formatTime('')).toBe('-')
  expect(formatTime('2026-11-11T00:00:00Z')).toMatch(/2026/)
})

test('shortCommit:取 7 位,空值占位', () => {
  expect(shortCommit('6da067cabc1234')).toBe('6da067c')
  expect(shortCommit(undefined)).toBe('-')
  expect(shortCommit('')).toBe('-')
})

test('formatSize:B/KB/MB 分档', () => {
  expect(formatSize(512)).toBe('512B')
  expect(formatSize(2048)).toBe('2.0KB')
  expect(formatSize(5 * 1024 * 1024)).toBe('5.0MB')
})
