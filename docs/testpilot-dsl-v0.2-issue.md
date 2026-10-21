# TestPilot DSL V0.2 擴展 Issue 草稿

> 說明（esign 項目內部備註，投遞時刪除本節）：本檔為提交至 `chowsangsang.ghe.com/mei-ling-ling/css-test-pilot` 的 issue 正文草稿，正文為簡體（與目標倉庫文檔習慣一致）。投遞方式見專案會話記錄：`gh issue create -R chowsangsang.ghe.com/mei-ling-ling/css-test-pilot --title "..." --body-file 本檔`。

---

## 标题

DSL V0.2：新增 miniapp 深度测试 action（mockWxApi / trigger / callMethod / assert.dataPath），解锁原生弹窗分支与页面状态测试

## 背景：真实项目暴露的表达力缺口

真实小程序项目（周生生电子签认 esign）按 TestPilot 工作流完成需求评审，产出 26 个测试点，其中 **11 个只能标「人工」**，根因不是能力缺失，而是 DSL V0.1 未暴露底层 adapter 已具备的能力：

| 测试场景 | 现状 | 底层能力（已存在，DSL 够不到） |
| --- | --- | --- |
| getPhoneNumber 授权弹窗分支（拒绝 / 授权 / 号码不一致） | 人工 | `automation_element_action` 的 `trigger` + `detail` 可对按钮注入 `getphonenumber` 事件，绕过原生弹窗直接驱动分支 |
| 授权弹窗后的 modal 文案断言（wx.showModal） | 人工 | `automation_wx_api` 的 `mock` 可拦截 `wx.showModal` 并捕获 `content` / `confirmText` 供断言 |
| 后端响应驱动分支（needPhoneAuth / mobileMismatched / expired） | 依赖后端造数，无法造时只能人工 | `automation_wx_api` 的 `mock` 可拦截 `wx.request` 注入响应，**消除后端造数依赖** |
| scroll-view 受控下拉刷新（refresher-triggered） | 人工 | `automation_page_action` 的 `setData` / `callMethod` 可驱动真实 `onRefresh` 链路 |
| wx.openDocument / wx.downloadFile 参数断言（fileType 解析） | 人工 | `automation_wx_api` 的 `mock` 捕获调用参数 |
| 页面状态机断言（data 中 `status: loading/ready/expired`） | 只能间接靠 UI 文案 | `automation_page_action` 的 `getData` 可直接断言页面 data |
| 未授权前置（storage 清理制造设备状态） | 设备状态互斥，无法在 Case 内切换 | `wx.clearStorageSync` 经 evaluate 可清登录态前置 |

这些能力在 wechatide 工具链中全部存在（工具 id：`automation_wx_api`、`automation_element_action`、`automation_page_action`），缺口仅在 `packages/dsl` schema、Execution Engine 调度与 adapter 映射。本文档所列工具参数以下列实测 schema 为准（摘自 wechatide `tools.yaml`）：

- `automation_element_action`：`action` 枚举含 `trigger`（配 `type`、`detail: object`）、`touchstart/touchmove/touchend`（配 `touches/changedTouches`）
- `automation_wx_api`：`action` 枚举 `call / mock / restore`，字段 `method`（必填）、`result: object`、`functionDeclaration: string`
- `automation_page_action`：`action` 枚举 `getData / setData / querySelector / querySelectorAll / size / callMethod / scrollTop`，字段 `dataPath`、`patch: string(JSON)`、`method`、`args: array`

## 目标

新增以下 miniapp action（+1 个 assert 扩展），使上述 11 个人工测试点中 **≥8 个**可写成 Case 自动执行，同时不破坏 V0.1 任何既有行为。

## 规格建议

> 以下为业务侧视角的规格建议。与仓库现有架构（zod schema / Execution Engine / adapter 分层）冲突时以仓库架构为准，但**设计决策请在 PR 描述中记录理由**。

### 1. `action: mockWxApi`

```yaml
- target: miniapp
  action: mockWxApi
  method: showModal            # 必填：wx API 名
  result:                      # 必填（与 functionDeclaration 二选一）：mock 返回值
    confirm: true
  capture: showModalCall       # 可选：捕获真实调用参数到变量，供后续 ${showModalCall.content} 引用
```

