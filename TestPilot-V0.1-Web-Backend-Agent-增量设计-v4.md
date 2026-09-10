# TestPilot V0.1 — Web / Backend / Agent 增量设计 v3

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

| 目录 | 职责 |
|---|---|
| `.agents/skills/testpilot/` | AI 使用 TestPilot 的规范 |
| `.testpilot/` | TestPilot Runtime 配置、运行产物 |
| `tests/e2e/` | 业务测试资产 |
| `tests/e2e/cases/` | 业务 Case |
| `testpilot.yaml` | 项目级 TestPilot 配置 |

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

> **CLI 包名 / 命令统一使用 `csspilot`。**
>
> 由于 npm 上已存在 `testpilot` 包，TestPilot 项目的 CLI 对外命令调整为：
>
> ```bash
> npx csspilot <command>
> ```
>
> 产品 / 框架名称仍然是 **TestPilot**，仅 CLI 命令名使用 **CSSPilot / csspilot**，避免 npm 包名冲突。

现有 CLI：

```bash
npx csspilot init
npx csspilot validate
npx csspilot list
npx csspilot run
npx csspilot report
npx csspilot doctor
```

### 5.1 init：将 TestPilot 接入当前业务项目

`init` 的职责是：

> 建立“业务项目 ↔ TestPilot Server Project”的关联，并初始化本地 TestPilot 配置。

流程：

```text
检测项目
   ↓
检测 Git Repository
   ↓
检测测试结构
   ↓
初始化 .testpilot/
   ↓
关联 / 创建 TestPilot Project
   ↓
配置 projectId
   ↓
检测 Adapter
   ↓
准备 .agents/skills/testpilot/
```

本地项目：

```text
my-project/
├── .agents/
│   └── skills/
│       └── testpilot/
├── .testpilot/
│   └── project.json
├── tests/
│   └── e2e/
│       └── cases/
└── testpilot.yaml
```

`.testpilot/project.json` 只保存 TestPilot 项目关联信息，例如：

```json
{
  "projectId": "proj_01HXYZ"
}
```

### 5.2 Skill 安装路径

TestPilot 官方 Skill 的标准入口：

```text
.agents/skills/testpilot/
```

TestPilot 仓库：

```text
.agents/
└── skills/
    └── testpilot/
        ├── SKILL.md
        ├── references/
        ├── workflows/
        └── scripts/
```

TestPilot **只维护 `.agents/skills/testpilot/`**。

不同 AI Agent 如果使用自己的 Skill 目录，由用户自行复制：

```text
.agents/skills/testpilot/
        ↓
Agent 自己的 Skill 目录
```

TestPilot 不负责为 `.qoder`、`.claude`、`.cursor`、`.workbuddy` 等 Agent 分别维护安装器。

### 5.3 Case Metadata 不通过开发者手动 sync

不建议把：

```bash
testpilot sync
```

作为普通开发者的核心工作流。

原因：

```text
开发者 A 本地新增 Case
        ↓
A 执行 sync
        ↓
Server 已经看到新 Case
        ↓
但开发者 B 的 Git 还没有这个 Case
```

会导致：

```text
Git Case 数量 ≠ Server Case 数量
```

因此正式规则是：

> **Git Push 是 Case Metadata 进入 TestPilot Server 的正式同步边界。**

推荐 CI 使用：

```bash
npx csspilot sync-metadata
```

该命令专门用于 CI，不建议依赖开发者手动执行。

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
    │   ├── reports.ts
    │   └── integrations.ts
    ├── services/
    │   ├── project-service.ts
    │   ├── case-service.ts
    │   ├── run-service.ts
    │   ├── report-service.ts
    │   └── metadata-sync-service.ts
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

> **TestPilot Control Plane API**

负责：

- 项目管理
- Case Metadata 索引
- Git / CI 同步入口
- Run 管理
- Run Event
- Report Metadata
- Environment 管理
- Account / Secret 元数据管理
- Runner 管理
- Agent API
- Web API

不负责：

- 业务 Case 的 Source of Truth
- 直接维护另一份完整 Case DSL
- 在 Server 内重复实现 Execution Engine

### 11.1 Server 与业务项目的关系

核心原则：

