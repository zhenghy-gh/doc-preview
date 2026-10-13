# Round 149/100 — 2026-10-13 — 候选撤回（decodeRangeWithoutGuard 微优化端到端无稳定收益）

> 结论：**候选撤回，不升号、不发布，轮次计入。** 源码已 `git checkout` 还原，fastDecode 护栏仍 15/15。

## 前提与目标
- 当前 HEAD（post-148，0.7.69）`--cpu-prof`（80 轮×27 份，perRoundMs≈182ms）自耗占比：createParagraphsWithRealFormats 12.75%、GC 11.05%、applyStructuralFormats 13.56%（两份副本）、bytesToBase64 4.76%、buildMagicScanIndex 3.83%、extractFormattedText 3.65%、**decodeRangeWithoutGuard 3.14%**。
- Round148 交接明确标注 `decodeRangeWithoutGuard 3.80% 未动`，且历史 progress 记录其有「判定/分配/访存三处微优化（合计约 1.1x）」的遗留空间——本轮即攻此方向。

## 候选实现（已还原）
`src/utils/docparser/clxReader.ts` 的 `decodeRangeWithoutGuard`：
1. **分配**：复用模块级可增长 `decodeScratch = new Uint16Array(1024)`，去掉每调用 `new Uint16Array(n)`（按码元上界逐次分配，是 GC 占比来源之一）。单次解析顺序调用、TextDecoder 同步返回独立字符串，无两块活跃视图重叠，scratch 安全可复用。
2. **判定**：内联 `isValidPrintableChar`（c>=0x20 已由外层保证，省略 <0x20 初判），去掉每字符函数调用。

## 等价性
- `tests/clxReader.fastDecode.test.ts` **15/15 通过**（含真实语料逐区间差分、两分支全覆盖、非字符域断言）。内联谓词与独立函数对 c>=0x20 逐字符等价（负向区间互斥，else-if 链保持语义）。

## 测量证据
- 同进程配对端到端 `r149-paired.mjs`（interleave baseline/candidate，每对各一次 parseAll）：
  - **80 对**：baseMedian 90.349ms / candMedian 90.276ms，中位比值 **0.99207**（+0.8%）、胜 44/80（55%）、中位差 −0.749ms。
  - **300 对**：baseMedian 87.582ms / candMedian 87.521ms，中位比值 **1.00012（中性）**、均值比值 **1.00413（候选慢 0.4%）**、胜 149/300（49.67%）。
- 早期 80 对的 +0.8% 在小样本下看似 positive，放大到 300 对后回落为中性/轻微负值——**典型 R145/R146 小样本噪声陷阱**。

## 归因（为何无稳定收益）
- `isValidPrintableChar` 体积极小且单态，V8 已在 JIT 中内联；手动物理内联无增量收益。
- 每调用 `new Uint16Array(n)` 的分配削减，未转化为可测端到端收益——当前 GC 占比（11%）并非由本函数主导，分配开销被其他路径（对象展开、字符串切片）淹没。
- 隔离/小样本赢家 ≠ 端到端赢：本轮再次验证「凡微基准赢家须端到端配对复核才能落地」。

## 纪律结论
候选端到端无稳定收益，按协议**撤回**（`git checkout -- src/utils/docparser/clxReader.ts`），不升号、不发布；本轮计入 100 轮预算。fastDecode 护栏保持 15/15 不受影响。

## 给下一轮（150）
- 149 其余热点处置：applyStructuralFormats 13.56% 维持默认否决（写-读依赖链、等价风险高）；bytesToBase64 / buildMagicScanIndex 已最优；createParagraphsWithRealFormats 12.75% 为第 1 大，历史标注「内部展开约 2%，注意 resolved-先行键序约束」——150 转查其内部对象展开（对象 spread / `Object.keys().length` 分配）是否可安全收口而不破坏 Round144 的键序约束。
- 下一轮 150，目标 208。
