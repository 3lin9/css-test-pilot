# TestPilot V0.1 最终架构与 CLI / Skill 开工设计

## 1. 产品定位

**TestPilot — AI Native 跨端业务测试基础设施**

TestPilot 不是一个业务测试项目，也不是单纯的 Playwright 封装。

它是一套：

> **让 AI 能理解、生成、校验并执行业务测试的跨端测试基础设施。**

核心职责：

```text
TestPilot
├── CLI                用户 / AI 的入口
├── DSL                测试描述语言
├── Execution Engine   测试执行引擎
├── Adapter            平台执行适配器
├── Evidence           截图 / Trace / 日志
├── Reporter           测试结果
└── Skill              AI 使用 TestPilot 的能力规范
```

TestPilot 不拥有业务测试用例。

业务项目负责：

```text
Business Project
├── testpilot.yaml
├── tests/e2e/
│   └── cases/
└── .agents/skills/
    └── testpilot/
```

---

# 2. 核心设计原则

### 原则一：TestPilot 是工具，不是业务项目

错误：

```text
testpilot/
├── cases/
│   ├── login.yaml
│   └── order.yaml
```

正确：

```text
testpilot/
├── packages/
├── apps/
└── skills/
```

业务项目：

```text
my-project/
├── tests/e2e/
│   └── cases/
│       ├── login.yaml
│       └── order.yaml
```

---

### 原则二：Skill 不直接操作 Playwright / WeChatIDE

错误：

```text
AI
 ↓
Skill
 ↓
Playwright
```

正确：

```text
AI
 ↓
TestPilot Skill
 ↓
TestPilot CLI
 ↓
DSL / Case
 ↓
Execution Engine
 ↓
Adapter
 ├── Playwright
 └── WeChatIDE
```

Skill 是 AI 能力入口，不是执行器。

---

### 原则三：Case 属于业务项目

TestPilot 定义：

```text
怎么描述测试
怎么校验测试
怎么执行测试
```

业务项目定义：

```text
测什么业务
测哪个页面
测什么流程
预期是什么
```

---

### 原则四：Web 和 Mini Program 共用测试模型，但执行器不同

```text
                 TestPilot
                     │
              Execution Engine
                     │
             Adapter Resolver
                /          \
               /            \
      WebAdapter          MiniAppAdapter
           │                    │
      Playwright            WeChatIDE
```

两者共享：

- DSL
- Case
- ExecutionContext
- Event
- Artifact
- Result
- Reporter

但不强行共享底层执行实现。

---

# 3. 用户第一体验：npx csspilot init

V0.1 最重要的命令：

```bash
npx csspilot init
```

它的定义不是：

> 创建一个 TestPilot 项目。

而是：

> **把 TestPilot 接入当前业务项目。**

执行流程：

```text
npx csspilot init
        │
        ├── 检测项目
        │
        ├── 检测已有测试结构
        │
        ├── 安装 TestPilot Skill
        │       ↓
        │   .agents/skills/testpilot/
        │
        ├── 初始化 TestPilot Runtime
        │       ↓
        │   .testpilot/
        │
        ├── 创建 / 复用 tests/e2e
        │
        └── 创建 testpilot.yaml
```

---

# 4. init 后的业务项目结构

推荐：

```text
my-project/
│
├── src/
├── pages/
├── functions/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│       ├── cases/
│       ├── fixtures/
│       └── data/
│
├── .agents/
│   └── skills/
│       └── testpilot/
│           ├── SKILL.md
│           ├── manifest.yaml
│           │
│           ├── rules/
│           │   ├── case-design.md
│           │   ├── dsl.md
│           │   ├── locator.md
│           │   └── assertion.md
│           │
│           └── workflows/
│               ├── create-case.md
│               ├── validate.md
│               ├── run.md
│               └── analyze-result.md
│
├── .testpilot/
│   ├── config.yaml
│   └── artifacts/
│
└── testpilot.yaml
```

职责：

```text
.agents/skills/testpilot/
    AI 使用规范

.testpilot/
    Runtime 状态 / 运行产物

tests/e2e/
    测试资产

tests/e2e/cases/
    业务 Case

testpilot.yaml
    项目级 TestPilot 配置
```

---

# 5. CLI 设计

V0.1 CLI 保持极简。

## 5.1 init

```bash
npx csspilot init
```

职责：

- 检测项目
- 安装 Skill
- 初始化目录
- 生成配置
- 检测 Adapter
- 输出下一步操作

---

## 5.2 validate

```bash
npx csspilot validate
```

或者：

```bash
npx csspilot validate tests/e2e/cases/order.yaml
```