```text
Business Project Git
        │
        │ Source of Truth
        ▼
Case / DSL
        │
        │ git push
        ▼
CI / Webhook
        │
        │ metadata sync
        ▼
TestPilot Server
        │
        ▼
Case Index
        │
        ▼
TestPilot Web
```

Server 中的 Case 是：

> **Case Metadata / Index，而不是 Case 源文件的第二份 Source of Truth。**

例如业务项目：

```yaml
id: ORDER-001
title: 用户创建订单

steps:
  ...
```

Server 只保存：

```json
{
  "id": "ORDER-001",
  "projectId": "proj_01HXYZ",
  "title": "用户创建订单",
  "file": "tests/e2e/cases/order-create.yaml",
  "branch": "main",
  "commit": "a82fd91",
  "status": "active"
}
```

不要求 Server 长期保存完整 `steps`。

### 11.2 Case Metadata 同步策略

推荐采用：

> **Git Push → CI → `testpilot sync-metadata` → Server**

例如：

```text
Developer
   │
   │ git push
   ▼
Git Repository
   │
   ▼
CI
   │
   │ npx csspilot sync-metadata
   ▼
TestPilot Server
   │
   ▼
Case Index
```

`sync-metadata` 执行：

1. 读取 `.testpilot/project.json`
2. 获取当前 Git Repository
3. 获取当前 Branch
4. 获取当前 Commit SHA
5. 扫描业务项目 Case
6. 解析 Case Metadata
7. 计算新增 / 修改 / 删除
8. 将当前 Case Snapshot 提交到 Server
9. 更新 `lastSyncedCommit`

### 11.3 Snapshot Sync

不要只做简单：

```text
INSERT Case
```

而应该同步当前 Git Commit 对应的完整 Case Snapshot。

例如 Server 原来：

```text
A
B
C
D
E
```

Git Push 后：

```text
A
B
C
D
```

同步后：

```text
A active
B active
C active
D active
E deleted
```

建议 Case Metadata：

```text
active
deleted
```

历史 Run 仍然可以引用已删除 Case。

### 11.4 为什么 Git Push 才同步

未 Push 的本地 Case：

```text
A 本地：
128 Cases
```

Server：

```text
128 Cases
```

另一位开发者 B：

```text
Git：
120 Cases
```

这是允许的，因为 A 的修改还没有进入团队共享状态。

当 A：

```bash
git push
```

CI 自动：

```text
sync-metadata
```

之后：

```text
Git main
    ↓
129 Cases
    ↓
Server Case Index
    ↓
Web
    ↓
所有团队成员看到 129 Cases
```

因此：

> **Git Push 是团队 Case Metadata 的共享边界。**

### 11.5 Server 不成为第二个 Git

禁止设计：

```text
Git Case
    ↕
Server Case
```

双向同步。

正确模型：

```text
Git
 ↓
Metadata Sync
 ↓
Server Case Index
```

Web 可以查看 Case Metadata，但 V0.1 不做复杂 Case IDE，也不允许 Web 修改 Case 源文件。

## 12. Backend API V0.1

### 12.1 Project

```text
GET  /api/projects
GET  /api/projects/:id
POST /api/projects
```

### 12.2 Case Metadata

```text
GET  /api/projects/:projectId/cases
GET  /api/projects/:projectId/cases/:caseId
POST /api/projects/:projectId/cases/sync
```

`POST /cases/sync` 是 CI / Webhook 使用的正式入口。

请求核心信息：

```json
{
  "repository": "git@github.com:company/my-project.git",
  "branch": "main",
  "commit": "a82fd91",
  "cases": [
    {
      "id": "ORDER-001",
      "title": "用户创建订单",
      "file": "tests/e2e/cases/order-create.yaml"
    }
  ]
}
```

### 12.3 Runs

```text
POST /api/runs
GET  /api/runs
GET  /api/runs/:id
GET  /api/runs/:id/events
POST /api/runs/:id/cancel
```

### 12.4 Reports

```text
GET /api/runs/:id/report
```

### 12.5 Project Sync Status

Web 需要知道项目当前是否已经和 Git 同步：

```text
GET /api/projects/:id/sync-status
```

返回：

```json
{
  "branch": "main",
  "lastSyncedCommit": "a82fd91",
  "caseCount": 128,
  "lastSyncedAt": "2026-09-10T07:42:00Z"
}
```

暂不加入：

```text
baseline
RAG
复杂权限
复杂调度
```

