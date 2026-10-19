# 三态判定 + charter 视角矩阵 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 失败按 product / infra(blocked) / unverified(inconclusive) 三桶分流(CI exit 0/1/2),并把 charter 视角矩阵并入评审与建 Case 工作流。

**Architecture:** 在既有 `TestPilotError.code` 链路上收编所有 throw 点,新增 core 级 verdict 推导函数作为唯一映射源;`CaseStatus` 扩展 `blocked` / `inconclusive` 两个枚举成员,reporter/CLI/web/server 消费新状态;特性③纯 skill 文档 + 示例 tags,零代码。

**Tech Stack:** TypeScript (Node >=22, ESM), vitest, pnpm workspace + turbo, commander (CLI)。

**Spec:** `docs/superpowers/specs/2026-10-10-verdict-charter-design.md`(特性①回放缓存不在本计划范围)

## Global Constraints

- 不新增任何 npm 依赖。
- 现有错误码名**保留不改**:`ADAPTER_NOT_FOUND` / `UNSUPPORTED_ACTION` / `CONFIG_MISSING` 全部映射 infra 桶。
- `TestPilotError`(`packages/core/src/errors/index.ts`)已存在,构造签名 `(code: string, message: string, options?: { cause?: unknown })`,直接复用。
- Step 级 `status` 保持 `'passed' | 'failed' | 'skipped' | 'warning'` **不变**,verdict 只通过新增 `errorCode` 字段承载,case/run 级才出现新状态。
- 注释与错误消息用中文,标识符英文;遵循仓库现有 `@testpilot/*` workspace 导入方式。
- 每个 Task 提交一次,提交信息用仓库惯例(conventional commits + 中文描述 + `Co-Authored-By: Claude Code <noreply@anthropic.com>`)。
- 明确不做(见 spec "明确不做"节):不做 `--blocked-exit` 配置;reporter 不读 reviews 文件;不实现运行时 AI;不引入第四种状态。
- dataset 文件本身 JSON/YAML 解析失败仍是 **run 级错误(run 中止)**——有意保留,不做 per-case blocked(spec 的 FIXTURE_MISSING 走 requires→missingDependencies 既有流)。

## Review Focus

按对使用者伤害概率排序;每条已在归属 Task 的测试步骤中钉死:

1. **历史 run JSON 无 `errorCode`**:reporter 统计必须原样工作(regex 兜底),否则旧报告/历史趋势全碎 → Task 7 Step 1。
2. **JSON 凭据缺字段**(如凭据只有 username 没有 password):`${account.password}` 必须报 `ACCOUNT_UNAVAILABLE`(case blocked),而不是把字面量 `${account.password}` 填进输入框 → Task 2 Step 1。
3. **validate 已声明变量的正常替换**不能被 resolve-throw 破坏(fixture/dataset/config/extract 声明的变量在运行时已注入时必须原样工作)→ Task 2 Step 1。
4. **元素等不到的等待超时**必须归 `ELEMENT_NOT_FOUND`(产品桶,CI 红),不许落到环境桶被静默 → Task 5 Step 1。
5. **web 报告页收到 `blocked` / `inconclusive` 状态**不得渲染成空白/undefined → Task 9 Step 3。

---

## 文件结构总览

| 包 | 修改 | 职责 |
| --- | --- | --- |
| core | `src/verdict.ts`(新)、`src/types/index.ts`、`src/index.ts` | verdict 推导唯一来源 + 结果模型扩展 |
| execution-engine | `src/context/index.ts`、`src/engine/step-executor.ts`、`src/engine/execution-engine.ts`、`src/engine/result-collector.ts` | resolve 语义、错误码化、case 状态汇总、run totals |
| adapter-playwright / adapter-wechatide / adapter-api | 各 `src/` | 裸 Error 收编为带码 TestPilotError |
| reporter | `src/classify.ts`、`src/summary-report.ts`、`src/report.ts` | errorCode 优先分类 + 三桶展示 |
| cli | `src/commands/run.ts` | exit 0/1/2 + 输出行 |
| web / server | `apps/web/src/api/types.ts` 等 | 状态字面量 union 同步、渲染 |
| skills | `skills/testpilot/workflows/*.md`、`rules/case-design.md` | charter 矩阵(特性③) |

