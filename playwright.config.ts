import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  reporter: [['list']],
  use: {
    headless: true,
    trace: 'retain-on-failure',
  },
  // e2e 依赖 mock 业务后端(订单接口 + 后台页面)
  webServer: {
    command: 'node examples/mock-backend/server.js',
    port: 8080,
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