## 12.6 Server 数据模型

V0.1 推荐核心模型：

```text
Project
   │
   ├── Case
   │     ├── metadata
   │     ├── commit
   │     └── status
   │
   ├── Environment
   │
   └── ...

Workspace
   │
   ├── Project Environment Binding
   ├── Account
   └── Secret

Runner

Run
   ├── StepResult
   ├── RunEvent
   ├── Artifact
   ├── Report
   └── Workspace Snapshot
         ├── StepResult
         ├── RunEvent
         ├── Artifact
         └── Report
```

### Project

```text
id
name
repositoryUrl
defaultBranch
lastSyncedCommit
lastSyncedAt
createdAt
updatedAt
```

### Case

```text
id
projectId
title
filePath
branch
commit
status
tags
updatedAt
```

Case 不保存业务执行逻辑的第二份完整副本。

### Run

```text
id
projectId
caseId
environmentId
commit
status
startedAt
finishedAt
duration
```

Run 必须记录执行时的：

```text
project
case
environment
commit
```

这样即使 Case 后续被修改，历史 Run 仍然可以准确追溯。


## 12.7 跨项目关联：Project / Environment / Workspace

随着真实业务场景增加，一个测试项目往往不再是单一系统。

例如“商城小程序”的一次完整测试，可能同时依赖：

```text
PPM
 └── 配置优惠信息

商城后台
 └── 配置商品 / 活动 / 库存

商城小程序
 └── 用户购买
       ↓
    验证优惠
       ↓
    验证订单
```

因此，TestPilot **应该支持跨项目关联**，但不建议直接设计成：

```text
Project A dependsOn Project B
```

因为这里真正需要表达的不是代码依赖，而是：

> **一次测试运行需要哪些系统、哪些环境，以及这些系统之间如何组成一个可执行的测试环境。**

### 12.7.1 Project 与测试环境的边界

`Project` 仍然表示一个被 TestPilot 管理的业务代码 / Git 项目：

```text
Projects
├── 商城小程序
├── 商城后台
└── PPM
```

每个 Project 可以拥有多个 Environment：

```text
商城小程序
├── TEST
├── STAGING
└── PROD

商城后台
├── TEST
└── STAGING

PPM
├── TEST
└── STAGING
```

因此：

```text
Project
  ↓
Project Environment
```

### 12.7.2 引入 Test Workspace

当一次测试需要组合多个项目时，引入：

> **Test Workspace：一次测试运行所使用的多系统测试环境组合。**

例如：

```text
Test Workspace
└── 商城测试环境
```

它绑定：

```text
商城小程序 → TEST
商城后台   → TEST
PPM        → TEST
```

另一个：

```text
商城预发环境
├── 商城小程序 → STAGING
├── 商城后台   → STAGING
└── PPM        → STAGING
```

核心关系：

```text
Workspace
   │
   ├── Project Environment
   ├── Project Environment
   └── Project Environment
```

而不是：

```text
Workspace
   ├── Project
   └── Project
```

因为真正决定运行行为的是“项目 + 环境”。

### 12.7.3 Case 引用 Workspace

业务 Case 不应该把多个系统的 URL、账号、配置硬编码进去。

不推荐：

```yaml
id: ORDER-001
title: 使用优惠券创建订单

ppmUrl: https://ppm-test.xxx
mallAdminUrl: https://admin-test.xxx
miniappUrl: https://mall-test.xxx
```

推荐：

```yaml
id: ORDER-001
title: 使用优惠券创建订单

workspace: mall-test

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
```

Case 只表达测试意图，Workspace 负责提供运行时环境。

### 12.7.4 Workspace 与 Account / Secret

Workspace 可以进一步关联团队共享资源：

```text
Workspace
│
├── Project Environments
│   ├── 商城小程序 / TEST
│   ├── 商城后台 / TEST
│   └── PPM / TEST
│
├── Accounts
└── Secrets
```

例如：

```yaml
workspace: mall-test
accountRef: test-user
```

Case 不保存密码、Token、Cookie、Private Key 等敏感信息。

原则：

```text
Case
  ↓ reference
Account / Secret
  ↓ resolve
Workspace / Runtime
```

### 12.7.5 跨项目能力不要直接进入 TestPilot Core

例如：

