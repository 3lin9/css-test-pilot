import { expect, test } from 'vitest'
import { resolveRunEnvironment } from './run-environment'

test('uses the configured default environment and exposes its base URL to test scripts', () => {
  const result = resolveRunEnvironment({
    casesDir: 'tests/e2e',
    environment: {
      default: 'test',
      test: { baseUrl: 'http://localhost:8080' },
      staging: { baseUrl: 'https://staging.example.com' },
    },
  })

  expect(result).toEqual({
    name: 'test',
    extraEnv: {
      TESTPILOT_ENV: 'test',
      TESTPILOT_BASE_URL: 'http://localhost:8080',
      TEST_BASE_URL: 'http://localhost:8080',
    },
  })
})

test('an explicit environment overrides the configured default', () => {
  const result = resolveRunEnvironment(
    {
      casesDir: 'tests/e2e',
      environment: {
        default: 'test',
        test: { baseUrl: 'http://localhost:8080' },
        staging: { baseUrl: 'https://staging.example.com' },
      },
    },
    'staging',
  )

  expect(result?.extraEnv.TESTPILOT_BASE_URL).toBe('https://staging.example.com')
})

test('rejects unknown environments and unresolved base URL references', () => {
  const config = {
    casesDir: 'tests/e2e',
    environment: {
      default: 'test',
      test: { baseUrl: '${MISSING_BASE_URL}' },
    },
  }

  expect(() => resolveRunEnvironment(config, 'production')).toThrow(/未在 testpilot\.yaml 中定义/)
  expect(() => resolveRunEnvironment(config)).toThrow(/未设置的环境变量/)
})

test('does not inject an environment when no selection or default is configured', () => {
  expect(resolveRunEnvironment({ casesDir: 'tests/e2e' })).toBeUndefined()
})
