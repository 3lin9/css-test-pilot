# TestPilot 原生脚本改造设计

> 2026-10-28。承接 `TestPilot-csspilot-init-项目测试基础设施设计.md`（下称 init 设计）。
> init 设计回答"项目怎么接入"，本文回答"用例正文是什么、TestPilot 还剩什么"。

## 1. 背景与决策

**动机**：统一 engine 的步骤翻译层（`step-executor`，YAML action → adapter 调用）是各端能力的"最低公约数"。翻译层为了跨端统一，只能暴露各端能力的交集，代价具体落在：断言无重试（对比 Playwright `expect().toHaveText()` 的 auto-wait）、定位表达力受限（对比 locator 链）、等待策略僵化、AI 生成 YAML"方言"的质量低于生成 Playwright 原生代码。

**决策**：测试清单确定之后，用例正文就是当前端的官方测试脚本。TestPilot 不再把一份中间格式翻译成各端动作——不做中间商。

**已定边界**（见 `skills/testpilot/SKILL.md`、`rules/native.md`）：

| 端 | 目录与文件 | 框架 | 启动 |
| --- | --- | --- | --- |
| web | `tests/e2e/web/<id>.spec.ts` | `@playwright/test` | `npx playwright test` |
| miniapp | `tests/e2e/miniapp/<id>.test.ts` | `miniprogram-automator` + `node:test` | `node --test` |
| api | `tests/e2e/api/<id>.test.ts` | `node:test` + `fetch` | `node --test` |

- 文件头注释约定 evidence 链：`// 测试点: TP-001` + `// 视角: charter:error-path`
- 跨端用例拆成每端一个脚本，不做跨端编排 runner（黄金路径的跨端状态传递通过 `tests/e2e/data/` 交换文件，如 web 端落 token、api 端读）
- 凭据不进脚本，`.env.testing` / CI secret；公共输入放 `tests/e2e/data/`

## 2. 现状盘点（已完成的迁移）

| 项 | 状态 |
| --- | --- |
| `SKILL.md` / `workflows/create-case.md` / `rules/native.md` | ✅ 已切原生，DSL 标注 legacy、禁止新用例使用 |
| `apps/cli/src/commands/run.ts` | ✅ 双轨：默认原生；显式 `.yaml` / `--tag` / `--require-ready` 走旧引擎 |
| `packages/sdk/src/native-cases.ts` | ✅ collect / plan / spawn 三件套（stdio inherit，仅返回 exitCode） |
| `apps/cli/src/commands/init` | ✅ 目录改为 `tests/e2e/{cases,web,miniapp,api,data,reviews}` |
| `packages/core/src/verdict.ts` | ✅ 三态桶独立:`verdictFromErrorCode`(product/infra/unverified → failed/blocked/inconclusive,未知码宁红勿漏归 product) |
| `packages/reporter/src/native-ingest.ts` | ✅ ingest 归一:Playwright JSON + node:test TAP → 与 YAML run 同形态的 result.json |
| `packages/native`(`@testpilot/native`) | ✅ `blocked()`/`inconclusive()` 三态标记 + `launchMiniApp`(auto 探测常驻 connect/launch、ticket 缓存) |
| 原生 run 退出码 | ✅ blocked→2、failed/inconclusive→1(ingest 聚合后,与 YAML run 同契约) |
| `validate` | ✅ 原生 lint 三道卡(evidence 头注释 / reviews 清单出处 / env 声明);YAML 分支保留至退役 |
| `doctor` / `sync-metadata` | ✅ 各端 runner 可用性检测;头注释元数据并入同步快照(原生覆盖同 ID 的 YAML 条目) |
| `buildRunSummary` | ✅ 下沉 `@testpilot/core`(engine re-export),ingest 复用同一实现,聚合规则零漂移 |

## 3. 目标架构

```
需求评审(reviews/) → 测试点清单
        │  AI 按端写原生脚本(rules/native.md, evidence 头注释)
        ▼
tests/e2e/web/*.spec.ts  miniapp/*.test.ts  api/*.test.ts
        │  npx csspilot run  (native-cases: collect → plan → spawn)
        ▼
各端 runner 原生执行 ──(结构化输出)──► native-ingest 归一
        │                              Playwright JSON / node:test TAP
        ▼                              + 错误码三态 + 头注释元数据
run 目录 result.json (与旧 YAML run 同形态)
        ▼
report / summary-report / history ── 现有报告体系零改动复用

横切：@testpilot/native helper —— launchMiniApp()/connectMiniApp() 连接、blocked()/inconclusive() 三态标记
```

## 4. 缺口 A：原生结果归一（native-ingest）

现状缺口：`runNativeCases` 只透传 stdio + 返回 exitCode，原生 run 在 `.testpilot/artifacts/runs/` 里没有任何产物，`report` / 跨 run 汇总对它无数据可读。

