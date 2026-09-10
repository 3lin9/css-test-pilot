# TestPilot V0.1 — Web / Backend / Agent 增量设计

> 本文只描述在已经完成的 TestPilot V0.1 Core 架构基础上的新增与调整内容，不推翻现有 Core / DSL / Execution Engine / Adapter / Case 设计。

## 1. 目标

在现有 TestPilot V0.1 基础上增加：

- Web：测试控制台
- Backend：Control Plane API
- Agent：AI 测试需求与 Case 编排能力
- SDK：CLI / Backend / Agent 与 TestPilot Core 的统一编程接口

核心目标：

```text
用户需求
   ↓
Agent / Skill
   ↓
Case / DSL
   ↓
TestPilot SDK
   ↓
Execution Engine
   ↓
Adapter
   ↓
Web / Mini Program
   ↓
Evidence / Report
```

## 2. 核心边界

### TestPilot Core

负责：

- CLI
- DSL
- Execution Engine
- Adapter
- Evidence
- Reporter
- Skill Runtime

不负责：

- 业务 Case
- 业务 Skill
- Login / Order / Payment 等业务能力
- Web Dashboard
- Backend 业务 API
- Agent

### Business Project

负责：

```text
testpilot.yaml

tests/
└── e2e/
    └── cases/

.agents/
└── skills/
    └── testpilot/

.testpilot/
```

| 目录                        | 职责                             |
| --------------------------- | -------------------------------- |
| `.agents/skills/testpilot/` | AI 使用 TestPilot 的规范         |
| `.testpilot/`               | TestPilot Runtime 配置、运行产物 |
| `tests/e2e/`                | 业务测试资产                     |
| `tests/e2e/cases/`          | 业务 Case                        |
| `testpilot.yaml`            | 项目级 TestPilot 配置            |

## 3. Monorepo 增量结构

在现有 TestPilot V0.1 基础上增加：

```text
testpilot/
│
├── apps/
│   ├── cli/              # 已有，保持
│   ├── server/           # 新增
│   ├── web/              # 新增
│   └── agent/            # 新增
│
├── packages/
│   ├── core/             # 已有
│   ├── dsl/              # 已有
│   ├── execution-engine/ # 已有
│   ├── adapter-core/     # 已有
│   ├── adapter-playwright/
│   ├── adapter-wechatide/
│   ├── evidence/
│   ├── reporter/
│   └── sdk/              # 新增，关键
│
├── skills/
│   └── testpilot/        # 已有
│
├── examples/
├── tests/
├── docs/
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## 4. SDK

新增：

```text
packages/sdk/
└── src/
    ├── client.ts
    ├── project.ts
    ├── cases.ts
    ├── runs.ts
    ├── reports.ts
    └── index.ts
```

SDK 是上层应用访问 TestPilot Core 的统一入口：

```text
CLI ──────┐
Server ───┼──→ @testpilot/sdk → TestPilot Core
Agent ────┘
```

禁止：

```text
Server → execution-engine
Agent  → execution-engine
Web    → adapter-playwright
Agent  → Playwright
```

统一通过 SDK。

## 5. CLI

现有 CLI 保持：

```bash
npx csspilot init
npx csspilot validate
npx csspilot list
npx csspilot run
npx csspilot report
npx csspilot doctor
```

### init 增强

`init` 定义为：

> 将 TestPilot 接入当前业务项目。

流程：

```text
检测项目
   ↓
检测测试结构
   ↓
安装 TestPilot Skill
   ↓
.agents/skills/testpilot/
   ↓
初始化 .testpilot/
   ↓
检测 / 创建 tests/e2e/
   ↓
创建 testpilot.yaml
   ↓
检测 Adapter
```

Skill 必须安装到：

```text
.agents/skills/testpilot/
```

不要使用：

```text
.testpilot/skills/
```

## 6. TestPilot Skill

TestPilot 仓库：

```text
skills/
└── testpilot/
    ├── manifest.yaml
    ├── SKILL.md
    ├── rules/
    │   ├── case-design.md
    │   ├── dsl.md
    │   ├── locator.md
    │   └── assertion.md
    │
    └── workflows/
        ├── create-case.md
        ├── validate.md
        ├── run.md
        └── analyze-result.md
