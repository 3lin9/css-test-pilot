# Locator 规范

定位器写成当前端框架自己的调用,不写 YAML 字段。

| 平台 | 写法 |
| --- | --- |
| web | Playwright:`page.getByTestId`、`page.getByRole`、`page.getByLabel`、`page.getByPlaceholder`、`page.getByText`、`page.locator` |
| miniapp | `miniprogram-automator`:`page.$`、`page.$$`、`element.$`。自定义组件内部要先取到组件再往下选 |
| api | 没有页面定位器。断言写在响应状态码和响应体上 |

`testId:`、`role:`、`label:`、`css:`、`text:` 这种字段是已退役的 YAML 用例格式,不要再写。

## 铁律:不凭空发明 locator

- locator 必须来自真实证据:Web 用 Playwright MCP 的 accessibility snapshot 或它生成的 locator;小程序用 wechatide MCP 的运行时节点树、console 或截图。MCP 未接入时,改为项目源码或真实 DOM/WXML。
- 禁止根据业务名词猜测文案或类名。
- 文案类定位要与真实渲染完全一致,注意空格与标点。
- Web 优先级:`getByTestId` > `getByRole` > `getByLabel` > `getByPlaceholder` > 稳定业务属性 > 精确文案 > CSS。
- 小程序只用运行时节点的 id 或稳定 class。先 `page.waitFor`,不要用固定毫秒等待代替元素出现。
- 视觉坐标只能作为观察证据,不能写进长期脚本。
