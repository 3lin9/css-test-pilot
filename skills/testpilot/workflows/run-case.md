# Workflow:执行测试

```bash
npx csspilot run
npx csspilot run tests/e2e/web/order-create.spec.ts
npx csspilot run tests/e2e/miniapp
npx csspilot run tests/e2e/api/create-order.test.ts
```

这次执行的是已写好的脚本。编写阶段的 Playwright MCP / wechatide MCP 会话不在这里重放。

`run` 在启动框架前做与 `csspilot validate` 相同的轻量预检:文件头测试点与视角、reviews 清单出处、`process.env` 已声明。任一不过就退出,不调用 Playwright 或 `node --test`。完整输出仍用 `npx csspilot validate`。

`csspilot run` 按目录把脚本交给当前端的框架:

- `tests/e2e/web` → `npx playwright test`
- `tests/e2e/miniapp` 与 `tests/e2e/api` → `node --test`

被测服务、页面和小程序开发者工具需要先就绪。地址和凭据来自 shell、CI secrets 或 `.env.testing`。

run 结束后 ingest 归一各端结构化输出写入 run 目录 `result.json`,打印 totals 行并按三态退出:`0` 通过/跳过,`1` 产品失败或证据不足(inconclusive),`2` 环境阻塞(blocked,非产品回归)。CI 对 1 和 2 都判失败,2 分流到环境排查。