职责：

```text
Case
 ↓
YAML Parser
 ↓
DSL Schema
 ↓
Validator
 ↓
ValidationResult
```

检查：

- YAML 格式
- DSL 结构
- action 是否存在
- target 是否存在
- locator 是否合法
- 必填字段
- 变量引用
- Adapter 是否支持当前 action

---

## 5.3 list

```bash
npx csspilot list
```

输出：

```text
TestPilot Cases

✓ order-create
  tests/e2e/cases/order-create.yaml

✓ refund
  tests/e2e/cases/refund.yaml

✓ login
  tests/e2e/cases/login.yaml
```

支持：

```bash
npx csspilot list --tag smoke
```

---

## 5.4 run

```bash
npx csspilot run
```

默认运行项目配置中的 Case。

也支持：

```bash
npx csspilot run tests/e2e/cases/order.yaml
```

以及：

```bash
npx csspilot run --tag smoke
```

执行：

```text
CLI
 ↓
Case Loader
 ↓
DSL Validator
 ↓
Execution Engine
 ↓
Adapter
 ↓
Evidence
 ↓
Reporter
```

---

## 5.5 report

```bash
npx csspilot report
```

生成：

```text
.testpilot/artifacts/
└── runs/
    └── 20260910-001/
        ├── report.json
        ├── report.html
        ├── screenshots/
        ├── traces/
        └── logs/
```

---

## 5.6 doctor

```bash
npx csspilot doctor
```

用于检查环境。

例如：

```text
TestPilot Doctor

✓ Node.js 22
✓ TestPilot CLI
✓ Playwright
✓ Chromium
✓ testpilot.yaml
✓ TestPilot Skill

Mini Program
✓ WeChat Developer Tools
✓ MiniApp adapter

Environment looks good.
```

---

# 6. CLI V0.1 命令总览

最终先做：

```text
csspilot
│
├── init
├── validate
├── list
├── run
├── report
└── doctor
```

暂时不要做：

```text
discover
generate
repair
agent
baseline
platform
dashboard
```

这些都可以后续增加。

---

# 7. TestPilot Skill 设计

Skill 放在 TestPilot 仓库：

```text
testpilot/
└── skills/
    └── testpilot/
        ├── manifest.yaml
        ├── SKILL.md
        ├── rules/
        └── workflows/
```

安装到业务项目：

```text
.agents/
└── skills/
    └── testpilot/
```

也就是说：

```text
TestPilot Repository
        │
        │ install
        ▼
Business Project
.agents/skills/testpilot/
```

---

# 8. Skill 的定位

Skill 不负责：

```text
❌ 操作 Playwright
❌ 操作 WeChatIDE
❌ 保存业务 Case
❌ 保存业务账号
❌ 实现业务逻辑
```

Skill 负责：

```text
✓ 告诉 AI TestPilot 是什么
✓ 告诉 AI Case 怎么写
✓ 告诉 AI DSL 怎么用
✓ 告诉 AI 什么时候调用 CLI
✓ 告诉 AI 如何分析项目
✓ 告诉 AI 如何验证 Case
✓ 告诉 AI 如何执行测试
✓ 告诉 AI 如何分析结果
```

---

# 9. SKILL.md 的核心内容

建议结构：

```markdown
# TestPilot

## What is TestPilot

TestPilot is an AI Native cross-platform testing infrastructure.

## When to use

Use TestPilot when the user wants to:

- create business test cases
- validate test cases
- run tests
- inspect test results

## Core workflow

1. Understand user requirement
2. Inspect project
3. Identify test target
4. Create TestPilot Case
5. Validate Case
6. Run Case
7. Analyze result

## Important rules

- Never directly control Playwright.
- Never directly control WeChatIDE.
- Use TestPilot DSL.
- Business cases belong to the project.
- Prefer existing project conventions.
- Never invent locators without evidence.
- Validate before running.

## CLI

csspilot init
csspilot validate
csspilot list
testpilot run
csspilot report
csspilot doctor
```

---

# 10. Skill 的 AI 工作流

## Workflow 1：创建测试

用户：

> 帮我测试用户下单。

AI：

```text
1. 阅读 TestPilot Skill
2. 分析项目结构
3. 找到商品页面
4. 找到购物车
5. 找到下单页面
6. 确定测试路径
7. 生成 Case
8. validate
```

生成：

```text
tests/e2e/cases/order-create.yaml
```

---

# 11. AI 不能凭空生成测试

这是 TestPilot Skill 最重要的规范之一。

AI 应该：

