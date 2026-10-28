# Workflow:校验脚本

`csspilot validate` 对原生脚本做 lint(evidence 头注释 / reviews 清单出处 / env 引用),是 AI 生成后自查与 CI 卡点的统一入口:

```bash
npx csspilot validate                                     # tests/e2e 全量
npx csspilot validate tests/e2e/web/<id>.spec.ts          # 指定脚本/目录
```

三道卡:

1. 文件头注释 `// 测试点: TP-001` 必填,`// 视角: charter:*` 在 5 个枚举内
2. 测试点 ID 必须在 `tests/e2e/reviews/` 清单中存在(清单外 ID 直接报错——清单是唯一用例来源)
3. 脚本引用的 `process.env.*` 在 `.env.testing` / `testpilot.yaml` `${VAR}` / 白名单中已声明

lint 之外,运行前确认:

- 定位器、选择器和接口路径来自项目代码或真实页面
- 脚本没有写入账号密码
- Web 项目已安装 `@playwright/test`;小程序脚本能 import `miniprogram-automator`
