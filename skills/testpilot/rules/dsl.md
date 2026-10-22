# DSL 规范

Case 是 YAML 文件,顶层结构:

```yaml
id: order-create      # kebab-case,与文件名一致
name: 用户创建订单      # 人类可读名称
accountRef: test-user # 可选:引用环境凭据,用 ${account.username} 等变量,禁止明文密码
fixtures:             # 可选:项目相对路径,仅允许 tests/e2e/data 下的 YAML/JSON
  - tests/e2e/data/products.yaml
datasets:             # 可选:同一 steps 按对象数组逐行执行
  file: tests/e2e/data/checkout-rows.yaml
  idField: id
requires:             # 可选:逐行执行前的静态依赖契约
  - fixture.product.styleNo
  - dataset.expectedTotal
  - variable.ppmProjectId
setup:                # 可选:主步骤前执行
  - target: api
    action: request
    url: /test-support/cart/clear
steps:                # 有序步骤列表
  - target: miniapp   # 执行端:miniapp | web | api
    action: click     # 见下方 Action 表
    locator:          # 定位器(见 rules/locator.md)
      text: 提交订单
teardown:             # 可选:setup 开始后始终执行
  - target: api
    action: request
    url: /test-support/cart
    method: DELETE
```

## Action 总表

### 通用与 UI 基础

| action | 用途 | 支持端 | 关键字段 |
| --- | --- | --- | --- |
| `launch` | 启动应用 | web, miniapp | — |
| `navigate` | 打开页面(miniapp 为小程序路由 reLaunch) | web, miniapp | `url` |
| `click` | 点击 | web, miniapp | `locator` |
| `longpress` | 长按(小程序原生;web 以按住 ~600ms 近似) | web, miniapp | `locator` |
| `input` | 输入 | web, miniapp | `locator`, `value` |
| `select` | 下拉选择(小程序 picker 暂不支持) | web | `locator`, `value` |
| `wait` | 等待元素出现或等待毫秒 | web, miniapp | `locator` 或 `timeout` |
| `screenshot` | 截图取证 | web, miniapp | — |

### 断言与提取

| action | 用途 | 支持端 | 关键字段 |
| --- | --- | --- | --- |
| `assert` | 断言,见下方四种模式 | web, miniapp, api | 见下 |
| `extract` | 提取内容为变量(UI 元素文本 / api JSON path) | web, miniapp, api | `locator` 或 `value`(api),`variable` |

`assert` 的四种模式(互斥,一套步骤只能选一种):

```yaml
# 1) 文本断言(缺省):元素文本包含 expected
- target: miniapp
  action: assert
  locator: { css: ".order-id" }
  expected: "${orderId}"

# 2) 页面 data 断言(dataPath,仅 miniapp):页面 data 路径的值包含 expected
- target: miniapp
  action: assert
  dataPath: status
  expected: expired

# 3) 属性断言(attribute web/miniapp;property 仅 miniapp):String(值) 与 expected 全等
- target: miniapp
  action: assert
  locator: { css: ".submit-btn" }
  attribute: disabled        # 或 property: status(自定义组件实例属性)
  expected: "true"           # 属性不存在时实际值为 <absent>

# 4) 数量断言(count):匹配元素的精确数量,0 即"元素不存在";不需要 expected
- target: miniapp
  action: assert
  locator: { css: ".cart-item" }
  count: 3
```

### 网络断言与 API 端

| action | 用途 | 支持端 | 关键字段 |
| --- | --- | --- | --- |
| `request` | HTTP 请求(可断言状态码) | api | `url`, `method`, `headers`, `body`, `expected`(状态码) |

`expectRequests` 可附在 web/miniapp 的 `navigate`、`click`、`input`、`select` 上做请求次数精确断言(只观察不拦截),见下文。

### 小程序深度测试(仅 miniapp)

