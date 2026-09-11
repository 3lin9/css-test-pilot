# DSL 规范

Case 是 YAML 文件,V0.1 顶层结构:

```yaml
id: order-create      # kebab-case,与文件名一致
name: 用户创建订单      # 人类可读名称
accountRef: test-user # 可选:引用环境凭据,用 ${account.username} 等变量,禁止明文密码
steps:                # 有序步骤列表
  - target: miniapp   # 执行端:miniapp | web | api
    action: click     # 见下方 Action 表
    locator:          # 定位器(见 rules/locator.md)
      text: 提交订单
```

## V0.1 稳定 Action

| action | 用途 | 支持端 | 关键字段 |
| --- | --- | --- | --- |
| `launch` | 启动应用(miniapp) | miniapp | — |
| `navigate` | 打开页面(web) | web, miniapp | `url` |
| `click` | 点击 | web, miniapp | `locator` |
| `input` | 输入 | web, miniapp | `locator`, `value` |
| `select` | 选择 | web | `locator`, `value` |
| `wait` | 等待 | web, miniapp | 条件(以 @testpilot/dsl schema 为准) |
| `assert` | 断言 | web, miniapp, api | `locator`+`expected`(UI)/`expected`(api 响应体包含) |
| `extract` | 提取内容为变量 | web, miniapp, api | `locator`+变量名(UI)/`value`(JSON path)+变量名(api) |
| `screenshot` | 截图取证 | web, miniapp | — |
| `request` | HTTP 请求 | api | `url`, `method`, `headers`, `body`, `expected`(状态码) |

字段定义最终以 `packages/dsl` 的 zod schema 为准;不要使用表中之外的字段。

## api 端(HTTP 接口测试与造数)

`target: api` 走 HTTP 执行端:相对 `url` 按 `testpilot.yaml` 的 `api.baseUrl` 解析。典型用法:API 造数 → UI 操作 → API/JSON 断言的混合编排。

```yaml
id: api-checkout
name: API 下单校验
accountRef: test-user
steps:
  - target: api
    action: request
    url: /api/login
    method: POST
    headers:
      authorization: 'Bearer ${account.token}'
    body:
      username: '${account.username}'
    expected: '200'          # 断言 HTTP 状态码
  - target: api
    action: extract
    value: data.orderId      # 点号 JSON path(数组用下标,如 items.0.id)
    variable: orderId
  - target: api
    action: request
    url: '/api/orders/${orderId}'
  - target: api
    action: assert
    expected: '"status":"PAID"'  # 响应体文本包含
```

## 账号与凭据(accountRef)

- Case 顶层 `accountRef: test-user` 引用凭据,值由运行方注入(Server 环境凭据 / CLI 环境变量),Case 里永远不写明文
- 注入后在 headers/body/url/expected 中用 `${account.username}`、`${account.password}` 等引用(凭据值推荐 JSON 对象)
- 取证与报告对 authorization/cookie 等敏感头自动脱敏,凭据原文不落 Run 结果

## 原则:Action 是通用测试原语,不是业务能力

```text
login / order / payment   ❌ 业务动作不是 Action
click / input / assert    ✓ 由基础 Action 组合表达业务流程
```

登录、下单等业务流程由多个基础 Action 组合而成,不要设计业务 Action。

## 示例

见仓库 `examples/cases/order-create.yaml`(小程序下单 → Web 后台验证的黄金路径)。
