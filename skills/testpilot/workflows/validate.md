# Workflow:校验 Case

任何 Case 在 run 之前必须先 validate。

```bash
npx csspilot validate              # 全量
npx csspilot validate <file>       # 指定文件
npx csspilot validate --runtime    # 静态校验 + 真实界面只读 observe/probe
```

检查内容:

- YAML 格式
- DSL 结构
- action 是否存在
- target 是否存在
- locator 是否合法
- 必填字段
- 变量引用
- fixture/dataset 路径必须位于 `tests/e2e/data/`,格式与 rowId 合法且 fixture 无冲突
- `requires` 路径语法与可用作用域
- setup/steps/teardown 的变量定义顺序
- `expectRequests` 仅用于支持的 UI 动作
- 当前 adapter 是否支持该 action

静态校验只证明 DSL 合法,不证明 locator 在当前环境真实存在。新 Case 或页面变更后必须使用
`--runtime`;有错误时修复 Case 后重新校验,再通过 `rehearse` 签发 Ready Certificate。
