# TestPilot

> AI Native 跨端业务测试基础设施 —— 让 AI 能理解、生成、校验并执行业务测试。

CLI 是入口,Skill 是 AI 能力入口,DSL 是测试语言,Execution Engine 是核心,Adapter 是执行器,Evidence / Reporter 是证据与结果。

TestPilot 是**工具,不是业务测试项目**:它定义怎么描述、校验、执行测试;业务项目定义测什么、怎么算通过,并把 Case 保存在自己的 `tests/e2e/cases/`。

完整架构见 [docs/architecture.md](docs/architecture.md),CLI 命令详见 [docs/cli.md](docs/cli.md)。

## 核心链路

```text
AI → .agents/skills/testpilot(规范) → TestPilot CLI → DSL → Execution Engine
    → Adapter(Playwright / WeChatIDE) → Evidence → Report
```

## 仓库结构

```
/
├── apps/
│   ├── cli/                 # CLI(npm 包名 csspilot):init/validate/list/run/report/doctor
│   ├── server/              # Control Plane API(Fastify + SQLite + Drizzle)
│   ├── web/                 # 测试控制台(Vue 3:项目 / Case Index / Run / Agent Job)
│   └── agent/               # TestPilot AI:Planner + Analysis(经 Skill → SDK → Engine)
├── packages/                # 内部共享包,统一 scope @testpilot
│   ├── core/                # 通用类型、错误、常量、配置模型(testpilot.yaml)
│   ├── dsl/                 # 用例 DSL:schema(zod)/ parser(yaml)/ validator
│   ├── execution-engine/    # 执行引擎:engine/context/scheduler/lifecycle/events(NDJSON)/artifacts
│   ├── adapter-core/        # 适配器抽象(adapter/session/locator)
│   ├── adapter-playwright/  # Web 驱动实现(Playwright)
│   ├── adapter-wechatide/   # 小程序驱动实现(WeChat DevTools)
│   ├── evidence/            # 取证产物:screenshot/video/trace/log(文件系统)
│   ├── reporter/            # 报告:report/summary/diff(JSON + HTML)
│   └── sdk/                 # 统一编程接口:CLI/Server/Agent 都经由 SDK 访问 Core
├── skills/
│   └── testpilot/           # AI Skill:manifest.yaml + SKILL.md + rules/ + workflows/
├── examples/
│   └── cases/               # DSL 示例(黄金路径:order-create.yaml)
├── tests/                   # 本仓库自身测试:unit / integration / e2e / fixtures
└── docs/                    # 架构文档
```

## CLI(V0.1)

| 命令                               | 作用                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx csspilot init`                | 把 TestPilot 接入当前业务项目(装 Skill 到 `.agents/skills/testpilot/`、初始化 `.testpilot/`、创建/复用 `tests/e2e`、生成 `testpilot.yaml`) |
| `npx csspilot validate [files]`    | 校验 Case(DSL schema / action / locator / 变量引用 / adapter 支持)                                                                         |
| `npx csspilot list [--tag]`        | 列出用例                                                                                                                                   |
| `npx csspilot run [files] [--tag]` | 执行用例(Case Loader → Validator → Engine → Adapter → Evidence → Reporter)                                                                 |
| `npx csspilot report [--run id]`   | 生成 JSON + HTML 报告(`.testpilot/artifacts/runs/<id>/`)                                                                                   |
| `npx csspilot doctor`              | 环境体检(Node / Playwright / WeChat DevTools / 项目配置)                                                                                   |

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

pnpm --filter testpilot dev --help      # 本地运行 CLI(源码)
pnpm build                             # 打包 CLI(esbuild -> apps/cli/dist)
node apps/cli/dist/bin.js --help       # 运行打包产物
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
Phase 8  TestPilot Skill 完善(✓ rules/workflows 与实现对齐,随真实使用持续迭代)

增量(Web / Backend / Agent,见 TestPilot-V0.1-Web-Backend-Agent-增量设计-v4.md):
Phase 9  SDK @testpilot/sdk(✓ client/project/cases/runs/reports;CLI 已改为统一走 SDK;引擎支持取消)
Phase 10 Backend Control Plane + Git Metadata Sync(✓ Fastify + SQLite + Drizzle;快照式 Case 同步 + Run 编排)
Phase 11 Web 测试控制台(✓ Vue 3 + Vite:项目概览 / Case Index / Run 详情(Step 级结果 + 截图/日志/Trace)/ 同步状态;Server 静态托管)
Phase 12 Agent(✓ Web→Server→AgentOrchestrator→apps/agent;在 rootPath 写 YAML;push+sync-metadata 后进 Case Index)
```

## SDK 与 Control Plane(增量)

分层约定:CLI / Server / Agent 一律通过 `@testpilot/sdk` 访问 Core,禁止直连 execution-engine 或具体 adapter。

```bash
pnpm --filter @testpilot/server dev     # 启动 Control Plane API(默认 127.0.0.1:3000)
pnpm --filter @testpilot/web dev        # Web 控制台开发模式(5173,/api 代理到 3000)
pnpm --filter @testpilot/web build      # 构建控制台;Server 会自动静态托管 apps/web/dist
TESTPILOT_PROJECT_ROOT=/path/to/project pnpm --filter @testpilot/server start
```

**Git Push 是 Case Metadata 进入 Server 的正式同步边界**:Git 是 Case 的 Source of Truth,Server 只保存 Case Metadata / Index(不是第二个 Git);`POST /cases/sync` 以"当前 Commit 的完整用例列表"做快照同步,消失的 Case 标记 deleted(历史 Run 仍可引用)。