```text
用户需求
    ↓
代码 / 页面 / 配置
    ↓
Evidence
    ↓
测试步骤
    ↓
Case
```

而不是：

```text
用户需求
    ↓
AI 猜
    ↓
Case
```

例如不能看到：

> 测试登录

就直接写：

```yaml
locator:
  text: 登录
```

应该先检查项目真实页面。

---

# 12. Case 生成规范

AI 生成：

```yaml
id: order-create
name: 用户创建订单

steps:
  - target: miniapp
    action: launch

  - target: miniapp
    action: click
    locator:
      text: 商品

  - target: miniapp
    action: click
    locator:
      text: 立即购买

  - target: miniapp
    action: click
    locator:
      text: 提交订单

  - target: web
    action: navigate
    url: /orders

  - target: web
    action: assert
    locator:
      css: .order-id
    expected: "${orderId}"
```

业务 Case 属于：

```text
tests/e2e/cases/
```

不是：

```text
TestPilot/packages/
```

---

# 13. Skill 中的 DSL 规范

V0.1 只支持少量稳定 Action：

```text
launch
navigate
click
input
select
wait
assert
extract
screenshot
```

暂时不要设计几十个 Action。

原则：

> **Action 是通用测试原语，不是业务能力。**

所以：

```text
login       ❌
order       ❌
payment     ❌

click       ✓
input       ✓
assert      ✓
extract     ✓
```

登录流程由多个基础 Action 组成。

---

# 14. Skill 的 CLI 调用规则

AI 不应该直接执行：

```bash
npx playwright ...
```

也不应该：

```bash
wechat-devtools ...
```

而应该：

```bash
npx csspilot validate
npx csspilot run
npx csspilot report
```

因此 AI 和执行层之间只有一个稳定入口：

```text
AI
 ↓
Skill
 ↓
TestPilot CLI
```

---

# 15. Skill manifest

建议：

```yaml
id: testpilot
name: TestPilot
version: 0.1.0

description: >
  AI Native cross-platform testing skill.

capabilities:
  - create-case
  - validate
  - run
  - list
  - report

runtime:
  cli: csspilot

permissions:
  filesystem:
    read:
      - src/**
      - pages/**
      - tests/**
      - testpilot.yaml

    write:
      - tests/e2e/**
      - .testpilot/**

  shell:
    allow:
      - npx
      - pnpm
      - npm
      - testpilot
```

这里以后可以接入你之前设计的 **Skill 安全扫描机制**。

---

# 16. TestPilot Core

V0.1 核心代码建议：

```text
testpilot/
│
├── apps/
│   └── cli/
│       └── src/
│           ├── commands/
│           │   ├── init.ts
│           │   ├── validate.ts
│           │   ├── list.ts
│           │   ├── run.ts
│           │   ├── report.ts
│           │   └── doctor.ts
│           │
│           ├── cli.ts
│           └── index.ts
│
├── packages/
│   ├── core/
│   ├── dsl/
│   ├── execution-engine/
│   ├── adapter-core/
│   ├── adapter-playwright/
│   ├── adapter-wechatide/
│   ├── evidence/
│   └── reporter/
│
├── skills/
│   └── testpilot/
│       ├── manifest.yaml
│       ├── SKILL.md
│       ├── rules/
│       └── workflows/
│
├── examples/
├── tests/
├── docs/
│
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.json
```

---

# 17. Execution Engine

核心：

```ts
interface ExecutionEngine {
  run(plan: TestPlan, context: ExecutionContext): Promise<TestResult>;

  cancel(runId: string): Promise<void>;
}
```

内部：

```text
ExecutionEngine
├── Scheduler
├── ExecutionContext
├── StepExecutor
├── AdapterResolver
├── EventBus
├── ArtifactManager
└── ResultCollector
```

---

# 18. Adapter

统一接口：

```ts
interface TestAdapter {
  launch(): Promise<void>;

  navigate(target: string): Promise<void>;

  click(locator: Locator): Promise<void>;

  input(locator: Locator, value: string): Promise<void>;

  wait(condition: WaitCondition): Promise<void>;

  assert(assertion: Assertion): Promise<void>;

  screenshot(): Promise<Artifact>;
}
```

具体实现：

```text
adapter-playwright
        ↓
     Playwright

adapter-wechatide
        ↓
    WeChatIDE
```

Engine 不知道底层细节。

---

# 19. V0.1 最重要的 Golden Path

不要用十几个 Case 验证架构。

只做一个真正能打通全链路的：

> **Mini Program 创建订单 → Web 后台验证订单**

业务项目：

```text
tests/e2e/cases/order-create.yaml
```

