# Workflow:分析测试结果

1. 执行 `npx csspilot report` 生成报告。
2. 产物位于 `.testpilot/artifacts/runs/<run-id>/`:
   - `report.json` —— 结构化结果,AI 优先读这个:`{ generatedAt, summary: { runId, status, totals, cases: [{ caseId, rowId, status, skipReason?, missingDependencies?, warnings?, steps: [{ phase, index, target, action, status, durationMs, error?, screenshot?, extracted?, requestAssertions? }] }] }, history(最近 12 次运行趋势), failures(失败分类明细:category / caseId / message) }`;失败步骤的 `category` ∈ assert / element / adapter / env / timeout / other
   - `report.html` —— 交互式报告(步骤树、失败分类筛选、历史趋势)
   - `screenshots/`、`videos/`、`traces/`、`logs/` —— 失败取证
3. 失败分析顺序:report.json 中失败步骤的 `category` 与 `error` → 对应 `screenshot` → `logs/run.log` → `events.ndjson`。
4. 得出结论:
   - Case 问题(locator 过期、步骤错误)→ 修改 Case,重新 validate → run
   - 产品 bug → 停止修改 Case,向用户报告证据与结论
5. 历史趋势中出现反复失败的用例(intermittent / flaky)要在结论中单独标注。
6. `skipped(dependency-not-ready)` 先按 missingDependencies 补数据,不归类为产品 bug;teardown warning 单独报告,不把已通过主流程改判 failed。
7. 请求次数断言失败时比较 `actualCount/count` 和匹配请求摘要,排查重复绑定、重试或双击。
8. 不要在未分析 Evidence 的情况下盲目重跑或修改 Case。
