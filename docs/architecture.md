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
├── Adapter            平台执行适配器(Playwright / WeChatIDE)
├── Evidence           截图 / Trace / 日志
├── Reporter           测试结果(JSON + HTML)
└── Skill              AI 使用 TestPilot 的能力规范
```

## 最终架构图

```text
                         AI
                          │
                          ▼
                .ai/skills/testpilot
                          │ 规范 / 能力
                          ▼
                    TestPilot CLI
                          ▼
                    TestPilot DSL
                          ▼
                 Execution Engine
                          │
                    Adapter Resolver
                     /            \
                    ▼              ▼
          Playwright Adapter   WeChatIDE Adapter
                   │                │
                   ▼                ▼
                 Web             Mini Program
                    \              /
                      ▼          ▼
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

| 东西 | 定义 |
| --- | --- |
| TestPilot | 测试基础设施 |
| CLI | TestPilot 的统一入口 |
| Skill | AI 使用 TestPilot 的能力规范 |
| DSL | 测试描述语言 |
| Case | 业务项目中的测试资产 |
| Execution Engine | 执行 DSL 的核心 |
| Adapter | 对接具体平台 |
| Evidence | 测试证据 |
| Reporter | 测试结果输出 |
| `.ai/skills` | AI Skill 安装位置 |
| `.testpilot` | TestPilot Runtime 数据 |
| `tests/e2e` | 业务项目测试目录 |

## V0.1 范围

CLI 六个命令:`init` / `validate` / `list` / `run` / `report` / `doctor`。
DSL 九个基础 Action:`launch` / `navigate` / `click` / `input` / `select` / `wait` / `assert` / `extract` / `screenshot`。
Golden Path:小程序创建订单 → extract orderId → Web 后台 assert 订单号。

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
