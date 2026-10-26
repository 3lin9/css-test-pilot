# 自动化测试项目中的配置、凭据、测试数据与产物布局

> 调研日期：2026-10-26  
> 范围：Playwright、Cypress、Maestro、Robot Framework、Keploy，以及 TestPilot 当前实现。  
> 方法：通过 `gh` CLI 只读查询公开 GitHub 仓库的官方文档、示例和源码；下文链接均指向项目维护者控制的一手来源。  
> 结论先行：TestPilot 的 `tests/e2e/data`、`testpilot.yaml systems/variables`、`.env.testing` 和 `accountRef` **在设计意图上不必冲突，但当前存在命名过宽、入口重复、物理存储混杂三类冲突风险**。应保留“版本化声明 + 外部注入值 + 引用式身份 + 可版本化业务数据 + 被忽略运行产物”的总体方向，并收紧每一层的准入规则。

## 1. 本文采用的六类资产定义

先定义语义，否则不同框架对 “fixture” 的不同用法会造成误判。

1. **环境/系统配置（environment/system topology）**：有哪些被测系统、系统类型、连接方式、默认 profile、超时、浏览器/设备等。它回答“测哪里、怎么连”，结构应进 Git。
2. **base URL / endpoint**：系统连接配置的一部分；键和引用关系进 Git，具体值是否进 Git取决于它是否公开、是否环境相关。生产/内网地址默认不提交。
3. **账号凭据（credentials）**：密码、token、cookie、API key、客户端证书及可还原登录态的文件。只由 Secret Manager、CI secret 或本机忽略文件注入，不进 Git。
4. **fixture**：本文在 TestPilot 语境中特指“单个用例或一组用例复用的具名业务对象/稳定输入”，例如商品、优惠券模板、地址；它不是 Playwright 所说的 setup/teardown 生命周期 fixture。
5. **dataset**：同一测试逻辑要逐行执行的参数集合，具有稳定 `rowId`，例如折扣类型 × 会员等级 × 期望金额。
6. **运行时产物（artifacts）**：报告、截图、视频、trace、日志、下载文件、实际响应、临时登录态、缓存。默认不进 Git，可由 CI 按保留策略上传。

判定某个值放在哪里时，依次问：

- 它是不是秘密？是，则只能进入 secret channel。
- 它是否描述系统连接/运行方式？是，则结构进项目配置，环境值外部注入。
- 它是否决定业务场景或期望结果？是，则进入 fixture/dataset，而不是 env。
- 它是否由一次运行生成？是，则进入 artifacts，而不是 data。

## 2. 各项目的具体存放模式

### 2.1 Microsoft Playwright