测试统一放 `tests/unit/`(现有惯例:engine.test.ts、reporter.test.ts 等,root `pnpm test` = vitest run)。

---

### Task 1: core verdict 模块与类型扩展

**Files:**
- Create: `packages/core/src/verdict.ts`
- Modify: `packages/core/src/types/index.ts`、`packages/core/src/index.ts`
- Test: `tests/unit/verdict.test.ts`(新)

**Interfaces:**
- Consumes: 无(本任务为源头)。
- Produces(后续所有 Task 依赖):
  - `export type Verdict = 'product' | 'infra' | 'unverified'`
  - `export function verdictFromErrorCode(code: string | undefined): Verdict`
  - `export function caseStatusFromErrorCode(code: string | undefined): 'failed' | 'inconclusive' | 'blocked'`
  - `StepResult.errorCode?: string`、`CaseResult.errorCode?: string`
  - `CaseStatus = 'passed' | 'failed' | 'blocked' | 'skipped' | 'inconclusive'`;`RunStatus = CaseStatus`
  - `RunTotals.blocked?: number`、`RunTotals.inconclusive?: number`

- [ ] **Step 1: 写失败测试 `tests/unit/verdict.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { caseStatusFromErrorCode, verdictFromErrorCode } from '@testpilot/core'

describe('verdictFromErrorCode', () => {
  it('product 桶', () => {
    for (const code of ['ASSERTION_FAILED', 'REQUEST_COUNT_MISMATCH', 'STATUS_MISMATCH', 'ELEMENT_NOT_FOUND', 'STEP_TIMEOUT']) {
      expect(verdictFromErrorCode(code)).toBe('product')
    }
  })
  it('infra 桶(含现有码)', () => {
    for (const code of ['ENVIRONMENT_UNAVAILABLE', 'ADAPTER_NOT_FOUND', 'UNSUPPORTED_ACTION', 'FIXTURE_MISSING', 'ACCOUNT_UNAVAILABLE', 'CONFIG_MISSING']) {
      expect(verdictFromErrorCode(code)).toBe('infra')
    }
  })
  it('未知 code 与 undefined 默认 product(宁红勿漏)', () => {
    expect(verdictFromErrorCode('SOMETHING_NEW')).toBe('product')
    expect(verdictFromErrorCode(undefined)).toBe('product')
  })
})

describe('caseStatusFromErrorCode', () => {
  it('product→failed / infra→blocked / unverified→inconclusive', () => {
    expect(caseStatusFromErrorCode('ASSERTION_FAILED')).toBe('failed')
    expect(caseStatusFromErrorCode('ADAPTER_NOT_FOUND')).toBe('blocked')
    expect(caseStatusFromErrorCode('PREREQ_VARIABLE_MISSING')).toBe('inconclusive')
    expect(caseStatusFromErrorCode(undefined)).toBe('failed')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/verdict.test.ts`
Expected: FAIL(`verdictFromErrorCode` 未导出)

- [ ] **Step 3: 实现 `packages/core/src/verdict.ts`**

两个 code 集合用 `Set<string>` 常量(product 五码、infra 六码如测试所列);`verdictFromErrorCode`:infra 集合命中→`'infra'`,product 集合命中→`'product'`,其余(含 undefined)→`'product'`。`caseStatusFromErrorCode`:`'infra'→'blocked'`,`'unverified'→'inconclusive'`,其余→`'failed'`。在 `packages/core/src/index.ts` 导出两者与 `Verdict`。

- [ ] **Step 4: 扩展 `packages/core/src/types/index.ts`**

