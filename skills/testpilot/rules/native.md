# 原生脚本规范

测试清单确定之后,用例正文就是当前端的官方测试脚本。csspilot 不把一份中间格式翻译成各端动作。

| 平台 | 目录与文件 | 框架 | 启动 |
| --- | --- | --- | --- |
| web | `tests/e2e/web/<id>.spec.ts` | `@playwright/test` | `npx playwright test` |
| miniapp | `tests/e2e/miniapp/<id>.test.ts` | `miniprogram-automator` + `node:test` | `node --test` |
| api | `tests/e2e/api/<id>.test.ts` | `node:test` + `fetch` | `node --test` |

`npx csspilot run` 只按上面的目录收集脚本,并调用对应命令。它不生成步骤,也不改写脚本。

## 编写和回归

编写 Web 脚本时用 Playwright MCP 打开被测页,编写小程序脚本时用 wechatide MCP 操作模拟器。确认过的操作写入上表中的脚本。步骤见 `workflows/create-case.md`。

回归只执行这些脚本。`csspilot run` 不调用 MCP,也不重放编写时的会话。

## 重试、过滤与并发

- **重试**:Web 用例默认重试 1 次,重试后通过会被 Playwright 标记 flaky,报告里以警告呈现(不隐藏"第一次就失败"的事实)。设 `TESTPILOT_RETRIES=0` 关闭。小程序 / API 脚本没有用例级重试(node:test 无此机制)。
- **按名过滤**:`npx csspilot run --grep "<pattern>"`(正则)。web 走 Playwright `--grep`;miniapp / api 走 node `--test --test-name-pattern`(文件内的 `before`/`after` 钩子仍会执行)。
- **并发**:api 脚本默认并发 4(`TESTPILOT_API_CONCURRENCY` 可调);小程序脚本串行(开发者工具单实例会话);web 整组交给一个 Playwright 进程,并发度由业务项目 `playwright.config` 的 `workers` 决定。写 api 脚本时不要假设脚本间共享进程状态(并发下各文件独立进程)。

## 文件头

```ts
// 测试点: TP-001
// 视角: charter:error-path
```

视角取值与评审清单一致:`charter:persona`、`charter:edge-input`、`charter:numbers-copy`、`charter:state-recovery`、`charter:error-path`、`charter:inverse`。

## Web

`test` / `expect` 从 `tests/e2e/web/fixtures.ts` 导入,不直接从 `@playwright/test` 导入。该 fixture 由 `csspilot init` / `update` 生成,包装官方 `@playwright/test` 并自动采集浏览器控制台与网络请求,进报告的"控制台 / 网络请求"面板:

```ts
import { test, expect } from './fixtures'
```

定位和断言用 Playwright 自己的 API,例如 `page.getByRole`、`locator.click`、`expect`。不要写成 `action: click`。

失败取证由运行器负责:截图(`--screenshot=on`)与 trace(`--trace=retain-on-failure`)自动保留,无需脚本处理。失败用例在报告中可一键回放:`npx csspilot report --trace`,或 `npx playwright show-trace <trace 文件>` 打开 trace viewer(时间线 + DOM 快照逐帧 + 网络 + 控制台)。

## 小程序

脚本内直接调用 `automator.launch` / `automator.connect`、`miniProgram.reLaunch`、`element.tap`、`miniProgram.mockWxMethod`、`miniProgram.callWxMethod`。项目路径和 CLI 路径从 `MINIAPP_PROJECT_PATH`、`MINIAPP_CLI_PATH` 读取。

开发者工具需已登录,并在设置里打开服务端口。需要打开自动化端口时使用官方命令 `cli auto --project <项目> --auto-port 9420`。`cli auto-replay` 只回放开发者工具里录制的用例,不是这些脚本。

官方文档明示的限制,AI 写脚本最容易踩的坑:

- 等待元素:优先 `page.waitFor(selector)` / `page.waitFor(fn)`(选择器出现、断言函数为真)。毫秒死等只允许前置初始化场景。
- 自定义组件:`page.$` / `page.$$` 无法选择自定义组件内的元素。先取组件 element,再用 `element.$` 逐层进入。
- 取值:`element.attribute` 只取标签特性(字符串)。input 的实际值用 `element.property('value')`。
- 点击与输入:`element.trigger` 只能调用组件的响应方法,无法触发 `tap` / `longpress`。模拟点击用 `element.tap()`,填输入框用 `element.input()`。
- mock:`mockWxMethod` 传函数时函数内无法使用闭包变量(序列化传递),可用 `this.origin` 调原实现。插件方法用 `mockPluginWxMethod`(基础库 >= 2.19.3)。
- 诊断:`miniProgram.on('console')` / `on('exception')` 实时监听;测试失败时把收集到的异常随错误输出。
- 取证:通过和失败的用例各留一张结束时截图,放在 `.testpilot/artifacts/shots/<runId>/`。blocked、inconclusive、skipped 不留。Web 由运行器加 `--screenshot=on`。小程序由运行器在会话关闭前截图,仅模拟器有画面;真机没有这张图。API 没有界面,不截图。报告用 `screenshot` 字段直接打开这张图。
- 版本:基础库 >= 2.7.3,开发者工具 >= 1.02.1907232。

## API

用 `fetch` 访问 `API_BASE_URL`(Server 触发且绑定了环境时,注入的 `TESTPILOT_BASE_URL` 优先)。断言状态码和响应体写在脚本里。响应结构断言给一个最小骨架,避免只断言 200:

```ts
// 结构校验:关键字段存在且类型正确;字段清单写全(多余字段不报错,缺字段必报)
function assertShape(body: unknown): asserts body is { id: number; status: string } {
  assert(typeof body === 'object' && body !== null, '响应体应为对象')
  const b = body as Record<string, unknown>
  assert(typeof b.id === 'number', `id 应为 number,实际 ${JSON.stringify(b.id)}`)
  assert(typeof b.status === 'string', `status 应为 string,实际 ${JSON.stringify(b.status)}`)
}
```

要点:断言失败信息带实际值,报告里才能直接归因;只断言业务真正关心的字段,不要对整个响应做快照(接口加字段就腐烂)。

## 数据与凭据

账号、密码、token 不写进脚本。地址和凭据放 `.env.testing` 或 CI secret。可重复使用的输入放 `tests/e2e/data/` 的 JSON 或 YAML,由脚本读取。

数据复位的标准写法:共享前置在 `before()` 造数,`after()` 复位;不复位的脏数据会污染后续 run 与其他环境。优先用 API 造数与清理,不要用 UI 操作造数(脆弱且慢):

```ts
before(async () => {
  // 造数:API 建立本用例的前置数据,失败要显式 fail(不是 blocked——造不出来测不了)
  const res = await fetch(`${process.env.API_BASE_URL}/test-support/orders`, { method: 'POST', ... })
  assert(res.ok, `造数失败:POST /test-support/orders → ${res.status}`)
})
after(async () => {
  // 复位:清理失败只警告,不改变用例结果
  await fetch(`${process.env.API_BASE_URL}/test-support/orders/${orderId}`, { method: 'DELETE' }).catch(() => undefined)
})
```
