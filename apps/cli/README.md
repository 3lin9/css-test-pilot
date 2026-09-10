# csspilot

> [TestPilot](https://github.com/3lin9/css-test-pilot) CLI —— AI Native 跨端业务测试基础设施:让 AI 能理解、生成、校验并执行业务测试。

`csspilot` 把一套**可校验、可执行、可取证**的端到端测试工作流带进你的业务项目:用 YAML DSL 描述用例,同时驱动 **Web(Playwright)** 与**微信小程序(WeChat DevTools)** 两端,产出截图 / video / trace 证据与 JSON + HTML 报告;并随包附带 AI Skill,安装后让 AI 助手按同一套规范生成和维护用例。

[![npm version](https://img.shields.io/npm/v/csspilot.svg)](https://www.npmjs.com/package/csspilot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/3lin9/css-test-pilot/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/csspilot.svg)](https://www.npmjs.com/package/csspilot)

## 特性

- **一套 DSL,跨端执行**:`target: miniapp | web` 自由切换,变量跨端传递(小程序下单 → extract 订单号 → Web 后台 assert)
- **先校验后执行**:用例在运行前经过 DSL schema / action / locator / 变量引用 / adapter 支持的完整校验
- **全程取证**:每一步可留 screenshot,运行留 video / trace / 日志,证据按 run 归档在 `.testpilot/artifacts/runs/<id>/`
- **JSON + HTML 报告**:`csspilot report` 一步生成,支持按 run id 回看
- **AI Native**:内置 TestPilot Skill(规则 + 工作流),`init` 后 AI 助手即可按规范帮你写用例、跑测试、分析结果

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

## 快速开始

```bash
# 1. 在业务项目根目录接入 TestPilot(装 AI Skill、初始化 .testpilot/、生成 testpilot.yaml)
csspilot init

# 2. 在 tests/e2e/cases/ 下写用例(可让 AI 按 Skill 规范生成)

# 3. 校验用例
csspilot validate

# 4. 执行
csspilot run

# 5. 生成报告
csspilot report
```

不确定环境是否就绪?`csspilot doctor` 一键体检(Node / Playwright / WeChat DevTools / 项目配置)。

## 命令

| 命令                                    | 作用                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `csspilot init`                         | 把 TestPilot 接入当前业务项目(装 Skill 到 `.agents/skills/testpilot/`、初始化 `.testpilot/`、创建/复用 `tests/e2e`、生成 `testpilot.yaml`) |
| `csspilot validate [paths...]`          | 校验用例(DSL schema / action / locator / 变量引用 / adapter 支持)                                                                          |
| `csspilot list [--tag <tag>]`           | 列出用例                                                                                                                                   |
| `csspilot run [paths...] [--tag <tag>]` | 执行用例(Case Loader → Validator → Engine → Adapter → Evidence → Reporter)                                                                 |
| `csspilot report [--run <id>]`          | 生成 JSON + HTML 报告(`.testpilot/artifacts/runs/<id>/`)                                                                                   |
| `csspilot doctor`                       | 环境体检(Node / Playwright / WeChat DevTools / 项目配置)                                                                                   |

## DSL 速览

九个基础 Action:`launch` `navigate` `click` `input` `select` `wait` `assert` `extract` `screenshot`。Action 是通用测试原语;业务动作(登录 / 下单 / 支付)永远是业务项目里的 Case。

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

  # 提取订单号,存入上下文变量
  - target: miniapp
    action: extract
    locator:
      css: ".order-id"
    variable: orderId

  # Web 端:后台验证该订单(locator 支持 ${var} 引用)
  - target: web
    action: assert
    locator:
      css: "tr[data-order='${orderId}']"
```

## AI Skill

`csspilot init` 会把随包分发的 TestPilot Skill 安装到业务项目 `.agents/skills/testpilot/`,包含:

- `SKILL.md` —— 能力总览与使用约定
- `rules/` —— 用例设计 / DSL 书写 / 断言 / locator 规范
- `workflows/` —— 创建用例、校验、执行、结果分析的完整工作流

安装后,你的 AI 助手(Claude Code、Cursor 等)即可按这套规范生成、修改和运行用例。

## 相关链接

- [GitHub 仓库](https://github.com/3lin9/css-test-pilot) —— 完整架构、DSL 示例与开发文档
- [问题反馈](https://github.com/3lin9/css-test-pilot/issues)

## License

[MIT](https://github.com/3lin9/css-test-pilot/blob/main/LICENSE)