执行：

```text
TestPilot CLI
      ↓
DSL
      ↓
Execution Engine
      ↓
MiniAppAdapter
      ↓
WeChatIDE
      ↓
extract orderId
      ↓
ExecutionContext
      ↓
WebAdapter
      ↓
Playwright
      ↓
assert orderId
      ↓
Evidence
      ↓
Report
```

如果这个流程稳定：

> TestPilot V0.1 的核心架构基本就被验证了。

---

# 20. 开工顺序

不要先做 Skill Engine。

第一阶段：

```text
Phase 1
项目骨架
 ↓
Phase 2
CLI init / validate
 ↓
Phase 3
DSL
 ↓
Phase 4
Execution Engine
 ↓
Phase 5
Playwright Adapter
 ↓
Phase 6
WeChatIDE Adapter
 ↓
Phase 7
Cross-platform Case
 ↓
Phase 8
TestPilot Skill
```

其中：

### Phase 1

建立：

```text
pnpm workspace
Turbo
TypeScript
ESLint
Vitest
```

---

### Phase 2

先实现：

```bash
csspilot init
csspilot validate
csspilot list
testpilot run
csspilot report
csspilot doctor
```

CLI 必须可以独立工作。

---

### Phase 3

定义 DSL：

```text
schema
parser
validator
types
```

先不要追求复杂。

---

### Phase 4

实现：

```text
ExecutionContext
StepExecutor
AdapterResolver
EventBus
ArtifactManager
ResultCollector
```

---

### Phase 5

只实现：

```text
PlaywrightAdapter
```

先跑通：

```text
launch
navigate
click
input
wait
assert
screenshot
```

---

### Phase 6

实现：

```text
MiniAppAdapter
```

把 WeChatIDE 的特殊能力封装进去。

---

### Phase 7

完成黄金 Case：

```text
MiniApp
  ↓
extract
  ↓
orderId
  ↓
Web
  ↓
assert
```

---

### Phase 8

最后再完善：

```text
.agents/skills/testpilot/
```

让 AI 真正做到：

```text
需求
 ↓
项目分析
 ↓
生成 Case
 ↓
validate
 ↓
run
 ↓
分析结果
```

---

# 21. V0.1 明确不做

为了避免架构再次膨胀，以下全部延后：

```text
❌ Dashboard
❌ Fastify
❌ SQLite
❌ Drizzle
❌ RAG
❌ AI Planner
❌ AI Agent Loop
❌ AI 自动修复
❌ Baseline
❌ 性能基线
❌ 业务数据基线
❌ SQL Adapter
❌ MySQL Adapter
❌ Login Skill
❌ Order Skill
❌ Payment Skill
❌ 多用户
❌ 权限系统
```

尤其是：

```text
login
order
payment
```

永远不要放进 TestPilot Core。

它们应该是业务项目里的 Case。

---

# 22. 最终架构关系

最终只记住这一张图：

```text
                         AI
                          │
                          ▼
                .agents/skills/testpilot
                          │
                          │ 规范 / 能力
                          ▼
                    TestPilot CLI
                          │
                          ▼
                    TestPilot DSL
                          │
                          ▼
                 Execution Engine
                          │
                    Adapter Resolver
                     /            \
                    /              \
                   ▼                ▼
          Playwright Adapter   WeChatIDE Adapter
                   │                │
                   ▼                ▼
                 Web             Mini Program
                    \              /
                     \            /
                      ▼          ▼
                       Evidence
                          │
                          ▼
                        Report
```

而业务项目只负责：

```text
Business Project

tests/e2e/cases/
        ↑
        │
       AI
        │
用户：“我要测试下单”
```

---

# 23. 一句话定义每个东西

| 东西             | 定义                         |
| ---------------- | ---------------------------- |
| TestPilot        | 测试基础设施                 |
| CLI              | TestPilot 的统一入口         |
| Skill            | AI 使用 TestPilot 的能力规范 |
| DSL              | 测试描述语言                 |
| Case             | 业务项目中的测试资产         |
| Execution Engine | 执行 DSL 的核心              |
| Adapter          | 对接具体平台                 |
| Evidence         | 测试证据                     |
| Reporter         | 测试结果输出                 |
| `.agents/skills` | AI Skill 安装位置            |
| `.testpilot`     | TestPilot Runtime 数据       |
| `tests/e2e`      | 业务项目测试目录             |

最终原则：

> **AI 决定“测什么”，Skill 规定“怎么描述和使用”，DSL 描述测试，Engine 负责执行，Adapter 负责操作平台，业务项目负责保存 Case。**
