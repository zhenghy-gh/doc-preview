# Round 159/1000 — 2026-10-13 — 采纳（删除 `applyStructuralFormats` 中恒为空转的 Step 3.5 循环 + 正文着色循环局部量提升）

> 结论：**技术采纳，版本 0.7.72 → 0.7.73，双包发布。** 27 份 `parseWithFormat` 16,247,039 字符逐字节一致（SHA-1 `8f127d0b…`）；同进程配对端到端 **400 对：中位比值 0.98505 / 胜 274（68.5%）**、**600 对：0.98744 / 胜 351（58.5%）**、**800 对：0.98695 / 均值 0.98927 / 胜 507（63.4%）**，三轮规模同向、**无 400→800 符号翻转**；最终源码重建后复跑 400 对 0.98568（胜 59.0%）。护栏 `tests/paragraphFilter.round159.test.ts` 8 项 + 三组离树负控（N1 1 项、N2 4 项、N3 3 项失败）。

## 前提与目标

在 **post-158 HEAD** 上重建 bundle 并重跑 `--cpu-prof`（60 轮，71.97 ms/轮）。自耗前 12：`createParagraphsWithRealFormats` 13.54%、GC 9.94%、`applyStructuralFormats` **6.61% + 5.61%**（同一函数两处代码对象）、`buildMagicScanIndex` 4.77%、`bytesToBase64` 4.14%、`decodeRangeWithoutGuard` 4.02%、`mergeCharFormatForParagraph` 3.72%、`extractFormattedText` 3.12%、`parsePapxGrpprl` 2.36%、`parseChpxGrpprlWithFont` 2.33%。

**顺带复核 R158 的收益**：把剖析里所有 `RegExp:` 节点单独汇总（`prof-regex.mjs`）——**正则执行时间由 7.01%（R158 前）降到 5.45%**，与 R158 分派改造的预期一致。

**新认识（剖析口径，重要）**：`applyStructuralFormats` 的两个代码对象中，**类方法包装器**（`applyStructuralFormats(paragraphs) { return applyStructuralFormats(paragraphs) }`）独占 6.61% 自耗，且**全部落在那一行 `return` 上**。加 `--no-turbo-inlining` 后仍是 5.87%，`--no-opt` 下仍是 2.98% ⇒ **这不是内联归因的偶然，而是「被内联/被包装的调用把整段被调用方成本记到调用行」**。用「在函数入口提前 `return`」的探针复核：两个节点**同时消失**，且墙钟 71.97 → **63.92 ms/轮（−11.2%）** ⇒ 该函数真实占比 ≈ 11–12%，而**行级归因无法穿透**。

## 量测手段（本轮方法论）

1. **入口早退探针**：`if (globalThis.__EARLY !== 0) return;` 插在函数首行 ⇒ 拿到该函数的**总上限**（−11.2%）。
2. **分步计时**：该函数**每轮只被调用 27 次（1/文档）**，540 次解析共 675 次调用 ⇒ 用 `performance.now()` 逐 Step 计时，开销可忽略，却给出剖析器给不出的**精确分步占比**。
3. **计数插桩**：`mergeCharFormatForParagraph` / Step 3.5 / `buildMagicScanIndex` 的调用次数与内部迭代数。

分步结果（每次调用 ms，675 次调用平均）：

| Step | ms/次 | 占函数 |
|---|---|---|
| 预清洗（HYPERLINK / 字段码） | 0.0743 | 17.7% |
| Step 1 标题 | 0.0008 | 0.2% |
| Step 2 列表分组 | 0.0956 | 22.8% |
| Step 3a 副标题探测 | 0.0015 | 0.4% |
| Step 3b 副标题着色 + 插空行 | 0.0010 | 0.2% |
| **Step 3c 正文着色循环** | **0.1624** | **38.8%** |
| **Step 3.5 短段合并（死循环）** | **0.0296** | **7.1%** |
| Step 3.6 空行插入 | 0.0413 | 9.9% |
| Step 4 图片占位符拆分 | 0.0121 | 2.9% |
| 合计 | 0.4191 | 100% |

