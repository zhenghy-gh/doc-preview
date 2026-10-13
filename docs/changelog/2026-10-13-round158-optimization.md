# Round 158/1000 — 2026-10-13 — 采纳（detectListInfo 首字符分派：每段 12 次正则 test 降到 1–3 次）

> 结论：**技术采纳，版本 0.7.71 → 0.7.72，双包发布。** 27 份 `parseWithFormat` 16,247,039 字符逐字节一致（shasum `8f127d0b…`）；同进程配对端到端 **400 对：中位比值 0.94269 / 均值 0.94345 / 胜 356（89.0%）**，**800 对：中位比值 0.94369 / 均值 0.9557 / 胜 676（84.5%）** —— 两轮规模同向、无符号翻转。**这是本循环迄今单轮最大的端到端收益（≈5.6% 中位）**。护栏 `tests/textHeuristics.round158.test.ts` 5 项 + 三组离树负控（A 1 项、B 1 项、C 2 项失败）。

## 前提与目标

在 **post-157 HEAD** 上重建 bundle 并重跑 `--cpu-prof`（60 轮）。自耗前 10：`createParagraphsWithRealFormats` 12.00%、GC 10.06%、`applyStructuralFormats` 7.19%+6.09%（同一函数两处代码对象）、`buildMagicScanIndex` 4.50%、`bytesToBase64` 4.15%、`mergeCharFormatForParagraph` 3.89%、`decodeRangeWithoutGuard` 3.72%、`extractFormattedText` 3.65%、`parseChpxGrpprlWithFont` 2.52%。

**关键前置量测（先量后改）**：按函数统计每轮调用次数（`patch158.mjs` + `r158-count.mjs`）——`buildMagicScanIndex` 27/轮（=1/文档）、`detectParagraphFormat` 33,702/轮、`detectListInfo` 33,702/轮、`cleanParagraph` 34,348/轮、`mergeCharFormatForParagraph` 33,702/轮，**均无重复调用冗余**，故收益只能来自单次调用内部。

**新认识（剖析口径）**：把剖析里所有 `RegExp:` 节点单独汇总（`prof-regex.mjs`），**正则执行时间共 7.01%（406.7ms）**——它不落在调用行上，而是被 V8 记到独立的 `RegExp:` 节点。故「行级自耗」会系统性低估正则密集函数的真实成本。

## 发现（本轮核心）

`detectListInfo`（`src/utils/docparser/heuristics/textHeuristics.ts`）用**固定 12 次** `regex.test(trimmed)` 依次尝试：多级阿拉伯数字、阿拉伯数字、括号阿拉伯数字、罗马数字、拉丁字母、括号拉丁、中日韩数字、括号中日韩、带圈数字、ASCII 项目符号（两种）、中日韩项目符号、方块项目符号。

**12 个模式全部以 `^` 锚定**，各自的首字符集合很窄且两两不相交。用计数补丁统计 27 份语料 × 20 轮（33,702 段/轮）的首字符分布：

| 首字符类别 | 占比 |
|---|---|
| **拉丁字母** | **93.68%** |
| 数字 | 2.22% |
| 空白/长度<2（已早退） | 3.36% |
| 括号 `( （ [` | 0.15% |
| 其它（含项目符号、标点） | 0.59% |
| 中日韩数字 / 带圈 | 0.00% |

即 **93.68% 的段落只可能命中 ROMAN / LATIN 两个模式**，另外 10 个必然在第 1 个字符上失配——却仍要付每次 `test()` 的 regexp 调用与执行固定开销。

**收益上限实测**：把 `detectListInfo` 在长度检查后直接 `return null`（改变行为，仅用于测时）后跑 600 对配对基准——**中位比值 0.94349 / 均值 0.95102 / 胜 89.83%**，即该类工作的总上限约 **5.65%**。

## 候选实现

按 `trimmed.charCodeAt(0)` 分派到 4 组，每段只跑该组内的模式：

| 首字符 | 该组内按原顺序试 |
|---|---|
| 数字 `0-9` | ML → AR |
| `( （ [` | PA → PL → PC |
| 拉丁字母 | （仅当首字母 ∈ {i,I,v,V,x,X}）RO → LA |
| 其它 | CN → CI → BA → BC → BS |

