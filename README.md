# TestPilot

> AI Native 跨端业务测试基础设施 —— 让 AI 能理解、生成、校验并执行业务测试。

CLI 是入口,Skill 是 AI 能力入口,DSL 是测试语言,Execution Engine 是核心,Adapter 是执行器,Evidence / Reporter 是证据与结果。

TestPilot 是**工具,不是业务测试项目**:它定义怎么描述、校验、执行测试;业务项目定义测什么、怎么算通过,并把 Case 保存在自己的 `tests/e2e/cases/`。

完整架构见 [docs/architecture.md](docs/architecture.md)。

## 核心链路

```text
AI → .ai/skills/testpilot(规范) → TestPilot CLI → DSL → Execution Engine
    → Adapter(Playwright / WeChatIDE) → Evidence → Report
```

## 仓库结构

```
/
├── apps/
│   └── cli/                 # CLI(npm 包名 testpilot):init/validate/list/run/report/doctor
├── packages/                # 内部共享包,统一 scope @testpilot
│   ├── core/                # 通用类型、错误、常量、配置模型(testpilot.yaml)
│   ├── dsl/                 # 用例 DSL:schema(zod)/ parser(yaml)/ validator
│   ├── execution-engine/    # 执行引擎:engine/context/scheduler/lifecycle/events(NDJSON)/artifacts
│   ├── adapter-core/        # 适配器抽象(adapter/session/locator)
│   ├── adapter-playwright/  # Web 驱动实现(Playwright)
│   ├── adapter-wechatide/   # 小程序驱动实现(WeChat DevTools)
│   ├── evidence/            # 取证产物:screenshot/video/trace/log(文件系统)
│   └── reporter/            # 报告:report/summary/diff(JSON + HTML)
├── skills/
│   └── testpilot/           # AI Skill:manifest.yaml + SKILL.md + rules/ + workflows/
├── examples/
│   └── cases/               # DSL 示例(黄金路径:order-create.yaml)
├── tests/                   # 本仓库自身测试:unit / integration / e2e / fixtures
└── docs/                    # 架构文档
```

## CLI(V0.1)

| 命令 | 作用 |
| --- | --- |
| `npx testpilot init` | 把 TestPilot 接入当前业务项目(装 Skill 到 `.ai/skills/testpilot/`、初始化 `.testpilot/`、创建/复用 `tests/e2e`、生成 `testpilot.yaml`) |
| `npx testpilot validate [files]` | 校验 Case(DSL schema / action / locator / 变量引用 / adapter 支持) |
| `npx testpilot list [--tag]` | 列出用例 |
| `npx testpilot run [files] [--tag]` | 执行用例(Case Loader → Validator → Engine → Adapter → Evidence → Reporter) |
| `npx testpilot report [--run id]` | 生成 JSON + HTML 报告(`.testpilot/artifacts/runs/<id>/`) |
| `npx testpilot doctor` | 环境体检(Node / Playwright / WeChat DevTools / 项目配置) |

## DSL(V0.1)

九个基础 Action:`launch` `navigate` `click` `input` `select` `wait` `assert` `extract` `screenshot`。

Action 是通用测试原语,不是业务能力 —— login / order / payment 永远是业务项目里的 Case,不是 TestPilot 的 Action。示例见 [examples/cases/order-create.yaml](examples/cases/order-create.yaml)。

## 开发

要求 Node.js 22(`.nvmrc`)+ pnpm 10。

```bash
pnpm install
pnpm lint                              # ESLint(eslint.config.js)
pnpm test                              # Vitest(vitest.config.ts)
pnpm e2e                               # Playwright(playwright.config.ts)

pnpm --filter @testpilot/cli dev --help   # 本地运行 CLI
```

## 路线图

```text
Phase 1  项目骨架(✓ pnpm workspace / Turbo / TS / ESLint / Vitest)
Phase 2  CLI 六命令(✓ 全部实现:run / report 已可用)
Phase 3  DSL(✓ schema(zod)/ parser(yaml)/ validator + 单测)
Phase 4  Execution Engine(✓ Context / StepExecutor / AdapterResolver / EventBus(NDJSON)/ ArtifactManager / ResultCollector)
Phase 5  Playwright Adapter(✓ 9 个 Action 全部可用)
Phase 6  WeChatIDE Adapter(✓ 基于 miniprogram-automator,已真机验证)
Phase 7  跨端黄金 Case(✓ 已实测通过:小程序下单 → extract → Web 后台 assert,变量跨端传递)
Phase 8  TestPilot Skill 完善(随实现细节持续迭代)
```

## V0.1 明确不做

Dashboard、Fastify、SQLite、Drizzle、RAG、AI Planner / Agent Loop / 自动修复、Baseline、业务 Skill。业务动作(login / order / payment)永远属于业务项目,不要加进 TestPilot Core。

## 约定

- **workspace 成员**:`apps/cli` 与 `packages/*`;CLI 将以 npm 包名 `testpilot` 发布(内部 scope `@testpilot/*`)。
- **包间引用**:源码直引 —— 各包 `main`/`types` 指向 `src/index.ts`,配合 `tsconfig.base.json` 的 `paths` 别名,无需先构建。
- **质量工具**:Vitest 与 ESLint 集中在根配置;CI(GitHub Actions / Jenkins)跑 lint + build + test。
- **占位实现**:CLI 六个命令为可运行骨架,业务逻辑以 `TODO` 标注;空目录以 `.gitkeep` 保留结构。