`CaseStatus` 加 `'blocked' | 'inconclusive'`;`StepResult` / `CaseResult` 各加 `errorCode?: string`(注释:`TestPilotError.code,三态判定依据`);`RunTotals` 加 `blocked?: number`、`inconclusive?: number`。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/verdict.test.ts`
Expected: PASS

- [ ] **Step 6: 全量回归(类型扩展可能影响带 default 的 switch 之外的严格比较)**

Run: `pnpm typecheck && pnpm test`
Expected: 全绿(若有消费点因枚举扩展报错,逐个补 case 分支——预期在 Task 7-9 才出现,此处应为零)

- [ ] **Step 7: Commit**

```bash
git add packages/core tests/unit/verdict.test.ts
git commit -m "feat(core): verdict 推导与 blocked/inconclusive 状态扩展"
```

---

### Task 2: ExecutionContext 解析失败语义(PREREQ_VARIABLE_MISSING / ACCOUNT_UNAVAILABLE)

**Files:**
- Modify: `packages/execution-engine/src/context/index.ts`
- Test: `tests/unit/engine.test.ts`(追加 describe 块)

**Interfaces:**
- Consumes: Task 1 的 `TestPilotError`(core 导出,已存在)。
- Produces: `ExecutionContext.resolve(template: string): string` **行为变更**——遇到未定义 `${name}` 抛 `TestPilotError`;`name` 以 `account` 开头(含 `account` 整值与 `account.*` 字段)→ code `ACCOUNT_UNAVAILABLE`,否则 code `PREREQ_VARIABLE_MISSING`。已定义变量行为不变。

- [ ] **Step 1: 写失败测试(追加到 `tests/unit/engine.test.ts`)**

```ts
describe('ExecutionContext.resolve 未定义变量', () => {
  it('已定义变量正常替换(Review Focus 3)', () => {
    const context = new ExecutionContext()
    context.seed({ orderId: '42' })
    expect(context.resolve('order-${orderId}')).toBe('order-42')
  })
  it('普通变量未定义 → PREREQ_VARIABLE_MISSING', () => {
    const context = new ExecutionContext()
    try {
      context.resolve('${missingVar}')
      expect.unreachable()
    } catch (err) {
      expect((err as TestPilotError).code).toBe('PREREQ_VARIABLE_MISSING')
    }
  })
  it('凭据 JSON 缺字段 → ACCOUNT_UNAVAILABLE(Review Focus 2)', () => {
    const context = new ExecutionContext()
    context.seedAccount('{"username":"a"}')
    expect(context.resolve('${account.username}')).toBe('a')
    try {
      context.resolve('${account.password}')
      expect.unreachable()
    } catch (err) {
      expect((err as TestPilotError).code).toBe('ACCOUNT_UNAVAILABLE')
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/engine.test.ts`
Expected: 新增 3 条 FAIL(resolve 当前保持原样不抛)

- [ ] **Step 3: 实现**

`resolve` 的 replace 回调改为:命中→返回值;未命中→`throw new TestPilotError(name.startsWith('account') ? 'ACCOUNT_UNAVAILABLE' : 'PREREQ_VARIABLE_MISSING', \`变量 "${name}" 未定义(前置 extract 未执行或 fixture/dataset/凭据缺失)\`)`。更新方法上方注释(原"未定义的引用保持原样"语义作废)。**注意**:`packages/dsl` 校验器已静态拦截"从未声明"的引用(仅 extract 声明/config 白名单/fixture/dataset key 可用),运行时未命中即数据未兑现。

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `pnpm vitest run tests/unit/engine.test.ts && pnpm typecheck`
Expected: PASS(resolve 的所有既有调用方在 step-executor 内部,异常被其 catch 收编;typecheck 确认无签名破坏)

- [ ] **Step 5: Commit**

```bash
git add packages/execution-engine/src/context tests/unit/engine.test.ts
git commit -m "feat(engine): resolve 未定义变量抛 PREREQ_VARIABLE_MISSING/ACCOUNT_UNAVAILABLE"
```

---

### Task 3: step-executor 错误码化

**Files:**
- Modify: `packages/execution-engine/src/engine/step-executor.ts`、`packages/sdk/src/case-data.ts`
- Test: `tests/unit/engine.test.ts`(追加)、`tests/unit/sdk.test.ts`(追加)

**Interfaces:**
- Consumes: `TestPilotError`;Task 2 的 resolve 行为。
- Produces: `StepResult.errorCode`(catch 处填充);以下 throw 点换码:
  - `当前 X adapter 不支持请求次数断言` / `不支持 api 断言` / `不支持 api request` / `不支持 api 提取` / `api 端 extract 需要提供 value` / `不支持的 action` → `UNSUPPORTED_ACTION`
  - request 步骤 HTTP 状态码不匹配 → `STATUS_MISMATCH`(保留现有中文消息原文)
  - `expectRequests` 次数不匹配 → `REQUEST_COUNT_MISMATCH`(保留现有中文消息原文)
  - `case-data.ts` 数据文件不存在 → `FIXTURE_MISSING`(run 级错误带上机器可读码;文件存在但结构不符等编写错误保持普通 Error → product 桶)

- [ ] **Step 1: 写失败测试(mock adapter,沿用 engine.test.ts 既有 mock 模式)**

```ts
// 1) executeStep 内部抛普通 Error → errorCode 为 undefined,error 保留消息
// 2) expectRequests 实际次数不符 → result.errorCode === 'REQUEST_COUNT_MISMATCH'
// 3) request 步骤 expected '200' 实际 500 → result.errorCode === 'STATUS_MISMATCH'
// 4) resolve 抛 PREREQ_VARIABLE_MISSING(variable 引用缺失变量)→ result.errorCode === 'PREREQ_VARIABLE_MISSING'
```

每条断言 `result.status === 'failed'` 且 `result.error` 含原中文消息片段;2)/3) 需 mock adapter 的 `request` / `startRequestCapture` / `stopRequestCapture`(返回构造的 `CapturedRequest[]`)。
另在 `tests/unit/sdk.test.ts` 追加:`loadCaseDataFile` 指向不存在的文件 → 抛 `TestPilotError` 且 `code === 'FIXTURE_MISSING'`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/engine.test.ts tests/unit/sdk.test.ts`
Expected: 新增用例 FAIL(errorCode 为 undefined / FIXTURE_MISSING 未接)

- [ ] **Step 3: 实现**

step-executor 顶部 `import { TestPilotError } from '@testpilot/core'`;按 Interfaces 列表替换 6 处 `new Error` → `new TestPilotError('<code>', <原消息不变>)`;主 catch 块(`} catch (err) {`)内、`result.error = ...` 旁加 `result.errorCode = err instanceof TestPilotError ? err.code : undefined`。
`case-data.ts` 的「文件不存在」throw(先 grep `existsSync`/读文件失败处定位)换 `TestPilotError('FIXTURE_MISSING', 原消息)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/engine.test.ts tests/unit/sdk.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/execution-engine/src/engine/step-executor.ts packages/sdk/src/case-data.ts tests/unit/engine.test.ts tests/unit/sdk.test.ts
git commit -m "feat(engine,sdk): step-executor 错误码化与 FIXTURE_MISSING 收编"
```

---

### Task 4: runCase 状态汇总(errorCode 贯通 + 新 case 状态)

**Files:**
- Modify: `packages/execution-engine/src/engine/execution-engine.ts`
- Test: `tests/unit/engine.test.ts`(追加)

**Interfaces:**
- Consumes: Task 1 `caseStatusFromErrorCode`;Task 3 的 `StepResult.errorCode`。
- Produces: `CaseResult.status` 可为 `'blocked' | 'inconclusive'`;`CaseResult.errorCode`;`case-finished` 事件 `status` 字段携带新值。case 状态 = 有失败步骤时 `caseStatusFromErrorCode(失败步骤的 errorCode)`(取**第一个**失败步骤的码,与现有 `caseError = result.error` 同步赋值);teardown 失败降级 warning 的既有逻辑不变。

- [ ] **Step 1: 写失败测试**

```ts
// 1) resolver.get() 抛 TestPilotError('ADAPTER_NOT_FOUND') → case status 'blocked',caseResult.errorCode === 'ADAPTER_NOT_FOUND'
// 2) 步骤抛 TestPilotError('PREREQ_VARIABLE_MISSING') → case status 'inconclusive'
// 3) 步骤抛 TestPilotError('ASSERTION_FAILED') → case status 'failed'(现状保持)
// 4) teardown 步骤失败仍 → warning,不影响 case 状态(现状回归)
```

mock resolver/adapter 沿用测试文件既有模式;1) 直接让 mock `AdapterResolver.session()` 返回 reject 或 get 抛 TestPilotError(以现有 mock 结构最省的方式)。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/engine.test.ts`
Expected: 1)/2) FAIL(现在都是 'failed')

- [ ] **Step 3: 实现**

`runPhase` 的 catch 块:构造 result 时加 `errorCode: err instanceof TestPilotError ? err.code : undefined`。新增 `let caseErrorCode: string | undefined`,在 `if (result.status === 'failed')` 分支里与 `caseError` 同步赋 `caseErrorCode = result.errorCode`。收尾:`const status = caseError ? caseStatusFromErrorCode(caseErrorCode) : 'passed'`;`caseResult.errorCode = caseErrorCode`(有值时)。`bus.emit case-finished` 与日志使用新 `status` 变量(已是同一变量,确认即可)。

- [ ] **Step 4: 跑测试确认通过 + 回归**

Run: `pnpm vitest run tests/unit/engine.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/execution-engine/src/engine/execution-engine.ts tests/unit/engine.test.ts
git commit -m "feat(engine): case 状态按错误码推导出 blocked/inconclusive"
```

---

### Task 5: adapters 错误码收编

**Files:**
- Modify: `packages/adapter-playwright/src/page.ts`、`packages/adapter-wechatide/src/ide.ts`、`packages/adapter-api/src/index.ts`(如其中 assertResponse/request 有裸 Error)
- Test: `tests/unit/playwright-adapter.test.ts`、`tests/unit/wechatide-adapter.test.ts`(追加;沿用各自现有 mock/launch 方式)

**Interfaces:**
- Consumes: `TestPilotError`。
- Produces(错误码约定,三个 adapter 一致):
  - 断言文本不匹配 → `ASSERTION_FAILED`
  - locator 型操作(click/input/select/extract/wait 带 locator)等元素超时 → `ELEMENT_NOT_FOUND`(Review Focus 4)
  - `navigate` 的 `page.goto` 超时 → `STEP_TIMEOUT`;goto 网络错误(`net::ERR*`) → `ENVIRONMENT_UNAVAILABLE`
  - wechatide 启动/连接类(拉起 cli 失败、自动化端口等待超时) → `ENVIRONMENT_UNAVAILABLE`
  - adapter 能力缺口(不支持 select 等) → `UNSUPPORTED_ACTION`
  - 用例编写错误(`无效的 locator`、`仅支持 css locator`)**保持普通 Error**(落 product 桶,不静默)

- [ ] **Step 1: 写失败测试**

playwright-adapter.test.ts:mock page 的 locator `click` 抛 playwright `TimeoutError` → 期望 adapter 抛 `TestPilotError` 且 `code === 'ELEMENT_NOT_FOUND'`;`assert` 文本不符 → `code === 'ASSERTION_FAILED'`。
wechatide-adapter.test.ts:`等待元素超时` 路径 → `ELEMENT_NOT_FOUND`;`断言失败:期望包含` → `ASSERTION_FAILED`;启动端口超时 → `ENVIRONMENT_UNAVAILABLE`。
(若现有测试对消息文本有断言,保持消息不变,仅加 code 断言。)

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/playwright-adapter.test.ts tests/unit/wechatide-adapter.test.ts`
Expected: 新增用例 FAIL(当前抛普通 Error,无 code)

- [ ] **Step 3: 实现**

- playwright `page.ts`:加一个小助手 `private async coded<T>(fn: () => Promise<T>): Promise<T>`——执行 `fn`,`catch` 里:playwright `TimeoutError`(`import { TimeoutError } from 'playwright'`)→ `throw new TestPilotError('ELEMENT_NOT_FOUND', 原消息)`;其余原样 rethrow。`click/input/select/extract` 与 `assert` 内的 `waitFor` 用它包裹;`navigate` 单独 catch:`TimeoutError` → `STEP_TIMEOUT`,`err.message` 含 `net::ERR` → `ENVIRONMENT_UNAVAILABLE`;`assert` 的文本不匹配 throw 改 `ASSERTION_FAILED`。
- wechatide `ide.ts`:同消息保留、换 `TestPilotError`:`等待元素超时` → `ELEMENT_NOT_FOUND`;`断言失败` → `ASSERTION_FAILED`;`拉起开发者工具 cli 失败` / `自动化端口 ${port} 超时` → `ENVIRONMENT_UNAVAILABLE`;`暂不支持 select` → `UNSUPPORTED_ACTION`。
- adapter-api `index.ts`:核对 `assertResponse` 与 `request` 的失败路径——断言不符 → `ASSERTION_FAILED`;连接失败(`fetch` 抛)→ `ENVIRONMENT_UNAVAILABLE`。已有 `CONFIG_MISSING` / `UNSUPPORTED_ACTION` 不动。

- [ ] **Step 4: 跑测试确认通过 + 三包回归**

Run: `pnpm vitest run tests/unit/playwright-adapter.test.ts tests/unit/wechatide-adapter.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-playwright packages/adapter-wechatide packages/adapter-api tests/unit
git commit -m "feat(adapters): 定位/断言/环境错误收编为带码 TestPilotError"
```

---

### Task 6: result-collector 三桶 totals 与 run 状态

**Files:**
- Modify: `packages/execution-engine/src/engine/result-collector.ts`
- Test: `tests/unit/engine.test.ts`(追加)

**Interfaces:**
- Consumes: Task 1 的 `RunTotals` 扩展、Task 4 的新 case 状态。
- Produces: `buildRunSummary` 的 `totals.blocked` / `totals.inconclusive`(有值时输出);run `status` 优先级:`failed > inconclusive > blocked > passed > skipped`:

```ts
const status: RunStatus =
  totals.failed > 0 ? 'failed'
  : (totals.inconclusive ?? 0) > 0 ? 'inconclusive'
  : (totals.blocked ?? 0) > 0 ? 'blocked'
  : totals.passed > 0 || totals.cases === 0 ? 'passed'
  : 'skipped'
```

- [ ] **Step 1: 写失败测试**

```ts
// 1) cases = [blocked] → summary.status 'blocked',totals.blocked === 1
// 2) cases = [inconclusive] → 'inconclusive'
// 3) cases = [failed, blocked] → 'failed'(产品优先)
// 4) cases = [blocked, inconclusive] → 'inconclusive'
// 5) cases = [passed] → 'passed'(现状回归)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/engine.test.ts`
Expected: 1)-4) FAIL

