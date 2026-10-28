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