## 发现（本轮核心）

### 1. Step 3.5 是**可证明**的死循环

被删循环的唯一触发条件：`prev.text.length > 0 && prev.text.length < 20 && prev.charFormat.fontSize === 12 && !prev.paraFormat.listType && para.text.length >= BODY_MIN_LEN`。

而紧邻其上的 **Step 3c 正文着色循环**会把**每一个**段落改写成 10.5pt 或 18pt，除非命中四个 `continue` 之一：

| 被 Step 3c 跳过的类别 | 该段的字号 | 能否满足 Step 3.5 |
|---|---|---|
| ① `paraFormat.listType` | 保留原值（可能是 12） | **否** —— Step 3.5 自己用 `!listType` 排除 |
| ② `charFormat.fontSize === 28`（标题） | 28 | 否（28 ≠ 12） |
| ③ 副标题行 | 18（Step 3b 已着色） | 否（18 ≠ 12） |
| ④ `text.length === 0`（空段） | 保留原值 | **否** —— Step 3.5 自己用 `text.length > 0` 排除 |

⇒ Step 3 之后不存在「非空 + 非列表 + 恰为 12pt」的段落 ⇒ 条件恒为假。

**实证**：27 份样本 × 20 轮（540 次解析）共 **842,275 次迭代，命中 0 次**。

该循环原本就带 `/* v8 ignore start/stop */`（作者已怀疑其不可达），但**从未被删除**，于是每轮仍白跑 27 × ~1248 次属性访问。

### 2. Step 3c 正文着色循环的可省工作

```js
const _subtitleSet = new Set(subtitleLines)
for (let i = 0; i < paragraphs.length; i++) {
  if (paragraphs[i].paraFormat?.listType) continue
  if (paragraphs[i].charFormat?.fontSize === 28) continue
  if (_subtitleSet.has(i)) continue
  if (paragraphs[i].text.length === 0) continue
  const len = paragraphs[i].text.length
  ...
```

- `subtitleLines` 绝大多数情况为空（空集上 `has(i)` 恒为 false）⇒ 可短路这次 Set 查询；
- `paragraphs[i]` 在守卫链里被取 4 次、`paragraphs[i].text` 被取 2 次 ⇒ 提升为局部量（循环体内只写 `charFormat`/`paraFormat`，**从不写 `text`**，故缓存 `text` 安全）。

段落对象的形状实测只有 **4 种**（86.9% / 10.1% / 1.7% / 1.3%），属**多态**而非巨态，故属性访问本身不算异常慢；收益主要来自减少重复加载与 Set 查询次数。

## 候选实现（生产源码 `src/utils/docparser/heuristics/paragraphFilter.ts`）

1. **删除 Step 3.5 整段循环**，原位置改写为证明注释。
2. **Step 3c 守卫链**：新增 `const hasSubtitleLines = subtitleLines.length > 0`，守卫改为 `if (hasSubtitleLines && _subtitleSet.has(i)) continue`；新增 `const para = paragraphs[i]` 与 `const paraText = para.text`，后续守卫改用局部量。

**等价性论证**：删除的循环在全部输入上恒为空转（见上表）；空集短路是 `false && x ≡ false`；局部量提升只是把不变量（`paragraphs` 在本循环内不发生 `splice`、`text` 不被写）显式化。

## 被否决的候选（备记）

| 候选 | 400 对中位比值 | 否决理由 |
|---|---|---|
| 预清洗两步合并为单个超集正则门（`FIELD_CODE_QUICK_RE` 同时门住 HYPERLINK 与字段码判定） | 0.98559（快 1.44%） | **非严格等价**：门作用于**剥离前**的串，而字段码判定作用于**剥离后**的串；剥离可能把被拆开的两段拼接成 `EMBED` 等字面量。项目自带 `tests/structuralFormatCleanup.test.ts:68` 正是这一类反例 |
| 严密版超集门（只门住 HYPERLINK 块） | 0.99782（快 0.22%） | 收益落在噪声内，不值得引入额外正则 |
| 整体跳过预清洗循环（改行为上限探针） | 0.97897（快 2.10%） | 上限可观但**无法等价地**利用：该循环的两次扫描（`includes('HYPERLINK')` + 字段码正则）在绝大多数段落上都必须执行 |

