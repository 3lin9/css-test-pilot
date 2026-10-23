# Workflow:执行测试

```bash
npx csspilot run                  # 运行项目配置(testpilot.yaml)中的 Case
npx csspilot run <file>           # 运行指定 Case
npx csspilot run --tag smoke      # 按标签运行
npx csspilot run --require-ready  # 正式运行:要求当前 Ready Certificate
```

执行链路:

```text
CLI → Case Loader → DSL Validator → Execution Engine → Adapter(Playwright / WeChatIDE)→ Evidence → Reporter
```

规则:

- 只通过 testpilot CLI 执行测试,不要直接调用 playwright 或 wechat-devtools。
- 新建或发生代码/Case/数据/环境变化的用例,先 `discover`,再在可重置环境 `rehearse`。
- 正式执行使用 `--require-ready`;证书失效时重新彩排,禁止正式 Run 临场静默自愈 locator。
- 被测服务需先就绪(如业务后端、本地页面服务),`navigate` 的相对 url 基于 testpilot.yaml 的 `web.baseUrl` 解析。
- 环境变量来源:shell / CI secrets,或项目根目录 `.env.testing` 文件(CLI 自动加载,真实环境变量优先;刻意不读前端项目自身的 `.env`);`.env.testing` 含敏感信息,确认已加入 .gitignore。
- Case 只能读取 `testpilot.yaml variables` 白名单映射后的 `${variable.*}`,不能直接访问任意环境变量。
- 运行前按 dataset 行展开并预检 `requires`;依赖缺失的行显示 `skipped(dependency-not-ready)`,不是产品失败。
- 每行按 setup → steps → teardown 执行;teardown warning 不改变主结果。
- 运行产物写入 `.testpilot/artifacts/runs/<run-id>/`(screenshots / traces / logs)。