```bash
npx csspilot init            # 关联/创建 TestPilot Project,写入 .testpilot/project.json
git push -> CI -> npx csspilot sync-metadata   # Case Metadata 同步(不建议开发者手动跑)
```

REST API(V0.1):

```text
GET  /api/health
GET  /api/projects              POST /api/projects
GET  /api/projects/:id          GET  /api/projects/:id/sync-status
GET  /api/projects/:projectId/cases[/:caseId]
POST /api/projects/:projectId/cases/sync        # CI / Webhook 正式同步入口
GET  /api/projects/:projectId/environments         POST /api/projects/:projectId/environments
GET  /api/workspaces               POST /api/workspaces
GET  /api/workspaces/:id           POST /api/workspaces/:id/bindings
POST /api/runs                   GET  /api/runs
GET  /api/runs/:id               GET  /api/runs/:id/events
POST /api/runs/:id/cancel        GET  /api/runs/:id/report
GET  /api/runs/:id/summary       GET  /api/runs/:id/artifacts[/*]
POST /api/projects/:id/agent/jobs   GET /api/projects/:id/agent/jobs
GET  /api/agent/jobs/:id            GET /api/agent/jobs/:id/events
POST /api/agent/jobs/:id/cancel
```

- **Agent**(apps/agent):`TestPilot AI` = **Planner Agent**(规划/写 Case/validate/可选 run) + **Analysis Agent**(归因失败与建议)。经 Skill → `@testpilot/sdk` → Execution Engine;在项目 `rootPath` 落盘 YAML,**不**写入 Server Case Index。团队可见仍走 `git push` → `csspilot sync-metadata`。Web 项目详情页可提交 Job 并查看事件流。
- **Web 控制台**(apps/web,Vue 3 + Vite):仪表盘、项目列表/概览(Git 同步状态)、Case Index(active/deleted 过滤,可查看 DSL 源文件)、运行列表、Run 详情(Step 级结果、失败原因、截图内联预览、日志 / Trace / video 下载)、报告按需生成。生产形态由 Server 静态托管 `apps/web/dist`,单进程部署。

- **分支即测试环境**:同一 Case 可同时存在于多个分支(main→TEST、release→STAGING...);快照同步按分支作用域执行,互不影响;环境可绑定分支,Case Index 按环境(分支)筛选。
- **Workspace**:一次运行所需的多系统环境组合;绑定的是 Project Environment(不是 Project 本身)。Case 用 `workspace: <名称>` 声明,不硬编码各系统 URL/账号。
- **Run 可追溯**:每次 Run 记录 branch / commit / workspace 运行时快照——Workspace 后续可改,历史 Run 仍能还原当时的环境组合。
- **数据边界**:SQLite 只存元数据(projects / cases index / runs / run_events / reports);截图、视频、trace 留在业务项目 `.testpilot/artifacts/`;`testpilot.yaml` 仍是测试配置的 Source of Truth。

## V0.1 明确不做

RAG、AI 自动修复、Baseline、性能/业务数据基线、SQL/MySQL Adapter、业务 Skill(Login/Order/Payment)、Dashboard 高级 IDE、Multi-Agent、多用户、权限系统、复杂任务调度。业务动作(login / order / payment)永远属于业务项目,不要加进 TestPilot Core。

## 构建与发布

CLI 以 npm 包名 `csspilot` 发布:esbuild 单文件打包,内部 `@testpilot/*` 全部打入产物,`playwright` / `miniprogram-automator` 保持外部依赖,skill 目录随包分发。

**自动发布(推荐)**:推送 `v*` 标签触发 `.github/workflows/publish.yml` —— 校验 tag 与包版本一致 → build → test → e2e → publish(npmjs)。一次性准备:仓库 Settings → Secrets and variables → Actions 添加 `NPM_TOKEN`(npmjs 的 Granular/Automation token,需具备 `csspilot` 包发布权限且允许绕过 2FA)。

```bash
# 发版流程:
# 1) 更新 apps/cli/package.json 的 version、apps/cli/src/cli.ts 的 CLI_VERSION
#    与 skills/testpilot/manifest.yaml 的 version(三处保持一致)
# 2) 提交后打标签推送,CI 自动完成发布
# 3) 已安装的业务项目:升级 csspilot 依赖后 npx csspilot update 同步接入物
git tag v0.4.0 && git push origin v0.4.0
```

**手动发布(备用)**:

```bash
pnpm --filter csspilot build
cd apps/cli && pnpm publish --no-git-checks --access public --registry https://registry.npmjs.org
```

业务项目安装后即可 `npx csspilot init`,`init` 会把包内 skills/testpilot 安装到业务项目 `.agents/skills/`。

## 约定

- **workspace 成员**:`apps/*` 与 `packages/*`;CLI 即 npm 包 `csspilot`(`bin` 已配置,`pnpm build` 打包,内部包以源码形式打入产物)。
- **包间引用**:源码直引 —— 各包 `main`/`types` 指向 `src/index.ts`,配合 `tsconfig.base.json` 的 `paths` 别名,无需先构建。
- **SDK 边界**:CLI / Server / Agent 一律经由 `@testpilot/sdk` 访问 Core;禁止 Server/Agent → execution-engine、Agent → Playwright/WeChatIDE 的直连。
- **质量工具**:Vitest 与 ESLint 集中在根配置;CI(GitHub Actions / Jenkins)跑 lint + build + test。