- `functionDeclaration`（动态 mock 函数）**建议 V0.2 不开放**：任意 JS 破坏「Case 是声明式数据」的可审计性，validate 无法静态校验；静态 `result` 已覆盖本需求的全部场景。若要开放，单独 issue 论证。
- **生命周期建议：step 级**（字段挂在 step 上，该 step 执行完自动 `restore`），不做 Case 级 mocks 区。理由：与「每个数据行独立 ExecutionContext、行间不共享变量」的隔离原则一致，避免 mock 泄漏到后续 step 造成假通过。
- `capture` 写入 ExecutionContext 的结构建议：`${<capture>.args}`（调用参数对象）与 `${<capture>.called}`（布尔），命名与现有 extract 变量同作用域。
- adapter 落地：wechatide adapter → `automation_wx_api`（`action: mock`，step 收尾 `action: restore`）；playwright adapter 遇到本 action **必须报「不支持」错误**，不得静默跳过。

### 2. `action: trigger`

```yaml
- target: miniapp
  action: trigger
  locator:
    css: .login-btn
  eventType: getphonenumber    # 触发的事件类型
  detail:                      # 作为事件 e.detail 注入
    code: ''
```

- 空 `code` 即「用户拒绝授权」分支（业务代码以 `e.detail.code` 判空分流），无需 mock 任何弹窗即可测拒绝路径。
- adapter 落地：wechatide adapter → `automation_element_action`（`action: trigger` + `type` + `detail`）。

### 3. `action: callMethod`

```yaml
- target: miniapp
  action: callMethod
  method: onShow               # 页面/组件实例方法名
  args: []                     # 可选
```

- 覆盖热启动复现（`callMethod onShow`）、受控刷新驱动（配合 `setData`）。如认为需要，可一并支持 `setData`（`patch` 字段）——设计决策：独立 action 还是 `callMethod` 的特例，按仓库风格定。
- adapter 落地：wechatide adapter → `automation_page_action`（`action: callMethod` / `setData`）。

### 4. `assert` 扩展：`dataPath`（页面状态断言）

```yaml
- target: miniapp
  action: assert
  dataPath: status             # 页面 data 路径，与 locator 二选一
  expected: expired
```

- 现有 assert 仅 `locator + expected`（UI 文案）；页面状态机（`status`、`sortOldFirst`、`fileList.length`）只能靠间接文案推断。新增 `dataPath` 直接断言页面 data，落地为 `automation_page_action`（`action: getData` + `dataPath`）+ 引擎比对。
- validate 规则：`dataPath` 与 `locator` 互斥，同时出现报错。

## 硬性约束

1. **`packages/dsl` 的 zod schema 是唯一真相源**：新 action 同步 schema、`validate` 的错误信息、`rules/dsl.md` 的 action 表三处。
2. **不破坏 V0.1**：既有真实 Case（业务项目 esign 的 8 条：`tests/e2e/cases/*.yaml`，清单链路 5 条 + 扫码链路 3 条）validate 行为完全不变；建议为 schema 增加快照/回归测试。
3. **仅 miniapp**：`target: web` 使用以上 action 时 validate 给出明确错误（不是静默通过）。
4. **adapter 明确性**：未经 adapter 实现的 action，run 时 fail 并提示 adapter 缺口，不静默跳过（与「禁止凭空生成测试」的项目原则一致）。
5. **测试**：packages/dsl 单测（schema 接受/拒绝正反用例）+ adapter 集成测试 + `examples/cases` 增加一个 miniapp 深度示例。
6. **文档与版本**：dsl 版本 bump；`skills/testpilot/rules/dsl.md`、manifest 描述同步。

## 验收标准（黄金案例来自真实项目）

- [ ] 含新 action 的 Case 通过 `npx csspilot validate`
- [ ] 案例一（mock 后端响应）：mock `wx.request` 使 wechatLogin 返回 `needPhoneAuth=true` → assert `dataPath: status` == `ready` → assert `.login-btn` 出现
- [ ] 案例二（拒绝授权分支）：`trigger` `.login-btn` `getphonenumber`（空 code）+ `mockWxApi` 捕获 `showModal` → assert `${showModalCall.args.content}` 含「重新选择」话术、`confirmText` ==「重新选择」
- [ ] 案例三（受控下拉刷新）：清单页 `setData {refreshing: true}` → network 层确认 records 接口请求恰一次 → `refreshing` 自动复位 false
- [ ] 案例四（openDocument 参数断言）：mock `wx.downloadFile` + 捕获 `wx.openDocument` → assert `fileType` 从 url 扩展名正确解析
- [ ] 既有 V0.1 Case 回归 validate 全绿

## 明确不做（V0.2 范围外）

- web 端 fetch/XHR mock（另立 issue）
- 原生弹窗本身的 UI 自动化（微信客户端层，任何 adapter 均不可达——本文所有方案都是「绕过原生弹窗、驱动前端分支」）
- 真机专属场景（多手机号选择弹窗等）——保持人工
- `functionDeclaration` 动态 mock（理由见规格 1）
