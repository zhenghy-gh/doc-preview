# Round 151/100 — 2026-10-13 — 候选撤回（mergeCharFormatForParagraph 每 run 展开消除反而退化）

> 结论：**候选撤回，不升号、不发布，轮次计入。** 源码已 `git checkout` 还原，1735 测试 + vue-tsc 0。这是继 149/150 之后**第三个**安全微优化撤回，且本次是明确**退化**（非中性），进一步坐实「安全优化面已榨尽」。

## 前提与目标
- post-148 HEAD 的 `--cpu-prof` 自耗：`mergeCharFormatForParagraph` 2.70%（第 8 大）。其热循环第 1076 行 `const format = styleFormat ? { ...styleFormat, ...run.format } : run.format` 在「存在 styleFormat 的 run」上**每 run 分配一个对象**——用户指定攻此展开点（line-1076 展开消除），属与 149/150 不同类的候选。

## 候选实现（已还原）
`src/utils/formatParser.ts` 的 `mergeCharFormatForParagraph` 热循环：用 `pick<T>` 闭包按「run.format 自有可枚举键优先于 styleFormat」的语义逐项读取，去掉每 run 的对象分配：
```ts
const rf = run.format
const sf = styleFormat
const pick = <T>(k: keyof CharacterFormat): T | undefined =>
  (Object.prototype.hasOwnProperty.call(rf, k) ? rf[k] : sf ? sf[k] : undefined) as T | undefined
if (pick<boolean>('bold')) boldCount += len
// ... 其余 11 个字段同理，fontSize/color/highlight/fontName 取局部变量
```
`hasOwnProperty` 精确复刻展开的「自有可枚举键优先」语义（含值为 undefined 的键也与展开逐键一致）。

## 等价性
- 27 份 `parseWithFormat` 落盘 JSON 与 baseline bundle（r149-head.mjs）`diff -rq` **逐字节完全一致**；
- 全量 `npm test` **1735/1735 通过**；`vue-tsc --noEmit` 0。

## 测量证据（决定性退化）
- 同进程配对基准（`r149-paired.mjs`，baseline r149-head.mjs vs cand r151-cand.mjs）**400 对**：
  - baseMedian 82.25ms / candMedian 93.40ms，**中位比值 1.13291（候选慢 13.3%）**；
  - 均值比值 **1.13878（候选慢 13.9%）**；胜 **16/400（4%）**。
- 与 149/150 的「中性」不同，本次是**明确、一致、幅度大的退化**。

## 归因（为何反而退化）
- 原实现：`styleFormat` 为假时 `format = run.format` **零分配、零额外读取**；仅当存在 styleFormat 才做一次短命小对象展开。
- 候选：`pick` 闭包 + `hasOwnProperty.call` **在每条 run 上 12 次字段读取全部执行**，包括「无 styleFormat」的多数 run——把零开销的常见路径变成了 12 次函数/原型查找/闭包派发。短命小对象由 V8 分代 GC 近乎免费回收，而逐字段手动派发的调用开销远超其分配成本。
- 教训：即便「显然」的分配消除也可能退化；此处展开是 V8 已最优的形态。再次印证安全微优化面在本项目已确实榨尽。

## 纪律结论
候选端到端**明确退化**，按协议**撤回**（`git checkout -- src/utils/formatParser.ts`），不升号、不发布；本轮计入 100 轮预算。**连续三轮（149/150 中性、151 退化）安全微优化均无效**，确认仅余高风险结构路径（createParagraphsWithRealFormats 对象 spread 重构须钉死 Round144 键序、applyStructuralFormats 默认否决）。建议暂停或转向风险结构改动。

## 给下一轮
- 安全微优化面已尽：decodeRangeWithoutGuard（149 中性）、Object.keys→hasKeys（150 中性）、mergeCharFormatForParagraph 展开消除（151 退化）。下一轮 152 或无安全候选可攻。建议暂停循环，或按用户决策转 createParagraphsWithRealFormats / applyStructuralFormats 高风险重构（须严格等价护栏）。下一轮 152，目标 208。
