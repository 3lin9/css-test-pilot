# Locator 规范

## 支持形式

- `testId:` 按 `data-testid` 匹配(Web 首选)
- `role:` + 可选 `name:` 按 ARIA role / accessible name 匹配(Web)
- `label:` 按关联 label 匹配(Web 表单)
- `placeholder:` 按 placeholder 匹配(Web 表单)
- `text:` 按可见文案精确匹配(仅 Web,如 `text: 提交订单`)
- `css:` 按 CSS 选择器匹配(web 与小程序均支持,如 `css: .order-id`;小程序匹配 WXML 的 class/id)

除 `name` 只能配合 `role` 外,每个 locator 只能选择一种策略。

## 铁律:不凭空发明 locator

- locator 必须来自真实证据:Web aria snapshot/DOM、小程序运行时 WXML/节点树、组件代码或 screenshot。
- 禁止根据业务名词猜测文案或类名。
- 文案类 locator 要与真实渲染完全一致,注意空格与标点。
- 优先级:`testId` > `role+name` > `label` > `placeholder` > 稳定业务属性 > 精确文案 > scoped CSS。
- 小程序端只能用 `css`:由运行时节点的 id / 稳定 class 生成,每次缓存复用前必须 probe;失效后重新 observe。
- 视觉坐标只能作为观察证据,本阶段不能固化为长期 Case locator。
