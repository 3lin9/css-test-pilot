# Workflow:创建测试 Case

输入:用户需求,或 `test-requirements-review` 产出的**测试点清单**(推荐先做需求评审)。

1. 尚无测试点清单时,先执行 `workflows/test-requirements-review.md`;已有清单则直接使用。
2. 阅读本 Skill:`rules/dsl.md`、`rules/case-design.md`、`rules/locator.md`。
3. 分析项目结构:确定被测端(miniapp / web)与业务入口页面。
4. 针对测试点收集证据(读代码 / DOM / 现有测试),确定业务路径:从入口到业务结果页的完整步骤。
5. 按 DSL 规范生成 Case,写入 `tests/e2e/cases/<case-id>.yaml`:
   - 一条 Case 覆盖一个测试点(或一组强关联测试点)
   - 多个测试点步骤完全一致、仅数据和预期不同,使用 `datasets` 形成 data-driven Case;否则保持独立 Case
   - Case 的 `description` 注明关联的测试点编号(如 `测试点: TP-001`),保持需求可溯源
   - 按评审产出的平台执行信息声明 `accountRef` / `workspace`;发现 `.env` 缺少某平台的地址或凭据变量时,向用户索取后写入 `.env`,**不写进 Case**
   - 从需求与项目证据中识别最小 `requires`;项目没有账号/优惠/PPM 等概念时不要生成对应依赖
   - 公共参数写入 `tests/e2e/data/` fixture;环境参数先加入 `testpilot.yaml variables` 白名单
   - 造数与清理使用 `setup` / `teardown`;UI 动作需验证接口调用次数时使用 `expectRequests`
6. 执行 `npx csspilot validate tests/e2e/cases/<case-id>.yaml`。
7. 校验失败则修复 Case 后重新 validate,直到通过。

禁止:跳过第 3-4 步直接生成 Case(AI 不能凭空生成测试)。
