# Case 设计规范

## 用例属于业务项目,并且是原生脚本

- Web 用例放 `tests/e2e/web/*.spec.ts`。
- 小程序用例放 `tests/e2e/miniapp/*.test.ts`。
- API 用例放 `tests/e2e/api/*.test.ts`。
- 不要把用例写进 TestPilot 仓库,也不要再写 `tests/e2e/cases/*.yaml`。
- 一个文件覆盖一个测试点。文件名是 kebab-case,与测试点对应,例如 `order-create.spec.ts`。

## 各端用自己的框架

- Web 用 `@playwright/test`。
- 小程序用 `miniprogram-automator`。
- API 用 `node:test` 和 `fetch`。
- 同一条业务跨端时写成多份脚本,每份只调用该端的 API。不要用一份中间步骤指望两端行为一致。

## 跨端与跨系统配合

- 用例执行中要查**另一个系统**的信息(如小程序用例去 Web 后台核对订单)时,优先直接调对方的**查询接口**(`fetch` + 环境变量地址):在 `testpilot.yaml` 的 `systems:` 段登记该系统(`doctor` 逐系统探测可达性),地址放 `.env.testing`,凭据走 `TESTPILOT_ACCOUNT_<REF>`。只读核对,不写对方系统的业务数据。
- 必须走对方 **UI** 才能查的,拆成两个测试点、两份脚本:前一份把关键值写进 `tests/e2e/data/`,后一份读取后核对。不要在一端脚本里起另一端的框架(如小程序脚本里起 Playwright)。
- 两个 TP 需要按顺序接力时,用 run 的 paths 参数显式给顺序:`npx csspilot run tests/e2e/miniapp tests/e2e/web`。
- 评审阶段把涉及的系统列入平台执行信息表与资料准备清单(地址 / 入口 / 角色 / 造数方式)——评审不定下来,执行层就是缺口。

## AI 不能凭空生成测试

```text
用户需求 → 测试点清单 → 代码 / 页面 / 接口证据 → 该端原生脚本
```

TestPilot 不设中间格式与翻译层(YAML 链路已退役);看到「测试登录」就写一个不存在的按钮定位,仍然是错的。先读项目里的真实页面、组件或接口,再写脚本。

## 业务数据

- 不要把账号、密码硬编码进脚本。
- 可复用输入放 `tests/e2e/data/`。
- 环境地址和凭据放 `.env.testing`。

## charter 视角

文件头注释写明视角。取值固定为 `charter:persona`、`charter:edge-input`、`charter:numbers-copy`、`charter:state-recovery`、`charter:error-path`。某视角在本需求不适用时不写。