```

安装到业务项目：

```text
.agents/
└── skills/
    └── testpilot/
```

Skill 负责告诉 AI：

- TestPilot 是什么
- 什么场景应该使用 TestPilot
- Case 怎么设计
- DSL 怎么写
- Locator 怎么确定
- 如何 validate
- 如何 run
- 如何分析结果

Skill 不负责直接操作 Playwright、WeChatIDE 或保存业务 Case。

## 7. Agent

新增：

```text
apps/agent/
└── src/
    ├── agent.ts
    ├── tools/
    │   ├── inspect-project.ts
    │   ├── list-cases.ts
    │   ├── read-case.ts
    │   ├── create-case.ts
    │   ├── validate.ts
    │   ├── run.ts
    │   ├── get-run.ts
    │   └── get-report.ts
    ├── planner/
    ├── context/
    └── index.ts
```

V0.1 只做一个：

```text
TestPilotAgent
```

不做 Multi-Agent。

核心流程：

```text
用户需求
   ↓
Project Discovery
   ↓
Requirement Understanding
   ↓
Case Generation
   ↓
Validate
   ↓
Run
   ↓
Analyze Result
```

## 8. Agent 与 Skill

固定关系：

```text
AI Agent
   ↓
TestPilot Skill
   ↓
TestPilot Tools
   ↓
@testpilot/sdk
   ↓
TestPilot Core
```

禁止：

```text
Agent → Playwright
Agent → WeChatIDE
Agent → Execution Engine
```

## 9. Agent Tools

V0.1：

```text
testpilot.inspect_project
testpilot.list_cases
testpilot.read_case
testpilot.create_case
testpilot.validate
testpilot.run
testpilot.get_run
testpilot.get_report
```

未来再增加：

```text
testpilot.inspect_page
testpilot.find_locator
testpilot.analyze_failure
testpilot.suggest_fix
```

## 10. AI 生成 Case 原则

AI 不允许凭空猜测试步骤。

正确流程：

```text
用户需求
   ↓
读取 Skill
   ↓
分析项目代码
   ↓
分析页面 / 路由 / 组件
   ↓
获取 Evidence
   ↓
生成测试步骤
   ↓
生成 Case
   ↓
validate
```

AI 应生成业务项目中的：

```text
tests/e2e/cases/order-create.yaml
```

而不是直接生成 Playwright 代码。

## 11. Backend

新增：

```text
apps/server/
└── src/
    ├── routes/
    │   ├── health.ts
    │   ├── projects.ts
    │   ├── cases.ts
    │   ├── runs.ts
    │   └── reports.ts
    ├── services/
    │   ├── project-service.ts
    │   ├── case-service.ts
    │   ├── run-service.ts
    │   └── report-service.ts
    ├── repositories/
    ├── db/
    ├── orchestrator/
    └── server.ts
```

技术：

```text
Fastify
SQLite
Drizzle
```

Backend 是：

> TestPilot Control Plane API

负责：

- 项目管理
- Case 元数据
- Run 管理
- Run Event
- Report 元数据
- Agent API
- Web API

不负责实现测试执行引擎。

执行：

```text
POST /api/runs
      ↓
run-service
      ↓
@testpilot/sdk
      ↓
Execution Engine
```

## 12. Backend API V0.1

```text
GET /api/health

GET /api/projects
GET /api/projects/:id

GET /api/cases
GET /api/cases/:id

POST /api/runs
GET /api/runs
GET /api/runs/:id
GET /api/runs/:id/events
POST /api/runs/:id/cancel

GET /api/runs/:id/report
```

暂不加入：

```text
baseline
RAG
权限
多用户
复杂调度
```

## 13. Web

新增：

```text
apps/web/
└── src/
    ├── pages/
    │   ├── dashboard/
    │   ├── projects/
    │   ├── cases/
    │   ├── runs/
    │   └── reports/
    ├── components/
    ├── api/
    ├── stores/
    └── router/
