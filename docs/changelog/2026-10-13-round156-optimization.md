# Round 156/100 — 2026-10-13 — 采纳（createParagraphsWithRealFormats 的 piece 级 CHPX 路径可用性门控：消除对每个段落都白算的 pieceMap 分支）

> 结论：**技术采纳，版本 0.7.69 → 0.7.70，双包发布。** 27 份 `parseWithFormat` 16,247,039 字符逐字节一致；同进程配对端到端 400 对 **中位比值 0.98635（候选快 1.37%）/ 均值比值 0.9882 / 胜 251/400（62.75%）**；护栏 `tests/docParser.round156.test.ts` 7 项 + 两组离树负控（A 行为 3 项失败、B 元断言失败）。这是自 Round 148 以来**首个端到端稳定为正的采纳轮**（149/150/153/154 中性、151 退化、152 无点、155 护栏否决）。

## 前提与目标

- post-148 HEAD 的 `--cpu-prof`（`round149.cpuprofile`）自耗：GC 12.58%、`createParagraphsWithRealFormats` 12.46%（第 1 大）、`applyStructuralFormats` 6.85%+6.18%（同一函数两处代码对象）、`bytesToBase64` 4.61%、`buildMagicScanIndex` 3.66%、`extractFormattedText` 3.56%、`decodeRangeWithoutGuard` 3.01%、`mergeCharFormatForParagraph` 2.70%。
- 行级归因：`createParagraphsWithRealFormats` 内最热单行是**调用 `mergeCharFormatForParagraph` 的 L8013（3.58% 全样本）**。

## 发现（本轮核心）

用计数补丁（`patch156*.mjs` + `r156-count*.mjs`）在真实 bundle 上插桩，对 27 份样本统计每轮：

| 计数项 | 每轮值 |
|---|---|
| `mergeCharFormatForParagraph` 调用 | 33,702 |
| 该函数早退（totalChars≤0/runs 空） | **0** |
| 该函数迭代的 run 数 | 56,491（1.68/调用） |
| `{...styleFormat, ...run.format}` 分配次数 | 23,000（**仅 2.04%** 的 run） |
| pieceMap 分支进入 | 33,702 |
| 其中 overlapping 非空 | 33,702 |
| 其中 ratio≥0.5 | 33,702 |
| **overlapping 中带 chpxIndex 的 piece** | **0** |
| **`usedPieceChp` 置真次数** | **0** |
| fallback（`mergeCharFormatForParagraph`）实际执行 | 33,702 |

**结论**：对全部 27 份样本，`createParagraphsWithRealFormats` 里的 piece 级 CHPX 分支对**每一个段落**都白算——它分配 `overlapping` 数组、跑一次捕获 `cpStart`/`cpEnd` 的 `reduce` 闭包、算 ratio（恒 ≥0.5），却因 `p.chpxIndex` 恒为 `undefined` 而**从不写入 `merged`/`usedPieceChp`**，结果被紧随其后的 fallback `mergeCharFormatForParagraph` 完整覆盖。

根因：`chpxIndex` 仅在 piece 的 PCD 置位 `fChp` 时才有值（`pieceTable.ts:115,129`）。这 27 份文档使用 FKP 型 CHPX（`parseChpxRunsFromFkp`），真实字符格式由 `mergeCharFormatForParagraph` 从 CHPX bin table 合并，故 piece 无 `fChp`。

> 附带排除两个候选：①`{...styleFormat, ...run.format}` 只在 **2.04%** 的 run 上发生——Round 151 的展开消除方向确证无效（不是分配瓶颈）；②`mergeCharFormatForParagraph` 无早退（0/33,702），调用本身 + 二分查找是主要成本，非分配。

## 候选实现

`src/utils/docParser.ts` 的 `createParagraphsWithRealFormats`：在段落循环前**一次性**判定「整份 `pieceMap` 里是否存在可用的 piece CHPX」，无则整段跳过 pieceMap 分支。

```ts
// 段落循环前：
let piecePathUsable = false
if (pieceMap && pieceMap.length > 0) {
  for (let pi = 0; pi < pieceMap.length; pi++) {
    const p = pieceMap[pi]
    if (p.chpxIndex !== undefined && p.chpxIndex < chpxRuns.length) {
      piecePathUsable = true
      break
    }
  }
}
// 段落循环内：
if (piecePathUsable && pieceMap) { /* …原 piece 分支… */ }
```

**等价性论证**：分支内所有对 `merged`/`usedPieceChp` 的写入都在 `if (p.chpxIndex !== undefined && p.chpxIndex < chpxRuns.length)` 之内；若无任何 piece 满足该条件，分支对状态**零副作用**（`overlapping`/`ratio` 为局部量，`pieceCursor` 仅在本分支内使用）。故整段跳过与执行后结果逐位相同。

## 等价性（逐字节）

- 27 份 `parseWithFormat` 落盘 JSON：`cmp` **完全一致**（16,247,039 字符；两路 shasum 均 `8f127d0bdbb0a63718a5663f48d267972c753b0e`）。

## 性能证据（同进程配对端到端）

- `r149-paired.mjs`（baseline `/tmp/r149-head.mjs` vs cand `/tmp/r156-cand.mjs`）**400 对**：
  - baseMedian 85.063ms / candMedian 83.864ms，**中位比值 0.98635（候选快 1.37%）**；
  - **均值比值 0.9882（候选快 1.18%）**，**胜 251/400（62.75%）**。
- 中位与均值**同向为正**，胜率 62.75% 显著高于历史采纳阈值（57%+）与本轮前的噪声地板（149/150/153/154 均 ~54%）。

## 护栏（`tests/docParser.round156.test.ts`，7 项）

合成可区分输入：`chpxRuns[0]` 只覆盖 para0 前 5/20 字符（低于 fallback 的 50% bold 阈值 ⇒ fallback 对 para0 返回 `{}`），而 piece 路径直接取 `run.format` ⇒ `{bold:true}`；两条路径结果不同。

- **P1** 无 `chpxIndex` 的 pieceMap 输出与空 pieceMap **逐字节相同**，且两侧都走 fallback（spy 计数相等）。
- **P2** 带可用 `chpxIndex` ⇒ piece 级格式生效（`charFormatFromReal===true`、`bold===true`）、fallback **未被调用**。
- **P3** 越界 `chpxIndex`（=99）视作不可用 ⇒ 与空 pieceMap 逐字节相同。
- **P4** 仅一段可用 ⇒ 整份门控开（para0 走 piece、para1 走 fallback，spy 恰 1 次）。
- **负控 A**（注入 `if (false && pieceMap)` 无条件跳过）：**3 项行为断言失败**。
- **负控 B**（门控丢掉 `< chpxRuns.length` 范围校验）：**元断言失败**（门控区域必须含完整条件）。
- **元断言**：源码含 `piecePathUsable` / `if (piecePathUsable && pieceMap)`，且门控区域内匹配 `p.chpxIndex !== undefined && p.chpxIndex < chpxRuns.length`。

## 门禁

`npm test`（全量）+ `npx vue-tsc --noEmit` + `npm run lint` + `npm run build` + `npm run build:lib` 全通过（test/lint 串行，避免 vitest 临时文件致 eslint ENOENT）。

## 下一轮

Round 157，目标 1000。
