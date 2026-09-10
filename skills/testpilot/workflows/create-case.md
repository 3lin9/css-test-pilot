# Workflow:创建测试 Case

输入:用户的一句业务需求(如"帮我测试用户下单")。

1. 阅读本 Skill:`rules/dsl.md`、`rules/case-design.md`、`rules/locator.md`。
2. 分析项目结构:确定被测端(miniapp / web)与业务入口页面。
3. 找到业务路径上的真实页面与组件,收集证据(读代码 / DOM / 现有测试)。
4. 确定测试路径:从入口到业务结果页的完整步骤。
5. 按 DSL 规范生成 Case,写入 `tests/e2e/cases/<case-id>.yaml`。
6. 执行 `npx csspilot validate tests/e2e/cases/<case-id>.yaml`。
7. 校验失败则修复 Case 后重新 validate,直到通过。

禁止:跳过第 2-3 步直接生成 Case(AI 不能凭空生成测试)。
