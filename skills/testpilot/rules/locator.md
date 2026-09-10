# Locator 规范

## V0.1 支持形式

- `text:` 按可见文案匹配(仅 web,如 `text: 提交订单`)
- `css:` 按 CSS 选择器匹配(web 与小程序均支持,如 `css: .order-id`;小程序匹配 WXML 的 class/id)

## 铁律:不凭空发明 locator

- locator 必须来自真实证据:页面源码、DOM、组件代码,或 screenshot / extract 的结果。
- 禁止根据业务名词猜测文案或类名。
- 文案类 locator 要与真实渲染完全一致,注意空格与标点。
- 优先选择稳定且语义化的目标:自定义属性 > 语义类名 > 文案;避免依赖动态生成的类名和元素索引。
- 小程序端只能用 css:从 WXML / WXSS 中确认 class 或 id 后再写步骤。