- [ ] **Step 3: 实现**

totals 加 `blocked: cases.filter(status==='blocked').length`、`inconclusive: ...`;status 按上述表达式(现有三元链改写)。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/execution-engine/src/engine/result-collector.ts tests/unit/engine.test.ts
git commit -m "feat(engine): run 汇总三桶计数与状态优先级"
```

---

### Task 7: reporter 分类升级与三桶展示

**Files:**
- Modify: `packages/reporter/src/classify.ts`、`packages/reporter/src/summary-report.ts`、`packages/reporter/src/report.ts`
- Test: `tests/unit/reporter.test.ts`(追加)

**Interfaces:**
- Consumes: Task 1 的 `verdictFromErrorCode`(从 `@testpilot/core` 导入)。
- Produces:
  - `classify.ts` 新增 `export function classifyFromCode(code: string | undefined): FailureCategory | undefined`——码→分类映射:`ASSERTION_FAILED|REQUEST_COUNT_MISMATCH|STATUS_MISMATCH|STEP_TIMEOUT→'assert'`、`ELEMENT_NOT_FOUND→'element'`、`ADAPTER_NOT_FOUND|UNSUPPORTED_ACTION|CONFIG_MISSING→'adapter'`、`ENVIRONMENT_UNAVAILABLE|FIXTURE_MISSING|ACCOUNT_UNAVAILABLE→'env'`、`PREREQ_VARIABLE_MISSING→'other'`。
  - `classifyFailure(message)` **签名与行为不变**(regex,legacy 路径)。
  - 新增 `export type Verdict` 从 core re-export;`report.ts` 失败用例按 `verdictFromErrorCode` 分三组渲染:组标题「产品失败 / 环境与前置(非产品回归) / 未验证」;历史步骤无 errorCode 时沿用 `classifyFailure` 后映射到默认组 `product`。
  - `summary-report.ts` 内部的 status 字面量 union(line 72 附近 `status: 'passed' | 'failed' | 'skipped'` 等)扩展 `'blocked' | 'inconclusive'`;汇总块输出三桶计数。

- [ ] **Step 1: 写失败测试**

```ts
// 1) classifyFromCode 全映射表(上列 10 个码 → 期望分类;PREREQ_VARIABLE_MISSING → 'other')
// 2) classifyFailure('断言失败:xxx') 仍走 regex(现状回归)
// 3) summary-report:含 blocked/inconclusive case 的 run → 汇总含 blocked/inconclusive 计数且 status 透传新值
// 4) report:errorCode='ENVIRONMENT_UNAVAILABLE' 的失败 case 落「环境与前置」组;无 errorCode 的失败落「产品失败」组(Review Focus 1)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/reporter.test.ts`
Expected: 新增用例 FAIL

