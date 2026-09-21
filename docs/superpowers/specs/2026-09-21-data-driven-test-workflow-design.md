# TestPilot 数据驱动测试与需求覆盖设计

## 1. 目标

本次改造解决五类问题：

1. 从 PRD/Spec 识别“类型 × 组合”规则矩阵，展开全部有效组合，并以“一个可判定规则/数据点”为测试点粒度。
2. 输入 QA 用例库时生成 QA→TP 覆盖映射和缺口清单。
3. 允许相同步骤模板、不同数据与预期组成 data-driven Case 组。
4. 为 Case 增加 datasets、fixtures、requires、setup/teardown，并按数据行执行和报告。
5. 在 Web 与小程序 UI 操作上断言匹配接口的请求次数。

不在本次范围：

- 多 dataset 文件的笛卡尔积。
- 自定义依赖 checker 插件或远端 API 依赖探针。
- 自动拦截、去重或篡改 UI 网络请求。
- 改变 Case 属于业务仓库、执行必须经过 Engine/Adapter 的架构边界。

## 2. 总体架构

采用“运行前展开”：

```text
Case YAML + tests/e2e/data/*.yaml|json
                ↓
SDK Case Planner
  加载 fixture → 展开 dataset → requires 预检
                ↓
Case Execution(caseId + rowId + variables)
                ↓
Execution Engine
  setup → steps → teardown
                ↓
Adapter
  UI 操作 + 请求次数采集
                ↓
Result / Report
  每行 passed / failed / skipped / warnings
```

旧 Case 没有新字段时展开成一个 `rowId: default` 的执行单元，保持现有行为。

## 3. 需求评审与 QA 对标

### 3.1 规则矩阵

`workflows/test-requirements-review.md` 增加以下强制步骤：

1. 从需求中抽取原子规则；每条必须能独立回答“输入/条件是什么、预期是什么”。
2. 识别组合维度和值域，例如折扣类型、门槛有无、是否叠加、账号层级。
3. 记录组合约束与不适用条件。
4. 展开所有有效组合；排除组合必须记录理由，不得静默删除。
5. 将每个组合中的每条独立预期拆为 TP。相同组合若有多个独立预期，应生成多个 TP。
6. 共享业务步骤、仅数据与预期不同的 TP，可映射到一个 data-driven Case 组。
7. 根据当前需求、项目代码、配置、现有 Case 与 QA 用例识别执行依赖，生成当前测试点所需的最小 `requires` 草稿。

`requires` 没有跨项目固定字段。账号层级、优惠券、促销项次、PPM 项目 ID 只是可能出现的业务示例，不得默认写入每个项目：

- 需求和项目证据明确依赖某项数据时，AI 才声明对应字段。
- 项目不涉及账号、优惠、PPM 等概念时，不生成这些字段。
- 无外部数据依赖的 Case 可以省略 `requires`。
- AI 找不到字段来源或命名证据时，将问题写入澄清/缺口清单，不猜测字段。
- 人工负责确认 AI 生成的依赖契约；真实值由人工、Secret 或项目造数流程提供。

测试点最小粒度为“一个可判定规则/数据点”，不是一个页面操作，也不是整份 PRD。

### 3.2 QA→TP 覆盖映射

输入 QA 用例库时，在创建 Case 前输出：

- `covered`：QA 用例完整覆盖 TP 的条件与预期。
- `partial`：覆盖了部分条件或断言。
- `missing`：没有对应 QA 用例。
- `conflict`：QA 预期与需求/TP 冲突。

`partial`、`missing`、`conflict` 自动进入缺口清单。产物保存到：

```text
tests/e2e/reviews/<requirement-slug>-coverage.md
```

固定结构：

1. 来源与版本
2. 规则/数据点清单
3. 维度和值域
4. 有效组合判定表
5. 排除组合及理由
6. TP 测试点清单
7. QA→TP 覆盖映射
8. 覆盖缺口清单
9. 平台执行信息与阻塞项
10. 评审结论

## 4. Case 设计规则

默认仍是一条完整业务流程一个 Case。以下条件同时满足时允许组成 data-driven Case 组：

- 入口与业务结果相同。
- setup、steps、teardown 模板相同。
- 只改变输入数据、账号属性或预期值。
- 每行都能用唯一 rowId 追踪到 TP。

不同入口、不同业务结果、不同清理策略或无法共享步骤模板的测试点不得强行合组。

## 5. DSL

### 5.1 Case 示例

