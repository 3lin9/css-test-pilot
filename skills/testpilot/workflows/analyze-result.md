# Workflow:分析测试结果

1. 执行 `npx testpilot report` 生成报告。
2. 产物位于 `.testpilot/artifacts/runs/<run-id>/`:
   - `report.json` —— 结构化结果,AI 优先读这个
   - `report.html` —— 人类可读报告
   - `screenshots/`、`traces/`、`logs/` —— 失败取证
3. 失败分析顺序:report.json 中的错误信息 → 失败步骤的 screenshot → trace → logs。
4. 得出结论:
   - Case 问题(locator 过期、步骤错误)→ 修改 Case,重新 validate → run
   - 产品 bug → 停止修改 Case,向用户报告证据与结论
5. 不要在未分析 Evidence 的情况下盲目重跑或修改 Case。
