# 微信小程序测试能力与边界

> 本文说明 csspilot 原生链路下小程序端的执行模型、CI 无人值守前置条件,以及明确不做的范围。脚本写法与官方 API 的坑位清单见 `skills/testpilot/rules/native.md`;能力定义以 `miniprogram-automator` 官方文档为准。

## 一、执行模型

小程序用例是**业务项目里的普通 node:test 脚本**(`tests/e2e/miniapp/<id>.test.ts`),`npx csspilot run` 逐文件以 `node --import <截图钩子> --test` 启动,不翻译步骤、不代理会话。脚本内直接调用官方 API:

| 能力 | 官方 API | 说明 |
| --- | --- | --- |
| 启动 / 连接开发者工具 | `automator.launch` / `automator.connect` | 项目路径、CLI 路径从 `MINIAPP_PROJECT_PATH`、`MINIAPP_CLI_PATH` 读取;`cli auto --project <项目> --auto-port 9420` 打开自动化端口后可 connect 连已有实例 |
| 页面路由 | `miniProgram.reLaunch` / `page.waitFor` | 就绪等待优先 `page.waitFor(selector)`,不用毫秒死等 |
| 交互 | `element.tap` / `element.input` / `element.longpress` / `element.trigger` | `trigger` 只能调组件方法,模拟点击用 `tap` |
| 取值与断言 | `element.property('value')` / `element.attribute` / `page.data(path)` | input 的实际值用 `property`,attribute 只取标签特性 |
| wx.* mock | `miniProgram.mockWxMethod` / `restoreWxMethod` | 拦截 `wx.request` 消除后端依赖;传函数时无法用闭包变量(序列化传递),用 `this.origin` 调原实现 |
| wx.* 主动调用 | `miniProgram.callWxMethod` | `setStorageSync` 写登录态、`clearStorageSync` 制造"未授权设备"前置 |
| 原生授权弹窗 | `miniProgram.native().authorizeAllow / authorizeCancel` | 只操作开发者工具授权层,不产生可换真实手机号的 code |
| 诊断 | `miniProgram.on('console')` / `on('exception')` | 失败时把收集到的异常随错误输出,进 TAP → 归一进 result.json |

与 DSL 时代的差异(迁移注意):

- **没有中间翻译层**:等待、重连、就绪轮询都是脚本自己的责任;官方 automator 的超时异常直接暴露给用例。
- **没有 `expectRequests` 声明式请求计数**:需要精确计数时在脚本里用 `mockWxMethod` 包一层计数器并透传原实现(`this.origin`)。
- **没有 adapter 自动诊断落盘**:console/exception 靠脚本 `on(...)` 监听;截图由运行器注入的钩子自动完成(通过/失败各留一张,落 `.testpilot/artifacts/shots/<runId>/`,仅模拟器有画面,真机没有)。

## 二、CI 无人值守的前置条件

小程序自动化的前提是本机微信开发者工具处于**已登录**状态且**服务端口开启**(设置 → 安全设置 → 服务端口)。CI 环境要特别关注登录态:

1. **登录态、服务端口和游客 appid 会阻断小程序 run**:`npx csspilot doctor` 会检查 CLI、`cli islogin` 和 `project.config.json` 的 appid;未登录、无法确认服务端口、缺少真实 appid 或 `touristappid` 直接报错,不要等到自动化端口超时。
2. **登录态过期是 CI 全线失败的常见根因**:工具登录态长期有效但会因改密等事件失效,失效后所有用例连接失败。建议:
   - CI runner 首次配置时人工扫码 `cli login`,此后保持工具定期运行;
   - 官方 automator 提供 `getTicket` / `setTicket` / `refreshTicket` 票据接口,可用于跨机器迁移登录票据;csspilot 不封装票据管理,保持人工/脚本维护;
   - run 大面积连接失败时,先查 doctor 的登录态项。
3. **首次连接授权**:安全端口开启后,自动化客户端首次连接可能需要在工具内确认授权;CI 环境请预先完成一次人工连接。

## 三、明确不做(能力边界)

| 范围 | 说明 |
| --- | --- |
| 真机自动化 | 官方 automator 的 `remote`(真机调试)能力为**远期选项**,当前仅支持模拟器。扫码、支付、多手机号选择等仍保持人工 |
| 发布 / 预览类 | 推送手机预览、生成预览二维码、上传体验版属于发布流程,不属于测试基础设施 |
| 体验评分(`stopAudits`) | 属于质量评估而非业务测试 |
| 插件 API mock(`mockPluginWxMethod` 系列) | 用到插件的项目出现需求后再考虑(基础库 >= 2.19.3 时脚本可直接调用) |

## 四、已知约束

- **Skyline 渲染器**:工具在 Skyline 下页面元数据注册晚于 webview,偶发"页面未就绪"类错误;不稳定的工具版本建议临时切 webview 渲染跑 e2e。
- **text locator**:小程序 WXML 无法按文案查询,仅支持 css(class/id)。
- **picker 交互**:暂无专门 API,用 `element.tap` 完成选择。
- **测试间运行时状态**:连接与页面栈 / storage / 授权态等运行时状态是否隔离,由脚本的连接生命周期决定(如 `beforeAll` 建连、`afterAll` 断开);需要干净前置时在脚本内用 `callWxMethod`(`clearStorageSync`)显式制造。
- **单实例约束**:开发者工具同一项目同一时刻是一个自动化会话,csspilot 对小程序脚本保持串行执行(API 端脚本无此约束,可并发)。
