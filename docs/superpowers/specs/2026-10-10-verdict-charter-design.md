# 设计:三态判定与 charter 视角矩阵

- 日期:2026-10-10
- 状态:**已实现并合并**(merge d914273:三态判定 + charter 视角矩阵)。2026-10-19 增补:charter 步骤新增三分判定规则(见特性③变更点),纯 workflow 文字,无代码改动
- 来源:`docs/research/github-testcase-generation-landscape.md` §2.16(tester-army/e2e 三态判定)、§2.9(TestGen-LLM 过滤器链)、§4 共性模式 ⑥
- 配套蓝图:`2026-10-10-replay-cache-blueprint.md`(特性①,不在本 spec 实现范围)

## 背景与目标

当前 TestPilot 的失败信息链存在两个断点:

1. **错误码在引擎层丢失**:`TestPilotError` 已存在(`packages/core/src/errors/index.ts`),`adapter-api` 与 `adapter-resolver` 已抛 `CONFIG_MISSING` / `UNSUPPORTED_ACTION` / `ADAPTER_NOT_FOUND`,但 `step-executor` catch 通用 `Error` 后只把 `message` 写进 `StepResult.error`,code 丢失。reporter 的 `classify.ts` 只能对错误文本做 regex 事后猜测,环境问题与产品 bug 混在一个 `failed` 里污染缺陷统计。
2. **评审覆盖靠人想**:`test-requirements-review` 的规则矩阵只覆盖需求显式给出的维度,探索性视角(persona、边界输入、错误路径等)没有固定 checklist,容易整体遗漏。

目标:①失败按「产品问题 / 环境与前置 / 未验证」三桶分流,CI exit code 区分;②评审工作流引入固定 charter 视角矩阵,视角落到 case tags 可查询。

---

## 特性②:三态判定

### 错误码与三桶映射

code 为 string(沿用 `TestPilotError.code`),新增枚举成员如下;**现有 code 全部映射到 infra 桶**(`ADAPTER_NOT_FOUND` / `UNSUPPORTED_ACTION` / `CONFIG_MISSING`)。

| 桶 | code | 触发点 |
| --- | --- | --- |
| **product**(产品问题) | `ASSERTION_FAILED` | `assert` 步骤:实际文本/状态 ≠ `expected` |
| | `REQUEST_COUNT_MISMATCH` | `expectRequests` 实际次数 ≠ `count` |
| | `STATUS_MISMATCH` | `request` 步骤响应状态码 ≠ `expected` |
| | `ELEMENT_NOT_FOUND` | click/input/select/assert/wait 定位失败(保守归此桶:可能是产品回归也可能是 selector 腐烂,不允许静默) |
| | `STEP_TIMEOUT` | adapter 等待超时(非环境连接类) |
| **infra**(环境/前置 → **blocked**) | `ENVIRONMENT_UNAVAILABLE` | launch 失败、`navigate` 网络错误(net::ERR/ECONNREFUSED)、服务不可达 |
| | `ADAPTER_NOT_FOUND` / `UNSUPPORTED_ACTION` | target 未注册 adapter / adapter 不支持该动作(**沿用现有 code 名**,不改名,零迁移成本) |
| | `FIXTURE_MISSING` | fixture / dataset 文件缺失(接现有 `missingDependencies` 流) |
| | `ACCOUNT_UNAVAILABLE` | `accountRef` 声明但凭据未配置 |
| | `CONFIG_MISSING` | 现有 code,保持 |
| **unverified**(规则本轮没测到 → **inconclusive**) | `PREREQ_VARIABLE_MISSING` | 步骤引用的 `${variable}` 未定义(典型:前置 `extract` 失败,后续 assert 变成空值比较,断言"失败"实为"没测到") |

未知 code 或非 `TestPilotError` 的意外异常(如 TypeError)→ 默认 **product**(宁红勿漏)。

### 类型变更(`packages/core/src/types/index.ts`)

```ts
StepResult.errorCode?: string      // 新增
CaseResult.errorCode?: string      // 新增,case 级错误(adapter 解析失败等)
CaseStatus  = 'passed' | 'failed' | 'blocked' | 'skipped' | 'inconclusive'  // 扩展
RunStatus   = CaseStatus
RunTotals.blocked?: number
RunTotals.inconclusive?: number
```

verdict 推导收口在 core(`packages/core/src/errors/` 旁新增 `verdict.ts`):

```ts
export type Verdict = 'product' | 'infra' | 'unverified'
export function verdictFromErrorCode(code: string | undefined): Verdict
```

case 状态由步骤 verdict 汇总,优先级 **failed > inconclusive > blocked > passed**(产品问题优先暴露;inconclusive 意味着规则没测到,比环境问题更需注意);`skipped` 语义不变。

### 引擎变更(`packages/execution-engine`)

- `step-executor.ts`:所有 `throw new Error(中文消息)` 改为 `throw new TestPilotError(code, message)`;catch 时 `instanceof TestPilotError` → `result.errorCode = err.code`。
- adapter 层配合(`adapter-playwright` / `adapter-wechatide` / `adapter-api`):定位类失败抛 `ELEMENT_NOT_FOUND`,等待超时抛 `STEP_TIMEOUT`,连接/启动失败抛 `ENVIRONMENT_UNAVAILABLE`;各 adapter 现有裸 `Error` 逐一收编。
- `${variable}` 解析(`ExecutionContext.resolve`)遇未定义变量 → `TestPilotError('PREREQ_VARIABLE_MISSING', ...)`(现需核对 resolve 当前行为后接入)。
- case 级:`execution-engine.runCase` 捕获 adapter 解析/launch 等整 case 错误 → `CaseResult.errorCode` + 状态按映射(blocked 等)。

