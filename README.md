# TestPilot

> AI Native 跨端业务测试基础设施 —— 让 AI 能理解、生成、校验并执行业务测试。

CLI 是入口,Skill 告诉 AI 如何从测试清单写出各端脚本。测试用例使用当前端的框架:Web 用 Playwright,小程序用 miniprogram-automator,API 用 node:test。TestPilot 负责发现这些脚本并交给对应框架执行。

TestPilot 是**工具,不是业务测试项目**:业务项目定义测什么、怎么算通过。脚本放在 `tests/e2e/web`、`tests/e2e/miniapp` 和 `tests/e2e/api`。

完整架构见 [docs/architecture.md](docs/architecture.md),CLI 命令详见 [docs/cli.md](docs/cli.md),微信小程序测试能力与边界(CI 登录态、真机远期声明)见 [docs/miniapp-testing.md](docs/miniapp-testing.md)。

## 核心链路

```text
AI → 测试点清单 → 各端原生脚本(Playwright / miniprogram-automator / node:test)
    → csspilot run 交给对应框架
```

## 仓库结构

```
/
├── apps/
│   ├── cli/                 # CLI(npm 包名 csspilot):init/validate/run/report/doctor/sync-metadata
│   ├── server/              # Control Plane API(Fastify + SQLite + Drizzle)
│   └── web/                 # 测试控制台(Vue 3:项目 / Case Index / Run)
├── packages/                # 内部共享包,统一 scope @testpilot
│   ├── core/                # 通用类型、错误、常量、配置模型(testpilot.yaml)
│   ├── reporter/            # 报告(report/summary,JSON + HTML)+ 原生结果 ingest 归一
│   └── sdk/                 # 统一编程接口:CLI/Server 都经由 SDK(project/collect/run/report)
├── skills/
│   └── testpilot/           # AI Skill:manifest.yaml + SKILL.md + rules/ + workflows/
├── examples/                # 演示项目(mock-backend、miniapp-demo)
├── tests/                   # 本仓库自身测试:unit / integration / e2e
└── docs/                    # 架构文档
```

## CLI

| 命令                               | 作用                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx csspilot init`                | 把 TestPilot 接入当前业务项目(装 Skill 到 `.agents/skills/testpilot/`、初始化 `.testpilot/`、创建/复用 `tests/e2e`、生成 `testpilot.yaml`) |
| `npx csspilot validate [files]`    | 原生脚本 lint(头注释 evidence / reviews 清单出处 / env 引用)                                                                              |
| `npx csspilot run [paths]`         | 把脚本交给各端框架执行(ingest 归一落 result.json;blocked 退出码 2)                                                                        |
| `npx csspilot report [--run id]`   | 生成 JSON + HTML 报告(`.testpilot/artifacts/runs/<id>/`)                                                                                   |
| `npx csspilot report --summary`    | 跨 run 汇总报告(`summary.html` + `summary.json`,默认统计最近 30 次)                                                                       |
| `npx csspilot doctor`              | 环境体检(Node / Playwright / WeChat DevTools / 项目配置)                                                                                   |
| `npx csspilot sync-metadata`       | 把当前 Commit 的用例头注释元数据快照同步到 Server(CI 专用,Git Push 后)                                                                    |
| `npx csspilot update`              | CLI 升级后同步接入物(Skill / `.env.testing`;不触碰 `.env` 与用例)                                                                          |
| `npx csspilot ci init`             | 生成 CI 工作流模板(`.github/workflows/testpilot.yml`)                                                                                      |

> `.testpilot/artifacts/` 是本机运行产物(run 目录、报告、截图、trace),绑定当前机器,默认不提交 Git;报告的可发现性靠 `csspilot report --open` 与 CI artifact 上传,不靠挪动目录。

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

增量 2(测试方法论,spec 见 `docs/superpowers/specs/`):
Phase 13 测试需求评审 workflow + 工具链(✓ 评审工作流、`csspilot update`、`.env.testing` 自动加载、跨 run 汇总报告)
Phase 14 数据驱动测试(✓ 数据集展开执行 / setup·teardown / 依赖预检 / QA 覆盖映射)
Phase 15 三态判定 + charter 视角矩阵(✓ 失败三桶 product / infra / unverified → run 退出码 0/1/2;`charter:*` 视角 tags 与三分判定)
Phase 16 自主观察与一次成功执行(✓ Web aria observe/probe/actionability/稳定等待/彩排/证书;✓ 小程序运行时节点+WXML+截图融合观察、定位缓存失效重观察)

原生脚本改造(见 `TestPilot-原生脚本改造设计.md`):
Phase 17 各端原生脚本 + ingest 归一(✓ 用例即各端框架原生脚本;`csspilot run` 按目录交给 Playwright / node --test,ingest 归一进 run 目录;三态退出码)
Phase 18 DSL 链路退役(✓ dsl/execution-engine/adapters/observation-core/evidence/discovery-engine 九包与 apps/agent 删除;discover/rehearse/list 命令退役;Server run 改为 spawn 原生链路)
```

## SDK 与 Control Plane

分层约定:CLI / Server 一律通过 `@testpilot/sdk` 访问 project / collect / run / report 能力,不直接操作 run 目录结构。

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
GET  /api/runs/:id               POST /api/runs/:id/cancel
GET  /api/runs/:id/report        GET  /api/runs/:id/summary
GET  /api/runs/:id/artifacts[/*]
```

- **Web 控制台**(apps/web,Vue 3 + Vite):仪表盘、项目列表/概览(Git 同步状态)、Case Index(原生脚本头注释元数据,active/deleted 过滤)、运行列表、Run 详情(用例级结果、失败原因、截图内联预览、日志 / Trace / video 下载)、报告按需生成。生产形态由 Server 静态托管 `apps/web/dist`,单进程部署。

- **分支即测试环境**:同一 Case 可同时存在于多个分支(main→TEST、release→STAGING...);快照同步按分支作用域执行,互不影响;环境可绑定分支,Case Index 按环境(分支)筛选。
- **Workspace**:一次运行所需的多系统环境组合;绑定的是 Project Environment(不是 Project 本身)。Server 触发运行时指定 Workspace,不硬编码各系统 URL/账号。
- **Run 可追溯**:每次 Run 记录 branch / commit / workspace 运行时快照——Workspace 后续可改,历史 Run 仍能还原当时的环境组合。
- **数据边界**:SQLite 只存元数据(projects / cases index / runs / reports);截图、视频、trace 留在业务项目 `.testpilot/artifacts/`;`testpilot.yaml` 仍是测试配置的 Source of Truth。

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
- **SDK 边界**:CLI / Server 一律经由 `@testpilot/sdk` 访问 project / collect / run / report 能力,不直接操作 run 目录结构。
- **质量工具**:Vitest 与 ESLint 集中在根配置;CI(GitHub Actions / Jenkins)跑 lint + build + test。