```text
优惠券
商品
库存
订单
支付
```

这些都属于业务概念，不能因为跨项目测试就塞进 TestPilot Core。

TestPilot Core 仍然只理解：

```text
Project
Environment
Workspace
Capability / Integration（后续）
```

而不知道：

```text
PPM 是什么
订单是什么
优惠券是什么
商品是什么
```

### 12.7.6 Capability / Integration：V0.2 再引入

当跨项目场景进一步复杂时，可以增加通用的：

```text
Capability
Integration
Provider
```

例如：

```text
Workspace
│
├── Applications
│   ├── 商城小程序
│   └── 商城后台
│
└── Capabilities
    ├── promotion
    │    └── Provider → PPM
    ├── inventory
    │    └── Provider → 商城后台
    └── payment
         └── Provider → 支付中心
```

这里 TestPilot 只认识通用能力：

```text
promotion
inventory
payment
```

而具体由哪个系统提供，由 Workspace 中的 Integration / Provider 决定。

这样未来 AI 可以表达：

```text
需要 promotion capability
```

再由：

```text
Capability Resolver
       ↓
Workspace
       ↓
Integration
       ↓
Provider
```

找到实际系统。

**注意：这属于 V0.2+ 能力，V0.1 不需要实现完整 Capability Resolver。**

### 12.7.7 Web 中的展示

Web 不建议使用“依赖项目”作为主要概念。

推荐项目详情增加：

```text
关联系统 / Test Environments
```

例如：

```text
商城小程序
────────────────────────────────

关联系统

系统          环境        状态
PPM           TEST        ✓
商城后台       TEST        ✓
支付中心       TEST        ✓
```

同时提供：

```text
Workspace

商城测试环境
商城预发环境
```

项目本身仍然是独立 Project。

### 12.7.8 Run 必须记录 Workspace Snapshot

一次 Run 不能只记录：

```text
project
case
environment
commit
```

如果 Case 使用了 Workspace，还必须记录：

```text
workspace
workspaceSnapshot
```

例如：

```text
Run #10086
Case: ORDER-001
Workspace: 商城测试环境
Commit: a82fd91

Environment Snapshot:
├── 商城小程序 → TEST
├── 商城后台   → TEST
└── PPM        → TEST
```

推荐保存运行时快照，而不是只保存 Workspace ID。

原因：

> Workspace 后续可能被修改，但历史 Run 必须仍然能够准确还原当时使用的环境组合。

### 12.7.9 Server 数据模型增量

在现有模型基础上增加：

```text
Project
   │
   └── Environment

Workspace
   │
   ├── WorkspaceProjectBinding
   │       ├── projectId
   │       └── environmentId
   │
   ├── Account
   └── Secret
```

建议：

```text
Workspace
id
name
description
createdAt
updatedAt
```

```text
WorkspaceProjectBinding
id
workspaceId
projectId
environmentId
createdAt
```

Run：

```text
Run
├── projectId
├── caseId
├── workspaceId
├── commit
└── workspaceSnapshot
```

### 12.7.10 V0.1 实现范围

V0.1 只实现：

```text
Project
  ↓
Environment

Workspace
  ↓
Project Environment Binding

Case
  ↓
Workspace

Run
  ↓
Workspace Snapshot
```

暂时不实现：

```text
❌ Capability Resolver
❌ 复杂 Integration Marketplace
❌ 自动发现 Provider
❌ 业务系统管理后台
❌ PPM 管理能力
❌ 商品 / 库存 / 优惠券管理能力
❌ 跨项目代码依赖分析
```

核心原则：

> **Workspace 负责组合测试环境，Project 负责代码与测试资产，TestPilot 不负责管理被测业务系统本身。**


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

> **TestPilot 测试控制台 + 测试可观测性平台。**

第一版重点：

```text
项目列表
项目概览
Case 列表
Case 数量
Case 同步状态
最近运行
成功 / 失败统计
Run 详情
Step 级成功 / 失败
运行日志
截图
Trace
Report
```

暂时不做：

```text
复杂 Case IDE
Web 直接编辑 Case 源文件
Web 与 Git 双向 Case 同步
```

### 13.1 项目概览

例如：

