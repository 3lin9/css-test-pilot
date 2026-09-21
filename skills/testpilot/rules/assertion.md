# 断言规范

- 断言使用 `action: assert`,配合 `locator` + `expected`。
- `expected` 支持 `${variable}` 变量引用,变量来自之前的 `extract` 步骤(存于 ExecutionContext,可跨端传递,如小程序提取订单号 → Web 端断言)。
- 断言必须对应真实业务预期(如订单号出现在 Web 后台),不写恒真断言。
- 断言失败不一定是 Case 错误:先分析 Evidence(截图 / trace / log),判断是用例问题还是产品 bug,再决定修改 Case 还是上报问题。

## 请求次数断言

- UI 操作需要验证“只请求一次”时使用 `expectRequests`,不要用 wait 或页面文案间接推断。
- 匹配条件是可选 `method` + 必填 `urlContains`;`count` 是精确次数,不是最小次数。
- `windowMs` 是动作完成后的观察窗口,应取业务可合理完成的最小值。
- Web 和 MiniApp 观察器必须透明调用真实请求,不得 mock 响应或改变业务行为。
- URL 证据会隐藏 query 值;Case 中不要把 token 等秘密直接写入 `urlContains`。
