# csspilot CLI 使用文档

安装后(`npm i -g csspilot` 或业务项目内 `npm i -D csspilot`),通过 `npx csspilot <command>` 使用;monorepo 内开发用 `pnpm --filter csspilot dev <command>`(源码)或 `node apps/cli/dist/bin.js`(打包产物)。

## 命令总览

| 命令                                    | 作用                                           |
| --------------------------------------- | ---------------------------------------------- |
| `csspilot init`                         | 把 TestPilot 接入当前业务项目(项目测试基础设施初始化) |
| `csspilot validate [paths...]`          | 校验用例 DSL                                   |
| `csspilot list [--tag <tag>]`           | 列出用例                                       |
| `csspilot run [paths...] [--tag <tag>]` | 执行用例                                       |
| `csspilot report [--run <id>] [--open]` | 生成 JSON + HTML 报告                          |
| `csspilot sync-metadata`                | 同步 Case Metadata 到 Server(CI / git push 后) |
| `csspilot doctor`                       | 健康检查(分组报告:error / warning)          |
| `csspilot ci init`                      | 生成 TestPilot CI 工作流模板(不改动已有 CI)   |

全局:`-V` 查看版本,`-h` 查看帮助。

## init —— 接入业务项目

```bash
npx csspilot init [--server <url>]
```

项目测试基础设施初始化,按 Golden Path 执行(全部幂等,已有文件一律保留,不重置 projectId):

1. **项目识别**:名称 / 类型(web / wechat-miniapp / hybrid / unknown)/ 语言 / 包管理器 / Git / 已有测试目录
2. **Adapter 检测**:Playwright 依赖、微信开发者工具;不可用仅提示 warning,不阻塞
3. **配置初始化**:生成 `testpilot.yaml`(含 environment 环境段,baseUrl 用 `${VAR}` 引用)+ `.testpilot/{project.json,artifacts/}`;project.json 含 `version / projectId / testDir / caseDir / defaultAdapter`;Server 可达时注册项目,不可达时生成本地 ID
4. **测试目录**:`tests/e2e/{cases,fixtures,data}`(已有直接复用;检测到其他 E2E 目录只提示不迁移)
5. **Agent Skill**:安装到 `.agents/skills/testpilot/`,并生成项目级上下文 `references/{project,test-conventions,adapters}.md`
6. **环境配置**:模板引用 `TEST_BASE_URL` / `STAGING_BASE_URL`,敏感值一律由环境变量注入,不落明文
7. **CI 准备**:只检测已有 CI 并提示,可用 `csspilot ci init` 生成模板
8. **自动 Doctor**:结束时执行一次健康检查

## doctor —— 健康检查

```bash
npx csspilot doctor
```

分组输出 Runtime / Project / Test / Agent / Adapters / Environment / Server,末尾汇总 errors 与 warnings;有 error 时退出码 1。Adapter 缺失是 warning;配置缺失、用例校验失败、环境变量缺失是 error;未配置 Server 时跳过 Server 段。

## ci init —— CI 工作流模板

```bash
npx csspilot ci init
```

生成 `.github/workflows/testpilot.yml`(已有则跳过):git push 后执行 `csspilot validate` 与 `csspilot sync-metadata`(需在仓库 Secret 配置 `TESTPILOT_SERVER_URL`)。sync-metadata 是 Git Push → Server 的正式同步边界。

## sync-metadata —— 同步 Case Metadata(CI 专用)

```bash
npx csspilot sync-metadata
```

把**当前 Git Commit 的完整 Case 列表**作为快照同步到 TestPilot Server(`POST /api/projects/:id/cases/sync`):快照中消失的 Case 会被标记为 deleted(历史 Run 仍可引用)。

- Git Push 是 Case Metadata 进入团队共享 Server 的正式同步边界,建议只在 CI 中运行;开发者本地未 push 的 Case 不应进入团队视图
- Server 地址取值顺序:`--server` > 环境变量 `TESTPILOT_SERVER_URL` > `.testpilot/project.json` 的 `serverUrl` > 项目配置的 `server.baseUrl`

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
npx csspilot run                                  # 按 testpilot.yaml 配置
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

## 项目配置(testpilot.yaml)

`csspilot init` 生成的完整形态(旧字段 `casesDir` 仍兼容,与 `test.caseDirectory` 等价):

```yaml
version: 1

project:
  name: my-project            # 项目名(识别/注册用)

test:
  directory: tests/e2e
  caseDirectory: tests/e2e/cases

environment:                  # Case 用 environment: <名称> 引用
  default: test
  test:
    baseUrl: ${TEST_BASE_URL} # 敏感值由环境变量注入,禁止写明文
  staging:
    baseUrl: ${STAGING_BASE_URL}

adapters:
  - playwright                # 项目声明的执行端(可用性以 doctor 为准)

# workspace:
#   default: my-workspace     # 默认 Workspace(多系统环境组合)

# server:
#   baseUrl: http://127.0.0.1:3000  # TestPilot Server(Control Plane)

web:
  baseUrl: http://127.0.0.1:8080    # navigate 相对 url 的基准

# miniapp:
#   projectPath: path/to/miniprogram
#   cliPath: "C:/.../cli.bat"      # 可省略:自动探测
```

## 环境变量

| 变量                                   | 作用                                                |
| -------------------------------------- | --------------------------------------------------- |
| `TESTPILOT_SERVER_URL`                 | TestPilot Server 地址(init / sync-metadata)        |
| `TEST_BASE_URL` / `STAGING_BASE_URL`   | 环境配置引用的被测系统地址(doctor 会检查是否设置)  |
| `WECHAT_DEVTOOLS_CLI`                  | 指定开发者工具 cli 路径(探测优先级最高)             |
| `TESTPILOT_MINIPROGRAM_PROJECT_PATH`   | 小程序项目路径(可被 testpilot.yaml 覆盖)            |
| `TESTPILOT_MINIPROGRAM_AUTO_PORT`      | 自动化端口,默认 9420                                |
| `TESTPILOT_MINIPROGRAM_CLOSE_IDE`      | `true` 时运行结束直接关闭开发者工具(默认仅断开连接) |
| `TESTPILOT_HEADLESS`                   | `false` 时 Chromium 有头运行                        |
| `TESTPILOT_STEP_TIMEOUT`               | 单步操作超时毫秒,默认 15000                         |
| `TESTPILOT_SKILL_DIR`                  | init 安装 Skill 的自定义源目录                      |

## 产物目录

```text
.testpilot/artifacts/runs/<runId>/
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

- **开发者工具 cli 找不到**:设置环境变量 `WECHAT_DEVTOOLS_CLI`,或在 testpilot.yaml 配置 `miniapp.cliPath`;不配置时会按 常见安装位置 → 各盘符 Tencent 目录 → 注册表 自动探测。
- **cli auto 报"服务端口未开启"**:开发者工具 设置 → 安全设置 → 服务端口 开启后重试。
- **小程序项目打不开/模拟器空白**:确认 IDE 已登录、首次打开时处理项目导入与信任提示,必要时点工具栏"编译"。
- **Chromium 未安装**:`pnpm exec playwright install chromium`。
- **小程序端 select/text locator 报错**:V0.1 小程序只支持 css 定位(class/id),select 交互用 click 替代;validate 阶段就会拦截。
