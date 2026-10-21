# TestPilot V0.1 架构

## 定位

> TestPilot — AI Native 跨端业务测试基础设施:让 AI 能理解、生成、校验并执行业务测试。

TestPilot 是**工具,不是业务测试项目**。它定义"怎么描述 / 怎么校验 / 怎么执行测试";业务项目定义"测什么、怎么算通过",并把 Case 保存在自己的 `tests/e2e/cases/`。

核心职责:

```text
TestPilot
├── CLI                用户 / AI 的入口
├── DSL                测试描述语言
├── Execution Engine   测试执行引擎
├── Adapter            平台执行适配器(Playwright / WeChatIDE / API)
├── Evidence           截图 / Trace / 日志
├── Reporter           测试结果(JSON + HTML)
└── Skill              AI 使用 TestPilot 的能力规范
```

## 最终架构图

```text
                         AI
                          │
                          ▼
                .agents/skills/testpilot
                          │ 规范 / 能力
                          ▼
                    TestPilot CLI
                          ▼
                    TestPilot DSL
                          ▼
                 Execution Engine
                          │
                    Adapter Resolver
                   /        |        \
                  ▼         ▼         ▼
        Playwright    WeChatIDE     API
         Adapter       Adapter     Adapter
             │             │         │
             ▼             ▼         ▼
           Web      Mini Program   HTTP
                         \        /
                          ▼      ▼
                        Evidence
                           ▼
                         Report
```

## 核心原则

1. **TestPilot 是工具,不是业务项目** —— 业务 Case 属于业务项目。
2. **Skill 不直接操作 Playwright / WeChatIDE** —— 链路固定为 Skill → CLI → DSL → Engine → Adapter。
3. **Case 属于业务项目** —— TestPilot 只管描述、校验、执行。
4. **Web 与小程序共用测试模型,不共用执行实现** —— 共享 DSL / Case / Context / Event / Artifact / Result / Reporter,各自独立 Adapter。
5. **AI 不能凭空生成测试** —— 必须 Evidence-first:需求 → 代码/页面 → 证据 → 步骤 → Case。

## 一句话定义

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

## V0.1 基线范围(已全部落地)

CLI 六个命令:`init` / `validate` / `list` / `run` / `report` / `doctor`。
DSL 九个基础 Action:`launch` / `navigate` / `click` / `input` / `select` / `wait` / `assert` / `extract` / `screenshot`。
Golden Path:小程序创建订单 → extract orderId → Web 后台 assert 订单号。

> 以上为 V0.1 基线设计记录。基线之后已落地的增量(**现状以此为准**,详见 [README.md](../README.md) 路线图):
>
> - **Web / Backend / Agent 增量**:`@testpilot/sdk` 统一编程接口、Control Plane(Fastify + SQLite + Drizzle)、Web 控制台(Vue 3)、Agent 编排;CLI 追加 `sync-metadata` / `update` / `ci init`,共九个命令
> - **API Adapter**:`target: api` 与第 10 个 Action `request`,HTTP 造数、UI+API 混合编排与数据层断言
> - **数据驱动测试**:数据集展开执行、setup/teardown 阶段、静态依赖预检、QA 覆盖映射
> - **三态判定**:失败按 product / infra(blocked) / unverified(inconclusive) 三桶分流,run 退出码 0 / 1 / 2
> - **charter 视角矩阵**:评审工作流固定 5 视角,`charter:*` tags 与三分判定规则

## 开工顺序

```text
Phase 1  项目骨架(pnpm workspace / Turbo / TS / ESLint / Vitest)
Phase 2  CLI init / validate / list / run / report / doctor
Phase 3  DSL(schema / parser / validator)
Phase 4  Execution Engine(Context / StepExecutor / AdapterResolver / EventBus / ArtifactManager / ResultCollector)
Phase 5  Playwright Adapter
Phase 6  WeChatIDE Adapter
Phase 7  跨端黄金 Case
Phase 8  TestPilot Skill 完善
```

## V0.1 明确不做

Dashboard、Fastify、SQLite、Drizzle、RAG、AI Planner、AI Agent Loop、自动修复、Baseline、性能/业务数据基线、SQL/MySQL Adapter、业务 Skill(login / order / payment 永远属于业务项目的 Case)、多用户、权限系统。

> 其中 Fastify / SQLite / Drizzle / AI Planner(Agent 编排)已由 Web / Backend / Agent 增量落地(见上节);其余仍然不做。