**设计**：新增 `packages/reporter/src/native-ingest.ts`，把两个框架的结构化输出归一成与 YAML run 完全相同的 `result.json`（`ReportPayload`）。报告、跨 run 汇总、history 全部零改动复用。

- **web**：`npx playwright test --reporter=json > <runDir>/playwright.json`；JSON 内含每个 test 的 file/title/duration/error/attachment（trace、video、截图路径）
- **miniapp / api**：node:test 逐文件 spawn，用**内置 TAP reporter**（stdout 重定向到 `<runDir>/<端>-<序号>.tap`）。注：Node 22 没有内置 `ndjson` reporter（会被当作自定义 reporter 去 `import('ndjson')` 而失败），TAP 是内置且版本无关的选择；逐文件 spawn 让单个文件的崩溃不拖垮其他文件。ingest 解析 `ok/not ok` + 缩进 YAML 块（error/location/duration_ms/type）
- **元数据**：解析文件头 `// 测试点: <id>`、`// 视角: <charter>` 写入 case 元数据；`caseId` 取测试点 ID
- **失败分类**：复用 `classifyFailure` 的 message 正则——它本就按错误文本分类（`waiting for locator`、`net::ERR` 等），对原生错误文本天然适配
- **run 目录布局**：与 YAML run 一致（`.testpilot/artifacts/runs/<runId>/`），额外保留框架原始输出供深查
- run 命令收尾打印 totals 行（✗✗⊘?↷），退出码契约见缺口 B

**验收**：原生 run 后 `npx csspilot report` 与跨 run 汇总直接可用，原生与 YAML run 在同一份 summary 里统计。

## 5. 缺口 B：三态约定（@testpilot/native 的三态标记）

现状缺口：原生框架只有 passed/failed/skipped，`blocked`（环境/前置）与 `inconclusive`（本轮没测到）没有表达载体；退出码只剩 0/1，CI 依赖的"blocked→2 分桶重跑"语义丢失。

**设计**：新建 `packages/native`（npm 名 `@testpilot/native`，workspace 内不独立发版），导出两个标记函数：

```ts
import { blocked, inconclusive } from '@testpilot/native'

test('下单页加载', async () => {
  if (!(await isStagingAlive())) throw blocked('staging 不可达')   // infra 桶
  const token = await tryGetToken()
  if (!token) throw inconclusive('登录前置失败,断言未真正执行')     // unverified 桶
})
```

- 实现即抛带约定 `code` 的 Error（`code: 'ENVIRONMENT_UNAVAILABLE'` 等，复用 `verdict.ts` 现有桶表），不包装、不拦截原生框架的任何行为
- ingest 归一时从 error 的 code/message 提取错误码 → `verdictFromErrorCode` → failed/blocked/inconclusive
- **退出码契约恢复**：聚合后 `blocked > 0 && failed === 0` → exit 2，否则沿用 0/1（与 `run.ts` 现有 `exitCodeForSummary` 对齐）
- `rules/native.md` 增补"三态标记"章节：AI 写脚本时环境类前置失败抛 `blocked`，前置数据/变量缺失导致断言没真正跑抛 `inconclusive`；其余失败什么都不用标

## 6. 缺口 C：小程序连接 helper

现状缺口：`native.md` 要求脚本内直接 `automator.launch`，但 `adapter-wechatide/src/ide.ts`（1188 行）里沉淀的端口管理（`cli auto --auto-port`）、`connectWithRetry`、就绪等待、原生授权决策（authorizeAllow/authorizeCancel）、`mockWxMethod` 封装全是踩坑成果——让每个项目的脚本重新发明等于丢掉资产。

**设计**：`ide.ts` 中 **无 DSL 依赖的部分**（`automatorLauncher`、连接重试、授权处理、wx mock 封装）下沉到 `@testpilot/native` 导出；`MiniAppAdapter`（吃 DSL step 的部分）留在原地随旧链路退役。

```ts
import { test } from 'node:test'
import { launchMiniApp } from '@testpilot/native'

test('加购下单', async t => {
  const mini = await launchMiniApp({ projectPath: process.env.MINIAPP_PROJECT_PATH! })
  t.after(() => mini.close())
  await mini.reLaunch('/pages/goods/detail?id=1')
  // 之后全部是 miniprogram-automator 原生 API:mini.currentPage()、element.tap()、mockWxMethod()…
})
```

- 连接是一行 helper，之后的操作全部原生——不违背“不做中间商”
- helper 只覆盖“建立会话 + 授权决策 + mock 恢复”这三个每端必然重复的胶水点

### 6.1 与官方文档对齐（稳定性收益）

对照官方 automator / miniprogram / page / element / remote 文档（2026-10）逐项核对，官方已有现成能力直接命中当前痛点，helper 以透传参数的方式吸收，不发明新语义：