**项目/运行配置**：根级 `playwright.config.ts` 集中声明 `testDir`、`projects`、`reporter`、`use` 等；`projects` 表示不同浏览器或不同运行配置。官方配置文档示例也把 `baseURL` 放在 `use` 中，把 `outputDir` 定义为截图、视频和 trace 等产物目录，默认示意为 `test-results`（[test-configuration-js.md](https://github.com/microsoft/playwright/blob/main/docs/src/test-configuration-js.md)）。

**base URL 与身份状态**：`use.baseURL` 是 `page.goto('/path')` 的前缀；`use.storageState` 可载入认证状态。截图、视频和 trace 由独立 recording options 控制并写入 test output directory（[test-use-options-js.md](https://github.com/microsoft/playwright/blob/main/docs/src/test-use-options-js.md)）。这说明 endpoint/认证输入与运行产物是不同配置面。`storageState` 含 cookie/token 时本质上是凭据，不应提交。

**fixture**：Playwright fixture 是“为每个测试建立环境”的代码抽象，封装 setup/teardown，支持 test scope 和 worker scope，并强调测试间隔离；它不是业务数据文件（[test-fixtures-js.md](https://github.com/microsoft/playwright/blob/main/docs/src/test-fixtures-js.md)）。

**dataset**：参数化测试通常直接遍历数组；CSV 可作为与 spec 相邻或由 spec 显式读取的数据文件，官方明确示范用 Node.js 文件 API 和 `csv-parse` 生成测试（[test-parameterize-js.md](https://github.com/microsoft/playwright/blob/main/docs/src/test-parameterize-js.md)）。

**可借鉴点**：配置、生命周期 fixture、参数数据和 artifacts 四者有独立接口；不要因为都叫 fixture/data 就放入同一目录。

### 2.2 Cypress

**项目/运行配置**：根级 `cypress.config.{js,ts}` 是配置源；E2E 默认 spec pattern 为 `cypress/e2e/**/*.cy.*`，`baseUrl` 专门作为 `cy.visit()`/`cy.request()` 前缀。`fixturesFolder`、`downloadsFolder`、`screenshotsFolder`、`videosFolder` 是不同目录；后三者是运行生成内容，Cypress 可在运行前清空（[configuration.mdx](https://github.com/cypress-io/cypress-documentation/blob/main/docs/app/configure/configuration.mdx)）。

**fixture**：Cypress 的项目约定把静态 fixture 放在 `cypress/fixtures`；官方仓库自身也有大量 `cypress/fixtures` 示例，例如系统测试项目中的 fixture 目录（[cypress 仓库搜索](https://github.com/cypress-io/cypress/tree/develop/system-tests/projects)）。这种 fixture 更接近 TestPilot 当前 YAML/JSON 业务输入，但不等于参数化 dataset。

**环境值与 secrets**：官方列出多种覆盖源：配置文件 `env`、项目根的 `cypress.env.json`、`CYPRESS_*` OS 环境变量、CLI `--env` 和 `setupNodeEvents`。同时明确将密码、token、API key、credentials 视为敏感值，并要求含敏感值的 `cypress.env.json` 加入 `.gitignore`（[environment-variables.mdx](https://github.com/cypress-io/cypress-documentation/blob/main/docs/app/configure/environment-variables.mdx)）。

**可借鉴点**：业务 fixture 与环境注入可以并存，但“env 能承载任意值”不代表“业务测试数据应该放 env”；Cypress 新文档甚至进一步区分敏感 `cy.env()` 与可暴露公共配置。

### 2.3 Mobile.dev Maestro

**工作区配置**：`.maestro/config.yaml` 负责 flow glob、标签、执行顺序、平台行为和 `testOutputDir` 等工作区级设置。官方 E2E 示例将它放在应用内的 `.maestro/config.yaml`（[示例 config.yaml](https://github.com/mobile-dev-inc/Maestro/blob/main/e2e/demo_app/.maestro/config.yaml)），对应模型由 `WorkspaceConfig` 明确定义（[WorkspaceConfig.kt](https://github.com/mobile-dev-inc/Maestro/blob/main/maestro-orchestra-models/src/main/java/maestro/orchestra/WorkspaceConfig.kt)）。

**flow 配置和变量**：每个 YAML flow 自身声明 `appId`、name、tags 等，属于测试/应用选择信息（[MaestroConfig.kt](https://github.com/mobile-dev-inc/Maestro/blob/main/maestro-orchestra-models/src/main/java/maestro/orchestra/MaestroConfig.kt)）。CLI 通过 `-e/--env` 接收运行时变量；这是一种注入机制，不是业务 dataset 目录。

**产物**：CLI 将 report 的 `--output`、debug 的 `--debug-output`、一次运行完整 artifacts 的 `--test-output-dir` 分开；后者包含 manifest、commands、logs、截图和录屏，并允许 workspace config 给默认目录（[TestCommand.kt](https://github.com/mobile-dev-inc/Maestro/blob/main/maestro-cli/src/main/java/maestro/cli/command/TestCommand.kt)）。

**可借鉴点**：隐藏目录适合框架配置和运行产物，但 flow（测试定义）仍保持为普通 YAML；env 是运行覆盖通道，不能替代结构化 dataset。

### 2.4 Robot Framework

**测试、资源与变量**：suite 文件承载测试；`.resource` 文件用于共享 user keywords 和变量，但不能包含测试；variable file 则专门创建/共享变量，可用 Python、YAML 或 JSON。YAML/JSON variable file 顶层必须是 mapping（[ResourceAndVariableFiles.rst](https://github.com/robotframework/robotframework/blob/master/doc/userguide/src/CreatingTestData/ResourceAndVariableFiles.rst)）。

**环境切换**：Robot 支持命令行 `--variable`、`--variablefile` 和参数文件；命令行变量可覆盖文件变量。也就是说，版本化默认数据与运行时覆盖是两个层级，而不是把所有业务数据都变成 OS env（[BasicUsage.rst](https://github.com/robotframework/robotframework/blob/master/doc/userguide/src/ExecutingTestCases/BasicUsage.rst)）。

**产物**：默认产生 `output.xml`、`log.html`、`report.html`，可通过 `--outputdir` 统一放置；官方示例也把多次执行输出到 `out/` 后再由 `rebot` 合并（同上 [BasicUsage.rst](https://github.com/robotframework/robotframework/blob/master/doc/userguide/src/ExecutingTestCases/BasicUsage.rst)）。

**可借鉴点**：可复用行为（resource）、数据变量（variable file）和结果（output）彼此独立。TestPilot 目前只有 `data/`，不应未来再把 setup 行为也塞进去。

### 2.5 Keploy

**配置**：`keploy.yml` 描述 record/test 行为、选择哪些 test sets、noise 规则、覆盖率路径等。默认配置源码明确说明 `path` 指向 Keploy 保存整个 `keploy/` tree 的位置（[default.go](https://github.com/keploy/keploy/blob/main/config/default.go)）。

**录制测试、mocks 与报告**：Keploy 将真实 API、数据库和流式交互录制为 tests 与 dependency mocks，再重放；它们是被录制的测试资产，不是环境变量（[README](https://github.com/keploy/keploy/blob/main/README.md)）。源码将测试集配置和 mock 存储拆成不同实现，例如 [testset 配置存储](https://github.com/keploy/keploy/tree/main/pkg/platform/yaml/configdb/testset) 与 [mockdb](https://github.com/keploy/keploy/tree/main/pkg/platform/yaml/mockdb)。

**产物边界的特殊性**：Keploy 的录制 tests/mocks 可能被审核后版本化，而 replay reports 是运行结果。是否进 Git不能只看“是不是工具生成”，而应看它是否已成为稳定、可审查、可重放的测试输入。

**可借鉴点**：同一根目录下也要按 tests、mocks、reports 分层；录制原始数据经过脱敏和确认后才可升级为受版本控制的测试资产。

## 3. 共同规律

五个项目虽然术语不同，但有以下稳定规律：

1. **Git 保存结构、引用和可重复输入，不保存秘密和短命状态。**
2. **base URL 属于系统连接配置，不属于业务数据。** 多环境差异通过 project/profile、配置覆盖或 env 注入解决。
3. **env 是注入通道，不是数据模型。** 它适合 endpoint、运行开关和 secret locator/value；不适合商品编码列表、订单组合、期望金额等业务样本。
4. **凭据与账号角色分离。** 测试可声明“以 admin 身份运行”，但真实 password/token/storage state 由运行环境提供。
5. **fixture 与 dataset 要按消费方式区分。** fixture 是具名对象/前置资源；dataset 是按行展开的案例矩阵。二者即便同为 YAML/JSON，也应有不同 schema 和目录。
6. **运行产物必须有单独、可整体清理的根目录。** 报告、trace、截图、日志、下载、临时状态不可回写 `tests/e2e/data`。
7. **框架配置和测试数据允许有默认值，但覆盖优先级必须明确。** 常见顺序是：CLI/CI secret > OS env > 本机忽略文件 > Git 中非敏感默认值。
8. **生成内容只有经过审核并成为稳定测试输入后才能进 Git。** Keploy 的录制 test/mock 是典型例子；未审核录制、响应快照和调试数据仍是 artifact。

## 4. TestPilot 当前状态与冲突判断

### 4.1 当前实现

- `testpilot.yaml` schema 同时提供：
  - 顶层 `web.baseUrl`、`api.baseUrl`、`miniapp.projectPath/cliPath`；
  - `systems.<name>` 中的 `type/baseUrl/projectPath/cliPath/timeoutMs`；
  - `environment` 中的命名环境和 `baseUrl`；
  - 任意字符串映射 `variables`。
  这些字段均可通过 `${ENV_VAR}` 插值（[config-loader.ts](../../packages/core/src/config-loader.ts)）。
- `.env.testing` 被 CLI 独立加载，真实 OS 环境变量优先；源码明确认为它可能含凭据，仓库 `.gitignore` 的 `.env.*` 规则会忽略它。
- `accountRef` 由 Case 声明，CLI 映射为 `TESTPILOT_ACCOUNT_<REF>`，运行时注入 `${account.*}`；Server 侧还有环境级 secret 存储。
- `tests/e2e/data` 是 fixture/dataset 唯一允许根目录，加载器限制项目相对路径、扩展名和 realpath 越界（[case-data.ts](../../packages/sdk/src/case-data.ts)）。
- `.gitignore` 已排除 `reports/`、`artifacts/`、`test-results/`、`playwright-report/`、`.testpilot/artifacts/`、`.testpilot/cache/`、`.testpilot/ready/`。

### 4.2 是否冲突

结论不是“这些机制彼此冲突”，而是：

**A. `tests/e2e/data` 与 `systems/.env.testing/accountRef`：语义上不冲突。**  
前者应只含可版本化业务输入，后者分别表达系统连接、环境值和身份引用。现有示例中的商品款号、优惠券码、折扣矩阵放在 data 是合理的。

**B. `systems`、`environment`、顶层 target：存在真实的单一事实源冲突。**  
同一个 web/api base URL 可以出现在至少三处。调用方如果解析优先级不完全一致，就会出现 doctor、CLI、Server、Case 执行看到不同 endpoint 的风险。`systems` 应成为连接拓扑的唯一结构源；顶层 target 仅保留为兼容别名，`environment` 不再另存第二套 base URL。

**C. `variables` 与 `.env.testing`：存在职责过宽冲突。**  
当前 `variables` 是 Case 可见的任意字符串白名单，`.env.testing` 又能装任意键值。技术上可把 base URL、密码、商品编码或期望值都通过 `${variable.*}` 暴露，缺少 schema 级边界。它们不会自动发生键冲突，却会制造“同一业务值到底放 data 还是 env”的治理冲突。

**D. `.env.testing` 与 `accountRef`：存在物理存储混杂，但抽象不冲突。**  
`accountRef` 是正确的角色/凭据句柄；本地实现把其真实值和 base URL 一起放入 `.env.testing`，是部署便利而非领域归属。需要规则保证 `TESTPILOT_ACCOUNT_*` 只能由 account resolver 消费，不能进入通用 `${variable.*}` 白名单。Server secret 应优先于平面 env JSON，并避免“项目其他环境回退”造成跨环境误用。

**E. `tests/e2e/data`：目录过宽，fixture/dataset 语义冲突。**  
加载器已区分对象合并与逐行数据，但磁盘上二者混放。随着文件增加，无法从路径判断 schema、所有权和消费方式。应拆子目录，同时保留 `data/` 为安全边界。

**F. 示例与规则存在偏差。**  
`examples/testpilot.yaml` 仍直接写入 localhost base URL 和本机 `projectPath`。localhost 非 secret，但该示例弱化了“连接值外部注入”的规则，也会鼓励真实项目把环境专属值提交。示例应最终改为 `${WEB_BASE_URL}` 等引用（本次只做研究，不修改示例）。

## 5. 推荐目录与配置模型

```text
testpilot.yaml                         # 进 Git：系统拓扑、引用、默认非敏感运行策略
.env.testing.example                  # 进 Git：仅变量名、注释、安全示例值
.env.testing                          # 不进 Git：本机环境值和本机凭据
tests/e2e/
  cases/                              # 用例定义
  data/
    fixtures/                         # 进 Git：具名、可复用业务对象
      catalog/
      promotions/
    datasets/                         # 进 Git：含稳定 rowId 的参数矩阵
      checkout/
    schemas/                          # 进 Git：可选，fixture/dataset schema
  resources/                          # 进 Git：未来若引入可复用 setup/行为，不放 data
.testpilot/
  artifacts/                          # 不进 Git：截图、视频、trace、响应、下载
  reports/                            # 不进 Git：HTML/JUnit/汇总
  cache/                              # 不进 Git：可重建缓存
  state/                              # 不进 Git：临时登录态、session、ready marker
```

推荐的职责：

- `testpilot.yaml systems`：唯一的系统目录。每个 system 声明稳定 ID、`type`、endpoint/path 的 env 引用、timeout；可以提交。
- `testpilot.yaml profiles`（建议由现有 `environment` 演进）：只选择/覆盖 system 的变量引用或非敏感运行策略，不复制完整 system。若暂不新增 schema，则 `environment` 只保留 `default`，停止增加 `baseUrl`。
- `testpilot.yaml variables`：收窄并改名为 `inputs` 或 `runtimeVariables`。只允许**非秘密、非业务样本**的运行开关/外部资源句柄，例如 feature flag、tenant alias；base URL 留在 system，账号留在 account resolver。
- `.env.testing`：本地注入载体，不是权威配置。允许 endpoint 实值、机器路径、运行开关和 `TESTPILOT_ACCOUNT_*`；禁止商品、订单、优惠规则、期望结果等业务数据。
- `accountRef`：只保存稳定角色别名，如 `admin`、`buyer-vip`。真实值来自环境绑定的 secret store 或本机 `TESTPILOT_ACCOUNT_*`。Case、fixture、dataset、日志和报告中均不得出现明文 secret。
- `fixtures/`：顶层 mapping，供 `${fixture.*}` 使用；同名字段合并冲突继续 fail-fast。
- `datasets/`：顶层 rows，每行必须有稳定 `id/rowId`，供 `${dataset.*}` 使用；不得偷偷承载 endpoint 或 credentials。
- `.testpilot/*`：所有一次运行产生的内容统一收口；CI 通过 artifact upload 保留，不靠 Git。

一个建议形态（示意，不代表已实现 schema）：

```yaml
version: 2
systems:
  storefront:
    type: web
    baseUrl: ${STOREFRONT_BASE_URL}
  order-api:
    type: api
    baseUrl: ${ORDER_API_BASE_URL}
    timeoutMs: 10000

profiles:
  default: testing
  testing:
    variables:
      featureSet: ${TEST_FEATURE_SET}

runtimeVariables:
  featureSet: ${TEST_FEATURE_SET}
```

其中 URL 的**引用关系**在 Git，URL 的**环境实值**由 CI、本机 `.env.testing` 或环境配置中心提供；`featureSet` 是运行选择，不是某条业务 Case 的输入。

## 6. 迁移规则

迁移应保持可回滚和向后兼容，按以下顺序进行。

### 阶段 0：先加验证，不移动文件

1. doctor 对 `variables` 分类告警：
   - 名称匹配 `PASSWORD|TOKEN|SECRET|COOKIE|API_KEY|CREDENTIAL`：禁止进入通用变量；
   - 名称匹配 `*_BASE_URL|*_PROJECT_PATH|*_CLI_PATH`：提示迁入对应 `systems` 字段；
   - 值看起来像业务记录/JSON 数组：提示迁入 fixture/dataset。
2. 禁止 `TESTPILOT_ACCOUNT_*` 被 `variables` 白名单再次暴露。
3. 在输出前统一 secret redaction，包括 `${account}` 整值、字段值、headers、URL query 和 storage state。

### 阶段 1：建立唯一系统源

1. 将顶层 `web/api/miniapp` 转换为隐式 system（如 `default-web/default-api/default-miniapp`）。
2. 若同一 target 同时存在顶层配置与同名/default system：
   - 值一致：自动归并并告警；
   - 值不一致：停止迁移，要求用户选择，不能静默覆盖。
3. `environment.<name>.baseUrl` 转成 profile 对目标 system 的 endpoint 变量选择；在新配置中禁止继续新增。
4. 读取优先级在过渡期固定为：显式 Case `system` > 迁移后的 default system > 旧顶层 target；仅兼容读取，不允许多处同时写回。

### 阶段 2：拆分业务数据目录

1. 对 Case `fixtures` 引用的文件移动到 `tests/e2e/data/fixtures/`。
2. 对 Case `dataset.file` 引用的文件移动到 `tests/e2e/data/datasets/`。
3. 同一文件若同时作为 fixture 和 dataset 使用，先复制并按用途重塑 schema，不能仅保留一个含混文件。
4. loader 在一个大版本内兼容旧 `tests/e2e/data/*` 路径并给 deprecation warning；新建文件只允许子目录。
5. 所有移动同步更新 Case 引用，并运行解析、realpath 边界、rowId 唯一性和 fixture 冲突检查。

### 阶段 3：收紧 env 与 secret

1. 新增可提交的 `.env.testing.example`，只包含键名、注释和安全占位值；绝不复制真实 `.env.testing`。
2. `.env.testing` 保持 gitignored；CI 使用平台 secret/env，不生成可下载的明文 env artifact。
3. `accountRef` 解析优先级固定为：本次运行明确绑定的环境 secret > CI/OS `TESTPILOT_ACCOUNT_*` > 本机 `.env.testing`。禁止自动回退到“项目其他环境”的凭据。
4. account secret 建议结构化为独立字段或 secret reference；若兼容 JSON 字符串，解析失败应报配置错误，不能把原文继续注入。
5. 认证状态文件放 `.testpilot/state/<profile>/`，默认短期有效并忽略；不得放入 `tests/e2e/data/fixtures/accounts.*`。

### 阶段 4：统一运行产物

1. 将散落的 `reports/`、`artifacts/`、`test-results/` 等逻辑路径逐步汇聚到 `.testpilot/reports` 和 `.testpilot/artifacts`；适配器原生产物可保留原目录，但由 manifest 引用。
2. 每次 run 使用独立 run ID 子目录，禁止覆盖业务 data。
3. CI retention、清理和上传只针对 `.testpilot` 产物根；任何“更新 golden/recording”操作必须是显式命令，经过脱敏和 review 后才写入版本化目录。

## 7. 明确边界：什么绝不能混放

### Secrets 不进 Git

以下内容无论测试环境是否“低风险”都不提交：

- 密码、API key、access/refresh token、session cookie；
- Playwright `storageState`、浏览器 profile、客户端证书私钥；
- 可直接登录的账号 JSON；
- 含 Authorization/cookie 的录制请求、trace、HAR、截图或日志；
- 内网拓扑中被组织认定为敏感的 URL、租户 ID、设备标识。

允许提交的是：

- `accountRef: buyer-vip` 这样的非秘密别名；
- `${STOREFRONT_BASE_URL}`、`${TESTPILOT_ACCOUNT_BUYER_VIP}` 这样的引用；
- `.env.testing.example` 中无效、安全的占位值；
- 脱敏且经过审核的 mock/fixture。

注意：`.gitignore` 只是最后一道防线，不是 secret 管理方案。已经提交过的 secret 即使随后删除或 ignore，仍需轮换并清理历史。

### 业务测试数据不进 env

必须放 fixture/dataset 的典型内容：

- SKU、商品属性、会员等级、优惠券规则；
- 订单行、地址样本、边界值、组合矩阵；
- 输入文本、预期状态、预期金额、错误码；
- 为重放而审核过的 request/response body 或 dependency mock。

可以放 env/runtime injection 的内容：

- `*_BASE_URL`、本机项目路径、CLI 路径；
- 运行 profile、并发度、外部服务开关；
- secret value 或 secret reference；
- CI run ID 等一次运行上下文（但它是运行元数据，不应通过 `${variable.*}` 变成业务断言的默认数据）。

一个简单的反例判断：如果把 `DISCOUNT_RATE=0.8` 从 env 改成 `0.9` 会改变业务用例及其期望，那么它是 dataset/fixture；如果把 `ORDER_API_BASE_URL` 改掉只是在同一用例上切换被测环境，那么它是 system/environment 配置。

## 8. 最终建议

TestPilot 不需要推翻现有机制。应保留四个正确基础：`accountRef` 间接引用、`.env.testing` 独立于应用 `.env`、`tests/e2e/data` realpath 安全边界、`.testpilot` 产物忽略规则。优化重点是：

1. 让 `systems` 成为连接拓扑唯一事实源，消除 `environment` 和顶层 target 对 base URL 的重复表达；
2. 将 `variables` 收窄为非敏感运行输入，禁止它成为绕过 fixture/dataset/accountRef 的万能通道；
3. 将 `data` 拆成 `fixtures/` 与 `datasets/`，并为二者实施不同 schema；
4. 将 account secret 从通用 env 语义上隔离，并禁止跨环境凭据回退；
5. 将所有运行生成内容统一收口到 ignored artifact/state 根目录。

这套边界与 Playwright 的 config/fixture/output、Cypress 的 config/fixtures/secrets/artifact folders、Maestro 的 workspace/env/output、Robot Framework 的 resource/variable/output，以及 Keploy 的 config/tests/mocks/reports 分层方向一致。
