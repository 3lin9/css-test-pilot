# 断言规范

- 断言使用 `action: assert`,配合 `locator` + `expected`。
- `expected` 支持 `${variable}` 变量引用,变量来自之前的 `extract` 步骤(存于 ExecutionContext,可跨端传递,如小程序提取订单号 → Web 端断言)。
- 断言必须对应真实业务预期(如订单号出现在 Web 后台),不写恒真断言。
- 断言失败不一定是 Case 错误:先分析 Evidence(截图 / trace / log),判断是用例问题还是产品 bug,再决定修改 Case 还是上报问题。
