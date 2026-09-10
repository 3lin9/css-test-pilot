# Workflow:执行测试

```bash
npx testpilot run                  # 运行项目配置(testpilot.yaml)中的 Case
npx testpilot run <file>           # 运行指定 Case
npx testpilot run --tag smoke      # 按标签运行
```

执行链路:

```text
CLI → Case Loader → DSL Validator → Execution Engine → Adapter(Playwright / WeChatIDE)→ Evidence → Reporter
```

规则:

- 只通过 testpilot CLI 执行测试,不要直接调用 playwright 或 wechat-devtools。
- 运行产物写入 `.testpilot/artifacts/runs/<run-id>/`(screenshots / traces / logs)。
