# 微信小程序测试能力与边界

> 本文对照微信官方自动化能力(miniprogram-automator 的 MiniProgram / Element API、开发者工具工具链 Skills),说明 TestPilot 当前的小程序测试能力面、CI 无人值守的前置条件,以及明确不做的范围。能力定义以 `@testpilot/adapter-core` 的 `TestAdapter` 可选能力与 `@testpilot/dsl` schema 为准。

## 一、能力面(对照官方 API)

### 会话与导航

| 能力 | DSL / 行为 | 官方对应 |
| --- | --- | --- |
| 启动开发者工具并连接 | `launch`(自动发现 cli;`cli auto` 失败时降级自行拉起) | `automator.launch` / `automator.connect` |
| 页面路由 | `navigate url`(reLaunch + 就绪等待) | `miniProgram.reLaunch` |
| 断线重连 | 模拟器重编译断开 ws 后自动重连重试 | —(TestPilot 增强) |

### 交互与断言

| 能力 | DSL | 官方对应 |
| --- | --- | --- |
| 点击 / 输入 | `click` / `input` | `element.tap` / `element.input` |
| 长按 | `longpress`(web 端以按住 ~600ms 的 click 近似) | `element.longpress` |
| 注入事件 | `trigger` + `eventType` + `detail`(绕过原生弹窗驱动分支) | `element.trigger` |
| 触摸手势 | `touch` + `phase` + `touches` | `element.touchstart/touchmove/touchend` |
| 受控组件驱动 | `scroll`(scroll-view/页面)、`swipeTo`(swiper)、`slideTo`(slider)、`moveTo`(movable-view) | `element.scrollTo/swipeTo/slideTo/moveTo`、`miniProgram.pageScrollTo` |
| 文本断言 / 提取 | `assert` / `extract`(数据绑定未完成时自动轮询) | `element.text` |
| 页面 data 断言 / 读取 | `assert dataPath`(与 locator 互斥) | `page.data(path)` |
| 属性断言 | `assert attribute`(web/miniapp)、`assert property`(仅 miniapp 自定义组件实例属性) | `element.attribute` / `element.property` |
| 存在性 / 计数断言 | `assert count`(0 即"元素不存在";负向断言只等短 settle 窗口) | `page.$$` |
| 页面 / 组件方法 | `callMethod`(locator 缺省为页面级) | `page.callMethod` / `element.callMethod` |
| 页面 / 组件 data 写入 | `setData`(locator 缺省为页面级) | `page.setData` / `element.setData` |

### wx.* API 层

| 能力 | DSL | 官方对应 | 典型用途 |
| --- | --- | --- | --- |
| mock 并捕获 | `mockWxApi`(`result` + `capture`;step 结束自动恢复) | `miniProgram.mockWxMethod` / `restoreWxMethod` | 拦截 `wx.request` 消除后端造数依赖;捕获 `wx.showModal` 文案断言 |
| 主动调用 | `callWxApi`(`variable` 可捕获返回值) | `miniProgram.callWxMethod` | `setStorageSync` 写登录态、`clearStorageSync` 制造"未授权设备"前置 |
| 请求次数断言 | `expectRequests`(临时 mock `wx.request` 计数,自动恢复) | 同上 | 交互触发的网络请求精确次数 |

### 运行时取证(失败时自动落盘)

Case 失败时,adapter 会把以下诊断写入 `runs/<runId>/logs/diagnostics-<case>-miniapp.json`,并在 `CaseResult.diagnostics` 记录路径:

- **console 尾部**:订阅 automator `console` 事件,环形缓冲最近 200 条(含 error/warn)
- **appservice 异常**:automator `exception` 事件
- **页面栈**:`miniProgram.pageStack()`
- **系统信息**:`miniProgram.systemInfo()`(SDK 版本 / 平台 / 像素比,用于区分"环境差异"与"代码缺陷")

## 二、CI 无人值守的前置条件

小程序自动化的前提是本机微信开发者工具处于**已登录**状态且**服务端口开启**(设置 → 安全设置 → 服务端口)。CI 环境要特别关注登录态:

1. **`npx csspilot doctor` 会检查**:CLI 是否可发现、`cli islogin` 登录态、`project.config.json` 的 appid 是否缺失或为 `touristappid`(游客模式会受限)。登录态问题以 warning 呈现,不阻塞其他检查。
2. **登录态过期是 CI 全线失败的常见根因**:工具登录态长期有效但会因改密等事件失效,失效后所有 Case 连接失败。建议:
   - CI runner 首次配置时人工扫码 `cli login`,此后保持工具定期运行;
   - 官方 automator 提供 `getTicket` / `setTicket` / `refreshTicket` 票据接口,可用于跨机器迁移登录票据(需要从已登录机器导出);TestPilot 暂不封装票据管理,保持人工/脚本维护;
   - run 大面积 `ENVIRONMENT_UNAVAILABLE` / 连接失败时,先查 doctor 的登录态项。
3. **首次连接授权**:安全端口开启后,自动化客户端首次连接可能需要在工具内确认授权;CI 环境请预先完成一次人工连接。

## 三、明确不做(能力边界)

| 范围 | 说明 |
| --- | --- |
| 真机自动化 | 官方 automator 的 `remote`(真机调试)能力为**远期选项**,当前仅支持模拟器;原生弹窗、扫码、支付等真机专属场景保持人工 |
| 发布 / 预览类 | 推送手机预览、生成预览二维码、上传体验版属于发布流程,不属于测试基础设施 |
| `evaluate` 任意代码 | 破坏 Case 的声明式可审计性,不开放;storage / 前置状态场景用 `callWxApi` 表达 |
| 体验评分(`stopAudits`) | 属于质量评估而非业务测试 |
| 插件 API mock(`mockPluginWxMethod` 系列) | 用到插件的项目出现需求后再立项 |
| `functionDeclaration` 动态 mock | 任意 JS 破坏可审计性;静态 `result` 覆盖现有场景 |

## 四、已知约束

- **Skyline 渲染器**:工具在 Skyline 下页面元数据注册晚于 webview,偶发"页面未就绪"类错误;不稳定的工具版本建议临时切 webview 渲染跑 e2e。
- **text locator**:小程序 WXML 无法按文案查询,仅支持 css(class/id)。
- **select**:picker 交互暂不支持,用 `click` 完成选择。
- **Case 间运行时状态**:ws 连接跨 Case 复用(性能考虑),页面栈 / storage / 授权态等运行时状态**不保证**在 Case 间隔离;需要干净前置时在 Case 内用 `callWxApi`(`clearStorageSync`)显式制造。
