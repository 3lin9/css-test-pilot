# Case 设计规范

## Case 属于业务项目

- Case 只存在于业务项目的 `tests/e2e/cases/`,永远不要写进 TestPilot 仓库的 `packages/`。
- 一个 Case 描述一条完整的业务流程(如:创建订单、提交退款),不是单个页面操作。
- `id` 使用 kebab-case,与文件名一致:`order-create.yaml` → `id: order-create`。

## Case 与数据行

- 默认一条独立业务流程一个 Case。
- 多个测试点的步骤模板完全相同、差异仅为输入数据和可判定预期时,允许合并为一个 data-driven Case。
- 每个 dataset 行必须有稳定唯一的 rowId,并仍保持“一个可判定规则/数据点”粒度。
- 不同页面路径、不同角色权限流程、不同清理策略或不同断言结构不得为了减少 Case 数量而强行合并。
- 报告按 `caseId#rowId` 标识执行结果;统计时每个数据行算一次执行。

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
- 测试参数统一放业务项目 `tests/e2e/data/` 的 YAML/JSON 文件,Case 通过 `${fixture.*}` / `${dataset.*}` 引用。
- `requires` 只声明当前 Case 有证据支持的静态依赖。AI 必须从 PRD/Spec、代码、配置、已有 Case 或 QA 用例识别,不得因为业务名称自动发明账号、优惠券、PPM 等字段。
- `.env` 提供当前环境的实际值;只有 `testpilot.yaml variables` 白名单映射的值可通过 `${variable.*}` 暴露给 Case。
- 缺失依赖会使该数据行 `skipped(dependency-not-ready)`,这只表示静态值未就绪,不保证远端业务对象有效。
- setup/teardown 优先使用 API 造数和清理;teardown 必须可重复执行。
