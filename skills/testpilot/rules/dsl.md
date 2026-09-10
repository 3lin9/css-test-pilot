# DSL 规范

Case 是 YAML 文件,V0.1 顶层结构:

```yaml
id: order-create      # kebab-case,与文件名一致
name: 用户创建订单      # 人类可读名称
steps:                # 有序步骤列表
  - target: miniapp   # 执行端:miniapp | web
    action: click     # 见下方 Action 表
    locator:          # 定位器(见 rules/locator.md)
      text: 提交订单
```

## V0.1 稳定 Action

| action | 用途 | 关键字段 |
| --- | --- | --- |
| `launch` | 启动应用(miniapp) | — |
| `navigate` | 打开页面(web) | `url` |
| `click` | 点击 | `locator` |
| `input` | 输入 | `locator`, `value` |
| `select` | 选择 | `locator`, `value` |
| `wait` | 等待 | 条件(以 @testpilot/dsl schema 为准) |
| `assert` | 断言 | `locator`, `expected` |
| `extract` | 提取内容为变量 | `locator`, 变量名(以 schema 为准) |
| `screenshot` | 截图取证 | — |

字段定义最终以 `packages/dsl` 的 zod schema 为准;不要使用表中之外的字段。

## 原则:Action 是通用测试原语,不是业务能力

```text
login / order / payment   ❌ 业务动作不是 Action
click / input / assert    ✓ 由基础 Action 组合表达业务流程
```

登录、下单等业务流程由多个基础 Action 组合而成,不要设计业务 Action。

## 示例

见仓库 `examples/cases/order-create.yaml`(小程序下单 → Web 后台验证的黄金路径)。
