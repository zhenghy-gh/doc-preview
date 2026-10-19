# Round 173/1000 — 2026-10-19 — 采纳（`splitTextByParagraphMark` 把 `\u0007\u0007` 分支提到循环外，去掉每段的单元素数组 + 迭代器）——版本 0.7.85 → 0.7.86

> 结论：**技术采纳，版本 0.7.85 → 0.7.86。**（发布仍暂停，闭环 = 代码 + 护栏 + 验证 + 提交。）27 份 `parseWithFormat` 16,247,039 字符**三路逐字节一致**（SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`；esbuild 基线 == esbuild 候选 == 构建后 dist-lib）。同进程配对端到端**三组样本**（3000 / 2000 / 2000 对）：medianRatio **0.99480 / 0.99074 / 0.99117**，胜率 **54.40% / 58.40% / 58.60%**，**三组 medianRatio 全部 < 1、无符号翻转**。护栏 `tests/docParser.round173.test.ts` **13 项** + **五组**离树负控全部检出。
>
> **诚实标注（边界情形）**：三组合并 **3972/7000 = 56.74%**，**略低于 57% 采纳阈值**；但第一组跑在 load **18.45** 的高负载下（R146：高负载独立进程中位数失真），而两组低负载样本（load≈4）为 **58.40% / 58.60%**，合并 **2340/4000 = 58.50%**，且 medianRatio 与 meanRatio 均 < 1。判据取「两组干净样本 > 57% + 三组无符号翻转 + 机制为真实工作削减」，故采纳；量级记为 **≈0.9%**（保守）。

## 前提

post-172 HEAD 重建 bundle 重剖析（60 轮，**61.30 ms/轮**，3,548 samples；R172 已撤回，源码等同 post-171）。自耗前 12：`createParagraphsWithRealFormats` 11.56%、GC 10.51%、`buildMagicScanIndex` 6.71%、`applyStructuralFormats` 6.17%+4.54%、`decodeRangeWithoutGuard` 4.82%、`mergeCharFormatForParagraph` 3.64%、`bytesToBase64` 3.58%、`extractFormattedText` 3.38%、`parseChpxGrpprlWithFont` 2.99%、`parsePapxGrpprl` 2.62%。

**先否掉一个候选（查一眼即可，省一轮）**：`cleanParagraph` 的 `JUNK_PREFIX_RE` 是 `^[…]+` **锚定**字符类 —— 首字符不是垃圾字符时正则**本就 O(1) 失败**、`replace` 返回原串不分配，加 O(1) 首字符门无收益。

随后在**行级第 14–40 名**里找到本轮目标：`L7323`（`splitTextByParagraphMark` 内的 `subParts` 行）**0.73%**。

## 候选：`splitTextByParagraphMark` 的 `\u0007\u0007` 分支外提

### 动机

Word 表格行以 TTP 标记（0x07）而非段落标记（0x0D）结尾，整张表会粘在同一个 `\n`-part 里，故需在每个行边界（**连续两个**单元格标记）后再切一刀。原实现**无条件**先造一个单元素数组再迭代：

```ts
const subParts = paraText.includes('\u0007\u0007')
  ? paraText.split(/(?<=\u0007\u0007)/)
  : [paraText]
let subOffset = 0
for (const subText of subParts) { … }
```

实测 34,945 段/轮里含 `\u0007\u0007` 的**极少** ⇒ 99%+ 的段落白付：① 一次单元素数组分配 ② 一次 `for...of` 迭代器协议 ③ 一次 `subParts` 变量间接。

### 候选

```ts
if (paraText.includes('\u0007\u0007')) {
  let subOffset = 0
  for (const subText of paraText.split(/(?<=\u0007\u0007)/)) {
    parts.push({ text: subText, cpStart: cp + subOffset, originalIndex: partIndex })
    subOffset += subText.length
  }
} else {
  parts.push({ text: paraText, cpStart: cp, originalIndex: partIndex })
}
```

### 等价性（可自证）

无 `\u0007\u0007` 时原 `subParts` 恒为 `[paraText]` ⇒ 循环只 push 一次，且 `cpStart = cp + 0 = cp` ⇒ 与直接 push **逐字段相同**（`text`/`cpStart`/`originalIndex` 全等）。

> **注意这不是「更短的写法」（对照 R172 教训 13）**：它删掉的是**每个段落一次数组分配 + 一次迭代器协议**，属于「少做一件事」；`includes('\u0007\u0007')` 的扫描**照旧保留**（那是真实工作，不能省）。

## 等价性（逐字节）

- 27 份 `parseWithFormat` 序列化后 `cmp` **逐字节一致**，16,247,039 字符，SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`（dump 16,261,351 字节）。
- **三路互核**：esbuild 基线 == esbuild 候选 == **构建后 `dist-lib/doc-preview.js`**，三份 dump SHA-1 全同。
- **实现标记核对**（陷阱 B）：基线 bundle `subParts` 计数 **2**，候选 **0**。
- **构建确定性**：最终源码重建的候选 bundle == 跑端到端证据的候选 bundle（**325,396 B**）；基线 325,325 B。

