# 原生脚本规范

测试清单确定之后,用例正文就是当前端的官方测试脚本。TestPilot 不把一份中间格式翻译成各端动作。

| 平台 | 目录与文件 | 框架 | 启动 |
| --- | --- | --- | --- |
| web | `tests/e2e/web/<id>.spec.ts` | `@playwright/test` | `npx playwright test` |
| miniapp | `tests/e2e/miniapp/<id>.test.ts` | `miniprogram-automator` + `node:test` | `node --test` |
| api | `tests/e2e/api/<id>.test.ts` | `node:test` + `fetch` | `node --test` |

`npx csspilot run` 只按上面的目录收集脚本,并调用对应命令。它不生成步骤,也不改写脚本。

## 文件头

```ts
// 测试点: TP-001
// 视角: charter:error-path
```

视角取值与评审清单一致:`charter:persona`、`charter:edge-input`、`charter:numbers-copy`、`charter:state-recovery`、`charter:error-path`。

## Web

使用 Playwright 自己的定位和断言,例如 `page.getByRole`、`locator.click`、`expect`。不要写成 `action: click`。

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
- 取证:`miniProgram.screenshot` 仅开发者工具模拟器可用,真机模式无截图。
- 版本:基础库 >= 2.7.3,开发者工具 >= 1.02.1907232。

## API

用 `fetch` 访问 `API_BASE_URL`。断言状态码和响应体写在脚本里。

## 数据与凭据

账号、密码、token 不写进脚本。地址和凭据放 `.env.testing` 或 CI secret。可重复使用的输入放 `tests/e2e/data/` 的 JSON 或 YAML,由脚本读取。