| action | 用途 | 关键字段 |
| --- | --- | --- |
| `callMethod` | 调用 Page 方法(locator 缺省)或组件实例方法(提供 locator) | `methodName`, `args`, `locator`(可选) |
| `setData` | 写入页面 data(locator 缺省)或组件 data(提供 locator)补丁,驱动 onShow/onPullDownRefresh 等真实链路 | `patch`, `locator`(可选) |
| `trigger` | 对组件注入事件(如 `getphonenumber` + 空 detail = 用户拒绝授权分支) | `locator`, `eventType`, `detail` |
| `mockWxApi` | 拦截 wx.* API 返回 mock 值;`capture` 记录真实调用参数到变量(`${<capture>.options}` / 列表),step 结束自动恢复 | `wxApi`, `result`, `capture` |
| `callWxApi` | 主动调用 wx.* API 造前置状态(如 `setStorageSync` 写登录态、`clearStorageSync` 制造未授权设备);返回值可用 `variable` 捕获 | `wxApi`, `args`, `variable` |
| `touch` | 派发触摸事件(自定义手势组件) | `locator`, `phase`(touchstart/touchmove/touchend), `touches` |
| `scroll` | 滚动 scroll-view 元素(提供 locator)或页面(缺省) | `scrollTop`, `locator`(可选) |
| `swipeTo` | swiper 切到指定页 | `locator`, `index` |
| `slideTo` | slider 滑到指定值 | `locator`, `value`(数字) |
| `moveTo` | movable-view 移动到坐标 | `locator`, `x`, `y` |

示例:mock 后端响应驱动分支 + 断言页面状态机(不需要后端造数):

```yaml
steps:
  - target: miniapp
    action: launch
  # mock wx.request 使登录接口返回 needPhoneAuth,直接进入待授权分支
  - target: miniapp
    action: mockWxApi
    wxApi: request
    result: { needPhoneAuth: true }
  - target: miniapp
    action: navigate
    url: /pages/login/index
  - target: miniapp
    action: assert
    dataPath: status
    expected: ready
  # 绕过原生授权弹窗,注入"用户拒绝"事件
  - target: miniapp
    action: trigger
    locator: { css: ".login-btn" }
    eventType: getphonenumber
    detail: { code: "" }
  - target: miniapp
    action: assert
    locator: { css: ".toast" }
    expected: 重新选择
```

示例:callWxApi 造"未授权设备"前置 + 数量断言:

```yaml
steps:
  - target: miniapp
    action: launch
  - target: miniapp
    action: callWxApi
    wxApi: clearStorageSync      # 制造未授权前置,替代"换设备"
  - target: miniapp
    action: navigate
    url: /pages/list/index
  - target: miniapp
    action: assert
    locator: { css: ".list-item" }
    count: 0                     # 未授权时列表为空
```

字段定义最终以 `packages/dsl` 的 zod schema 为准;不要使用表中之外的字段。

## Data-driven、fixture 与 variables

- fixture 文件根必须是对象;多个文件按顺序深合并,字段冲突直接校验失败。
- dataset 文件根必须是对象数组;`idField` 默认 `id`,每行值必须非空且唯一。
- 每个数据行有独立 ExecutionContext,同一 Case 的行之间不能共享 extract 变量。
- 可用作用域:
  - `${fixture.*}`:合并后的共享 fixture
  - `${dataset.*}`:当前数据行
  - `${account.*}`:`accountRef` 对应凭据
  - `${variable.*}`:`testpilot.yaml variables` 白名单
  - `${name}`:之前 `extract` 产生的运行时变量(含 `callWxApi` 的 `variable` 捕获)
- 禁止 `${env.*}` 或其他方式任意读取进程环境变量。

`requires` 只检查路径存在且不是 `null`、空字符串或未解析的 `${ENV_VAR}`。缺失时该行不执行任何阶段,结果为 `skipped`,原因 `dependency-not-ready`。

## setup / steps / teardown

执行顺序固定:

1. `requires` 预检
2. `setup`
3. `steps`
4. `teardown`

setup 失败时主结果 failed、跳过主步骤并执行 teardown;主步骤失败也执行 teardown。teardown 失败记 warning,不改变主结果。

## UI 请求次数断言

`expectRequests` 可附在 web/miniapp 的 `navigate`、`click`、`input`、`select`:

```yaml
- target: web
  action: click
  locator:
    css: .submit
  expectRequests:
    - method: POST
      urlContains: /api/orders
      count: 1
      windowMs: 1000
```

它只观察并计数,不拦截、不修改响应。断言失败时报告实际次数和已脱敏的匹配 URL。小程序端通过临时 mock `wx.request` 实现,step 结束自动恢复。

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

登录、下单等业务流程由多个基础 Action 组合而成,不要设计业务 Action。小程序深度 action(callMethod/setData/mockWxApi 等)同样只表达测试原语——驱动页面、注入事件、拦截 API——不封装业务语义。

## 示例

- 仓库 `examples/cases/order-create.yaml`:小程序下单 → Web 后台验证的跨端黄金路径
- 仓库 `examples/cases/miniapp-deep.yaml`:小程序深度测试全景(mock/trigger/dataPath/count/longpress/scroll 等)
