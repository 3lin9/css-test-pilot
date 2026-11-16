# Workflow:创建测试脚本

输入:用户需求,或 `test-requirements-review` 产出的**测试点清单**(推荐先做需求评审)。

1. 尚无测试点清单时,先执行 `workflows/test-requirements-review.md`;已有清单则直接使用。写脚本前逐条读取 Given、When、Then、数据和证据。任一字段缺失,或证据没有需求章节、已有用例、代码位置,先回到评审补齐,不在这一步推断。
2. 阅读 `rules/case-design.md` 和 `rules/native.md`。按测试点的平台选择该端自己的测试框架,不要写 YAML,也不要经过 csspilot DSL。
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
   - 前置、操作、输入值和断言按该测试点的 Given、When、Then、数据编写。预期文案、数值、状态,以及反向时不出现的结果,只使用 Then 里已经写出的内容
   - 定位器、选择器和接口路径来自第 4 步,用来落实 When / Then,不用来改写预期或补一个评审没写的输入
   - 多个测试点步骤相同、只有数据和预期不同时,用该框架自己的参数化写法(Playwright `test` 循环或 `node:test` 循环),不要合成一份跨端 YAML
   - 发现 `.env.testing` 缺少地址或凭据时,向用户索取后写入 `.env.testing`,不写进脚本
   - 公共测试数据放 `tests/e2e/data/`,由脚本自己读取
6. 先校验刚写好的脚本:`npx csspilot validate tests/e2e/<端>/<id>.spec.ts` 或对应的 `.test.ts`。三道卡是文件头 evidence、测试点 ID 与 `tests/e2e/reviews/` 解析出的 `TP-<数字>` 全字匹配、env 引用已声明。清单目录不存在、为空或解析不出 ID 时不得通过。不过就改脚本,不要执行。CI 跑同一道卡。
7. 校验通过后再执行 `npx csspilot run tests/e2e/<端>/<id>.spec.ts` 或对应的 `.test.ts`。Web 需要项目已安装 `@playwright/test`。`run` 启动框架前会再做同一道轻量预检,不过则不调用 `npx playwright test` 或 `node --test`。这次跑的是脚本本身,不重放 MCP 会话。

禁止:把测试点翻译成 `tests/e2e/cases/*.yaml`。禁止凭空编写定位器;定位来自第 4 步的 MCP 观察或项目源码。禁止在脚本里补评审交接块没有的前置、输入或预期。
