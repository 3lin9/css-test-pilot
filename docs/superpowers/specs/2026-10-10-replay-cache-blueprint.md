# 蓝图:AI 兜底步骤的回放缓存(证据门槛写入 + 回放效果验证)

- 日期:2026-10-10
- 状态:**设计蓝图,不在本次实现范围**。前置依赖(`fallback: 'agent'` 步骤与运行时模型接入)立项后,以本文件为设计基线。
- 来源:`docs/research/github-testcase-generation-landscape.md` §2.16(tester-army/e2e 的缓存写入证据门槛与回放效果验证)、§2.15(healenium 回放唯一命中验证)。

## 前置依赖(不在本蓝图定义)

1. DSL 扩展:step 新增 `fallback: 'agent'`(仅 locator 型步骤:click / input / select / assert / wait)。
2. 运行时模型接入。本蓝图只假设其接口形状:**输入**(当前屏语义快照 + 步骤意图/原 locator)→ **输出**(候选 locator 列表,形态与现有 `locatorSchema` 一致:css / text)。模型协议、成本预算、快照采集方式由立项 spec 定义。

## 核心决策:缓存「修正后的 locator」,不缓存动作序列

e2e 缓存的是 agent 动作序列;TestPilot 的用例本身就是确定性 DSL,动作序列已在 YAML 里,**脆的是 locator**。因此本缓存的对象是映射:

```
(模板ID, 行ID, step index, stepHash) → 修正后的 locator
```

AI 兜底只在步骤定位失败时介入;缓存命中时用修正 locator 替换原 locator 执行,全程确定性。

## 写入门槛(证据门槛)

修正成功 ≠ 可写入。判定推迟到 **case 结束时**统一做:

- case 最终 **passed** → 写入本次所有修正(unconfirmed → saved);
- case **failed / blocked / inconclusive** → 本次的修正全部**丢弃**(unconfirmed)——不知道失败是不是修正引起的,就不能信任它;
- 同 case 同 step 只保留最后一次修正。

## 命中与验证

- 解析 case 时按 key 查缓存;`stepHash` 一致才命中(见失效)。
- **唯一命中验证**(healenium 式):修正 locator 在当页解析结果必须**唯一命中**;零命中或歧义 → 视为 miss,按原 locator 执行 → 仍失败才走 AI 兜底。缓存绝不允许引入"猜对"的定位。
- 命中的步骤在 `StepResult` 标记 `cacheHit: true`,报告可见。

## 失效(evict)

| 条件 | 动作 |
| --- | --- |
| `stepHash` 不匹配(case YAML 该步骤的 action+locator+value+expected+target 变了) | 条目作废 |
| 修正 locator 解析歧义或零命中 | 本次跳过;连续 N 次失败删除条目(N 立项时定,建议 3) |
| 命中后该 case 最终未 passed | 删除条目 |
| `--no-cache` 运行 | 全局旁路(排查"缓存还是产品"时排除干扰,对齐 e2e 调试纪律) |

key **不含模型名/模型版本**——模型可替换,`stepHash` 才是资产身份(对齐 e2e "换模型缓存不失效")。

## 存储

- 位置:`.testpilot/cache/<templateId>/[<rowId>/]step-<n>.json`(`.testpilot/` 已是运行时状态目录,gitignore)。
- 内容:`{ stepHash, originalLocator, fixedLocator, createdAt, lastConfirmedAt, source: 'agent-fallback' }`。

## 与 no-invention 原则的关系

- fallback 只允许基于**当前屏证据**产出 locator(屏上语义存在才可输出),产出一律过「唯一命中」验证;
- **永不自动改写 case YAML 源文件**。case passed 且存在缓存命中时,报告提示"建议人工将修正 locator 回写 case"——回写是人的决定,工具只提供 diff。这是与 evidence-first 一致的底线:缓存的修正属于运行时便利,源文件必须始终是人审过的。

## 开放问题(立项时决策)

- fallback 的模型调用预算:每 case 上限次数、单步超时。
- 连续 evict 的计数窗口(按 run 还是按天)。
- 报告是否需要 stale 条目清单(命中但 stepHash 变更的条目提示清理)。
