# 示例

## 跨端黄金路径(order-create.yaml + mock-backend)

`cases/order-create.yaml` 是 Phase 7 的目标场景:**小程序真实下单 → extract 订单号 → Web 后台 assert 该订单**。它验证 csspilot 的核心价值:一套 DSL、两个 Adapter、变量跨端传递(含 locator 变量)。

完整体验:

```bash
# 1. 启动 mock 业务后端(订单接口 + 订单后台页面)
node examples/mock-backend/server.js

# 2. 业务项目里接入 csspilot
npx csspilot init

# 3. csspilot.yaml 参考 examples/csspilot.yaml:
#    web.baseUrl 指向后端、miniapp.projectPath 指向小程序项目(examples/miniapp-demo 可直接用)

# 4. 把 cases/order-create.yaml 复制到业务项目 tests/e2e/cases/ 后执行
npx csspilot validate
npx csspilot run
npx csspilot report
```

## 演示小程序(miniapp-demo/)

可运行的最小小程序项目(游客 appid):点击"提交订单"会 `wx.request` 调用 mock 后端真实下单,订单号渲染在 `.order-id` 元素上(下单前该元素不存在,可直接用 wait/extract 验证异步时序)。`project.config.json` 已关闭 urlCheck 以便请求本地后端。

## 运行前提

- 本机安装微信开发者工具,登录并开启服务端口(设置 -> 安全设置 -> 服务端口)
- cli 路径不需要配置:csspilot 按 环境变量 `WECHAT_DEVTOOLS_CLI` → 常见安装位置 → 各盘符 Tencent 目录 → 注册表 的顺序自动探测

小程序端变量通过 `extract` 存入 ExecutionContext,后续 `target: web` 的步骤用 `${orderId}` 引用(url、value、expected、locator 均支持),实现跨端数据衔接。
