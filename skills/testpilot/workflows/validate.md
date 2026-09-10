# Workflow:校验 Case

任何 Case 在 run 之前必须先 validate。

```bash
npx testpilot validate              # 全量
npx testpilot validate <file>       # 指定文件
```

检查内容:

- YAML 格式
- DSL 结构
- action 是否存在
- target 是否存在
- locator 是否合法
- 必填字段
- 变量引用
- 当前 adapter 是否支持该 action

输出 `ValidationResult`;有错误时修复 Case 后重新校验,全部通过才允许 run。