- [ ] **Step 3: 实现**

`classify.ts` 加 `classifyFromCode`(纯映射表);`summary-report.ts` 聚合处:case 分类改 `classifyFromCode(item.errorCode) ?? (item.status==='failed' ? classifyFailure(item.error) : undefined)`,union 扩展;`report.ts` 步骤级同样 errorCode 优先,失败 case 分组渲染(三组标题如上,blocked 组副标注"非产品回归")。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/reporter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/reporter tests/unit/reporter.test.ts
git commit -m "feat(reporter): errorCode 优先分类,失败三桶分组展示"
```

---

### Task 8: CLI run exit code 与输出

**Files:**
- Modify: `apps/cli/src/commands/run.ts`
- Test: `tests/unit/cli-exit.test.ts`(新)

**Interfaces:**
- Consumes: Task 6 的 `RunSummary.status`。
- Produces: `export function exitCodeForSummary(status: RunSummary['status']): 0 | 1 | 2`——`'failed' | 'inconclusive' → 1`,`'blocked' → 2`,其余 → `0`;action 内以 `process.exitCode = exitCodeForSummary(summary.status)` 替换现有 `if (... 'failed')` 行;输出行 totals 段追加 `⊘${totals.blocked ?? 0}` 与 `?${totals.inconclusive ?? 0}`(blocked=⊘ 环境、inconclusive=❓未验证,符号跟在既有 ✓✗↷⚠ 风格后)。

- [ ] **Step 1: 写失败测试 `tests/unit/cli-exit.test.ts`**

```ts
// exitCodeForSummary('passed')===0;('skipped')===0;('failed')===1;('inconclusive')===1;('blocked')===2
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/cli-exit.test.ts`
Expected: FAIL(函数不存在)

- [ ] **Step 3: 实现**

`run.ts` 顶部导出该纯函数;action 内替换 exit 行、扩展输出行字符串。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/cli-exit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/run.ts tests/unit/cli-exit.test.ts
git commit -m "feat(cli): run 按 blocked/inconclusive 区分 exit code(0/1/2)"
```

