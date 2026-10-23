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
   - 按评审产出的平台执行信息声明 `accountRef` / `workspace`;发现 `.env.testing` 缺少某平台的地址或凭据变量时,向用户索取后写入 `.env.testing`,**不写进 Case**
   - 从需求与项目证据中识别最小 `requires`;项目没有账号/优惠/PPM 等概念时不要生成对应依赖
   - 公共参数写入 `tests/e2e/data/` fixture;环境参数先加入 `testpilot.yaml variables` 白名单
   - 造数与清理使用 `setup` / `teardown`;UI 动作需验证接口调用次数时使用 `expectRequests`
   - 把该 Case 关联 TP 的每个 charter 视角写入 `tags`,与既有 tag(如 `smoke`)共存;一个 TP 多视角则多 tag。映射(视角定义见 `test-requirements-review` 步骤 6):

     | 评审视角 | case tag |
     | --- | --- |
     | persona | `charter:persona` |
     | 边界输入 | `charter:edge-input` |
     | 数字与文案 | `charter:numbers-copy` |
     | 状态恢复 | `charter:state-recovery` |
     | 错误路径 | `charter:error-path` |

     ```yaml
     tags: [smoke, charter:persona, charter:error-path]
     ```
6. 执行 `npx csspilot validate tests/e2e/cases/<case-id>.yaml`。
7. 执行 `npx csspilot discover tests/e2e/cases/<case-id>.yaml`,用真实界面的语义树/运行时 WXML、截图和 probe 结果验证 locator。
8. 在可重置测试环境执行 `npx csspilot rehearse tests/e2e/cases/<case-id>.yaml`:
   - 动作前 locator 必须唯一、可见且可操作
   - 动作后页面必须稳定,click/navigate 必须有 UI 状态变化或明确的 `expectRequests`
   - 全部数据行通过后才会写入 `.testpilot/ready/<case-id>.json`
9. validate / discover / rehearse 任一失败都不算可执行交付;修复 Case 后重新走完整链路。

禁止:跳过第 3-4 步直接生成 Case(AI 不能凭空生成测试)。