```yaml
id: promotion-discount
name: 促销折扣规则
description: |
  需求: docs/prd/promotion.md
  测试点: TP-001 ~ TP-012

fixtures:
  - tests/e2e/data/promotion.yaml
  - tests/e2e/data/accounts.yaml

datasets:
  file: tests/e2e/data/discount-cases.yaml
  idField: id

requires:
  - fixture.product.styleNo
  - fixture.coupon.code
  - dataset.discountType
  - dataset.accountLevel
  - account.token

accountRef: promotion-user

setup:
  - target: api
    action: request
    method: POST
    url: /test-support/bag/clear
    expected: "200"

steps:
  - target: miniapp
    action: navigate
    url: /pages/product/detail?id=${fixture.product.styleNo}

  - target: miniapp
    action: click
    locator:
      css: ".add-to-bag"
    expectRequests:
      - method: POST
        urlContains: /api/bag/items
        count: 1
        windowMs: 1500

  - target: miniapp
    action: assert
    locator:
      css: ".discount-amount"
    expected: "${dataset.expectedDiscount}"

teardown:
  - target: api
    action: request
    method: DELETE
    url: /test-support/bag
    expected: "204"
```

### 5.2 数据文件

YAML 和 JSON 均支持。dataset 文件根必须是对象数组：

```yaml
- id: vip-threshold-stackable
  discountType: percentage
  accountLevel: vip
  threshold: 500
  stackable: true
  expectedDiscount: "100.00"
```

fixture 文件根必须是对象。多个 fixture 按顺序深合并；任意键冲突报错，不允许静默覆盖。

### 5.3 变量作用域

- `${fixture.*}`：合并后的 Case 共享 fixture。
- `${dataset.*}`：当前数据行。
- `${account.*}`：`accountRef` 对应的 Secret。
- `${variable.*}`：`testpilot.yaml` 白名单映射的环境变量。
- `${name}`：当前执行单元中由 `extract` 产生的变量。

setup 中提取的变量可供 steps 和 teardown 使用；steps 中提取的变量可供 teardown 使用。每个数据行使用独立 ExecutionContext。

Case 不得通过 `${env.*}` 任意读取进程环境变量。环境相关的稳定值必须先在 `testpilot.yaml` 显式映射：

```yaml
variables:
  ppmProjectId: ${PPM_PROJECT_ID}
  testUserLevel: ${TEST_USER_LEVEL}
```

Case 再通过 `${variable.ppmProjectId}` 引用。这样 `.env` 只负责提供当前环境的实际值，`requires` 负责声明哪些值是当前 Case 的运行前依赖。

### 5.4 数据文件安全边界

- 数据引用只能是项目相对路径。
- 解析后的文件必须位于项目的 `tests/e2e/data/` 下。
- 禁止绝对路径和通过 `..` 越出 data 目录。
- 数据文件不存在、格式错误、fixture 冲突或 rowId 重复属于 validate 失败。

### 5.5 requires

`requires` 是 AI 根据当前项目证据生成、经人工确认的可选依赖契约，不是所有项目共用的字段清单。AI 的识别来源按优先级包括：

1. PRD/Spec 的前置条件、输入与验收标准。
2. 项目接口、类型、页面代码与配置。
3. 已有 Case、fixture、dataset 和 QA 用例。
4. 项目 `references/test-conventions.md` 中声明的数据约定。

AI 负责提出所需字段；人工确认字段含义和来源；真实值由人工、Secret、fixture、dataset 或 setup 造数流程提供。缺少证据时必须提出澄清问题，不得根据“登录”“下单”“促销”等业务名词自动发明字段。

第一版只做**静态依赖完整性预检**：判断已声明的路径是否存在且非空，不声称远端业务数据一定有效。路径可引用 `fixture`、`dataset`、`account`、`variable`；Case 未使用某个作用域时不要求声明。`variable` 只来自 `testpilot.yaml variables` 白名单，不能直接遍历或读取任意 `process.env`。

不存在、`null` 或空字符串表示依赖未就绪。预检按数据行执行，并发生在 setup 之前。预检失败时：

- 当前数据行状态为 `skipped`。
- 原因码为 `dependency-not-ready`。
- 记录缺失路径。
- 不执行 setup、steps、teardown。

非空值仍可能指向已失效、未发布或不属于当前环境的业务对象。这类有效性问题第一版由 setup 或主步骤暴露；后续版本可增加 API 探针，但不属于本次范围。

### 5.6 setup/teardown

三个阶段复用相同的 TestStep Schema：

1. setup 顺序执行。
2. setup 成功后执行 steps。
3. teardown 在 setup 开始后始终执行，即使 setup 或 steps 失败。

状态规则：