## 等价性（逐字节）

- 27 份 `parseWithFormat` 落盘 JSON：`cmp` **完全一致**（16,247,039 字符；SHA-1 均 `8f127d0bdbb0a63718a5663f48d267972c753b0e`）。
- 四路互核：**剖析 bundle == 生产源码重建 bundle == 旧 `dist-lib/doc-preview.js` == 重建后的 `dist-lib/doc-preview.js`**，SHA-1 全部相同。

## 性能证据（同进程配对端到端，正反交错）

`r149-paired.mjs`（baseline `/tmp/r159-head.mjs` vs cand）：

| 规模 | baseMedian / candMedian (ms) | 中位比值 | 均值比值 | 胜率 |
|---|---|---|---|---|
| 400 对 | 71.511 / 70.683 | **0.98505**（快 1.50%） | 0.99132 | 274/400 = 68.5% |
| 600 对 | 72.837 / 72.192 | **0.98744**（快 1.26%） | 0.99336 | 351/600 = 58.5% |
| 800 对 | 71.727 / 70.832 | **0.98695**（快 1.31%） | 0.98927 | 507/800 = 63.4% |
| 400 对（**最终源码重建后复跑**） | 75.109 / 74.494 | **0.98568**（快 1.43%） | 0.99596 | 236/400 = 59.0% |

三轮规模同向、无符号翻转；协议要求「所有性能证据必须在最终源码上重跑」，故补跑第四行。

## 护栏（`tests/paragraphFilter.round159.test.ts`，8 项）

- **A1** 改动前 Step 3.5 的**逐行转写**作用在**函数输出**上必须 0 次合并且输出逐字段不变（7 条语料）。
- **A2** **正控**：同一转写在手工构造的 `prev=12pt 短段 + para>=100` 上**必须**合并 1 次 ⇒ 证明转写本身有鉴别力，A1 不是空转。
- **A3** 非空转：语料里确实存在 ≥6 处「<20 字符段落紧邻 >=100 字符段落」的触发形状。
- **B1** 输出不变量：不存在「非空 + 非列表 + `fontSize===12`」的段落。
- **B2** 不变量非空转：`[LONG, LONG, LONG]`（>150 字符，避开列表区间）必须产出 ≥3 个 10.5pt 正文段。
- **B3** 副标题路径（`subtitleLines` 非空）下不变量仍成立且副标题为 18pt。
- **C1/C2** 接线元断言：源码已无被删循环的判定串，且已含空集短路与局部量提升、旧写法不再出现。

**负控（离树注入生产源码，注入后 `cmp` 核验逐字节复原）**：

| 编号 | 注入 | 结果 |
|---|---|---|
| N1 | `const paraText = para.text` → `paragraphs[i].text` | 1 项失败 ✓ |
| N2 | `hasSubtitleLines && _subtitleSet.has(i)` → `\|\|` | 4 项失败 ✓（含行为项） |
| N3 | 删掉 Step 3c 长正文分支的 `fontSize = 10.5` | 3 项失败 ✓（A1/B1 行为项） |

## 门禁与产物

- `npm test` **1763/1763（88 文件）**；`npx vue-tsc --noEmit` 0 错；`npm run lint` 0 告警；`npm run build` + `npm run build:lib` 均通过（test 与 lint 串行执行）。
- `bench-diff.mjs 159` 与 `cycle-158.json` **除 `cycle`/`timestamp` 外逐字段相同**。
- `dist-lib/doc-preview.js` **369,858 → 369,538 字节（−320 B）**；`dist-lib/doc-preview.umd.cjs` 274,394 字节。

## 下一轮

Round 160，目标 1000。方向：Step 3c（函数内最大子步，38.8%）与 Step 2 列表分组（22.8%）；并注意「被包装/内联的调用会把成本记到调用行」这一口径陷阱。
