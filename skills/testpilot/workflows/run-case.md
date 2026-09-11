# Workflow:执行测试

```bash
npx csspilot run                  # 运行项目配置(testpilot.yaml)中的 Case
npx csspilot run <file>           # 运行指定 Case
npx csspilot run --tag smoke      # 按标签运行
```

执行链路:

```text
CLI → Case Loader → DSL Validator → Execution Engine → Adapter(Playwright / WeChatIDE)→ Evidence → Reporter
```

规则:

- 只通过 testpilot CLI 执行测试,不要直接调用 playwright 或 wechat-devtools。
- 被测服务需先就绪(如业务后端、本地页面服务),`navigate` 的相对 url 基于 testpilot.yaml 的 `web.baseUrl` 解析。
- 运行产物写入 `.testpilot/artifacts/runs/<run-id>/`(screenshots / traces / logs)。
