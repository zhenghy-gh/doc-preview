# Round 152/100 — 2026-10-13 — 无可行安全候选（extractFormattedText 为一次性编排方法，无热循环），安全优化面确证榨尽

> 结论：**本轮无 adoptable 安全候选**。未改源码、未发布。作为对「最后一个未探安全热点」的尽职调查记录，确认安全微优化面在穷尽所有剩余热点后**确证榨尽**。建议暂停循环（或转高风险结构改动）。轮次计入。

## 前提
- post-148 HEAD 的 `--cpu-prof`（80 轮×27 份）自耗：`extractFormattedText` 3.65%，列第 5 大自耗项，且是前几大里唯一「未尝试且非默认否决」的候选。用户选「试 extractFormattedText」作最后一个未探安全候选。

## 勘察结论（无热循环，无安全可榨点）
`src/utils/docParser.ts:1466` 的 `extractFormattedText` 是**纯编排/分发方法，每文档仅调用一次**。逐段读其体（1466–1716+）：
- 三个分支（libwv / CLX / FibBase 回退 / 自动检测）均为条件判断 + 子调用 +（至多）每文档构造一个返回对象；
- 其自耗 3.65% 由**每文档一次性开销**构成：变量声明、`parseFormatRuns` 返回的 ~22 字段解构（1539 行）、`mainText.trim()` / `.length`（1524、1536 行）、`logger` 调用（1628、1656 等）、以及 1571–1591 行的 ~20 字段大返回对象（多数字段为 undefined）；
- **无逐字符 / 逐段落热循环**——所有重活（createParagraphsWithRealFormats 12.75%、parseFormatRuns、applyStructuralFormats 13.56%、filterParagraphsWithGenericLogic）都在被分别归因的子调用里，不在本方法自耗中。

因此本方法**不存在可剥离的安全微优化点**：任何改动（如惰性构造大返回对象）只作用于每文档一次的路径，端到端无可见收益；且按 Round151 教训，加派发/分支反而可能退化。

## 安全优化面穷尽确认
至此对 post-148 全部剩余热点逐一处置：
| 热点 | 自耗 | 处置 |
|---|---|---|
| decodeRangeWithoutGuard | 3.14% | 149 试：中性（均值 −0.4%）撤回 |
| createParagraphsWithRealFormats | 12.75% | 内部 object spread / Round144 键序约束 → 高风险，未动 |
| applyStructuralFormats | 13.56% | 交接默认否决 |
| bytesToBase64 | 4.76% | 0x2000 已最优；分块 btoa 变体（148）0.968× 更慢 |
| buildMagicScanIndex | 3.83% | R143/R145 已采纳优化，剩余展开变体（145）端到端退化撤回 |
| extractFormattedText | 3.65% | 152 勘察：一次性编排，无热循环，无安全可榨点 |
| mergeCharFormatForParagraph | 2.70% | 151 试：展开消除反而退化 13.3% 撤回 |
| Object.keys→hasKeys（createParagraphsWithRealFormats 内） | — | 150 试：中性（均值 −0.4%）撤回 |

**连续三轮实测（149 中性 / 150 中性 / 151 退化）+ 本轮勘察，确证本项目安全微优化面已榨尽。** V8 对短命对象、Object.keys、对象展开等模式已高度优化，手工替代无增量甚至退化。

## 给下一轮
- 仅余高风险结构路径：createParagraphsWithRealFormats 的对象 spread 重构（须钉死 Round144 键集合与键序守卫）或重新评估 applyStructuralFormats 默认否决。二者等价风险高，需严格护栏。
- 148 个已发布优化远超最初「100 轮」口径。建议**暂停**安全 grind，待用户指定风险结构改动方向或新热点再继续。下一轮 153（或暂停），目标 208。