- setup 失败：主结果 `failed`，跳过剩余 setup 和全部 steps，执行 teardown。
- steps 失败：主结果 `failed`，跳过剩余 steps，执行 teardown。
- teardown 失败：StepResult 为 `warning`，写入 CaseResult warnings，不改变主结果。

Skill 推荐 setup/teardown 优先使用 API，避免脆弱的 UI 造数和清理，但 DSL 不限制 target。

### 5.7 UI 请求次数断言

`expectRequests` 允许出现在 `navigate`、`click`、`input`、`select` 等 UI 动作上：

```yaml
expectRequests:
  - method: POST
    urlContains: /api/bag/items
    count: 1
    windowMs: 1500
```

语义：

1. Adapter 在动作前开始采集。
2. 执行动作。
3. 动作完成后观察 `windowMs`。
4. 按 method（大小写不敏感）与 URL 包含关系匹配。
5. 实际次数必须严格等于 `count`。

Web 使用 Playwright Page 的请求事件；小程序使用 `miniprogram-automator` 的 `exposeFunction` 与 `mockWxMethod('request')` 透明采集，并始终调用原始 `wx.request`。采集结束后恢复原方法。该能力不篡改、去重或阻止请求。

## 6. 执行模型

SDK 新增 Case 准备层，职责为：

1. 读取并校验数据引用。
2. 合并 fixture。
3. 读取 dataset 并校验 rowId。
4. 为每行建立初始变量。
5. 执行 requires 预检。
6. 输出一个或多个 CaseExecution。

Execution Engine 只执行已准备的 CaseExecution，不负责文件路径解析。

每个执行单元至少包含：

```text
templateId
caseId
caseName
file
rowId
rowIndex
fixture variables
dataset variables
account variables
dependency preflight result
setup / steps / teardown
```

artifact 文件名和运行事件使用 `caseId + rowId`，避免数据行之间覆盖。

## 7. 结果和报告

### 7.1 状态

- StepStatus：`passed | failed | skipped | warning`
- CaseStatus：`passed | failed | skipped`
- RunStatus：
  - 任意执行行 failed → `failed`
  - 无 failed 且至少一行 passed → `passed`
  - 全部执行行 skipped → `skipped`

### 7.2 CaseResult

新增：

- `rowId`、`rowIndex`
- `skipReason`
- `missingDependencies`
- `warnings`
- 每个 StepResult 的 `phase`
- 请求断言的匹配条件、期望次数、实际次数和脱敏摘要

结果不保存完整 fixture 或 dataset 对象，避免泄露账号、券码等业务数据。

### 7.3 汇总

- `totals.cases`：实际执行行数。
- `totals.templates`：YAML Case 模板数。
- 新增 `totals.skipped`、`totals.warnings`、`stepsWarning`。

报告按模板 Case 分组、数据行为子项。历史与 flaky 统计键使用 `caseId + rowId`，避免把不同数据行混为同一个用例。

Control Plane 与 Web 类型同步支持 `skipped` 和 `warning`。Agent Job 可成功完成，但消息必须明确测试执行被 skipped。

## 8. 兼容性

- 旧 YAML 无需迁移。
- 旧 Case 展开为一个 `default` 数据行。
- 新 Result 字段均为附加字段；报告读取旧 result.json 时提供默认值。
- 原有 `steps` 仍必填；setup/teardown 可选。
- 原有变量、账号、API、Web、小程序行为不改变。

## 9. 测试策略

实现按 TDD 进行，至少覆盖：

1. DSL 新字段 Schema 与变量语义。
2. YAML/JSON fixture/dataset 加载。
3. 数据路径越界、fixture 冲突、rowId 重复。
4. 每行独立变量与 artifact 名称。
5. requires 逐行 skipped。
6. setup 失败、steps 失败与 teardown warning。
7. Web 请求次数通过/失败。
8. 小程序请求透明采集、原始 request 调用与恢复。
9. 报告的模板分组、数据行统计、全 skipped Run。
10. 旧 Case 和旧 result.json 回归。
11. Skill 评估：规则矩阵、QA 映射、data-driven 分组选择。

## 10. 交付顺序

1. 更新 Skill 工作流与 Case 设计规则。
2. 扩展 DSL Schema、解析与语义校验。
3. 实现 SDK 数据加载、展开与依赖预检。
4. 扩展 Engine 生命周期、状态和事件。
5. 扩展 Adapter 请求采集能力及 Web/小程序实现。
6. 更新 Reporter、CLI、Server 和 Web 类型。
7. 更新文档与示例，运行全量测试、类型检查和构建。