---

### Task 9: web/server 适配与全链路回归

**Files:**
- Modify: `apps/web/src/api/types.ts`(status 字面量 union 三处:line 54 RunStatus、83 StepStatus、114/132 CaseStatus 类复制)+ 渲染新状态的组件(grep 定位)
- Verify: `apps/server` 消费点

**Interfaces:**
- Consumes: Task 1/4/6 的新状态值。
- Produces: web 类型与渲染识别 `blocked` / `inconclusive`;server 无需行为变更(仅核对)。

- [ ] **Step 1: grep server/web 的 status 消费点**

Run: `grep -rn "case-finished\|'failed'\|\"failed\"" apps/server/src apps/web/src --include="*.ts" --include="*.tsx" | grep -v test`
记录所有 switch/比较点清单(预期:server orchestrator 的 run 状态推进、web 的 badge 渲染)。

- [ ] **Step 2: 扩展 `apps/web/src/api/types.ts` 三个 union,补齐渲染**

所有渲染 status 的 switch/映射表补 `'blocked'`(⊘,中性色)与 `'inconclusive'`(❓,警示色)分支;server 侧若存在把非 `passed` 一律视为失败的布尔判断,补 `blocked`/`inconclusive` 归入"非成功"即可,不改变 run 编排语义。

- [ ] **Step 3: 验证(Review Focus 5)**

