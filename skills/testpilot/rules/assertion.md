# 断言规范

- 断言用各端框架自己的断言:Web 用 `@playwright/test` 的 `expect`(元素断言加 `await`),小程序与 API 用 `node:assert/strict`。
- 断言必须对应真实业务预期(如订单号出现在 Web 后台、状态字段正确),不写恒真断言。
- 断言失败不一定是脚本错误:先看 `result.json` 里的 case error、Web 的 `playwright.json`、截图和 trace,判断是脚本问题还是产品 bug,再决定改脚本还是上报问题。
- 验证“UI 操作只触发一次请求”时,Web 用 Playwright 的请求监听(`page.waitForRequest` / route 统计),小程序在 `wx.request` 封装层计数;不要用页面文案间接推断。
- 请求证据(URL、body 摘要)不要包含 token 等明文凭据。