### 消费面

- **CLI `run`**(apps/cli):exit 规则——存在 `failed`(product)或 `inconclusive` case → **1**;否则存在 `blocked` → **2**;否则 **0**。输出行补 blocked/inconclusive 计数。
- **reporter `classify.ts`**:有 `errorCode` → `verdictFromErrorCode` 直取;无(历史 run)→ 现有 regex 兜底,`FailureCategory` 增加到 verdict 的映射表,regex 路径标注 legacy。
- **reporter summary / report / summary-report**:`RunTotals` 三桶计数;HTML 报告按「产品失败 / 环境与前置 / 未验证」分组展示,blocked 组明确标注"非产品回归"。
- **apps/web**:`src/api/types.ts` 的字面量 status union 同步扩展;报告页渲染新状态与三桶分组。
- **apps/server**:`run-repo`(status TEXT 列直接兼容新值)、`run-service` / `sync-metadata` 透传新状态与计数;`routes/runs` 的 status filter 不变。
- **packages/sdk**:核对类型重导出面,预期零改动(core 类型透传)。
- **history.ts**:旧 run 无 errorCode,regex 路径保证统计连续。

### 兼容性

新增枚举成员 + 可选字段;所有消费点逐一核对 switch 是否带 default(适配清单:web types、server routes、reporter、cli)。0.x 阶段以 minor 版本说明 breaking 面(外部消费 result JSON 的脚本可能假定三态)。

### 测试计划

- core:`verdictFromErrorCode` 全表 + 未知 code 默认值单测。
- execution-engine:每类错误码触发路径(mock adapter 抛 `TestPilotError` / 裸 `Error` / 超时);case 状态汇总优先级;端到端「extract 失败 → 后续 assert → case inconclusive」。
- reporter:errorCode 优先/regex 兜底;三桶 totals;HTML 分组。
- cli:exit 0/1/2 集成测试。
- 回归:现有 `tests/`(unit/integration/e2e)全绿。

---

## 特性③:charter 视角矩阵(workflow + tags)

### 视角定义(固定 5 项)

| 视角 | tag | 判定问题 |
| --- | --- | --- |
| persona | `charter:persona` | 首次用户 / 未登录 / 无权限角色走这个流程会怎样? |
| 边界输入 | `charter:edge-input` | 空值 / 极值 / 特殊字符 / 超长输入? |
| 数字与文案 | `charter:numbers-copy` | 金额计算、计数、提示文案是否正确一致? |
| 状态恢复 | `charter:state-recovery` | reload / 中断 / 返回后状态是否保持? |
| 错误路径 | `charter:error-path` | 网络失败 / 服务端错误 / 非法操作的表现? |

### 变更点

1. **`skills/testpilot/workflows/test-requirements-review.md`**:
   - 「建立规则矩阵」之后插入一步「**套用 charter 视角矩阵**」(后续步骤号顺延):逐视角过 checklist,为每个 TP 标注视角(可多个);**某视角在本需求内无任何 TP 时必须显式记录「不适用 + 需求证据」,禁止静默跳过**。
   - **三分判定规则**(视角 checklist 的出口):想到需求未覆盖的场景(重复点击 / 非法输入 / 文案细节等)时,按「需求是否给出预期结果」当场归类,三选一,禁止静默丢弃——① 需求已有预期 → 纳入 TP(打视角 tag);② 无预期且伤业务(资损 / 核心流程 / 数据一致性)→ 澄清问题,标注视角与风险等级,整单结论至多「有条件可测」,答复后回流为新 TP;③ 无预期且不伤业务 → 视角覆盖表记「暂缓 + 理由」。
   - 测试点清单表增加「视角」列。
   - 评审产物(`tests/e2e/reviews/<slug>-coverage.md` 同级)增加「视角覆盖表」:视角 × TP 列表 / 不适用理由。
2. **`skills/testpilot/workflows/create-case.md`**:新增规则——TP 的视角写入 case `tags`(命名表如上),与既有 tag(如 `smoke`)共存;一个 TP 多视角则多 tag。
3. **`skills/testpilot/rules/case-design.md`**:补充 `charter:*` tag 命名与用途说明。

### 查询(零新增代码)

`npx csspilot list --tag charter:error-path` 直接可用(现有 `--tag` 功能)。视角覆盖缺口在评审时显式化;建 Case 阶段遗漏靠 `list --tag` 对照评审产物人工核对——**report 不读 reviews 文件**(避免跨界耦合,YAGNI)。

### 验收

- 对一个真实需求跑一次评审工作流,产物含视角覆盖表且无不适用静默项。
- 三分判定三种去向均有显式记录:覆盖(TP)/ 澄清(带视角与风险等级)/ 暂缓(带理由),不存在第四种出口。
- `docs/` 或 `examples/` 中的示例 case(如 `order-create.yaml`)补 charter tag 作示范。

---

## 明确不做(YAGNI)

- 不做 `--blocked-exit` 之类的 exit code 配置项(定死 0/1/2 语义,需要时再加)。
- 不做 report → reviews 的自动覆盖 diff。
- 不在本 spec 范围内实现运行时 AI / fallback 步骤(见 `2026-10-10-replay-cache-blueprint.md`)。
- 不引入 inconclusive 之外的第四态。