```text
┌──────────────────────────────────────────────┐
│ 小程序商城                                  │
│                                              │
│ 测试用例                 128                 │
│ 最近一次执行             126                 │
│                                              │
│ Passed                  112                 │
│ Failed                   11                 │
│ Blocked                   3                 │
│                                              │
│ Git                                      │
│ main · a82fd91                              │
│ 最后同步：5 分钟前                           │
└──────────────────────────────────────────────┘
```

### 13.2 Case 列表

Web 显示的是 Server Case Index：

```text
用户创建订单       ORDER-001       Active
用户取消订单       ORDER-002       Active
退款流程           ORDER-003       Active
历史用例           ORDER-004       Deleted
```

可以显示：

```text
文件路径
最近一次运行
最近一次结果
最近执行时间
Git Commit
```

### 13.3 Run 详情

Run 是 Web 最重要的页面之一：

```text
Run #20260910-001

状态：Failed

Case：
用户创建订单

Commit：
a82fd91

Environment：
test

────────────────────────

✓ 启动小程序
✓ 进入商品页
✓ 点击立即购买
✗ 获取订单号

失败原因：
response.orderId 不存在

[截图]
[日志]
[Trace]
```

因此 Web 不只是显示：

```text
Failed
```

而是能够定位：

```text
Case
 ↓
Step
 ↓
Error
 ↓
Evidence
```

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

### 16.1 业务项目

```text
my-project/
├── .agents/
│   └── skills/
│       └── testpilot/
├── .testpilot/
│   └── project.json
├── tests/
│   └── e2e/
│       └── cases/
│           ├── order-create.yaml
│           └── order-cancel.yaml
└── testpilot.yaml
```

### 16.2 第一次接入

```bash
npx csspilot init
```

完成：

```text
关联 TestPilot Project
        ↓
生成 projectId
        ↓
初始化 .testpilot/project.json
        ↓
准备 TestPilot Skill
        ↓
检测 Adapter
```

### 16.3 AI 创建 Case

```text
用户需求
   ↓
读取 TestPilot Skill
   ↓
分析项目
   ↓
生成 Case
   ↓
validate
   ↓
本地 run
```

Case 写入：

```text
tests/e2e/cases/
```

### 16.4 Git Push 后同步到 Web

```text
git add .
git commit
git push
   ↓
Git Repository
   ↓
CI
   ↓
npx csspilot sync-metadata
   ↓
TestPilot Server
   ↓
Case Index
   ↓
TestPilot Web
```

Web 此时可以看到：

```text
项目
Case 总数
新增 / 删除 Case
Git Commit
最近同步时间
```

### 16.5 测试执行

执行可以发生在：

```text
本地 CLI
CI Runner
TestPilot Runner
```

执行：

```text
Case
 ↓
Execution Engine
 ↓
Adapter
 ↓
Run
 ↓
Run Event
 ↓
Result / Evidence
 ↓
Server
 ↓
Web
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

虽然 Monorepo 可以同时建立多个 App，但不要同时实现所有功能。

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

统一连接：

```text
CLI
Agent
Server
```

### Phase 5：Backend + Git Metadata Sync

优先实现：

```text
Project
Case Metadata
Git Repository
Metadata Sync
Run
Run Event
Artifact Metadata
```

关键链路：

```text
git push
   ↓
CI
   ↓
testpilot sync-metadata
   ↓
Server
   ↓
Web
```

### Phase 6：Web

实现：

```text
Dashboard
Projects
Cases
Runs
Reports
Sync Status
```

重点先做好：

```text
项目 Case 数量
最近执行结果
成功 / 失败
失败 Step
截图 / Trace / Logs
Git Commit
同步状态
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
❌ 复杂多用户权限系统
❌ 复杂任务调度
❌ Web / Git 双向 Case 同步
```


> **Workspace 负责组合一次测试所需的多个 Project Environment。**
>
> **跨项目关联表达的是测试环境组合，不是代码依赖。**
>
> **Run 必须记录 Workspace Snapshot，保证历史运行可追溯。**

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
> **Server 负责控制平面、Case Metadata 索引与 Run 数据。**
>
> **Web 负责可视化控制台与测试可观测性。**
>
> **Git Push 是 Case Metadata 进入团队共享 Server 的正式同步边界。**
>
> **Git 是 Case 的 Source of Truth，Server 不是第二个 Git。**
>
> **Web 查看的是 Case Index，真正的 Case 文件始终属于 Business Project。**