## 性能证据（同进程配对端到端，正反交错）

| 样本 | 对数 | load | **medianRatio** | meanRatio | **胜率** | baseMedian / candMedian |
|---|---|---|---|---|---|---|
| 1 | 3000 | **18.45** | **0.99480** | 1.00265 | **54.40%** | 61.825 / 61.703 ms |
| 2 | 2000 | ≈4.3 | **0.99074** | 0.99733 | **58.40%** | 62.016 / 61.594 ms |
| 3 | 2000 | 4.25 | **0.99117** | 0.99565 | **58.60%** | 61.290 / 60.959 ms |
| 合并 | 7000 | — | ≈0.9922 | ≈0.9985 | **3972/7000 = 56.74%** | — |
| **干净子集（2+3）** | **4000** | ≈4 | ≈ **0.9910** | ≈0.9965 | **2340/4000 = 58.50%（z≈10.8）** | −0.55 ~ −0.57 ms |

**判读**：三组 medianRatio **全部 < 1**（0.99480 / 0.99074 / 0.99117），**无符号翻转**；两组干净样本胜率 **58.4% / 58.6%** 均高于 57% 阈值，medianRatio 与 meanRatio 一致为正。第一组（54.40%）跑在 load 18.45 下，按 R146 纪律不作为定值依据。量级 **≈0.9%**。

## 护栏（`tests/docParser.round173.test.ts`，13 项）

> **本轮护栏比 R171/R172 更强**：A 组不是「本地 oracle vs 本地 oracle」，而是**直接对生产函数 `splitTextByParagraphMark` 做差分**（拿逐行转写的旧实现当 oracle）⇒ 对「生产代码被改错」**有真实鉴别力**（负控实测：N2/N3/N5 均被 A 组 + B1 双重抓住）。

- **A 组（生产函数差分）**
  - A1 穷举 16 种文本形状（空串 / 纯换行 / 单/双单元格标记 / 混合 / 长串 / 表格行 + 换行）；
  - A2 **随机模糊 2,000 条**，并断言随机集里含 `\u0007\u0007` 的 >10、含 `\n` 的 >100（两条分支都被覆盖）；
  - A3 **绝对锚点**：`'ab\u0007\u0007cd\nnext'` 的 parts 文本 / `cpStart` / `originalIndex` 逐项固定，并断言「同 part 内逐段相接、跨 part 再加 1」。
- **B 组（真实语料）**
  - B1 27 份全量 **SHA-1 锚定 `8f127d0b…`** + chars **恰 16,247,039**；
  - B2 真实语料里含 `\u0007\u0007` 的段落确实存在（总段落 >30,000 且命中 >0）。
- **D 组（骨架负控）**：`round173SplitSkeleton(text, mode)`，模式 `ok | forgetSubOffset | neverSplit`。
  D1 正控；D2 从不切表格行；D3 忘记 `subOffset` 累加（**并显式记录「单子段输入对这条缺陷零鉴别力」**）；**D4 元断言：无 `\u0007\u0007` 时 `ok` 与 `neverSplit` 输出完全相同**（R164 教训 10 的直接钉子）。
