# csspilot CLI 使用文档

安装后(`npm i -g csspilot` 或业务项目内 `npm i -D csspilot`),通过 `npx csspilot <command>` 使用;monorepo 内开发用 `pnpm --filter csspilot dev <command>`(源码)或 `node apps/cli/dist/bin.js`(打包产物)。

## 命令总览

| 命令                                    | 作用                         |
| --------------------------------------- | ---------------------------- |
| `csspilot init`                         | 把 csspilot 接入当前业务项目 |
| `csspilot validate [paths...]`          | 校验用例 DSL                 |
| `csspilot list [--tag <tag>]`           | 列出用例                     |
| `csspilot run [paths...] [--tag <tag>]` | 执行用例                     |
| `csspilot report [--run <id>] [--open]` | 生成 JSON + HTML 报告        |
| `csspilot doctor`                       | 环境体检                     |

全局:`-V` 查看版本,`-h` 查看帮助。

## init —— 接入业务项目

```bash
npx csspilot init
```

执行内容(全部幂等,已存在则跳过):

1. 安装 Skill 到 `.agents/skills/csspilot/`(SKILL.md + manifest.yaml + rules/ + workflows/)
2. 创建 Runtime 目录 `.csspilot/artifacts/`
3. 创建/复用 `tests/e2e/{cases,fixtures,data}`
4. 生成项目配置 `csspilot.yaml`
5. 输出下一步操作

## validate —— 校验用例

```bash
npx csspilot validate                                # 默认 casesDir 全量
npx csspilot validate tests/e2e/cases/order.yaml    # 指定文件/目录
```

检查:YAML 格式 → DSL 结构(zod schema)→ 语义规则(action/target 支持、必填字段、字段误用、locator 合法性、变量引用)。任何失败以退出码 1 结束。

## list —— 列出用例

```bash
npx csspilot list
npx csspilot list --tag smoke
```

输出用例 id、文件路径与标签;解析失败的文件单独标出。

## run —— 执行用例

```bash
npx csspilot run                                  # 按 csspilot.yaml 配置
npx csspilot run tests/e2e/cases/order.yaml       # 指定用例
npx csspilot run --tag smoke                      # 按标签
```

链路:Case Loader → DSL Validator → Execution Engine → Adapter(Playwright / WeChatIDE)→ Evidence → Reporter。校验失败的用例跳过并在输出中标注;有失败用例时退出码 1。

## report —— 生成报告

```bash
npx csspilot report               # 最近一次运行
npx csspilot report --run 20260910-001
npx csspilot report --open        # 生成后在浏览器打开
```

在 run 目录内生成 `report.json`(结构化,供 AI 分析)与 `report.html`(人类可读,含状态徽章、步骤表、变量值、截图链接)。

## doctor —— 环境体检

检查 Node 版本(>=22)、csspilot.yaml、用例目录、Skill 安装、Playwright + Chromium、微信开发者工具。全部通过时输出 `Environment looks good.`

## 项目配置(csspilot.yaml)

```yaml
casesDir: tests/e2e/cases # validate / list / run 的默认用例目录

web:
  baseUrl: http://127.0.0.1:8080 # navigate 相对 url 的基准

miniapp:
  projectPath: path/to/miniprogram # 小程序项目目录(含 project.config.json)
  cliPath: "C:/.../cli.bat" # 可省略:自动探测
```

## 环境变量

| 变量                                | 作用                                                |
| ----------------------------------- | --------------------------------------------------- |
| `WECHAT_DEVTOOLS_CLI`               | 指定开发者工具 cli 路径(探测优先级最高)             |
| `csspilot_MINIPROGRAM_PROJECT_PATH` | 小程序项目路径(可被 csspilot.yaml 覆盖)             |
| `csspilot_MINIPROGRAM_AUTO_PORT`    | 自动化端口,默认 9420                                |
| `csspilot_MINIPROGRAM_CLOSE_IDE`    | `true` 时运行结束直接关闭开发者工具(默认仅断开连接) |
| `csspilot_HEADLESS`                 | `false` 时 Chromium 有头运行                        |
| `csspilot_STEP_TIMEOUT`             | 单步操作超时毫秒,默认 15000                         |
| `csspilot_SKILL_DIR`                | init 安装 Skill 的自定义源目录                      |

## 产物目录

```text
.csspilot/artifacts/runs/<runId>/
├── result.json      # 引擎写入的运行结果(RunSummary)
├── events.ndjson    # 运行事件流(run/case/step 级)
├── logs/run.log     # 文本日志
├── screenshots/     # 步骤截图(失败自动取证)
├── videos/          # 用例录屏(webm,仅 Web 端)
├── traces/          # Playwright trace 包(zip,仅 Web 端)
├── report.json      # report 命令生成
└── report.html      # report 命令生成
```

runId 格式 `yyyymmdd-NNN`,同日递增。视频与 trace 为用例级(每用例独立 context 录制),trace 用 `npx playwright show-trace traces/<file>` 查看;小程序端 V0.1 仅截图取证。

## 常见问题

- **开发者工具 cli 找不到**:设置环境变量 `WECHAT_DEVTOOLS_CLI`,或在 csspilot.yaml 配置 `miniapp.cliPath`;不配置时会按 常见安装位置 → 各盘符 Tencent 目录 → 注册表 自动探测。
- **cli auto 报"服务端口未开启"**:开发者工具 设置 → 安全设置 → 服务端口 开启后重试。
- **小程序项目打不开/模拟器空白**:确认 IDE 已登录、首次打开时处理项目导入与信任提示,必要时点工具栏"编译"。
- **Chromium 未安装**:`pnpm exec playwright install chromium`。
- **小程序端 select/text locator 报错**:V0.1 小程序只支持 css 定位(class/id),select 交互用 click 替代;validate 阶段就会拦截。
