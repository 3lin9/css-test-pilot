# csspilot

> [TestPilot](https://github.com/3lin9/css-test-pilot) CLI —— AI Native 跨端业务测试基础设施:让 AI 能理解、生成、校验并执行业务测试。

`csspilot` 把一套**可校验、可执行、可取证**的端到端测试工作流带进你的业务项目:用 YAML DSL 描述用例,同时驱动 **Web(Playwright)**、**微信小程序(WeChat DevTools)** 与 **HTTP API**,产出截图 / video / trace 证据与 JSON + HTML 报告;并随包附带 AI Skill,安装后让 AI 助手按同一套规范生成和维护用例。

[![npm version](https://img.shields.io/npm/v/csspilot.svg)](https://www.npmjs.com/package/csspilot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/3lin9/css-test-pilot/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/csspilot.svg)](https://www.npmjs.com/package/csspilot)

## 特性

- **一套 DSL,跨端执行**:`target: miniapp | web | api` 自由切换,变量跨端传递(小程序下单 → extract 订单号 → Web 后台 assert)
- **先校验后执行**:用例在运行前经过 DSL schema / action / locator / 变量引用 / adapter 支持的完整校验
- **全程取证**:每一步可留 screenshot,运行留 video / trace / 日志,证据按 run 归档在 `.testpilot/artifacts/runs/<id>/`
- **JSON + HTML 报告**:单次 run 报告,或 `--summary` 跨 run 汇总;`--open` 生成后打开浏览器
- **账号凭据不进 Case**:`accountRef` 引用环境凭据,本地用 `TESTPILOT_ACCOUNT_*` 注入,明文密码禁止写进 YAML
- **AI Native**:内置 TestPilot Skill(规则 + 工作流 + 项目级 references),`init` 后 AI 助手即可按规范帮你写用例、跑测试、分析结果
- **幂等接入与升级**:`init` 不覆盖已有配置与用例;`update` 只同步 Skill / `.env.example`,不碰 `.env` 与 `tests/e2e`

## 安装

要求 Node.js ≥ 22。

```bash
npm install -g csspilot
# 或免安装直接用
npx csspilot --help
```

Web 端执行依赖 Playwright 浏览器:

```bash
npx playwright install chromium
```

CLI 启动时会加载项目根目录的 `.env`(真实环境变量优先于文件)。`testpilot.yaml` 里的 `${VAR}` 在运行时注入。

## 快速开始

```bash
# 1. 在业务项目根目录接入 TestPilot
#    (检测项目与 Adapter、生成 testpilot.yaml / .env.example / .testpilot/、
#     创建 tests/e2e/{cases,fixtures,data}、安装 Skill、自动 doctor)
csspilot init
# 可选:关联 TestPilot Server
# csspilot init --server http://127.0.0.1:3000

# 2. 复制 .env.example 为 .env,填入 TEST_BASE_URL 等真实值(.env 已写入 .gitignore)

# 3. 在 tests/e2e/cases/ 下写用例(可让 AI 按 Skill 规范生成)

# 4. 校验用例
csspilot validate

# 5. 执行
csspilot run

# 6. 生成报告
csspilot report
```

不确定环境是否就绪?`csspilot doctor` 一键体检(Runtime / 项目配置 / 用例 / Skill / Adapter / 环境变量 / Server)。

`init` 全程幂等:已有 `testpilot.yaml`、用例目录、Skill references 一律保留,不重置 `projectId`。

## 命令

| 命令 | 作用 |
| --- | --- |
| `csspilot init [--server <url>]` | 把 TestPilot 接入当前业务项目(幂等)。装 Skill 到 `.agents/skills/testpilot/`、初始化 `.testpilot/`、创建/复用 `tests/e2e`、生成 `testpilot.yaml` 与 `.env.example`,并跑一次 doctor。`--server` 写入关联地址(默认读 `TESTPILOT_SERVER_URL`) |
| `csspilot validate [paths...]` | 校验用例(DSL schema / action / locator / 变量引用 / adapter 支持);不传路径则按 `testpilot.yaml` 的 cases 目录 |
| `csspilot list [--tag <tag>]` | 列出用例(含无效文件提示) |
| `csspilot run [paths...] [--tag <tag>]` | 执行用例;校验失败的文件跳过。本地账号凭据来自 `TESTPILOT_ACCOUNT_<REF>` |
| `csspilot report [--run <id>] [--open] [--summary] [--last <n>]` | 生成 JSON + HTML。默认最近一次 run;`--summary` 生成跨 run 汇总(`summary.html` / `summary.json`),窗口默认最近 30 次 |
| `csspilot doctor` | 健康检查(Runtime / Project / Test / Skill / Adapter / 环境变量 / Server) |
| `csspilot update [--force]` | 把 Skill 主体与 `.env.example` 同步到当前 CLI 版本。不覆盖 `.env`、用例、`testpilot.yaml`、`references/`。版本一致时需 `--force` 才覆盖本地 Skill 修改 |
| `csspilot ci init` | 生成 `.github/workflows/testpilot.yml`(validate + sync-metadata);已有则跳过,不改动其他 CI |
| `csspilot sync-metadata [--server <url>]` | 把当前 Git commit 的 Case Metadata 快照同步到 TestPilot Server。面向 CI / git push,本地未 push 的 Case 不应进入团队视图 |

版本:`csspilot -v` 或 `-V`。

## 配置与环境变量

`init` 生成的 `testpilot.yaml` 是项目配置源。环境相关字段只放 `${VAR}` 引用,真实值写在 `.env`:

| 变量 | 用途 |
| --- | --- |
| `TEST_BASE_URL` / `STAGING_BASE_URL` | `environment` 段的 baseUrl |
| `WEB_BASE_URL` | Web 端相对 url 基准(需在 yaml 启用 `web` 段) |
| `MINIAPP_PROJECT_PATH` / `MINIAPP_CLI_PATH` | 小程序项目目录与开发者工具 CLI(需启用 `miniapp` 段) |
| `TESTPILOT_SERVER_URL` | TestPilot Server(Control Plane);也可写在 yaml 的 `server.baseUrl` |
| `TESTPILOT_ACCOUNT_<REF>` | 本地账号凭据。Case 里 `accountRef: test-user` 对应 `TESTPILOT_ACCOUNT_TEST_USER='{"username":"a","password":"b"}'`(`-` 转 `_`,大写) |
| `WECHAT_DEVTOOLS_CLI` | 微信开发者工具 CLI 可执行文件路径(doctor / adapter 检测) |
| `TESTPILOT_SKILL_DIR` | 覆盖内置 Skill 源目录(开发/调试用) |

## DSL 速览

十个稳定 Action:`launch` `navigate` `click` `input` `select` `wait` `assert` `extract` `screenshot` `request`。Action 是通用测试原语;业务动作(登录 / 下单 / 支付)永远是业务项目里的 Case。执行端:`miniapp` | `web` | `api`。

```yaml
# tests/e2e/cases/order-create.yaml
id: order-create
name: 用户创建订单
tags:
  - smoke

steps:
  # 小程序端:下单
  - target: miniapp
    action: launch

  - target: miniapp
    action: navigate
    url: /pages/index/index

  - target: miniapp
    action: click
    locator:
      css: ".submit-btn"

  - target: miniapp
    action: wait
    locator:
      css: ".order-id"

  # 提取订单号,存入上下文变量
  - target: miniapp
    action: extract
    locator:
      css: ".order-id"
    variable: orderId

  # Web 端:后台验证该订单(locator 支持 ${var} 引用)
  - target: web
    action: navigate
    url: /orders

  - target: web
    action: assert
    locator:
      css: ".order-row-${orderId}"
    expected: "${orderId}"
```

`target: api` 用 `request` / `extract` / `assert` 做接口造数与校验,相对 url 按 `testpilot.yaml` 的 `api.baseUrl` 解析。完整字段以 `@testpilot/dsl` schema 为准。

## AI Skill

`csspilot init` 会把随包分发的 TestPilot Skill 安装到业务项目 `.agents/skills/testpilot/`,包含:

- `SKILL.md` —— 能力总览与使用约定
- `manifest.yaml` —— Skill 版本(供 `update` / `doctor` 比对)
- `rules/` —— 用例设计 / DSL / 断言 / locator 规范
- `workflows/` —— 需求评审、创建用例、校验、执行、结果分析
- `references/` —— **项目级**上下文(`project.md` / `test-conventions.md` / `adapters.md`),升级 Skill 时不会被覆盖

安装后,你的 AI 助手(Claude Code、Cursor 等)即可按这套规范生成、修改和运行用例。可选:按所用 Agent 复制到 `.cursor/skills/`、`.claude/skills/` 等目录。

Skill 落后于当前 CLI 时,`doctor` 会提示,执行 `csspilot update` 并提交 `.agents/skills/` 即可。

## CI 与 Server

- `csspilot ci init` 生成 GitHub Actions:在 `main` 上 push 后跑 `validate`,若配置了 `TESTPILOT_SERVER_URL` Secret 再跑 `sync-metadata`。执行用例步骤默认注释,需要时自行打开。
- `sync-metadata` 需要 Git 仓库(含 commit / branch)以及 Server 注册过的 `projectId`(本地模式无法同步)。
- 未配置 Server 时,`init` 以本地模式关联项目;`doctor` 跳过 Server 段。

## 相关链接

- [GitHub 仓库](https://github.com/3lin9/css-test-pilot) —— 完整架构、DSL 示例与开发文档
- [问题反馈](https://github.com/3lin9/css-test-pilot/issues)

## License

[MIT](https://github.com/3lin9/css-test-pilot/blob/main/LICENSE)
