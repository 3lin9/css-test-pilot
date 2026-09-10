# Case 设计规范

## Case 属于业务项目

- Case 只存在于业务项目的 `tests/e2e/cases/`,永远不要写进 TestPilot 仓库的 `packages/`。
- 一个 Case 描述一条完整的业务流程(如:创建订单、提交退款),不是单个页面操作。
- `id` 使用 kebab-case,与文件名一致:`order-create.yaml` → `id: order-create`。

## AI 不能凭空生成测试

正确路径:

```text
用户需求 → 代码 / 页面 / 配置 → Evidence → 测试步骤 → Case
```

禁止路径:

```text
用户需求 → AI 猜 → Case
```

看到"测试登录"就直接写 `locator: { text: 登录 }` 是错误的。
必须先阅读项目真实页面/代码,确认元素存在、文案准确,再生成步骤。

## 业务数据

- 不要把业务账号、密码硬编码进 Case。
- 测试数据放业务项目 `tests/e2e/fixtures/` 或 `tests/e2e/data/`,Case 中通过变量引用。
