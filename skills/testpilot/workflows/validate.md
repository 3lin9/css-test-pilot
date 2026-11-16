# Workflow:校验脚本

`csspilot validate` 对原生脚本做 lint(evidence 头注释 / reviews 清单出处 / env 引用),是 AI 生成后自查与 CI 卡点的统一入口:

```bash
npx csspilot validate                                     # tests/e2e 全量
npx csspilot validate tests/e2e/web/<id>.spec.ts          # 指定脚本/目录
```

三道卡:

1. 文件头注释 `// 测试点: TP-001` 必填,`// 视角: charter:*` 在 6 个枚举内:`charter:persona`、`charter:edge-input`、`charter:numbers-copy`、`charter:state-recovery`、`charter:error-path`、`charter:inverse`
2. `tests/e2e/reviews/` 必须存在且能解析出精确的 `TP-<数字>`。测试点 ID 与解析结果全字匹配;目录不存在、清单为空或没有 ID 时直接报错。`TP-001` 不会因为文中出现 `TP-0010` 而通过
3. 脚本引用的 `process.env.*` 在 `.env.testing` / `testpilot.yaml` `${VAR}` / 白名单中已声明

lint 之外,运行前确认:

- 定位器、选择器和接口路径来自项目代码或真实页面
- 脚本没有写入账号密码
- Web 项目已安装 `@playwright/test`;小程序脚本能 import `miniprogram-automator`
