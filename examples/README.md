# 示例

演示资源:mock 业务后端 + 可运行小程序项目 + 一条最小原生 API 用例。

## 快速体验(原生 API 用例)

```bash
# 1. 启动 mock 业务后端(订单接口 + 订单后台页面)
node examples/mock-backend/server.js

# 2. 校验并执行(以 examples/ 为项目根)
cd examples
npx csspilot validate
npx csspilot run tests/e2e/api
npx csspilot report
```

`tests/e2e/api/order-create.test.ts` 是各端原生脚本的最小样例:`node:test` + 全局 `fetch`,文件头注释回链测试点(`// 测试点: TP-001`),清单出处是 `tests/e2e/reviews/order-coverage.md`。Web 端用 `@playwright/test` 写 `tests/e2e/web/*.spec.ts`,小程序端用 `miniprogram-automator` 写 `tests/e2e/miniapp/*.test.ts`,模式相同。

## mock-backend(零依赖)

- `POST /api/orders` 创建订单 → `{ id }`
- `GET /api/orders` 订单列表 → `{ orders: [{ id, status, time }] }`
- `GET /orders` 订单后台页面(Web 端 Playwright 脚本的断言目标)

## miniapp-demo(演示小程序)

可运行的最小小程序项目(游客 appid):点击"提交订单"会 `wx.request` 调用 mock 后端真实下单,订单号渲染在 `.order-id` 元素上(下单前该元素不存在,可验证异步时序)。`project.config.json` 已关闭 urlCheck 以便请求本地后端。

## 运行前提

- API / Web 用例:`node examples/mock-backend/server.js`(默认 8080,`PORT` 可改)
- 小程序用例:本机安装微信开发者工具,登录并开启服务端口(设置 -> 安全设置 -> 服务端口);cli 路径自动探测(环境变量 `WECHAT_DEVTOOLS_CLI` 优先)
