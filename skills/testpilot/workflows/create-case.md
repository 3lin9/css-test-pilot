# Workflow:创建测试脚本

输入:用户需求,或 `test-requirements-review` 产出的**测试点清单**(推荐先做需求评审)。

1. 尚无测试点清单时,先执行 `workflows/test-requirements-review.md`;已有清单则直接使用。
2. 阅读 `rules/case-design.md` 和 `rules/native.md`。按测试点的平台选择该端自己的测试框架,不要写 YAML,也不要经过 TestPilot DSL。
3. 分析项目结构:确定被测端(miniapp / web / api)与业务入口。
4. 用当前端的 MCP 对着真实界面收集证据,确定从入口到业务结果的完整路径。
   - web:用 Playwright MCP 打开被测页。定位取自 accessibility snapshot,或 MCP 生成的 locator。脚本里写成 Playwright 自己的 `getByRole` / `getByTestId` 等调用。
   - miniapp:用 wechatide MCP 编译并操作模拟器(同一套 wechatide 工具走 CLI 时同样适用)。选择器和断言取自运行时节点、console 和截图。脚本里写成 `miniprogram-automator` 调用。
   - api:读接口实现或现有调用,确定路径、方法和响应字段。这一端没有页面 MCP。
   - 当前环境没有对应 MCP 时,改为读项目里的页面、组件或接口代码。定位和路径必须能在这些材料里对上。
   - 完成标准:脚本里每个定位、路径和预期结果都能指回这次 MCP 观察,或指回项目源码。
5. 用该端框架写原生脚本,一条测试点一个文件:
   - web → `tests/e2e/web/<id>.spec.ts`,使用 `@playwright/test`
   - miniapp → `tests/e2e/miniapp/<id>.test.ts`,使用 `miniprogram-automator` 与 `node:test`
   - api → `tests/e2e/api/<id>.test.ts`,使用 `node:test` 与 `fetch`
   - 文件头注释写明 `测试点: TP-001` 和 charter 视角
   - 多个测试点步骤相同、只有数据和预期不同时,用该框架自己的参数化写法(Playwright `test` 循环或 `node:test` 循环),不要合成一份跨端 YAML
   - 发现 `.env.testing` 缺少地址或凭据时,向用户索取后写入 `.env.testing`,不写进脚本
   - 公共测试数据放 `tests/e2e/data/`,由脚本自己读取
6. 执行 `npx csspilot run tests/e2e/<端>/<id>.spec.ts` 或对应的 `.test.ts`。Web 需要项目已安装 `@playwright/test`。这次跑的是刚写好的脚本:`csspilot run` 调用 `npx playwright test` 或 `node --test`,不重放 MCP 会话。
7. 生成后自查:`npx csspilot validate`(原生 lint:头注释 evidence 链、测试点 ID 必须在 reviews 清单、env 引用已声明)。CI 会跑同一道卡。

禁止:把测试点翻译成 `tests/e2e/cases/*.yaml`。禁止凭空编写定位器;定位来自第 4 步的 MCP 观察或项目源码。