| 官方能力 | 稳定性/统一性收益 | helper 落点 |
| --- | --- | --- |
| `automator.connect({ wsEndpoint })` + `cli auto --auto-port` 常驻 | **常驻模式**：工具已开着项目时免重复启动编译——每次 launch 全自动冷启动（官方 timeout 默认 30000ms）是最大的时间开销与不稳定源 | `connectMiniApp({ wsEndpoint })`；`launchMiniApp` 内部先探测服务端口，有常驻会话自动降级为 connect |
| `launch({ timeout })` | 启动超时官方参数，替代手写 retry 循环 | 透传，默认对齐官方 30s |
| `launch({ ticket })` + `getTicket/setTicket/refreshTicket` | **登录票据跨机器复用**（2 小时有效，refreshTicket 续期）：工具未登录是 CI 环境类失败（blocked）的主要来源 | `launchMiniApp({ ticket })` 透传；ticket 缓存在 `.testpilot/cache/`（已 gitignore），临期自动 refresh |
| `launch({ account })` + `miniProgram.testAccounts` | **多账号调试**：以指定 openid 启动（IDE ≥ 1.02.2002272），登录态准备从“脚本内 UI 登录”升级为官方原生支持 | `launchMiniApp({ account })` 透传；账号引用复用 `.env.testing` 的 `TESTPILOT_ACCOUNT_*` 约定，三端账号机制统一 |
| `launch({ projectConfig })` | 启动时覆盖 project.config.json，消除“项目配置差异”类环境噪声 | 透传 |
| `miniProgram.remote()` | **真机自动化**：同一份脚本模拟器跑通后可切真机执行（安卓微信 ≥ 7.0.6、iOS ≥ 6.6.7；`remote(true)` 自动调起） | `launchMiniApp({ mode: 'remote' })` 透传；取证差异见 6.2 |

以上全部归属“会话建立”一类胶水，helper 硬边界不扩（§10）。

### 6.2 官方已知限制（写进 rules/native.md）

AI 写脚本最容易踩的坑，全部是官方文档明示的限制，进 `rules/native.md` 的脚本规范：

- **等待**：优先 `page.waitFor(selector)` / `page.waitFor(fn)`（选择器出现、断言函数为真），毫秒死等只允许前置初始化场景
- **组件内元素**：`page.$/$$` **无法选择自定义组件内的元素**，必须先取组件 element 再 `element.$` 逐层进入——小程序自动化失败的第一大原因，项目组件化程度高，规范必须写明
- **取值**：`attribute` 只取标签特性（字符串）；input 实际值用 `element.property('value')`
- **点击**：`element.trigger` 只能调用组件的响应方法、**无法触发 tap/longpress**；模拟点击用 `element.tap()`，填输入框用 `element.input()`
- **mock**：`mockWxMethod` 支持函数形式并可用 `this.origin` 调原实现，但函数内**无法使用闭包变量**（序列化传递；automator ≥ 0.9.0、基础库 ≥ 2.9.5）；插件方法用 `mockPluginWxMethod`（基础库 ≥ 2.19.3）
- **诊断**：`miniProgram.on('console')` / `on('exception')` 实时监听；helper 默认挂 exception 监听，失败时随错误输出，ingest 落入 case 诊断信息
- **取证平台差异**：`miniProgram.screenshot` **仅开发者工具模拟器可用**，真机（remote）模式无截图——ingest 对 remote 模式的截图占位标注 `unavailable`，不静默缺失
- **版本门槛**：基础库 ≥ 2.7.3、IDE ≥ 1.02.1907232（doctor 检测项，见 §8）

## 7. 缺口 D：evidence 机器校验（lint）

现状缺口：no-invention 原靠 `validate` 硬卡 schema；原生脚本只有头注释约定，无任何校验。

**设计**：`validate` 命令增加原生脚本 lint 分支（YAML 分支保留至退役）：

1. 头注释存在且格式合法（测试点 ID、视角取值在枚举内）
2. 测试点 ID 在 `tests/e2e/reviews/` 清单中存在——**清单是唯一的用例来源**，清单里没有的 ID 直接报错（no-invention 的残留硬卡）
3. 脚本引用的 `process.env.*` 在 `.env.testing` / 配置白名单中可解析
4. （web）引用的页面路由在项目路由表中存在时才校验，做不了的不硬卡

lint 是 AI 生成后自查 + CI 卡点的统一入口。

## 8. CLI 命令终局

