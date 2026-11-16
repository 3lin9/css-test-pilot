# csspilot

> [csspilot](https://github.com/3lin9/css-test-pilot) CLI —— AI Native 跨端业务测试基础设施:让 AI 能理解、生成、校验并执行业务测试。

`csspilot` 把一套**可校验、可执行、可取证**的端到端测试工作流带进你的业务项目。用例就是当前端的官方脚本:Web 用 `@playwright/test`,微信小程序用 `miniprogram-automator` + `node:test`,API 用 `node:test` + `fetch`。`csspilot run` 按目录把脚本交给对应框架,不翻译、不重放编写时的 MCP 会话。项目配置仍是 `testpilot.yaml`;YAML 用例已退役,传入 `.yaml` 用例会直接拒绝。

[![npm version](https://img.shields.io/npm/v/csspilot.svg)](https://www.npmjs.com/package/csspilot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/3lin9/css-test-pilot/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/csspilot.svg)](https://www.npmjs.com/package/csspilot)

## 特性

- **各端用自己的脚本**:`tests/e2e/web/*.spec.ts`、`tests/e2e/miniapp/*.test.ts`、`tests/e2e/api/*.test.ts`。跨系统核对优先调对方查询接口,地址写在 `testpilot.yaml` 的 `systems` 与 `.env.testing`
- **先校验后执行**:运行前检查文件头测试点、评审清单出处、`process.env` 是否已声明
- **按结果取证**:通过和失败各留截图,放在 `.testpilot/artifacts/shots/<runId>/`;blocked、inconclusive、skipped 不留。Web 另有失败 trace;API 没有界面,不截图
- **JSON + HTML 报告**:单次 run 报告,或 `--summary` 跨 run 汇总;`--open` 生成后打开浏览器;`--trace` 回放 Web 失败
- **凭据不进脚本**:地址和账号放 `.env.testing` 或 CI secret,本地账号用 `TESTPILOT_ACCOUNT_*`
- **AI Native**:内置 csspilot Skill。编写时用 Playwright MCP / wechatide MCP 看真实界面,确认后再写入脚本
- **幂等接入与升级**:`init` 不覆盖已有配置与用例;`update` 只同步 Skill / `.env.testing`(缺失时生成,不覆盖已填的真实值),不碰 `.env` 与 `tests/e2e`

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

CLI 启动时会加载项目根目录的 `.env.testing`(真实环境变量优先于文件;刻意不读前端项目自身的 `.env`)。`testpilot.yaml` 里的 `${VAR}` 在运行时注入。

## 快速开始

```bash
# 1. 在业务项目根目录接入 csspilot
#    (检测项目与 Adapter、生成 testpilot.yaml / .env.testing / .testpilot/、
#     创建 tests/e2e/{web,miniapp,api,data,reviews}、安装 Skill、自动 doctor)
csspilot init
# 可选:关联 csspilot Server
# csspilot init --server http://127.0.0.1:3000

# 2. 在 .env.testing 中直接填入 DEVELOP_BASE_URL 等真实值(CLI 自动加载;已写入 .gitignore,
#    刻意不读前端项目自身的 .env)

# 3. 在 tests/e2e/{web,miniapp,api} 下写各端脚本(可让 AI 按 Skill 规范生成)

# 4. 校验脚本
csspilot validate

# 5. 执行。省略 --env 时用 environment.default(模板为 develop)
csspilot run
csspilot run --env uat

# 6. 生成报告
csspilot report
```

不确定环境是否就绪?`csspilot doctor` 一键体检(Runtime / 项目配置 / 用例 / Skill / Adapter / 环境变量 / Server)。

`init` 全程幂等:已有 `testpilot.yaml`、用例目录、Skill references 一律保留,不重置 `projectId`。

## 命令

| 命令 | 作用 |
| --- | --- |
| `csspilot init [--server <url>]` | 把 csspilot 接入当前业务项目(幂等)。装 Skill 到 `.agents/skills/testpilot/`、初始化 `.testpilot/`、创建/复用 `tests/e2e`、生成 `testpilot.yaml` 与 `.env.testing`,并跑一次 doctor。`--server` 写入关联地址(默认读 `TESTPILOT_SERVER_URL`) |
| `csspilot validate [paths...]` | 原生脚本 lint(文件头测试点 / reviews 清单出处 / env 引用)。不传路径则收集 `tests/e2e/{web,miniapp,api}`。`.yaml` 用例直接拒绝 |
| `csspilot run [paths...] [--env <name>] [--grep <pattern>]` | 先做与 `validate` 相同的轻量预检,通过后把脚本交给各端框架。`--env` 选择 `testpilot.yaml` 的环境并注入 `TESTPILOT_BASE_URL`。`--grep` 按测试名过滤 |
| `csspilot report [--run <id>] [--open] [--summary] [--last <n>] [--trace]` | 生成 JSON + HTML。默认最近一次 run;`--summary` 生成跨 run 汇总;`--trace` 用 Playwright trace viewer 回放失败用例 |
| `csspilot doctor` | 健康检查(Runtime / Project / Test / Skill / Adapter / 环境变量 / Server) |
| `csspilot update [--force]` | 把 Skill 主体与 `.env.testing` 同步到当前 CLI 版本(后者缺失时生成,已存在只提示新增变量)。不覆盖 `.env`、用例、`testpilot.yaml`、`references/`。版本一致时需 `--force` 才覆盖本地 Skill 修改 |
| `csspilot ci init` | 生成 `.github/workflows/testpilot.yml`(validate + sync-metadata);已有则跳过,不改动其他 CI |
| `csspilot sync-metadata [--server <url>]` | 把当前 Git commit 的用例头注释元数据快照同步到 csspilot Server。面向 CI / git push,本地未 push 的用例不应进入团队视图 |

版本:`csspilot -v` 或 `-V`。

## 配置与环境变量

`init` 生成的 `testpilot.yaml` 是项目配置源,不是用例格式。环境相关字段只放 `${VAR}` 引用,真实值写在 `.env.testing`:

| 变量 | 用途 |
| --- | --- |
| `DEVELOP_BASE_URL` / `UAT_BASE_URL` / `PREPROD_BASE_URL` | `environment` 段 develop / uat / preprod 的 baseUrl |
| `API_BASE_URL` | API 端相对 url 的基准。`csspilot run --env` 会注入 `TESTPILOT_BASE_URL`,脚本优先读它 |
| `MINIAPP_PROJECT_PATH` / `MINIAPP_CLI_PATH` | 小程序项目目录与开发者工具 CLI(需启用 `miniapp` 段) |
| `TESTPILOT_SERVER_URL` | csspilot Server(Control Plane);也可写在 yaml 的 `server.baseUrl` |
| `TESTPILOT_ACCOUNT_<REF>` | 本地账号凭据。引用名 `test-user` 对应 `TESTPILOT_ACCOUNT_TEST_USER='{"username":"a","password":"b"}'`(`-` 转 `_`,大写)。明文密码禁止写进脚本 |
| `WECHAT_DEVTOOLS_CLI` | 微信开发者工具 CLI 可执行文件路径(doctor / adapter 检测) |
| `TESTPILOT_SKILL_DIR` | 覆盖内置 Skill 源目录(开发/调试用) |

## 脚本速览

| 平台 | 目录与文件 | 框架 | `csspilot run` 调用 |
| --- | --- | --- | --- |
| web | `tests/e2e/web/<id>.spec.ts` | `@playwright/test` | `npx playwright test` |
| miniapp | `tests/e2e/miniapp/<id>.test.ts` | `miniprogram-automator` + `node:test` | `node --test` |
| api | `tests/e2e/api/<id>.test.ts` | `node:test` + `fetch` | `node --test` |

每个脚本文件头写测试点和视角,例如:

```ts
// 测试点: TP-001
// 视角: charter:error-path
```

Web 从 `tests/e2e/web/fixtures.ts` 导入 `test` / `expect`。地址用 `process.env.TESTPILOT_BASE_URL`(未设置时可回退 `API_BASE_URL`)。可重复使用的输入放 `tests/e2e/data/` 的 JSON 或 YAML,由脚本自己读取。字段、定位和断言以各端框架 API 与 Skill `rules/native.md` 为准。

## AI Skill

`csspilot init` 会把随包分发的 csspilot Skill 安装到业务项目 `.agents/skills/testpilot/`,包含:

- `SKILL.md` —— 能力总览与使用约定
- `manifest.yaml` —— Skill 版本(供 `update` / `doctor` 比对)
- `rules/` —— 用例设计、原生脚本、断言、locator
- `workflows/` —— 需求评审、创建用例、校验、执行、结果分析
- `references/` —— **项目级**上下文(`project.md` / `test-conventions.md` / `adapters.md`),升级 Skill 时不会被覆盖

安装后,你的 AI 助手(Claude Code、Cursor 等)即可按这套规范生成、修改和运行用例。可选:按所用 Agent 复制到 `.cursor/skills/`、`.claude/skills/` 等目录。

Skill 落后于当前 CLI 时,`doctor` 会提示,执行 `csspilot update` 并提交 `.agents/skills/` 即可。

## CI 与 Server

- `csspilot ci init` 生成 GitHub Actions:在 `main` 上 push 后跑 `validate`,若配置了 `TESTPILOT_SERVER_URL` Secret 再跑 `sync-metadata`。执行用例步骤默认注释,需要时自行打开。
- `sync-metadata` 需要 Git 仓库(含 commit / branch)以及 Server 注册过的 `projectId`(本地模式无法同步)。
- 未配置 Server 时,`init` 以本地模式关联项目;`doctor` 跳过 Server 段。

## 相关链接

- [GitHub 仓库](https://github.com/3lin9/css-test-pilot) —— 完整架构与开发文档
- [CLI 命令说明](https://github.com/3lin9/css-test-pilot/blob/main/docs/cli.md)
- [问题反馈](https://github.com/3lin9/css-test-pilot/issues)

## License

[MIT](https://github.com/3lin9/css-test-pilot/blob/main/LICENSE)
