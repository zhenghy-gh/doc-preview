# Round 174/1000 — 2026-10-19 — **整轮否决**（用「首个正文段下标」替代 `prefixBodyCounts` 前缀数组 + 整趟遍历）——版本保持 0.7.86（不升号）

> 结论：**候选端到端中性偏负 ⇒ 整轮否决，未落地任何生产代码，不升号。**
>
> 设计上它更「干净」（删掉一整趟 `paragraphs` 遍历 + 一个 `Int32Array(34,945)` ≈139 KB/文档 的分配），27 份 `parseWithFormat` **逐字节一致**（SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`），bundle 还小了 33 B。但同进程配对端到端**两组一致地停在噪声地板**：3000 对 medianRatio **0.99798** / 胜率 **51.53%**，2000 对 **0.99822** / **51.50%**，合并 **2576/5000 = 51.52%**；且 **meanRatio 两组均 > 1（1.00387 / 1.00510）**。

## 前提与动机

post-173 HEAD（**61.3 ms/轮**）里 `applyStructuralFormats` 仍占约 10.7%，其中 `prefixBodyCounts` 是**一整趟**全段落遍历（34,945 段/轮）+ 一个 `Int32Array(34,945)` 分配。

**关键观察**：`prefixBodyCounts` 的全部下游用法只有两处，且都是「`group.start` **之前**是否已有正文段」：

```ts
group.count * 10 + (1 - group.cv) * 20 + (prefixBodyCounts[group.start] >= 1 ? 15 : 0)
const hasBodyBefore = prefixBodyCounts[bestGroup.start] > 0
```

两者都是 **`>= 1` / `> 0`** —— 只需要知道**最早**那个正文段的下标，**不需要完整计数**。

## 候选

在 Step 2 的循环里顺手记 `firstBodyIndex`（找到即停，`firstBodyIndex < 0` 守卫让后续段落只付一次比较），删掉整条前缀数组与整趟遍历，两处判据改为 `firstBodyIndex >= 0 && firstBodyIndex < start`。

**等价性（可自证）**：`prefixBodyCounts[k] >= 1` ⟺ ∃ `i < k` 使 `bodyLen(i) > LIST_ITEM_MAX_LEN` ⟺ `firstBodyIndex >= 0 && firstBodyIndex < k`；`bodyLen` 的定义（含 `\u0001` 时只剥开头那一个）与原实现逐字相同。

**前提核实（本轮确实做了）**：探针实测 `prefixBodyCounts` 在 **27 份里执行了 25 次** ⇒ 不是「罕见路径」，前提成立。

**验证**：27 份逐字节一致；实现标记 `firstBodyIndex` 5 处；bundle 325,396 → **325,363（−33 B）**。

## 为什么它不转化（本轮教训）

| 样本 | 对数 | medianRatio | meanRatio | 胜率 |
|---|---|---|---|---|
| 1 | 3000 | 0.99798 | **1.00387** | 51.53% |
| 2 | 2000 | 0.99822 | **1.00510** | 51.50% |
| 合并 | 5000 | ≈0.9981 | ≈1.0044 | **2576/5000 = 51.52%** |

**两组高度一致地停在噪声地板，且均值口径都是「更慢」。** 归因：

1. **被删掉的那趟遍历本来就极便宜**：每段只有约 5 次 typed-array 操作（`visibleTextLengths[i]` 读、`picFlags[i]` 读、比较、`prefixBodyCounts[i]` 读、写），**没有属性加载、没有函数调用、没有字符串扫描**。34.9k 段 × ~5 ops ≈ 17 万次操作 ≈ 0.2–0.3% —— 低于本方法的检出分辨率。
2. **省下的分配几乎免费**：V8 对大块 typed array 走的是按页映射 + 惰性置零，且该数组是**短命**的（每文档一个、随即丢弃），分代 GC 回收成本极低。
3. **而新增的分支落进了更热的循环**：Step 2 是 `applyStructuralFormats` 里最热的循环之一，多一段分支/局部量可能挤掉内联预算，抵消掉那点收益（meanRatio > 1 正是这个信号）。

> **教训 14（本轮新记，是对教训 13 的细化）**：**「删掉一整趟遍历」也不自动等于「减少真实工作」** —— 要看**那趟遍历的每单位成本**，以及**新增代码落在了多热的循环里**。判据升级为三条：
> ① 被删掉的工作**每单位**贵不贵（属性加载 / 函数调用 / 字符串扫描 = 贵；typed-array 读 + 比较 = 便宜）？
> ② 新增的代码落在**更热还是更冷**的循环里？
> ③ 净效应 = ①×量 − ②×量，是否超过 ~0.5%（本方法的检出下限）？
> 只有三条都过才值得做。R171 能成（`startsWith` + 属性加载 + 迭代器，且被删代码在**更冷**的位置）、R174 不能成（typed-array 五连读，且新增代码进了**更热**的 Step 2），正好是一对正反例。

## 处置

- **撤回**：`git checkout -- src/utils/docparser/heuristics/paragraphFilter.ts`，sha256 恢复 `f0f5cca124bdf7810a85e18adc2606e217858e750b5ea6f09a476d6595fbe5ec`（= R171 版本）。
- **还原核对**：用最终源码重建的 bundle 与 R173 基线 bundle（`/tmp/r173-cand.mjs`，325,396 B）**逐字节相同**。
- **不升号、不提交生产代码**：`package.json` 保持 **0.7.86**。

## 下一轮

`applyStructuralFormats` 的「省遍历」路线（并趟 / 换前缀数组）**本轮证否**，除非能把被删工作换成「贵操作」。下一轮候选：

1. **`bytesToBase64`（单行 3.21%）** —— 先证 `TextDecoder('latin1')` **不可用**（WHATWG 里 `latin1`/`iso-8859-1` 都是 **windows-1252** 的别名，0x80–0x9F 会映射成 €‚ƒ 等，直接破坏 base64）。若不可用则本条关闭，转而核 `String.fromCharCode.apply` 的分块策略是否已到顶（R161 已定 `0x800`）；
2. **`mergeCharFormatForParagraph`（3.64% + 调用点 3.47%）** —— 先用「入口早退探针」量真实占比；若确有 ~7%，再找单次调用内可省的**贵操作**（属性加载 / Map.get）；
3. **`findJpegEnd` 的 `data.indexOf(0xFF, offset)`（0.76%）** —— 需先确认 `scanImagesFromStream` 是否对同一段 JPEG 重复调用（若重复，属「重复扫描」类真工作）；
4. `buildMagicScanIndex`（6.71%）、两处 `runs.sort`（1.18%，受 R167 D5 元断言约束）—— 均已在历史轮次判过或受契约约束。

目标 1000 轮。
