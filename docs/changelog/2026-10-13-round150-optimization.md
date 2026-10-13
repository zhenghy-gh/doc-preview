# Round 150/100 — 2026-10-13 — 候选撤回（createParagraphsWithRealFormats 的 Object.keys→hasKeys 微优化端到端无稳定收益）

> 结论：**候选撤回，不升号、不发布，轮次计入。** 源码已 `git checkout` 还原，162 测试 + vue-tsc 0。

## 前提与目标
- post-148 HEAD 的 `--cpu-prof` 自耗：createParagraphsWithRealFormats 12.75%（第 1 大）、applyStructuralFormats 13.56%（交接标默认否决）、extractFormattedText 3.65%、mergeCharFormatForParagraph 2.70%、GC 11.05%。
- 用户选「安全微优化续做 150」：把 `createParagraphsWithRealFormats` 热段落循环里反复出现的 `Object.keys(x).length > 0`（每次检查分配一个数组，累计数万次/文档，是 GC 占比来源之一）换成非分配式 `hasKeys`。不动键序/语义。

## 候选实现（已还原）
`src/utils/docparser/formatRecovery.ts`：新增模块级
```ts
function hasKeys(x: object): boolean {
  for (const k in x) {
    if (Object.prototype.hasOwnProperty.call(x, k)) return true
  }
  return false
}
```
替换热循环内 5 处（`papx.format` / `resolved.paraFormat` / `resolved.charFormat`×2 / `merged`）及同模块 style 预解析 1 处 `Object.keys(x).length > 0` → `hasKeys(x)`。语义严格等价（这些对象均为字面量或 spread 构造的普通对象，无继承可枚举键）。

## 等价性
- 27 份 `parseWithFormat` 落盘 JSON 与 baseline bundle（r149-head.mjs）`diff -rq` **逐字节完全一致**；`formatParser`/`paragraphStyleRenderer`/`structuralFormatCleanup` 三套 **162 测试通过**；`vue-tsc --noEmit` 0。

## 测量证据
- 同进程配对基准（复用 `r149-paired.mjs`，baseline r149-head.mjs vs cand r150-cand.mjs）**400 对**：
  - baseMedian 83.331ms / candMedian 83.337ms，中位比值 **0.9964**（候选中位快 0.36%）。
  - 均值比值 **1.00418（候选均值慢 0.4%）**，胜 215/400（**53.75%**）。
- 中位略正、均值转负、胜率仅 53.75% → **中性**。均值转负说明 `for-in + hasOwnProperty` 并未胜过 V8 已高度优化的 `Object.keys`，且分配削减未转化为端到端收益（GC 占比并非由本检查主导）。

## 归因（为何无稳定收益）
- 与 Round149 同理：V8 对 `Object.keys` 已优化，手工非分配替代无增量；该检查占 createParagraphsWithRealFormats 自耗极小，远小于同函数内的对象 spread 与字符串切片分配。

## 纪律结论
候选端到端无稳定收益，按协议**撤回**（`git checkout -- src/utils/docparser/formatRecovery.ts`），不升号、不发布；本轮计入 100 轮预算。**连续两轮（149/150）安全微优化均中性，确认本项目的「安全微优化面」已榨尽**——剩余热点仅 `createParagraphsWithRealFormats`（对象 spread / Round144 键序约束，高风险）与 `applyStructuralFormats`（默认否决）。

## 给下一轮
- 继续只余风险路径：createParagraphsWithRealFormats 的对象 spread 重构（须钉死 Round144 键集合与键序守卫）或 applyStructuralFormats 默认否决降级；二者等价风险高。建议**暂停**或转风险结构改动，而非继续中性安全微优化。下一轮 151（或暂停），目标 208。