- **C 组（接线元断言）**：C1 `\u0007\u0007` 分支已外提、旧 `const subParts = …` 与 `: [paraText]` 形态**消失**、`subParts` 标识符零出现；C2 常见路径直接 push 且 `cpStart: cp`；C3 表格行分支仍用 lookbehind split 且 `subOffset += subText.length`；C4 循环收尾（`cp += paraText.length + 1` / `partStart = cut + 1` / `partIndex++` / `nl = text.indexOf('\n', partStart)`）未被改动。

## 离树负控（注入生产源码，跑完即还原）

**还原用逐字节回写并断言 sha256 一致**（R161 陷阱 E）。**五组全部检出**：

| 注入 | 性质 | 结果 |
|---|---|---|
| N1 **整体回退为单元素数组形态** | **行为保持型** | **FAIL，3 项**（C1/C2/C3） |
| N2 从不切表格行（`if (false)`） | 行为改变型 | **FAIL，5 项**（A1/A2/A3/B1/C1） |
| N3 忘记 `subOffset` 偏移 | 行为改变型 | **FAIL，4 项**（A1/A2/A3/B1） |
| N4 判据写错（单个 `\u0007` 即切） | **实为行为保持型**（lookbehind 不匹配时 split 返回 `[paraText]`） | **FAIL，1 项**（C1） |
| N5 丢掉 `subOffset += subText.length` | 行为改变型 | **FAIL，5 项**（A1/A2/A3/B1/C3） |

五组注入后源码 sha256 恢复 `a59f6cddf99298e5877dcc6e45d02d4b49d6586bbb58d56b44cb3c5e7e898c1d`（与注入前一致），护栏复跑 **13/13**。

> **N4 是个有意思的发现**：把判据从 `includes('\u0007\u0007')` 放宽到 `includes('\u0007')` **在语义上是等价的** —— 因为当没有 `\u0007\u0007` 时 `split(/(?<=\u0007\u0007)/)` 不匹配、返回 `[paraText]`，与 else 分支结果相同。它只是变慢（多跑一次 split）。**这正好反过来印证本轮的机制**：分支外提省的正是「无谓地走一遍 split + 数组 + 迭代」。

## 门禁与产物

- `npm test`：**1974 / 1974 通过（101 文件）**（R171 为 1961/100；+13 = 本轮新护栏，+1 文件）。test 与 lint **串行**执行。
- `vue-tsc --noEmit`：exit 0。`eslint .`：exit 0。
- `npm run build`：`dist/assets/main-BrLQbGKD.js` 324.17 kB / gzip 111.86 kB；worker 133.56 kB；css 45.47 kB。
- `npm run build:lib`：`dist-lib/doc-preview.js` **372,749 → 372,819 字节（+70 B）**、`dist-lib/doc-preview.umd.cjs` **276,382 → 276,426 字节（+44 B）**（vite 报 gzip 85.13 kB）。
- `node bench-diff.mjs 173`：**cycle-173 与 cycle-171**（上一个**采纳**轮；172 被否决故无 cycle-172）除 `cycle`/`timestamp` 外 **12 个字段全部逐字段相同**，`median` 均 `0.9502433994244857`，`parseSuccess` 27/27。
- **包体记账**：未压缩 esbuild bundle **325,325 → 325,396（+71 B，含说明注释）**；压缩后 dist-lib **+70 B / umd.cjs +44 B**。相对 **≈0.9% 的实测运行时收益**，增量可忽略。

## 下一轮

1. **`applyStructuralFormats` 的 `prefixBodyCounts` 并趟** —— 但须先量「有候选组的文档占比」，否则会变成「总是多分配一个 Int32Array（34.8k × 4B）」；
2. `bytesToBase64`（单行 3.21%）—— 先证 `TextDecoder('latin1')` **不可用**（WHATWG 里 `latin1` 是 windows-1252 别名，0x80–0x9F 会错映射），若不可用则本条关闭；
3. `mergeCharFormatForParagraph`（3.64% + 调用点 3.47%）—— 先用「入口早退探针」量真实占比再决定；
4. `findJpegEnd` 的 `data.indexOf(0xFF, offset)`（0.76%）—— 需先确认是否存在重复扫描同一段 JPEG；
5. `buildMagicScanIndex`（6.71%）、两处 `runs.sort`（1.18%，受 R167 D5 元断言约束）—— 均已在历史轮次判过或受契约约束。

目标 1000 轮。