Run: `pnpm typecheck && pnpm test && pnpm lint`
Expected: 全绿;grep 确认无裸比较 `status === 'failed' ? : else passed` 遗漏新状态的渲染分支

- [ ] **Step 4: Commit**

```bash
git add apps/web apps/server
git commit -m "feat(web,server): 适配 blocked/inconclusive 状态"
```

---

### Task 10: 文档对齐

**Files:**
- Modify: `docs/cli.md`(run 命令 exit code 说明补 0/1/2)、`skills/testpilot/SKILL.md`(CLI 节后补一行:失败三桶语义)
- Test: 无(纯文档)

- [ ] **Step 1: 更新两处文档**,内容以 spec「错误码与三桶映射」表为准,各不超过 15 行。
- [ ] **Step 2: Commit**

```bash
git add docs/cli.md skills/testpilot/SKILL.md
git commit -m "docs: run exit code 与三态判定说明"
```

---

### Task 11: 评审 workflow 并入 charter 视角矩阵(特性③)

**Files:**
- Modify: `skills/testpilot/workflows/test-requirements-review.md`

**Interfaces:**
- Produces: 评审新增固定步骤与产物模板(被 Task 12 的 create-case 规则引用)。

- [ ] **Step 1: 编辑 workflow**

在步骤 5「建立规则矩阵」之后插入新步骤「5.5 套用 charter 视角矩阵」(后续步骤号顺延),内容:

