# GitHub 高星自动化测试项目的测试用例生成机制调研

> 调研日期：2026-10-08。所有 star 数、最近推送时间均来自 GitHub REST API（`api.github.com/repos/<owner>/<repo>`）当日实时抓取；机制描述均基于项目 README、官方文档、源码文件或论文原文（一手资料），每个论断附来源链接。无法核实的信息明确标注"未核实"。

---

## ① 筛选方法与项目清单

### 筛选方法

1. **必选清单核实**：对任务书列出的每个项目逐一调用 GitHub API 核实存在性、star 数、活跃度、许可证。两处修正：
   - `bytedance/Midscene.js` 已迁移为 **`web-infra-dev/midscene`**（官网 midscenejs.com 页头 GitHub 链接指向该仓库，[来源](https://midscenejs.com/)）。
   - `UnitTestBot/utbot` 已不存在（API 404），现以组织内主仓库 **`UnitTestBot/UTBotJava`** 为准。
2. **增补**（2025–2026 更新高分且与"用例生成"直接相关）：
   - **antiwork/shortest**（自然语言 E2E 测试框架，5.7k★）
   - **microsoft/playwright-mcp**（37.9k★，a11y-tree 驱动浏览器 + 录制/locator 生成，直接影响"AI 生成 E2E 用例"的定位策略）
   - 补充调研了 GitHub trending 与社区盘点（Midscene / Stagehand / shortest / Keploy 为 2025–2026 年 AI 测试方向公认头部开源项目），未发现清单外有同等量级且更相关的遗漏项目。
3. **降级/排除及理由**：
   - **apiaryio/dredd**（4.2k★）：**仓库已被官方 archived**（最后 push 2024-05-11），机制上已被 schemathesis 等后继者覆盖，仅在 API 测试一节简述，不做深挖。
   - **qodo-ai/qodo-cover**（5.7k★）：README 于 2025-06-15 声明"**no longer maintained**，请 fork 后继续使用"（[仓库 News 区](https://github.com/qodo-ai/qodo-cover)）。但其"覆盖率闭环"方法论是 LLM 单测生成的典型实现，保留深挖并标注状态。
   - **UnitTestBot**：UTBotJava 最后 push 2025-10-27，组织开发重心已转向组件库 jacodb / usvm（2026-10 仍在推送，见[组织仓库列表](https://api.github.com/orgs/UnitTestBot/repos?sort=pushed)）。保留作为传统基线之一，活跃度如实标注。

### 项目清单表（数据抓取日期：2026-10-08）

| 项目 | 领域 | Stars | 最近 push | 许可证 | 状态 |
|---|---|---:|---|---|---|
| [browser-use/browser-use](https://github.com/browser-use/browser-use) | 浏览器 Agent（可用于 E2E） | 117,415 | 2026-10-07 | MIT | 活跃 |
| [microsoft/playwright](https://github.com/microsoft/playwright) | Web 测试框架 + codegen 录制基线 | 97,249 | 2026-10-08 | Apache-2.0 | 活跃 |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | a11y-tree 浏览器 MCP（含录制/locator 生成） | 37,912 | 2026-10-08 | Apache-2.0 | 活跃 |
| [browserbase/stagehand](https://github.com/browserbase/stagehand) | AI 浏览器 SDK（act/observe/extract） | 25,563 | 2026-10-08 | MIT | 活跃 |
| [keploy/keploy](https://github.com/keploy/keploy) | 流量录制 → API/E2E 测试 + mock | 18,539 | 2026-10-08 | Apache-2.0 | 活跃 |
| [web-infra-dev/midscene](https://github.com/web-infra-dev/midscene)（原 bytedance/Midscene.js） | AI UI 自动化 / E2E（GUI Agent for E2E Testing） | 15,097 | 2026-10-08 | MIT | 活跃 |
| [tester-army/e2e](https://github.com/tester-army/e2e) | NL goal + 确定性断言混合 E2E 框架（web/mobile），录制回放缓存 | 8,485 | 2026-10-09 | Apache-2.0 | 活跃（2026-07-22 创建，上升极快） |
| [antiwork/shortest](https://github.com/antiwork/shortest) | 自然语言 E2E 测试框架 | 5,685 | 2026-08-06 | MIT | 活跃 |
| [qodo-ai/qodo-cover](https://github.com/qodo-ai/qodo-cover) | LLM 单测生成 + 覆盖率闭环 | 5,659 | 2026-04-05 | AGPL-3.0 | **已声明不再维护（2025-06-15）** |
| [apiaryio/dredd](https://github.com/apiaryio/dredd) | API 契约测试 | 4,222 | 2024-05-11 | MIT | **已 archived** |
| [schemathesis/schemathesis](https://github.com/schemathesis/schemathesis) | 基于 OpenAPI/GraphQL schema 的属性化模糊测试 | 3,653 | 2026-10-07 | MIT | 活跃 |
| [test-zeus-ai/testzeus-hercules](https://github.com/test-zeus-ai/testzeus-hercules) | agentic QA 测试 agent | 1,178 | 2026-08-04 | AGPL-3.0 | 活跃 |
| [EvoSuite/evosuite](https://github.com/EvoSuite/evosuite) | 搜索式 SBST 单测生成（传统基线） | 921 | 2025-02-14 | LGPL-3.0 | 缓慢维护 |
| [healenium/healenium-web](https://github.com/healenium/healenium-web)（主仓库 [healenium/healenium](https://github.com/healenium/healenium) 167★） | Selenium locator 自愈 | 201 | 2026-10-06 | Apache-2.0 | 活跃 |
| [UnitTestBot/UTBotJava](https://github.com/UnitTestBot/UTBotJava) | 符号执行 + fuzzing 单测生成 | 147 | 2025-10-27 | Apache-2.0（仓库 API 标注） | 低活跃；组织重心转向 jacodb/usvm |

论文基线（非开源项目，方法论依据）：

- **TestGen-LLM**（Meta，FSE 2024）：[arXiv:2402.09171](https://arxiv.org/abs/2402.09171)
- **CodaMosa**（**Microsoft Research + UBC**，ICSE 2023，注意：任务书误记为 Meta，经论文作者页核实为 Microsoft/UBC 工作）：[ACM DOI](https://dl.acm.org/doi/10.1109/ICSE48619.2023.00085) ｜ [作者 PDF](https://www.carolemieux.com/codamosa_icse23.pdf) ｜ [代码 microsoft/codamosa](https://github.com/microsoft/codamosa)

---

## ② 逐项目机制剖析

### 2.1 web-infra-dev/midscene —— 截图视觉定位 + 可缓存缓存的 AI UI 自动化

**源头**：自然语言（代码内嵌指令）+ YAML/TypeScript（新套件 Midscene Test, Beta）。
README 原文：任务流与期望"described in plain English"，如 `await agent.aiAct('Search for headphones, ...')`；Midscene Test 让你 "Write UI flows and expectations in YAML, and wrap API calls, data preparation, and cleanup in reusable TypeScript Nodes"。（[README](https://github.com/web-infra-dev/midscene)）

**生成机制**：非"生成测试用例代码"，而是**运行时由多模态 LLM 即时规划与定位**。核心口号是 "look at the screen, act on what you see, and check the visible result"；关键取舍是**截图优先**："Screenshot-based UI actions avoid sending large DOM trees to the model"。默认"一个模型负责规划、定位与页面理解"，复杂任务可选独立 Planning/Insight 模型；支持 Qwen3.x、Doubao-Seed-2.1、UI-TARS（可自部署）等。API 面为 `aiAct`（自主流程）、`aiTap`/`aiInput`（单步动作）、`aiAssert`（断言）、`aiQuery`（结构化取数）、`aiWaitFor`、`aiLocate`。集成 Playwright、Puppeteer、JS SDK，覆盖 Web/Android/iOS/HarmonyOS/桌面。（[README](https://github.com/web-infra-dev/midscene)）

**覆盖度**：无覆盖率闭环概念，流程覆盖靠人（或 AI agent 通过 Midscene Skills）编写；Chrome 扩展 Playground 供在真实 UI 上调试指令后再固化成脚本。特色定位是"**people and AI Agents can discover the same capabilities and co-maintain test cases**"——用例可被人和 agent 共同维护/发现。

**质量闭环（断言来源，重点）**：断言即 `aiAssert`（自然语言期望，由模型对可见结果判定）。**明确把断言/查询排除在缓存之外**：官方缓存文档原文 "The query results like `aiBoolean`, `aiQuery`, `aiAssert` will never be cached"——即断言每次真跑模型，杜绝陈旧判定。（[缓存文档](https://midscenejs.com/caching)）

**定位稳定性**：视觉定位 + **两级缓存**——缓存 "AI Planning steps"（以指令文本为 key）与元素定位（web 端缓存 "element XPath information"）；带**防误配校验**：若"同 XPath 新元素文本与缓存元素不同"或"页面 DOM 结构较缓存时已变化"则跳过缓存回退 AI 重新分析；规划缓存失败也会清除陈旧记录并回退（且回退结果不写回原 key，因"cached steps may have already changed the page state before failing"）。Canvas、跨域 iframe、closed Shadow DOM、WebGL 等无法 XPath 缓存的场景自动回退 AI。缓存命中使示例执行时间 51s→28s。（[缓存文档](https://midscenejs.com/caching)）

**可维护性**：交互式 HTML 报告展示"截图、元素位置、AI 决策过程、动作与断言结果"；Midscene Test 记录每个 AI 步骤与自定义业务的输入/输出/耗时/状态，并从注册的 Nodes 生成 Markdown 参考；缓存以 `.cache.yaml` 存于 `./midscene_run/cache`，CI 中需提交进仓库。（[README](https://github.com/web-infra-dev/midscene)、[缓存文档](https://midscenejs.com/caching)）

---

### 2.2 browserbase/stagehand —— Playwright 之上的 act/observe/extract AI 原语，自愈 + 服务端缓存

**源头**：代码（Playwright 语义）+ 自然语言指令混排。官方示例是 `page.goto` / `page.locator(...).fill`（确定性代码）与 `act()` / `observe()` / `extract()`（AI 原语）交织在同一脚本里。（[README](https://github.com/browserbase/stagehand)）

**生成机制**：三个自然语言原语：`observe()` "finds elements and returns real selectors"；`act()` "performs actions and **self-heals when the site redesigns its form**"；`extract()` "returns schema-validated data"（TS 用 Zod、Python 用 Pydantic、Go 用 struct）。模型经 `modelName` 配置（如 `openai/gpt-5.4-mini`），Model Gateway 自动"picks the cheapest model for each action"。

**覆盖度**：无自动覆盖度推断；覆盖来自测试编写者，AI 降低每步编写/维护成本。上下文效率靠 "**Hybrid accessibility-tree trimming**"（给 agent "exactly the page context they need and nothing more"）。

**质量闭环（断言来源）**：断言不交给 LLM 发明——`extract()` 的**schema 校验**即硬断言；且 `observe()` 返回真实 selector 的设计使敏感数据"credentials never reach the model"，凭密填充走确定性代码。**缓存提供确定性重放**："cache: true: identical calls come back from Browserbase, no tokens spent"；**自愈**是质量闭环核心："act, observe, and extract refresh how an action happens when the site changes underneath it"（站点改版后重新解析动作而非失败）。（[README](https://github.com/browserbase/stagehand)）

**定位稳定性**：a11y-tree 混合裁剪为主；"deep locators for nested iframes and closed Shadow DOM"；自愈 = 页面变化后重解析。

**可维护性**：产物就是 TypeScript/Python/Go 代码（Playwright 风格 API），OTel traces 观测，另有 MCP server 暴露 navigate/act/observe/extract。有官方迁移指南可"Port an existing suite"。（[README](https://github.com/browserbase/stagehand)）

---

### 2.3 browser-use/browser-use —— 通用浏览器 Agent（E2E 的"执行器"而非"用例生成器"）

**源头**：自然语言任务（`Agent(task="...", llm=llm)`）。README 未承诺任何测试语义；它是 agent 库，测试社区把它当 AI 版 Selenium 用。

**生成机制**：单 `Agent` 类自主循环，"Browser Use implements all 31 browser actions"（结构化浏览器动作空间而非原始像素控制）；支持 `@tools.action(...)` 注册自定义工具、`extend_system_message`/`override_system_message` 定制系统提示；模型可用自研 `bu-2-0`（"BU2, our model optimized for browser automation"）或网关前缀模型（`anthropic/claude-sonnet-4-6`、`google/gemini-3-pro`），也支持直连 wrapper 与 Ollama 本地。（[README](https://github.com/browser-use/browser-use)）

**覆盖度**：不适用（无覆盖度机制）。质量基准是 Browser Use Benchmark V2（rubric 评分 + 成本曲线）。

**质量闭环（断言来源）**：无测试断言体系；结果经 `history.final_result()` 返回，校验责任在使用方（测试框架/回调）。这是它作为"测试工具"的最大空缺——**执行强、oracle 弱**。

**定位稳定性**：页面感知基于 DOM 序列化——源码树 `browser_use/dom/` 下有 `service.py`、`enhanced_snapshot.py`、`markdown_extractor.py`、`serializer/`（[源码目录](https://github.com/browser-use/browser-use/tree/main/browser_use/dom)），即"增强 DOM 快照 + markdown 化 + 索引元素"喂给 LLM，而非纯截图。（README 页面对感知细节着墨少，以源码结构为证据。）

**可维护性**：Python 库形态；云端提供 profiles/录制/stealth。作为测试资产时需要上层框架（如 shortest 类）把任务固化为可重放的用例。

---

### 2.4 test-zeus-ai/testzeus-hercules —— Gherkin 输入的 LangGraph 测试 agent（planner/executor/assertor 三节点）

**源头**：**Gherkin feature 文件是唯一测试输入**（"It turns simple, easy-to-write Gherkin steps into fully automated end to end tests"），经 `--input-file` 或 `input/test.feature` 约定目录传入；测试数据独立目录 `--test-data-path`；Gherkin 步骤可通过 Python 沙箱（Hypermind）调用自定义函数。（[README](https://github.com/test-zeus-ai/testzeus-hercules)）

**生成机制**：**运行时 agent 探索，非生成代码**。"Hercules runs on a LangGraph state-machine architecture"：planner 返回 "strict JSON containing `plan`, `next_step`, `target_helper`, `terminate`, and assertion fields"；executor 把 `target_helper` 路由到导航 agent（browser / API / security / SQL / time-keeper / MCP / visual），导航 agent "bind LangChain `StructuredTool` objects to their LLM and run a bounded tool-call loop"；结果回流 planner 直到 terminate 或进入断言处理。浏览器工具含感知类（`get_interactive_elements`, `get_input_fields`, `get_page_text`）与动作类（`open_url`, `click`, `bulk_enter_text`, `click_and_upload_file`, `captcha_solver`…）。测试类型覆盖 UI（Playwright，Chromium/firefox/webkit，移动仿真）、API、安全（集成 **Nuclei** 扫 OWASP Top 10）、无障碍（WCAG 2.0/2.1/2.2 A/AA/AAA）、视觉、SQL、MCP、原生 App（早期 Appium）。模型要求："planner model should be strong at structured JSON reasoning. Navigation models must support tool calling"；支持 GPT-4o/4.1/o 系/GPT-5 系、Claude、Gemini/Bedrock/Ollama 等，示例场景成本"up to $0.20"（GPT-4o）。（[README](https://github.com/test-zeus-ai/testzeus-hercules)）

**覆盖度**：由 feature 文件作者定义场景面；单场景内 agent 自主探索路径。无代码覆盖率反馈（E2E 层不适用）。

**质量闭环（断言来源，重点）**：**断言是状态图里的一等节点**——planner 的 JSON 包含 assertion fields，执行可显式 "route to assertion handling"，即"计划-执行-断言"三段解耦；视觉断言检查"snapshots and components on the application"。产品话术"ensuring that no assertion goes unchecked"。（[README](https://github.com/test-zeus-ai/testzeus-hercules)）

**定位稳定性**：**给 DOM 元素注入 `md` 属性作为主 selector**——"injects an `md` attribute into DOM elements and uses that value as the primary browser selector"，并对复杂企业页做输出压缩以避开 provider token 上限。（[README](https://github.com/test-zeus-ai/testzeus-hercules)）

**可维护性**：用例形态 = Gherkin（非技术人员可写）；失败定位证据链完整：JUnit XML + HTML 报告 + proofs 目录（"video recordings, screenshots per event, and network logs"）+ `agent_inner_thoughts.json`（agent 思考轨迹）+ 可选 Playwright trace.zip（`ENABLE_PLAYWRIGHT_TRACING=true`）。（[README](https://github.com/test-zeus-ai/testzeus-hercules)）

---

### 2.5 antiwork/shortest —— 自然语言字符串即测试，Claude 执行 + 回调硬断言兜底

**源头**：自然语言（TypeScript 文件里的字符串）：`shortest("Login to the app using email and password", { username: ..., password: ... })`，文件模式 `**/*.test.ts`，`shortest.config.ts` 配置。（[README](https://github.com/antiwork/shortest)）

**生成机制**："Built on Playwright"（浏览器行为经 `browser.contextOptions` 透传）+ "AI-powered test execution using Anthropic Claude API"；支持 headless、整包、单文件、按行号运行（`pnpm shortest login.test.ts:23`）。链式测试支持"sequential chains and reusable flows combined with spread operators"。

**覆盖度**：无覆盖度机制（黑盒 E2E）。

**质量闭环（断言来源，重点）**：**自然语言是主断言，程序化回调是硬兜底**——"AI will execute the callback function after the test execution in browser is completed"；回调拿到 Playwright `page`，可查 `localStorage`、查数据库（示例用 Drizzle 查询后 `expect(user).toBeDefined()`，失败 `throw new Error("User not found in database")`）。API 测试两种方式：传入 `APIRequest` 结果，或自然语言提示（"Expect the response to contain only active users"）。这个"NL 断言（软）+ 回调断言（硬）"双层结构，正面回应了 LLM 测试的 oracle 难题。（[README](https://github.com/antiwork/shortest)）

**定位稳定性**：未在 README 详述定位策略（由 Playwright 与模型自主决定）；未核实细节。

**可维护性**：用例即带 NL 字符串的 TS 文件 + 生命周期钩子（`beforeAll/beforeEach/afterEach/afterAll`）；CLI 输出，无独立报告 UI；CI 用 headless + 密钥注入。特色工程配套：GitHub 2FA 验证码支持（`--github-code --secret=...`）与 Mailosaur 邮箱验证登录流。（[README](https://github.com/antiwork/shortest)）

---

### 2.6 qodo-ai/qodo-cover —— "生成→跑→验证覆盖率提升→迭代"的 LLM 单测闭环（已停止维护）

**源头**：**已有源代码 + 现有测试文件 + 现有覆盖率报告**（硬性要求 Cobertura XML："A Cobertura XML code coverage report is required for the tool to function correctly"）。输入即 `--source-file-path` / `--test-file-path` / `--code-coverage-report-path` / `--test-command`。

**生成机制**：四个组件构成的迭代循环（README 原文）：**Test Runner**（"Executes the command or scripts to run the test suite and generate code coverage reports"）、**Coverage Parser**（"Validates that code coverage increases as tests are added, ensuring that new tests contribute to the overall test effectiveness"）、**Prompt Builder**（"Gathers necessary data from the codebase and constructs the prompt"）、**AI Caller**（"Interacts with the LLM to generate tests"）。目标："automatically generating qualified tests to extend code coverage"。经 LiteLLM 支持 100+ 模型；`--desired-coverage`、`--max-iterations` 控制收敛；repo 模式（2024-11）可"scan an entire repo, auto identify the test files, auto collect context for each test file"。已支持 Python（pytest-cov）/Go（gocov→xml）/Java（JaCoCo）。（[README](https://github.com/qodo-ai/qodo-cover)）

**覆盖度**：这是它的全部核心——**覆盖率 delta 是新测试的验收信号**，直到达到 desired-coverage 或迭代上限。

**质量闭环（断言来源）**：断言由 LLM 写进测试，但**只有"测试通过 + 覆盖率上升"才被保留**（Test Runner + Coverage Parser 双闸门）；路线图明确引用 TestGen-LLM 做防 flaky："Check test flakiness, e.g. by running 5 times as suggested by TestGen-LLM"。结果页 `test_results.html` 记录"Test status / Failure reason / Exit code / stderr / stdout / Generated test"。工程配套：`--record-mode` 把 LLM 响应按"源文件+测试文件内容哈希"存 YAML 重放省额度；设 `WANDB_API_KEY` 可把 prompts/responses 全量记录到 Weights & Biases。

**可维护性**：产物 = 常规测试代码（pytest 等），进现有仓库测试目录；失败定位用 `test_results.html`。

**状态警示**：README News 区 2025-06-15 声明 "**This repository is no longer maintained. Please fork it if you wish to continue development**"（[仓库页](https://github.com/qodo-ai/qodo-cover)）。方法论仍有效，选型需 fork 或换用后继方案。

---

### 2.7 EvoSuite/evosuite —— 整套测试遗传算法（SBST 基线）

**源头**：**Java 字节码本身**（被测类/类路径），无人工输入参与搜索过程。

**生成机制**：README 原文："automatically generates JUnit test suites for Java classes, targeting code coverage criteria such as branch coverage"；"uses an evolutionary approach based on a **genetic algorithm** to derive test suites"（整套测试为一个解进行演化，即 Whole Test Suite Generation）；实验配置示例使用 `-generateMOSuite -Dalgorithm=DynaMOSA`（many-objective 演化）。**覆盖目标极广**：源码 `Criterion` 枚举含 23 个准则（`EXCEPTION, DEFUSE, ALLDEFS, BRANCH, CBRANCH, STRONGMUTATION, WEAKMUTATION, MUTATION, STATEMENT, RHO, AMBIGUITY, IBRANCH, READABILITY, ONLYBRANCH, ONLYMUTATION, METHODTRACE, METHOD, METHODNOEXCEPTION, LINE, ONLYLINE, OUTPUT, INPUT, TRYCATCH`），默认启用 8 个：`LINE, BRANCH, EXCEPTION, WEAKMUTATION, OUTPUT, METHOD, METHODNOEXCEPTION, CBRANCH`（[Properties.java](https://github.com/EvoSuite/evosuite/blob/master/client/src/main/java/org/evosuite/Properties.java)）。

**质量闭环（断言来源，重点）**：**回归 oracle**——README："**regression assertions that capture the current behavior of the tested classes are added to the tests**"；生成流程先"the generated unit tests are minimized"（缩小测试集）再加断言。即：断言值不是"发明"的正确值，而是**当前实现的行为快照**，能发现未来回归，但会把现有 bug 固化为预期（SBST 共知局限）。（[README](https://github.com/EvoSuite/evosuite)）

**可维护性**：产物 = JUnit 测试类 + scaffolding，可进 CI；附带种子（SEEDS）文件保证实验可复现。

---

### 2.8 UnitTestBot/UTBotJava —— 符号执行 + 智能模糊化的路径覆盖生成

**源头**：Java 源码/字节码。

**生成机制**：README 原文："The **symbolic execution engine paired with a smart fuzzing technique** constitutes the core of UnitTestBot"；目标"**maximizes path coverage** while minimizing the number of tests and false positives"。产物"ready-to-use test cases for Java — with valid inputs and comments"，且"It can even predict whether the tests fail or pass"（利用符号执行对路径条件的推理给出预期）。IntelliJ 插件内右键 "Generate Tests with UnitTestBot..." 生成并运行，SARIF 报告。（[README](https://github.com/UnitTestBot/UTBotJava)）

**质量闭环**：断言/预期值来自符号执行对分支条件的求解（可预测 fail/pass）+ 人类可读的测试摘要（"Test failed? The summary refers you to the related branch or the condition under test"）。

**活跃度**：147★，最后 push 2025-10-27；组织近年主推 jacodb（字节码分析）与 usvm（符号虚拟机），UTBot 终端工具迭代放缓（[组织仓库列表](https://api.github.com/orgs/UnitTestBot/repos?sort=pushed)）。作为"符号执行 vs 搜索式"的对照基线有价值。

---

### 2.9 论文基线 A：Meta TestGen-LLM（FSE 2024）—— "过滤器保证可测量改进"的测试增强

论文原文（[arXiv:2402.09171](https://arxiv.org/abs/2402.09171)，全文经 [ar5iv HTML 版](https://ar5iv.labs.arxiv.org/html/2402.09171)核对）：

- **定位**："automatically improve existing human-written tests"——不改写全部测试，只**增强现有测试类**。
- **Oracle 难题的正面回答——四级过滤器**（"progressively demanding semantic filters"）：
  1. **Build filter**："checks that the candidate code is fully buildable within the existing infrastructure of the app under test"，失败"immediately discarded"；
  2. **Pass-on-first-execution filter**：'TestGen-LLM discards any test case that does not pass on first execution'——因为"cannot automatically tell a real bug from a bad assertion"（论文明说这是 oracle 问题）；
  3. **Flakiness filter**（论文称 'passes' filter）："a test that does not pass on every one of five executions is deemed flaky"；
  4. **Coverage filter**："measures their coverage; any test not improving coverage is discarded"。
  单次试验成功标准："builds, passes, and increases coverage over all existing test cases."
- **搜索方式**：目录级 generate-and-test + **ensemble**（多模型 × 多 prompt × 多 temperature），非 best-first 搜索；部署默认 temperature 0.0 与 `extend_coverage` prompt。
- **工业结果**：75% 生成测试可构建、57% 稳定通过、25% 提升覆盖；在 Meta 测试马拉松中"improved 11.5% of all classes"，**73% 建议被工程师接受进入生产**；Facebook 280 个 diff 中 144 个被接受。论文自称"the first report on industrial scale deployment of LLM-generated code"。

---

### 2.10 论文基线 B：CodaMosa（ICSE 2023, Microsoft Research + UBC）—— 覆盖率 plateau 触发的 LLM+SBST 混合

（出处核实：作者 Caroline Lemieux（UBC）、Jeevana Priya Inala、Shuvendu K. Lahiri、Siddhartha Sen（Microsoft）；[ACM DOI 10.1109/ICSE48619.2023.00085](https://dl.acm.org/doi/10.1109/ICSE48619.2023.00085)；[作者 PDF](https://www.carolemieux.com/codamosa_icse23.pdf)；开源实现 [microsoft/codamosa](https://github.com/microsoft/codamosa)。任务书中"Meta 的 CodaMosa"为误记，特此更正。）

- **问题**：SBST 高覆盖但常卡在 **coverage plateau**——需要"字典词、合法 ID"等搜索难构造的输入时 fitness 无法推进。
- **混合机制**：先跑 SBST（PyCOS fuzzing 变体），**当覆盖率停止增长时，把"覆盖不足的函数 + 现有输入统计"写进 prompt，让 Codex 生成示例/种子测试**；无论这些种子是否抛异常都并入 SBST 种子池继续演化——"integrates LLMs of code with SBST"。即：**LLM 只负责"进门"（构造难输入），覆盖率推进仍交给搜索式引擎**。
- **效果**：在基线 SBST 卡住的多数 benchmark 上逃出 plateau，line/branch 覆盖显著提升。

---

### 2.11 keploy/keploy —— eBPF 流量录制 → YAML 用例 + 自动 mock，回放响应 diff 即断言

**源头**：**真实流量录制**。机制页原文：Keploy "with eBPF hooks in the kernel on Linux, and in user space on macOS and Windows" 捕获；三个组件：eBPF hooks loader（Ingress："Captures incoming HTTP calls and stores them in YAML format"；Egress："Forwards TCP and certain UDP connections to the proxy for interception. Applications are unaware"）、Network Proxy（"acts as a transparent proxy for recording or mocking outgoing network calls"，把 DB/缓存/API 的"binary streams ... into well-formed YAMLs"；未知依赖"recording binary data as base64 in YAML and using fuzzy matching"；TLS 靠"inserting a fake certificate chain"）、API server。（[How Keploy works](https://keploy.io/docs/keploy-explained/how-keploy-works/)）

**生成机制**：Record 模式捕获"every incoming HTTP request and outgoing dependency call — database queries, API calls, message queue interactions"并"as YAML test cases"落盘；设计目标"Tests and stubs are easy to understand and modify"。零代码改动（"Automatic instrumentation: No code changes required"）。

**质量闭环（断言来源，重点）**：Test 模式"replays those requests in a sandboxed environment ... with all dependencies automatically virtualized and **responses compared to detect regressions**"——**录制的响应即预期值（regression oracle）**，mock 匹配用请求匹配（"Mocking responses during testing by matching requests"），mock 出站调用"ensures no side effects due to non-idempotency"。另有 recording filters（降噪）与 code-coverage 集成文档。

**AI 增强**：AI 页面称 Keploy "built to generate high-quality unit tests using the world's best AI"，多模型编排"For each test file, Keploy routes tasks to different models—letting each one play to its strengths"，并"generate better test cases, **filter out weak tests**, and cover more scenarios"；当前用 Gemini 2.5 Pro 与 GPT-4 family（[AI models 文档](https://keploy.io/docs/keploy-explained/ai-models/)）。注意：AI 主要用于在录制数据之上**补充/增强**单测，录制回放仍是主干。

**可维护性**：用例 = 人类可读 YAML（请求/响应/依赖 stub 三件套）；对比差异即失败定位；JUnit/coverage 报告可入 CI。

---

### 2.12 schemathesis/schemathesis —— schema 即 oracle 的属性化 API 模糊测试

**源头**：**OpenAPI / GraphQL schema**。README："tests OpenAPI and GraphQL APIs by **generating inputs from your schema**, adapting to server responses, and chaining operations into realistic workflows"；`@schema.parametrize()` 让每个操作"runs with random data, edge cases, and invalid inputs"。（[README](https://github.com/schemathesis/schemathesis)）

**生成机制**：基于 **Hypothesis**（"Schemathesis is built on top of Hypothesis, a powerful property-based testing library for Python"）的属性化生成；**自适应**："learns constraints, ids, and auth from responses, reusing them mid-run"；**状态化测试**：`schema.as_state_machine()` + "operation links inferred from your schema, no manual wiring"（自动把 create→get→delete 串成工作流）；**fuzz 字典**："mix real ids, wordlists, or **LLM-generated payloads** into generated data"；配置控制 "auth, phases, and per-operation overrides"。

**质量闭环（断言来源，重点）**：**schema 即 oracle**——源码中的内建检查（[core checks.py](https://github.com/schemathesis/schemathesis/blob/master/src/schemathesis/checks.py)、[OpenAPI checks.py](https://github.com/schemathesis/schemathesis/blob/master/src/schemathesis/specs/openapi/checks.py)）：`not_a_server_error`（"verify that the response is not a server-side error"）、`max_response_time`（默认 10s），以及 OpenAPI 专属 12 个：`status_code_conformance`、`content_type_conformance`、`response_headers_conformance`、`response_schema_conformance`、`negative_data_rejection`、`positive_data_acceptance`、`missing_required_header`、`unsupported_method`、`allow_header_conformance`、`use_after_free`、`ensure_resource_availability`、`ignored_auth`（"Check if an operation declares authentication as a requirement but does not actually enforce it"）。覆盖度量化：**"Schema coverage"——"keyword-level coverage report showing which constraints your tests exercised"**，live 基准按 phase 展示覆盖增长。

**可维护性**：失败即最小复现（crash-reproduction 指南），"Replay & baseline"可"re-run past failures"并"fail CI only on new ones"（老失败不阻塞、只拦新故障）；报告导出 JUnit/VCR/HAR/NDJSON/JSON/Allure。（[README](https://github.com/schemathesis/schemathesis)）

---

### 2.13 apiaryio/dredd —— 已归档的契约测试基线（简述）

从 API Blueprint/OpenAPI 文档生成"transaction"逐条请求并比对响应，hooks 机制支持自定义校验。**仓库已 archived**（最后 push 2024-05-11，[仓库页](https://github.com/apiaryio/dredd)），OpenAPI 契约测试场景事实上已被 schemathesis 类工具取代。此处仅作生态对照，不再深挖（细节未逐条核实）。

---

### 2.14 microsoft/playwright codegen —— "录制"基线：确定性代码 + 语义 locator 优先

**源头**：用户手工操作录制。`npx playwright codegen <url>` 双窗口（浏览器 + Inspector），操作实时写入 `test-1.spec.ts`；VS Code 内可 "Record at cursor" 追加。（[codegen 文档](https://playwright.dev/docs/codegen)）

**生成机制**：纯确定性录制转代码，无 LLM。**定位策略（本调研的"录制基线"）**：codegen "looks at the page to pick the best locator, **prioritizing role, text and test id locators**"；多个匹配时"improve the locator to make it resilient"至唯一识别；另支持 Pick locator 手工挑选、`--load-storage` 复用登录态。

**断言生成**：工具栏三键——'assert visibility'（"assert that an element is visible"）、'assert text'（"assert that an element contains specific text"）、'assert value'（"assert that an element has a specific value"）——即录制期间人工点选目标元素产生断言，预期值来自用户在页面上看到的实况（又一例"录制即预期"）。（[codegen 文档](https://playwright.dev/docs/codegen)）

**延伸（playwright-mcp）**：为 LLM 驱动浏览器提供的官方范式——"interact with web pages through **structured accessibility snapshots**, bypassing the need for screenshots or visually-tuned models"；明确卖点 "No vision models needed" 与 "Deterministic tool application. Avoids ambiguity common with screenshot-based approaches"；元素以 snapshot ref（"Exact target element reference from the page snapshot"）寻址；并自带生成侧能力：`--codegen <lang>`、`browser_start_recording`（"captures actions ... as Playwright code"）、`browser_generate_locator`（"Generate locator for the given element to use in tests"）、testing 能力包（`browser_verify_element_visible` / `browser_verify_text_visible` / `browser_verify_list_visible` / `browser_verify_value`）。（[README](https://github.com/microsoft/playwright-mcp)）

---

### 2.15 healenium/healenium —— 不生成用例，专治"用例变脆"：locator 自愈

**源头/定位**：不生成测试；对**既有 Selenium 用例**的 locator 做自愈，属于"定位稳定性"维度的专用方案。

**机制**：测试代码包一层代理 `SelfHealingDriver.create(delegate)`；正常定位时把元素的**节点路径（祖先链）**经 `nodeService.getNodePath` 打包（session ID + By locator + action + URL）存入 hlm-backend（Docker 双容器 "healenium-backend and healenium-db"，PostgreSQL）；locator 失败时由 Imitator 服务生成候选 locator，配置 `score-cap`（README 示例："a 0.5 cap means healing applies when probability of match with target one is >=50%"）与 `recovery-tries`（候选列表）控制。（[healenium-web README](https://github.com/healenium/healenium-web)、[healenium-backend README](https://github.com/healenium/healenium-backend)）

**质量闭环（源码级）**：`SelfHealingEngine.replaceHealedElementLocator` 对每个候选**回放验证**——`webDriver.findElements(locator)` 必须恰好命中一个、且其 Selenium element ID 与愈合元素一致才接受（`healedElement.setScored(new Scored<>(score, locator))`）；开关由 `heal-enabled` + 无 `@DisableHealing` 注解双条件控制（[SelfHealingEngine.java](https://github.com/healenium/healenium-web/blob/master/src/main/java/com/epam/healenium/SelfHealingEngine.java)）。候选相似度评分的数学细节在 `NodeService`/`HealingService`/treecomparing 包，本次未逐行核实（标注：未核实）。

**可维护性**：hlm-idea 插件把愈合后的 locator 回写进测试代码；报告含 healing 结果与"backlight-healing"红框截图。

---

### 2.16 tester-army/e2e —— "NL goal + 确定性断言"混合框架，录制回放缓存做到证据门槛级（补充调研 2026-10-10）

**概况**：2026-07-22 创建，8,485★（增速极快，GitHub Trending of the Day），TypeScript，Apache-2.0，商业公司 TesterArmy 支撑（BYO model/key/本地模型）；API 未到 1.0。Web 走 Playwright（Chromium/Firefox/WebKit），Mobile 走 agent-device（iOS/Android，`screen.getByRole(...).tap()` 一套 API 两端用）。README、[docs/core-concepts.mdx](https://github.com/tester-army/e2e/blob/main/docs/core-concepts.mdx)、[docs/cache.mdx](https://github.com/tester-army/e2e/blob/main/docs/cache.mdx)、[docs/agent-steps.mdx](https://github.com/tester-army/e2e/blob/main/docs/agent-steps.mdx)、[docs/bug-bash.mdx](https://github.com/tester-army/e2e/blob/main/docs/bug-bash.mdx)。

**源头**：人写/编码 agent 写 TS 测试文件（goal 字符串 + locator 断言同文件）；探索产物经 bug bash 转成 repro 测试。

**机制——三类步骤，成本显式化**：goal（`agent.act`，调模型，除非缓存回放）/ assertion（`agent.assert`/`waitFor`/`extract`，调模型）/ locator（`screen`+`expect`，零模型）。"人控 goal 顺序，agent 控 goal 内流程"。

**录制回放缓存（本调研所见最讲究的实现）**：
- **证据门槛写入**：act 步骤只有在**后续检查通过**后才被记录；无检查确认则 `unconfirmed` 不保存，回放失败/被修复则 `evicted`（cache.mdx）。
- **语义回放**：按 role/name/testId/上下文重找控件（非坐标）；匹配歧义即移交 agent（`handed off`）；报告区分 `replayed/handed off/missed` + `step.cache.reason/detail`（"at action 2 of 3, tap button Apply: ..."）。
- **效果验证**：回放必须复现原步骤造成的"变化"（控件出现/消失、状态翻转），且"结果在动作前已在屏上不证明任何事"；裸数字徽章永不作为证据；计数语义区分"本步骤产生"与"原本就有/仅移动"。
- **路由归一**：token/时间戳读作 id placeholder（`/orders/42` ≡ `/orders/7`），有语义的 query 差异算不同屏。
- **key 设计**：test+target+instruction+params+agent+context hash；**换模型不失效**（模型可替换）。`unique()` 包装每跑必变的值以免全量 miss，param-collision 防碰撞。

**断言证据学**：三态判定 passed/failed/**blocked**——环境挂了（exit 3）、种子数据缺失（exit 2）与产品 bug（exit 1）分账；"证据不足"是 `ASSERTION_INCONCLUSIVE` 而非失败。judge 模型只看断言语句+当前屏+context，**看不到此前步骤与 act 摘要**（防叙事偏见），可配独立 judge 模型。`extract` 走 Standard Schema（Zod），数据不在屏上返回 `ASSERTION_INCONCLUSIVE` 而非 placeholder。NL 软断言与 locator 硬断言同文件并存，文档明示"精确文本用 locator"。Secret 全链路脱敏（模型不可见、fill 后停发截图、屏上出现即替换 `<secret:name>`）。

**探索式找 bug（explore + bug bash）**：`e2e explore '<goal>'` 无测试文件探索，产出 issue/warning 分级 findings（复现步骤+截图）；**bug bash 闭环**：并行多个 explore charter（每区域一个 charter+一个人设：first-time user / numbers and copy / edge input / state after reload / error paths）→ 合并 findings → 剔除已知原因 → **编码 agent 给每个 finding 写 repro 测试 → 只有测试以 `ASSERTION_FAILED` 失败才确认是 bug**——"发现必须被一个失败的测试证明"。

**面向 coding agent 的基建**：`e2e init` 装 skill（`.agents/skills/e2e` + `.claude/skills` symlink）+ MCP 配置（live app 上核对 locator）；npm 包自带全部 docs（`node_modules/e2e/docs` 离线可读）；`create-verification-skill` 为项目生成验证 skill（启动命令、驱动方式、证据形式、feature map——每 feature 一个 explore charter）。

**风险**：项目仅 2.5 个月，API 未定；商业平台主导，hosted 引擎（kernel/smol/EAS）为付费服务；explore 有硬预算（默认 8 步/10 分钟，上限 12 步/15 分钟）；NL 断言终究是模型判定（官方自认，兜底靠 locator）。

**与共性模式的印证**：它是共性 ③（确定性打底、AI 断点介入）与 ⑥（可测量过滤器链）在 E2E 领域把细节打磨到最深的项目——把"后续断言验证过才缓存""回放必须复现效果""blocked 与 failed 分账""judge 看不到叙事"这些别人没做到的约束做成了默认行为。

---

## ③ 横向对比：源头 → 生成机制 → 覆盖度手段 → 质量闭环

| 项目 | 源头 | 生成机制 | 覆盖度手段 | 质量闭环（oracle/断言） | 定位/稳定性 | 用例形态与失败定位 |
|---|---|---|---|---|---|---|
| **midscene** | 自然语言 + YAML/TS | 运行时多模态 LLM 规划+截图定位（aiAct/aiAssert/aiQuery…） | 无闭环；Playground 调试 + 人/agent 共同维护 | aiAssert 自然语言断言；**断言/查询永不缓存**；规划缓存失败回退 | 视觉定位 + XPath 缓存（文本/DOM 变化即失效防误配） | YAML/TS；交互式 HTML 报告（截图+AI 决策） |
| **stagehand** | 代码 + NL 指令 | act/observe/extract 三原语，LLM 按需介入 | 无闭环 | extract **schema 校验**；**自愈**（站点变更重新解析）；服务端缓存确定性重放 | hybrid a11y-tree 裁剪；deep locators（iframe/Shadow DOM） | Playwright 风格代码；OTel traces |
| **browser-use** | 自然语言任务 | 单 Agent 自主循环 + 31 个结构化动作 + 自定义 tools | 无（通用 agent） | 无测试 oracle（`history.final_result()`） | DOM 序列化/增强快照（`browser_use/dom/`），非纯视觉 | Python 库；上层框架负责用例化 |
| **hercules** | **Gherkin feature 文件** | LangGraph 状态机（planner/executor/assertion）+ 各域导航 agent 工具循环 | 场景面由 feature 定义；agent 场景内自主探索 | **断言是独立图节点**（planner JSON 含 assertion fields）；视觉断言 | 注入 `md` 属性作 selector；感知工具列出可交互元素 | Gherkin；JUnit XML + HTML + proofs（视频/截图/网络日志）+ Playwright trace |
| **shortest** | 自然字符串（TS 文件） | Playwright 执行 + Claude 驱动 | 无闭环 | **NL 断言（软）+ 回调硬断言**（page/DB 校验，throw 即失败） | 未见专门策略（未核实） | TS 文件 + hooks；CLI 输出 |
| **qodo-cover** | 源码 + 现有测试 + 覆盖率报告 | LLM 生成测试 → 跑 → 覆盖率验证 → 迭代 | **覆盖率 delta 为验收**；desired-coverage / max-iterations | 通过 + 覆盖率提升才保留；flakiness 跑 5 次（引 TestGen-LLM） | 不适用 | 常规测试代码；test_results.html |
| **evosuite** | Java 字节码 | 遗传算法整 suite 演化；DynaMOSA；23 种准则（默认 8） | **多准则覆盖率 fitness 即搜索目标** | **回归断言**（捕获当前行为），先 minimization 后加断言 | 不适用 | JUnit + scaffolding；SEEDS 复现 |
| **UTBotJava** | Java 源码 | 符号执行 + smart fuzzing，**max path coverage** | 路径覆盖为搜索目标 | 符号执行求解预期；可预测 fail/pass；人类可读摘要 | 不适用 | JUnit（带注释）；SARIF 报告 |
| **TestGen-LLM（论文）** | 现有人写测试类 | LLM ensemble（模型×prompt×temperature）generate-and-test | **Coverage filter**：不提升覆盖即弃 | **Build→Pass(首跑)→Flakiness(5 跑)→Coverage 四级过滤器**；73% 被人接受 | 不适用 | 增量 diff 进现有测试库 |
| **CodaMosa（论文）** | Python 源码 | SBST 到 plateau → Codex 生成种子测试并入搜索 | **plateau 检测触发 LLM**，覆盖率继续由 SBST 推进 | 继承 fuzzing 的 oracle（异常/显式断言）+ SBST 框架 | 不适用 | pytest 测试代码 |
| **keploy** | **真实流量**（eBPF/代理） | 录制转 YAML 用例 + 依赖自动 mock；AI 多模型增强单测 | 真实流量天然代表实际用法；coverage 集成 | **回放响应 diff 即断言**（regression oracle）；mock 按请求匹配 + 未知依赖模糊匹配 | 不适用 | 可读 YAML（req/resp/stub）；diff 即失败定位 |
| **schemathesis** | **OpenAPI/GraphQL schema** | Hypothesis 属性化生成 + 自适应学习 + 状态机链接 + fuzz 字典（可 LLM payload） | **Schema coverage（keyword 级报告）**；phase 化增长 | **schema 即 oracle**：12+2 项内建 check（schema/status/negative_data_rejection/ignored_auth…） | 不适用 | pytest 集成；最小复现 + baseline"只 fail 新故障" |
| **playwright codegen** | 用户手工操作 | 确定性录制转代码 | 无（人工） | 录制时点选 assert visibility/text/value（**录制即预期**） | **role/text/testId 优先**，多匹配自动加固到唯一 | Playwright 测试代码；trace/inspector |
| **playwright-mcp** | agent 交互 + 用户录制 | a11y snapshot 驱动；`--codegen`/`browser_start_recording` 转 Playwright 代码 | 无 | testing 能力包 `browser_verify_*` | **a11y tree + ref 寻址，无需视觉模型**，"deterministic tool application" | Playwright 代码；snapshot/trace |
| **healenium** | 不生成（自愈既有用例） | 失败时 Imitator 生成候选 locator + 评分 | 不适用 | **回放验证**：唯一命中且 element ID 一致才接受 | 节点路径存 PostgreSQL；score-cap 阈值；IDE 插件回写 | 原 Selenium 代码 + 修复报告 |
| **e2e (tester-army)** | 人/coding agent 写 TS（goal+locator）；bug bash 把 finding 转 repro 测试 | act(NL goal)/assert(NL 判定)/locator(确定性) 三类步骤；录制回放缓存 | charter 视角矩阵（persona/边界/错误路径/reload 后状态）驱动 explore 扇出；repro 测试失败才确认 bug | **证据门槛缓存写入**（后续检查通过才记录）+ **回放效果验证**（必须复现变化）；三态判定（blocked≠failed，证据不足=INCONCLUSIVE）；judge 与 actor 信息隔离 | 语义 locator 回放（role/name/testId/上下文），歧义移交 agent；换模型缓存不失效 | TS 文件；run summary 报 tokens/模型调用数/缓存命中；trace 按步展示缓存 reason |

---

## ④ 可迁移的共性模式（7 条）

1. **oracle 三来源，LLM 不发明预期值**。断言/预期值的来源收敛为三条可信链：(a) **录制即预期**——keploy 的响应 diff、EvoSuite 的回归断言、Playwright codegen 的点选断言；(b) **契约即预期**——schemathesis 的 12 项 schema check、dredd 的 transaction 比对；(c) **程序化兜底**——shortest 的回调断言（page/DB 校验）、TestGen-LLM 的"必须通过现有套件"过滤器。LLM 负责步骤与输入，**预期值永远来自执行、录制或 schema**；纯 NL 断言（midscene aiAssert、hercules assertion 节点）仅用于视觉/语义类检查，且被明确排除出缓存（midscene："aiAssert will never be cached"）。TestGen-LLM 论文更直接点破：保留首跑失败"cannot tell a real bug from a bad assertion"，所以一律丢弃。

2. **覆盖率反馈闭环是单测生成的"唯一硬通货"**。qodo-cover（coverage parser 验收）、EvoSuite（覆盖率即 fitness）、CodaMosa（plateau 触发 LLM）、TestGen-LLM（coverage filter）、UTBot（path coverage）无一例外。最佳混合点在"搜索式引擎推进覆盖率，LLM 只在引擎卡住时被调用"（CodaMosa）或"LLM 产物必须带来可测量覆盖增量才被保留"（TestGen-LLM/qodo-cover）。

3. **确定性引擎打底、AI 只在断点介入的混合架构**。stagehand：Playwright 确定性代码为主、act/observe/extract 按需 AI；midscene：缓存命中跳过模型、失效回退 AI；keploy：录制回放为主、AI 做增强；CodaMosa：SBST 为主、plateau 调 Codex。共性是 **AI 的调用被"缓存/触发条件"最小化**，保住成本、速度与确定性。

4. **定位策略向"a11y tree/语义 locator 为主，视觉为辅，自愈兜底"收敛**。Playwright 官方线（codegen 优先 role/text/testId；playwright-mcp 纯 a11y snapshot"no vision models needed"）代表语义路线；midscene 代表截图视觉路线但配合 XPath 缓存+防误配校验；hercules 注入自定义属性做稳定 selector；healenium 代表事后自愈（历史路径存库 + 相似度评分 + **回放验证唯一命中**）。**自愈结果必须执行验证**（healenium 回放、stagehand 重新 observe）是共同底线。

5. **用例形态双轨制：自然语言/YAML 供人机共写，代码供 CI 长跑**。Gherkin（hercules）、YAML（keploy、midscene test）、NL 字符串（shortest）面向非工程角色与 agent 共同维护；Playwright 代码（stagehand/codegen/mcp 录制）、JUnit（evosuite/UTBot）、pytest（codamosa）面向版本化与回归。失败定位标配"证据包"：截图+视频+网络日志+agent 思考轨迹（hercules proofs）、AI 决策回放（midscene 报告）、trace（playwright/OTel）。

6. **质量验收 = 可测量的过滤器链，而非"看起来对"**。TestGen-LLM 的 Build→Pass→Flakiness(×5)→Coverage 是范式：每级过滤器都对应一个可自动测量的属性，幻觉在链上被逐级淘汰。同样模式遍布各项目：qodo-cover 的"通过+覆盖提升"、healenium 的"回放唯一命中"、keploy 的响应 diff、schemathesis 的 baseline"只 fail 新故障"（老失败不重复报，只拦新增）。

7. **从真实使用中挖掘输入，优于从零凭空生成**。keploy 用 eBPF 录真实流量（输入天然含真实分布与边界）；playwright codegen 录用户操作（人工即 oracle）；TestGen-LLM 增强现有测试而非新写；schemathesis 的自适应学习"从响应中 learn constraints/ids/auth"。这些"以真实运行数据为源头"的方案，恰恰绕开了 LLM 最弱的一环——凭空猜测合法输入与合理预期。

---

## 附录：核实状态说明

- **已核实（一手）**：全部 star/时间/许可证数据（GitHub API，2026-10-08）；midscene README 与缓存文档；stagehand README；browser-use README 与 `browser_use/dom/` 目录结构；hercules README；shortest README；qodo-cover README 与仓库页维护声明；evosuite README 与 `Properties.java` Criterion 枚举；UTBotJava README 与组织仓库列表；TestGen-LLM 摘要页与 ar5iv 全文；CodaMosa 作者 PDF/ACM DOI/开源仓库（经搜索核实）；keploy how-it-works 与 ai-models 文档；schemathesis README 与两处 checks.py 源码；playwright codegen 文档；playwright-mcp README；healenium 两仓库 README 与 `SelfHealingEngine.java` 源码。
- **未核实**：healenium 候选 locator 相似度的具体评分公式（位于 `NodeService`/`HealingService`/treecomparing 包内部，本次未逐行阅读）；shortest 内部 locator 策略；dredd 细节（已归档，仅生态对照）；healenium 官方是否提供 Appium 版本（healenium-web 页面未提，社区另有 healenium-appium 仓库之说，未核实）。
- **任务书勘误**：CodaMosa 为 **Microsoft Research + UBC**（ICSE 2023）工作，非 Meta；Meta 的工作是 TestGen-LLM（FSE 2024）。Midscene.js 仓库现址 `web-infra-dev/midscene`；UnitTestBot 原仓库 `utbot` 已 404，现用 `UTBotJava`。
- **补充调研（2026-10-10，§2.16）**：tester-army/e2e 为用户追加指定项目。star/时间数据来自 GitHub API（2026-10-10）；机制来自 README 与 docs/{core-concepts,cache,agent-steps,explore,bug-bash,coding-agents}.mdx 原文，未逐行核对 packages/ 源码实现；上述文档描述与实际行为的符合度未验证（项目未到 1.0）。
