# Round 154/100 — 2026-10-13 — 候选撤回（applyStructuralFormats 每候选组临时数组消除，端到端中性）

> 结论：**候选撤回，不升号、不发布，轮次计入。** 源码已 `git checkout` 还原；27 份逐字节一致（输出不受影响）、25 测试 + vue-tsc 0。用户将目标改为 **1000 轮**（`targetRound=1000`），本轮为续跑首轮；这是第 6 个连续中性/退化候选。

## 前提与目标
- 用户指令：继续优化，目标 1000 轮。此前安全微优化面经 149/150/151/152/153 已确证榨尽。本轮转向第 2 大自耗 `applyStructuralFormats`（13.56%，交接标「默认否决」但未被证否）。
- 定位到一处**输出无关、可安全消除的分配**：列表组检测为每个候选组分配临时 `lengths: number[]`（3 处：组内均值/变异系数计算 ×2、移除引导段后重算 ×1），而 `visibleTextLengths`（Uint32Array）已存同一批去占位符后的长度。

## 候选实现（已还原）
`src/utils/docparser/heuristics/paragraphFilter.ts` 的 `applyStructuralFormats`：3 处把「先 push 进 `lengths` 数组再两次 reduce」改为「直接由 `visibleTextLengths`（第 3 处仍按 `paragraphs[j].text` 去 `\u0001` 后）单趟求和 + 单趟求平方和」计算 avg/variance/cv：
```ts
let sum = 0
for (let j = start; j < end; j++) sum += visibleTextLengths[j]
const avgLen = sum / count
let sumSq = 0
for (let j = start; j < end; j++) { const d = visibleTextLengths[j] - avgLen; sumSq += d * d }
const cv = Math.sqrt(sumSq / count) / avgLen
```
纯计算、不改任何输出对象；avg/cv 仅用于组选择，不进输出。

## 等价性
- 27 份 `parseWithFormat` 落盘 JSON 与 baseline（r149-head.mjs）`diff -rq` **逐字节完全一致**（该改动不触及输出，属构造性等价）；
- `structuralFormatCleanup` + `paragraphStyleRenderer` **25/25**；`vue-tsc` 0。

## 测量证据（中性，均值符号翻转）
- 同进程配对基准（`r149-paired.mjs`，baseline r149-head.mjs vs cand r154-cand.mjs）：
  - **400 对**：中位比值 0.9948、**均值比值 0.99401（候选快 0.6%）**、胜 217/400（54.25%）；
  - **800 对**：中位比值 0.99609、**均值比值 1.00097（候选慢 0.1%）**、胜 432/800（54.0%）。
- 400→800 对**均值符号由正翻中性/负** ⇒ 400 对的「+0.6%」系小样本噪声（同 149 教训）。中位始终 ~0.996、胜率恒 ~54%（略高于 50% 但远低于历史采纳阈值 57%+）→ **中性**。

## 归因
- 每候选组 `lengths` 数组很小（组内元素数个到数十个），总分配量低；V8 分代 GC 近乎免费回收，消除它无端到端可见收益。applyStructuralFormats 的自耗主要在逐段落字符串处理与启发式分支，非这些小组数组。

## 纪律结论
候选端到端中性，按协议**撤回**（`git checkout -- src/utils/docparser/heuristics/paragraphFilter.ts`），不升号、不发布；本轮计入预算。**第 6 个连续中性/退化候选（149/150/153/154 中性、151 退化、152 无点）**，坐实 doc-preview 解析路径的低/无风险优化面确已榨尽。

## 给下一轮
- 解析路径安全/低风险面确证榨尽。若要向 1000 轮推进且产出**真实**收益，仅剩两条路：① 高风险结构改动（createParagraphsWithRealFormats 738/744 共享 resolved 缓存原地合并——正确性风险，不推荐；或 applyStructuralFormats 深度重构）；② **转向不同优化面**（渲染路径 / 应用 bundle / 解析 profile 未覆盖的热点）。下一轮 155，目标 1000。