- 固定 5 视角 checklist(判定问题照抄 spec 表格):persona / 边界输入 / 数字与文案 / 状态恢复 / 错误路径
- 规则:每个测试点至少标注一个视角;某视角在本需求内无任何测试点时,**必须显式记录「不适用 + 需求证据」,禁止静默跳过**
- 步骤 6 测试点清单表格定义增加「视角」列
- 新增「视角覆盖表」模板(放进评审产物 `tests/e2e/reviews/<需求-slug>-coverage.md` 同文件末尾):

```markdown
## 视角覆盖表

| 视角 | 测试点 | 说明 |
| --- | --- | --- |
| persona | TP-001, TP-003 | 覆盖首次用户与无权限角色 |
| edge-input | TP-002 | 覆盖空值与超长输入 |
| numbers-copy | TP-001 | 金额计算 |
| state-recovery | 不适用 | 需求无跨刷新状态(PRD §2 未涉及) |
| error-path | TP-004 | 支付失败回退 |
```

- 铁律节追加一条:「视角覆盖表缺任意一行(含不适用行)不得给出评审结论。」

- [ ] **Step 2: 通读改后全文核对步骤号连续性与表格列一致**

Run: 人工通读(或 `git diff skills/testpilot/workflows/test-requirements-review.md`)
Expected: 步骤号 1-10 连续、无交叉引用断裂

- [ ] **Step 3: Commit**

```bash
git add skills/testpilot/workflows/test-requirements-review.md
git commit -m "feat(skill): 需求评审并入 charter 视角矩阵"
```

---

### Task 12: create-case 与 case-design 的 tag 映射规则(特性③)

**Files:**
- Modify: `skills/testpilot/workflows/create-case.md`、`skills/testpilot/rules/case-design.md`

**Interfaces:**
- Consumes: Task 11 的视角定义。
- Produces: TP 视角 → case `tags` 的固定映射:`persona→charter:persona`、`edge-input→charter:edge-input`、`numbers-copy→charter:numbers-copy`、`state-recovery→charter:state-recovery`、`error-path→charter:error-path`。

- [ ] **Step 1: create-case.md 增加规则段**——按测试点清单建 Case 时,把该 TP 的每个视角写入 case `tags`(与既有 tag 如 `smoke` 共存,一 TP 多视角则多 tag);附映射表与一个 YAML 片段示例。
- [ ] **Step 2: case-design.md 补一小节**——`charter:*` 前缀保留含义、查询方式 `npx csspilot list --tag charter:error-path`。
- [ ] **Step 3: Commit**

```bash
git add skills/testpilot/workflows/create-case.md skills/testpilot/rules/case-design.md
git commit -m "feat(skill): create-case 按 TP 视角写 charter tags"
```

---

### Task 13: 示例对齐与验收(特性③)

**Files:**
- Modify: `examples/cases/order-create.yaml`(tags 数组追加 charter tag)

- [ ] **Step 1: 按 order-create.yaml 现有步骤语义选 1-2 个适配视角写入 `tags`(如正向下单主流程 → `charter:persona`;有金额断言 → `charter:numbers-copy`),不虚构不存在断言的视角。**
- [ ] **Step 2: 验证**

Run: `cd examples && npx csspilot validate && npx csspilot list --tag charter:persona`
Expected: validate 全过;list 输出包含 order-create

- [ ] **Step 3: Commit**

```bash
git add examples/cases/order-create.yaml
git commit -m "chore(examples): order-create 示范 charter tags"
```

---

## 收尾

- [ ] 全量验证:`pnpm typecheck && pnpm test && pnpm lint` 全绿;对照 spec 逐节勾验(错误码表 → Task 1/3/5;类型 → Task 1;引擎 → Task 2/3/4;消费面 → Task 7/8/9;测试计划 → 各 Task;特性③ → Task 11-13)。
