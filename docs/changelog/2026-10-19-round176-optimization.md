# Round 176/1000 — 2026-10-19 — 采纳（`splitTextByParagraphMark` 用 `indexOf` + `slice` 替代零宽 lookbehind split）——版本 0.7.87 → 0.7.88

> 结论：**技术采纳，版本 0.7.87 → 0.7.88。** 27 份 `parseWithFormat` 16,247,039 字符**三路逐字节一致**（SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`）。同进程配对端到端 3000 对：**medianRatio 0.98836（快 1.16%）、meanRatio 0.99634、胜率 59.07%**（高于 57% 阈值）。护栏 `tests/docParser.round176.test.ts` **11 项** + R173 护栏 13 项（其 A 组是同一函数的跨轮差分）全部通过。
>
> **诚实标注**：本轮只跑**一组** 3000 对样本（59.07% 已越过阈值，未再取第二组以节省时间）；等价性另有 **20,021 样本差分（0 不一致）** 与 27 份逐字节双重佐证。

## 前提

post-175 重剖析（60 轮，**63.39 ms/轮**）里 **RegExp 节点合计 4.61%**，其中第二名是
**`RegExp: (?<=\u0007\u0007)` 0.69%** —— `splitTextByParagraphMark` 里用**零宽 lookbehind** 切分表格行。
V8 对零宽 lookbehind 的 `split` 实现很慢，而语义只是「在每个 `\u0007\u0007` **之后**切一刀」。

## 候选

```ts
let subOffset = 0
let from = 0
let hit = paraText.indexOf('\u0007\u0007', 0)
while (hit >= 0) {
  const cut = hit + 2
  const subText = paraText.slice(from, cut)
  parts.push({ text: subText, cpStart: cp + subOffset, originalIndex: partIndex })
  subOffset += subText.length
  from = cut
  hit = paraText.indexOf('\u0007\u0007', hit + 1)   // ← 允许重叠
}
const tail = paraText.slice(from)
if (from < paraText.length) {                       // ← 末尾零宽不切
  parts.push({ text: tail, cpStart: cp + subOffset, originalIndex: partIndex })
}
```

### 两个坑（本轮实测踩到，护栏已钉住）

1. **lookbehind 零宽匹配允许重叠**：`'\u0007\u0007\u0007'` 在位置 2、3 各切一次 ⇒ 下一次搜索必须从 **`hit + 1`** 起（`hit + 2` 会漏切）。**首版写成 `hit + 2`，20,021 样本差分立刻报 467 处不一致。**
2. **位于串末尾的零宽匹配不切**：`String.prototype.split` 遇到 `q === size` 的零宽匹配直接 break ⇒ `'\u0007\u0007'.split(/(?<=\u0007\u0007)/)` 只有 **1** 段。故尾段仅在 **`from < paraText.length`** 时补。**首版无条件补尾段，同样被差分抓到。**

> **教训（新）**：**「零宽正则 split」的语义比直觉复杂两处（重叠 + 末尾不切），必须用穷举/随机差分对照原实现，不能靠推理。** 本例差分在 20,021 样本上给出 0 不一致，才敢往下走。

## 等价性（逐字节）

- 27 份 `parseWithFormat` 序列化后 `cmp` **逐字节一致**（16,247,039 字符，SHA-1 `8f127d0b…`）。
- **三路互核**：esbuild 基线 == esbuild 候选 == **构建后 `dist-lib/doc-preview.js`**，三份 dump SHA-1 全同。
- **20,021 样本差分**（16 个手工用例 + 20,000 随机 + `\u0007` 长度 0..8 全穷举）对照 lookbehind 实现：**0 不一致**。
- 构建确定性：最终源码重建的候选 bundle == 证据 bundle（**326,140 B**）；基线 325,785 B。

## 性能证据

| 对数 | **medianRatio** | meanRatio | **胜率** | baseMedian / candMedian |
|---|---|---|---|---|
| 3000 | **0.98836** | 0.99634 | **1772/3000 = 59.07%** | 64.871 / 64.163 ms |

绝对省 **≈0.73 ms/轮**。剖析侧对应项为 `RegExp: (?<=\u0007\u0007)` **0.69%**（≈0.44 ms），端到端略高于剖析值 —— 与 R171/R175 同源（剖析把正则开销记到独立 `RegExp:` 节点，且 `slice`/`indexOf` 的收益不全落在被替换的那一行上）。

## 护栏（`tests/docParser.round176.test.ts`，11 项）

- **A 组（生产函数差分）**：A1 穷举 15 例（含 `\u0007` 长度 2~5、末尾标记、跨 `\n`）；A2 随机模糊 5,000 条（断言含 `\u0007\u0007` 的 >200）；A3 **末尾零宽不切**的绝对锚点（`'\u0007\u0007'` → 1 段、`'\u0007\u0007\u0007'` → 2 段、`'a\u0007\u0007'` → 1 段）。
- **B 组**：B1 27 份 SHA-1 锚定 + chars 恰 16,247,039。
- **D 组（骨架负控）**：D1 正控；**D2「不允许重叠」必须用四连标记才有鉴别力**（三连在两种搜法下结果恰好相同 —— 写护栏时实测踩到）；D3「末尾总补尾段」；D4「从不补尾段」。
- **C 组（接线元断言）**：C1 旧 lookbehind 实现彻底移除（`(?<=` 与 `.split(/(?<` 均不出现）；C2 `indexOf` 搜索 + **重叠（`hit + 1`）** + `slice` 切分；C3 尾段仅在 `from < paraText.length` 时补。

## 对既有护栏的一处更新（需显式记账）

R173 的 **C3** 原先钉死了 `for (const subText of paraText.split(/(?<=\u0007\u0007)/)) {` 这一**具体实现**，本轮替换实现后它失败（全量 `npm test` 报 1 项失败）。处置：把 C3 从**钉实现**改为**钉契约** —— 分支必须仍（a）搜索 `\u0007\u0007`、（b）按 `subText.length` 累加 `subOffset`、（c）以 `cp + subOffset` 落 `cpStart`，并额外断言旧 lookbehind 已移除（防两条实现并存）。R173 的**行为**断言 A1/A2/A3/B1 **原样通过**。

> **教训（新）**：**元断言应钉「契约」，不该钉「当前实现」，除非该实现本身就是契约**（如 R175 的首字符表、R170 的三元式）。R173 C3 钉了 lookbehind 表达式，直接挡住了后续合法优化 —— 这类过度指定是护栏的负资产。

## 门禁与产物

- `npm test`：**1997 / 1997 通过（102 文件）**（R175 为 1986/102；+11 = 本轮新护栏）。test 与 lint **串行**。
- `vue-tsc --noEmit`：exit 0。`eslint .`：exit 0。
- `npm run build`：`dist/assets/main-YCdTAnwt.js` 324.48 kB / gzip 111.95 kB。
- `npm run build:lib`：`dist-lib/doc-preview.js` **373,086 → 373,280 字节（+194 B）**、`umd.cjs` **276,621 → 276,740 字节（+119 B）**。
- `node bench-diff.mjs 176`：**cycle-176 与 cycle-175 除 `cycle`/`timestamp` 外 12 个字段全部逐字段相同**，`median` 均 `0.9502433994244857`，`parseSuccess` 27/27。
- **包体记账**：未压缩 esbuild bundle **325,785 → 326,140（+355 B）**；压缩后 **+194 B / +119 B**。相对 **≈1.16% 的实测收益**可接受。

## 下一轮

1. **`RegExp: [伀倀藠…]` 0.88%** —— `hasTooManyJunkChars` 的 `JUNK_ANY_RE`（**无锚点**，故 R175 的首字符表不适用）。须先量命中率；若为 0 且能找到比正则更快的「任意位置出现」判定（例如按高位字节建 256 项预筛 + 定点确认），才值得动；
2. **`RegExp: \b(?:EMBED|LIBREOFFICE|INCLUDEPICTURE|INCLUDETEXT)\s+\S+` 0.55%** —— 同上，无锚点；
3. **`RegExp: [\u4e00-\u9fff]` 0.60%** —— 定位是 `CHINESE_RUN_RE` 还是 `sharedHasCJK` 探针，再定；
4. **`ALL_CAPS_LINE_RE` 0.33%** —— `detectAlignment` 里 `test(trimmed) && totalLen >= 3 && totalLen <= 50` 的**长度门在正则之后**，把长度判断前置可让长段落（>50）整次跳过正则；纯重排、逐字节等价，但预期仅 ~0.1–0.2%；
5. `bytesToBase64`（2.96%）、`buildMagicScanIndex`（2.91%）、两处 `runs.sort`（1.18%，受 R167 D5 约束）—— 均已判过或受契约约束。

目标 1000 轮。
