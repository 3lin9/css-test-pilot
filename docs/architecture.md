# csspilot 架构(Phase 18 原生脚本链路)

## 定位

> csspilot — AI Native 跨端业务测试基础设施:让 AI 能理解、生成、校验并执行业务测试。

csspilot 是**工具,不是业务项目**。业务项目定义"测什么、怎么算通过",用自己的测试框架写原生脚本(脚本放 `tests/e2e/{web,miniapp,api}`);csspilot 负责发现这些脚本、交给对应框架执行、把结果归一成统一的 run/报告形态,并维护元数据(Case Index / Run 历史)。

历史说明:DSL 步骤翻译链路(dsl / execution-engine / adapters / observation-core / evidence / discovery-engine 九包与 apps/agent)已在 Phase 18 退役;本文档描述的是**当前**架构。

## 核心职责

```text
csspilot
├── CLI           用户 / AI 的入口(init / validate / run / report / doctor / sync-metadata / update / ci init)
├── SDK           统一编程接口(project / native-cases / runs / reports),CLI 与 Server 都经由它
├── native        原生脚本 helper(三态标记 / 小程序会话建立 / 截图钩子)
├── reporter      结果归一(Playwright JSON / node:test TAP → RunSummary)与报告(JSON + HTML)
├── Control Plane Fastify + SQLite(Drizzle):项目 / Case Index / Run / Workspace 元数据
├── Web           测试控制台(Vue 3):项目 / Case Index / Run 可观测性
└── Skill         AI 使用 csspilot 的能力规范(.agents/skills/testpilot)
```

## 架构图

```text
        AI(按 Skill 规范工作)
              │  需求评审 → 测试点清单(tests/e2e/reviews)
              ▼
      业务项目 tests/e2e/{web,miniapp,api}
      各端原生脚本(Playwright / miniprogram-automator / node:test)
              │
              ▼
        csspilot CLI(validate → run → report)
              │  经由 @testpilot/sdk
              ▼
   ┌─────────────────────────────┐
   │  run:按目录把脚本交给对应框架  │
   │  web   → node <cli.js> test  │
   │  miniapp/api → node --test   │
   └─────────────────────────────┘
              │  结构化输出(Playwright JSON / TAP)
              ▼
   reporter ingest 归一(统一 RunSummary,写 run 目录 result.json;
   三态判定 product / infra / unverified → 退出码 1 / 2 / 0)
              │
              ▼
   HTML/JSON 报告(截图内联、时间线、trace 回放)
```

Control Plane 与控制台(本地单进程部署):

```text
  CLI(sync-metadata / run 触发)        浏览器
           │ REST                          │
           ▼                               ▼
  ┌────────────────────────────────────────────┐
  │  Control Plane(Fastify,127.0.0.1)         │
  │  · Host/Origin 回环防护(防 rebinding/CSRF) │
  │  · 请求体 zod schema 校验                   │
  │  · 静态托管 apps/web/dist(SPA 回退)         │
  ├────────────────────────────────────────────┤
  │  SQLite(Drizzle):projects / cases index /  │
  │  runs / reports / workspaces / secrets      │
  │  数据库位置:~/.testpilot/server.db          │
  └────────────────────────────────────────────┘
           │  spawn 原生框架(业务项目根 cwd)
           ▼
   业务项目 .testpilot/artifacts/(run 目录 / 截图 / trace)
```

## 核心原则

1. **用例即原生脚本** —— 不做步骤翻译:每个端跑自己的测试框架,csspilot 只做发现、执行、归一、报告。
2. **Git 是 Case 的 Source of Truth** —— Server 只存元数据索引;`git push → CI → sync-metadata` 是 Case 进入 Server 的正式同步边界。
3. **产物留本地** —— 截图 / trace / 报告在业务项目 `.testpilot/artifacts/`;SQLite 只存元数据与索引,不搬运大文件。
4. **CLI / Server 经由 SDK** —— 不直接操作 run 目录结构;路径约定(目录名 / runId 形态)收口在 `@testpilot/core`。
5. **三态判定,宁红勿漏** —— 失败按 product / infra(blocked) / unverified(inconclusive) 三桶分流,错误码未识别时归 product。
6. **AI 不能凭空生成测试** —— Evidence-first:测试点清单(reviews)是唯一用例来源,脚本头注释回链清单(lint 硬卡)。

## 一句话定义

| 东西             | 定义                                            |
| ---------------- | ----------------------------------------------- |
| csspilot        | 测试基础设施                                    |
| CLI              | csspilot 的统一入口                            |
| Skill            | AI 使用 csspilot 的能力规范                    |
| 原生脚本         | 各端框架的测试用例(唯一的 Case 形态)          |
| RunSummary       | 归一后的运行结果(ingest 产物,result.json)     |
| Reporter         | 结果归一与报告输出(JSON + HTML)               |
| Control Plane    | 本地元数据服务(项目 / Case Index / Run)       |
| `.agents/skills` | AI Skill 安装位置                              |
| `.testpilot`     | csspilot Runtime 数据(产物 / 缓存;db 不在此)  |
| `tests/e2e`      | 业务项目测试目录                               |

## 退役说明(DSL 链路)

Phase 1-16 的 DSL 步骤翻译链路(`tests/e2e/cases/*.yaml` → parser → Execution Engine → Adapter)已完成使命并退役:用例维护成本集中在 DSL 语法而非业务语言,AI 生成步骤的价值低于直接生成原生脚本。Phase 17-18 改造后:

- discover / rehearse / list 命令与 `@testpilot/dsl` 等九包删除;
- `csspilot run` 直接 spawn 各端框架,ingest 归一保持 run 目录与报告形态不变;
- Server 编排改为 spawn 原生链路,Web 控制台与报告零改动。

历史设计记录见仓库文档与 Phase 1-16 的 spec(`docs/superpowers/specs/`)。