| 命令 | 去向 |
| --- | --- |
| `init` | ✅ 已完成（目录、skill、references） |
| `run` | ✅ 双轨已有；本设计补 ingest + 退出码 2 |
| `report` | 不改（吃 result.json，原生 run 落同形态后自动可用） |
| `validate` | 改造：+原生 lint 分支；YAML 分支随退役删除 |
| `doctor` | 改造：检测各端 runner 可用性（playwright 安装、Node >= 22、IDE cli 存在且版本 ≥ 1.02.1907232、automator 版本、project.config.json libVersion ≥ 2.7.3、9420 服务端口连通性即常驻 connect 可用性），替代原 adapter 检测 |
| `sync-metadata` | 改造：改吃 ingest 后的原生用例元数据（头注释） |
| `rehearse` / `discover` / `list` | 退役（YAML 时代产物；`list` 若有需要改为列原生脚本与测试点映射） |
| `ci init` / `update` | 不变 |

## 9. 旧链路退役清单

**删除**（M3）：

- `packages/dsl`、`packages/execution-engine` 整包
- `packages/adapter-playwright`、`packages/adapter-api`、`packages/adapter-core`（locator/授权中无 DSL 依赖的逻辑先迁 `@testpilot/native`）
- `packages/observation-core`、`packages/evidence`（引擎取证链路；web 取证由 Playwright 原生 trace/video 接管）
- `packages/sdk` 中吃 DSL 的 9 个文件（cases/case-config/case-data/case-preparation/client/discovery/ready/runs/runs-api；配置、project link、reports 保留）
- `tests/e2e/cases/` 存量 YAML：迁移窗口期内 init 保留建目录但不推广；旧用例人工决定迁移或废弃

**迁移**（M2）：

- `adapter-wechatide/src/ide.ts` 拆分：无 DSL 的 automator 封装 → `@testpilot/native`；`MiniAppAdapter` → 删

## 10. 风险与对策

| 风险 | 对策 |
| --- | --- |
| node:test reporter 格式随 Node 版本漂移 | `package.json` 已锁 `node >= 22`；ingest 解析容错（解析失败的行原文保留） |
| Playwright JSON 输出体积大（含 attachment） | 附件只记路径不落内容；run 目录整包进 `.testpilot/artifacts/` 已被 gitignore |
| 旧 YAML run 与原生 run 混在 summary 里统计口径不一致 | ingest 归一到同一 `RunSummary` 形态；迁移期结束后 YAML run 自然消失 |
| `@testpilot/native` helper 蔓延成新 DSL | 硬边界：只允许“会话建立/授权决策/mock 恢复/三态标记”四类 API，出现 step/assert 类 API 即违反本设计 |
| 真机（remote）模式取证受限：`screenshot` 仅模拟器可用 | 取证能力按执行端矩阵化；remote 模式靠断言输出 + `on('exception')` 诊断，ingest 对截图占位标注 `unavailable` 而非静默缺失 |
| connect 常驻会话共享 IDE 状态，多脚本互染 | 常驻模式下脚本一律以 `reLaunch` 开局收口；对状态敏感的用例通过 helper 参数声明走 launch 冷启动 |
| AI 忘记标 blocked/inconclusive | 宁红勿漏兜底：未标记的失败一律 product→failed，与现有 verdict 语义一致 |

## 11. 里程碑

- **M1 — run/report 闭环**（缺口 A + B）✅ 2026-10-28 完成：native-ingest、三态标记、退出码 2；真实 node:test 冒烟全链路验证（HTML 报告含三桶、blocked exit 2、result.json 同形态）。落地修正：Node 22 没有内置 ndjson reporter，结构化输出改用**内置 TAP reporter**（逐文件 spawn，见 §4）
- **M2 — helper 与校验**（缺口 C + D）✅ 2026-10-28 完成：`@testpilot/native`（launchMiniApp 的 auto/launch/connect 三模式、ticket 缓存、blocked/inconclusive）、validate lint 三道卡、doctor 改造、sync-metadata 改造。注意：`@testpilot/native` 是 private workspace 包，业务项目装不了——脚本可零依赖手写 `[TESTPILOT:ENVIRONMENT_UNAVAILABLE]` / `[TESTPILOT:PREREQ_VARIABLE_MISSING]` 错误前缀（冒烟已验证此写法），ingest 同样识别
- **M3 — 退役**（§9）✅ 2026-10-28 完成：删除 dsl / execution-engine / adapter-playwright / adapter-api / adapter-core / observation-core / evidence / discovery-engine 九包与 apps/agent；sdk 清成 project + native-cases + runs + reports；`rehearse` / `discover` / `list` 命令与 CLI `--tag` / `--require-ready` 退役（YAML 输入给迁移指引并退出码 1）；存量 `tests/e2e/cases/` YAML 删除；Server 摘除 DSL 部分（Agent Job、RunEvent 事件流、runEvents 表），run 编排改为 spawn 原生链路（runNativeCases + 取消语义）；Web 控制台同步清理；collectPath 补显式文件路径存在性检查。注意：runs.ts 只保留纯文件系统函数（allocateRunId/listRuns/latestRunId/getRun/RunMeta），Server 触发运行改走 runNativeCases 直 spawn
