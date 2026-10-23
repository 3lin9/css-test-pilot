# UI 自主观察与彩排实施计划

## 完成标准

- Web：真实跑通 `observe → probe → rehearse → ready → run --require-ready`。
- 小程序：采集运行时节点、WXML、边界框和截图；缓存定位器复用前必须 probe，失效后重新观察。
- 正式 Run 不临场改写 Case；Ready Certificate 失效时阻止 `--require-ready` 运行。
- “一次成功”指首次正式 Run 得到可信结论，不承诺业务断言一定通过。

## 任务

1. 扩展 DSL locator：`testId`、`role + name`、`label`、`placeholder`，保持单策略互斥。
2. 新增 observation-core：观察、候选、元素指纹、probe、稳定性、状态变化和证书合同。
3. Playwright 通过 `page.ariaSnapshot({ mode: "ai", boxes: true })` 和精简交互 DOM 实现观察；probe 校验唯一、可见、启用、可编辑与遮挡。
4. discovery-engine 实现候选评分、指纹比对、缓存读取/写入和失效重观察。
5. rehearsal 在执行引擎中为 UI 动作增加动作前 probe、动作后稳定等待和状态变化证据；全部通过后签发证书。
6. SDK/CLI 提供 `discover`、`rehearse`、`validate --runtime`、`run --require-ready`。
7. Agent 的 `runAfterCreate` 改为先彩排并签发证书，再进行 require-ready 正式运行。
8. 小程序通过 automator 的 `$$("*")`、`outerWxml()`、`size()`、`offset()` 和 screenshot 形成融合观察；CSS 候选优先 id、稳定 class，再退回标签。
9. 增加单元/集成测试，最后执行 typecheck、全量测试、build、本次文件 lint 与 `git diff --check`。

## 安全与确定性边界

- Discover 只执行 launch/navigate/observe/probe，不执行有业务副作用的动作。
- Rehearse 会真实执行 Case，只应在可重置测试环境使用。
- 缓存 fallback 只有指纹匹配且 probe 通过才能复用。
- 密码、OTP、银行卡等敏感输入的值不进入观察结果。
- screenshot 作为证据；第二阶段不引入视觉模型或坐标点击。