另加两处**必要前置条件**（不改变结果，只减少调用）：
1. **ROMAN 首字母门**：`LIST_ROMAN_RE` 的首字符集合恰为 `{i,I,v,V,x,X}`，其余拉丁首字母直接跳过该多分支交替式。
2. **LATIN 第二字符门**：`LIST_LATIN_RE = /^[a-zA-Z][\.\)][\s\t]/` 要求第 2 个字符是 `.` 或 `)`，故先判 `charCodeAt(1)`。

**等价性论证**：各组首字符集合互斥 ⇒ 组间先后无影响；组内严格保持原顺序（ML<AR、PA<PL<PC、RO<LA、CN<CI<BA<BC<BS），故与「依次试 12 个、首个命中即返回」逐字节等价。首字符不属于任何模式的首字符集合时 12 个必然全失配 ⇒ 直接返回 null 亦等价。

## 等价性（逐字节）

- 27 份 `parseWithFormat` 落盘 JSON：`cmp` **完全一致**（16,247,039 字符；两路 shasum 均 `8f127d0bdbb0a63718a5663f48d267972c753b0e`）。

## 性能证据（同进程配对端到端，正反交错）

- `r149-paired.mjs`（baseline `/tmp/r158-head.mjs` vs cand `/tmp/r158-cand.mjs`）：
  - **400 对**（load ≈5.3）：baseMedian 77.124 / candMedian 72.993ms，**中位比值 0.94269（候选快 5.73%）**；**均值比值 0.94345（快 5.66%）**，**胜 356/400（89.0%）**。
  - **800 对**（load ≈4.9）：baseMedian 78.156 / candMedian 73.611ms，**中位比值 0.94369（候选快 5.63%）**；**均值比值 0.9557（快 4.43%）**，**胜 676/800（84.5%）**。
- 两轮规模中位/均值同向且几乎重合，胜率 84–89%，**无 400→800 符号翻转**；分派版实测（0.9437）已接近上限探针（0.9435），说明该类开销**几乎全部**来自「必然失配的正则调用」，而非下游连锁。
- 绝对量：中位 −4.38ms/轮（78.2 → 73.6ms）。高负载（load>3）下按协议采信同进程配对差与 min 口径，不做跨会话绝对值比较。

## 护栏（`tests/textHeuristics.round158.test.ts`，5 项）

- **P1 合成语料等价**：约 90 条覆盖 6 个分派组（含每组边界与失配、缩进、纯失配）的输入，`detectListInfo` ≡ 改动前「依次试 12 个」的逐行转写参照实现。
- **P2 随机模糊等价**：xorshift32 可复现 PRNG 生成 **5,000 条**混合字母表字符串（含各类首字符、空白、全角空格、制表符），逐条与参照实现深度相等。
- **P3 非空转**：语料确实覆盖 `decimal / lower-alpha / upper-roman / lower-roman / cjk-ideographic / disc / square` 全部 listStyle，且有 `listLevel > 0` 的缩进命中。
- **P4 接线元断言**：源码含 `const c0 = trimmed.charCodeAt(0)`、`const c1 = trimmed.charCodeAt(1)`，且 **12 个模式一个不少**地仍以 `X.test(trimmed)` 接线。
- **P5 注入骨架鉴别力**：正确骨架与参照实现逐条一致，而三类缺陷（数字上界收窄到 `0x38`、罗马首字母门丢掉 `x/X`、BC/BS 顺序对调）都被检出。
- **离树负控**（注入生产源码）：**A** 数字上界 `0x39`→`0x38` ⇒ 1 项失败；**B** 罗马门丢 `x/X` ⇒ 1 项失败；**C** BC/BS 顺序对调 ⇒ 2 项失败。三组注入后源码均以 `cmp` 校验恢复为**逐字节相同**，恢复后 5/5。

## 门禁

`npm test`（全量）+ `npx vue-tsc --noEmit` + `npm run lint` + `npm run build` + `npm run build:lib` 全通过（test/lint 串行，避免 vitest 临时文件致 eslint ENOENT）。

## 下一轮

Round 159，目标 1000。