```

V0.1 Web 定位：

> TestPilot 测试控制台。

第一版只做：

```text
项目列表
Case 列表
执行测试
运行状态
运行日志
测试结果
截图
Trace
Report
```

暂时不做复杂 Case IDE。

## 14. Web / Server / Agent / CLI 关系

```text
                    User
                     │
             ┌───────┴───────┐
             ▼               ▼
            Web             CLI
             │               │
             ▼               ▼
          Server            SDK
             │               │
             └───────┬───────┘
                     ▼
                    SDK
                     │
                     ▼
              TestPilot Core
```

Agent：

```text
Agent
  ↓
Skill
  ↓
Tools
  ↓
SDK
  ↓
TestPilot Core
```

最终：

```text
CLI ──────┐
Server ───┼──→ SDK → TestPilot Core → Execution Engine
Agent ────┘                                  │
                                            │
                              ┌─────────────┴─────────────┐
                              ▼                           ▼
                         Playwright                   WeChatIDE
```

## 15. 配置与数据边界

业务项目：

```text
testpilot.yaml
```

仍然是项目测试配置的 Source of Truth。

不要设计成：

```text
testpilot.yaml
      ↕
    SQLite
```

SQLite 只保存：

```text
projects
environments
cases metadata
runs
run_events
reports metadata
```

不要把以下大文件放数据库：

```text
screenshots
videos
traces
logs
```

使用：

```text
.testpilot/artifacts/
```

未来服务器环境可以切换到 Object Storage。

## 16. V0.1 Golden Path

业务项目：

```text
my-project/
├── .agents/
│   └── skills/
│       └── testpilot/
├── .testpilot/
├── tests/
│   └── e2e/
│       └── cases/
└── testpilot.yaml
```

用户：

```text
npx csspilot init
```

然后：

```text
“我要测试用户下单”
```

AI：

```text
读取 TestPilot Skill
        ↓
分析项目
        ↓
生成 Case
        ↓
validate
        ↓
run
        ↓
分析结果
```

黄金测试：

```text
Mini Program
     ↓
创建订单
     ↓
extract orderId
     ↓
ExecutionContext
     ↓
Web
     ↓
验证订单
     ↓
Evidence
     ↓
Report
```

## 17. 开发顺序

虽然 Monorepo 可以同时建立四个 App，但不要同时实现所有功能。

### Phase 1：Core + CLI

继续完成：

```text
Core
DSL
Execution Engine
CLI
```

跑通：

```bash
npx csspilot validate
npx csspilot run
```

### Phase 2：Adapters

```text
Playwright Adapter
WeChatIDE Adapter
```

跑通：

```text
MiniApp → Web
```

### Phase 3：Skill

实现：

```text
.agents/skills/testpilot/
```

跑通：

```text
AI → Case → validate → run
```

### Phase 4：SDK

抽象：

```text
@testpilot/sdk
```

让：

```text
CLI
Agent
Server
```

统一访问 Core。

### Phase 5：Backend

实现：

```text
Fastify
SQLite
Drizzle
REST API
Run Orchestrator
```

### Phase 6：Web

实现：

```text
Dashboard
Projects
Cases
Runs
Reports
```

### Phase 7：Agent

实现：

```text
Requirement
 ↓
Discovery
 ↓
Case Generation
 ↓
Validate
 ↓
Run
 ↓
Analyze
```

## 18. V0.1 不做

```text
❌ Multi-Agent
❌ RAG
❌ AI 自动修复
❌ Baseline
❌ 性能基线
❌ 业务数据基线
❌ SQL Adapter
❌ MySQL Adapter
❌ Login Skill
❌ Order Skill
❌ Payment Skill
❌ Dashboard 高级 IDE
❌ 多用户
❌ 权限系统
❌ 复杂任务调度
```

## 19. 最终原则

> **TestPilot Core 负责“怎么执行测试”。**
>
> **Business Project 负责“测什么”。**
>
> **Skill 负责“告诉 AI 怎么使用 TestPilot”。**
>
> **Agent 负责“把自然语言需求转成测试意图和 Case”。**
>
> **SDK 负责连接 CLI / Server / Agent 与 Core。**
>
> **Server 负责控制平面。**
>
> **Web 负责可视化控制台。**
