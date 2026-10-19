# Round 171/1000 — 2026-10-19 — 采纳（`applyStructuralFormats` 的 `prefixBodyCounts` 复用 Step 2 的 `\u0001` 标志位，删掉逐段 `startsWith`）——版本 0.7.84 → 0.7.85

> 结论：**技术采纳，版本 0.7.84 → 0.7.85。**（本轮起按用户 2026-10-19 指令**暂停 npm 发布**，闭环 = 代码 + 护栏 + 验证 + 提交。）27 份 `parseWithFormat` 16,247,039 字符**三路逐字节一致**（SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`；esbuild 基线 == esbuild 候选 == 构建后 dist-lib）。同进程配对端到端**两组独立样本**（2000 / 1000 对）：**medianRatio 0.98581 / 0.98513（快 1.42% / 1.49%）、胜率 62.00% / 62.10%**，**合并 1861/3000 = 62.03%**，无符号翻转。护栏 `tests/paragraphFilter.round171.test.ts` **16 项** + **五组**离树负控全部检出。
>
> 另：本轮顺手**验证了 Round 170 的效果**——上一轮融合的那行在剖析里从 **3.56%**（两行展开 0.96% + 1.07% + 1.53%）降到 **2.14%**，与端到端实测 2.4–2.8% 相符。

## 前提与目标

post-170 HEAD 重建 bundle 重剖析（60 轮，**66.72 ms/轮**，3,883 samples，load≈3.9）自耗前 12：

| 函数 | 自耗 |
|---|---|
| `createParagraphsWithRealFormats` | 11.95% |
| GC | 10.17% |
| `buildMagicScanIndex` | 6.18% |
| `applyStructuralFormats`（类方法包装器 + 真函数） | 5.79% + 5.33% |
| `decodeRangeWithoutGuard` | 4.51% |
| `tryBrokerFileTokenSync`（**沙箱 FS shim，非被测代码**） | 3.91% |
| `mergeCharFormatForParagraph` | 3.50% |
| `extractFormattedText` | 3.43% |
| `bytesToBase64` | 3.35% |
| `parseChpxGrpprlWithFont` | 2.96% |
| `parsePapxGrpprl` | 2.86% |

**先排除**（避免重复劳动）：`buildMagicScanIndex`（R142/143/145/165 已到顶）、`decodeRangeWithoutGuard`（R149 中性）、`bytesToBase64`（R161 已按真实尺寸分布定 `0x800`）、`mergeCharFormatForParagraph`（R166 游标 + R168 证身份键控不可行 + R151 证去分配退化）、两处 `runs.sort`（R132 契约 + R167 D5 元断言钉死）。

**逐行看 `applyStructuralFormats`（11.12%）**：最大单行只有 HYPERLINK 扫描 0.93%，其余全是 0.1–0.7% 的碎片 ⇒ 成本分布在**约 7 趟全段落遍历**的循环开销上。**唯一结构性的合并被顺序依赖堵死**：预清洗（HYPERLINK/域代码）必须整体先于 Step 1，而 Step 1（前 3 段定标题）又必须先于 Step 2 —— 三者无法并趟。

## 本轮候选：`prefixBodyCounts` 复用 Step 2 的 `\u0001` 标志位

### 动机（先量后改，27 份 × 20 轮）

`applyStructuralFormats` 里两处相邻的全段落遍历都要看 `\u0001`：

| 位置 | 判据 | 每轮 |
|---|---|---|
| Step 2（列表检测） | `text.includes('\u0001')`（全串扫描） | 34,800 段，命中 **126** |
| `prefixBodyCounts` | `t.startsWith('\u0001')`（再扫一遍） | 34,800 段，命中 **126**，剖析 **0.46%** |

而 `includes` **严格强于** `startsWith`：`!includes` ⟹ `!startsWith`。⇒ Step 2 的结论可以直接复用。

### 候选（`src/utils/docparser/heuristics/paragraphFilter.ts`）

```ts
const visibleTextLengths = new Uint32Array(paragraphs.length)
const picFlags = new Uint8Array(paragraphs.length)          // 新增

for (let i = 0; i < paragraphs.length; i++) {
  // ……
  if (text.includes('\u0001')) {
    picFlags[i] = 1                                        // 新增：记下「本段含占位符」
    // ……
  }
}

// prefixBodyCounts
for (let i = 0; i < paragraphs.length; i++) {
  let bodyLen = visibleTextLengths[i]                      // 默认直接用 Step 2 的长度
  if (picFlags[i] !== 0) {
    const t = paragraphs[i].text
    bodyLen = (t.charCodeAt(0) === 1 ? t.substring(1) : t).length
  }
  prefixBodyCounts[i + 1] = prefixBodyCounts[i] + (bodyLen > LIST_ITEM_MAX_LEN ? 1 : 0)
}
```

### 等价性（两条，均可自证）

1. **`picFlags[i] === 0` 一侧**：`0` ⟺ Step 2 的 `text.includes('\u0001')` 为假 ⟹ `text.startsWith('\u0001')` 为假 ⟹ 原实现不剥任何字符 ⟹ `text.length === visibleTextLengths[i]`（Step 2 只在**含占位符**时才把它改成「去掉全部占位符后的长度」）。⇒ 直接取 `visibleTextLengths[i]` 与原逻辑**逐位相同**，且**连 `paragraphs[i].text` 都不必再取**。
2. **`picFlags[i] !== 0` 一侧**：仍走原逻辑，只是把 `startsWith('\u0001')` 换成等价的 `charCodeAt(0) === 1`（`'\u0001'` 就是码元 1；空串时 `charCodeAt` 返回 `NaN`，两侧都为 false）。

**索引对齐**：Step 2 与 `prefixBodyCounts` 之间**没有任何 `splice`**（列表着色只写 `paraFormat`/`charFormat`，不增删段落）⇒ `picFlags` / `visibleTextLengths` 的下标与 `paragraphs` 严格一致。

## 等价性（逐字节）

- 27 份 `parseWithFormat` 序列化后 `cmp` **逐字节一致**，16,247,039 字符，SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`（dump 16,261,351 字节）。
- **三路互核**：esbuild 基线 == esbuild 候选 == **构建后 `dist-lib/doc-preview.js`**，三份 dump 的 SHA-1 全同。
- **实现标记核对**（陷阱 B）：基线 bundle `picFlags` 计数 **0**，候选 **3**。
- **构建确定性**：用**最终源码**重建的候选 bundle == 跑端到端证据的候选 bundle（**325,325 B**）；基线 325,141 B。

## 性能证据（同进程配对端到端，正反交错）

`r149-paired.mjs`（`/tmp/r171-head.mjs` vs `/tmp/r171-cand.mjs`，load≈3.9–4.5）。因为预期效应小（剖析只给 0.46%），本轮刻意**加大样本**以提高分辨率：

| 样本 | 对数 | **medianRatio** | meanRatio | **胜率** | baseMedian / candMedian |
|---|---|---|---|---|---|
| 1 | 2000 | **0.98581** | 0.99314 | **1240/2000 = 62.00%** | 64.082 / 63.430 ms |
| 2 | 1000 | **0.98513** | 0.99390 | **621/1000 = 62.10%** | 62.885 / 62.382 ms |
| **合并** | **3000** | ≈ **0.9856** | ≈ 0.9934 | **1861/3000 = 62.03%（z≈13.2）** | −0.88 ~ −0.92 ms/轮 |

**判读**：两组独立样本 medianRatio **几乎重合（0.98581 / 0.98513）**、方向一致、**无符号翻转**，胜率两组均 **62.0%**，远高于 57% 采纳阈值与 ~54% 噪声地板。量级 **≈1.45%**，绝对省 **≈0.9 ms/轮**。

> **为什么剖析只给 0.46%、实测却有 1.45%**：省掉的不止那一次 `startsWith` 调用 —— 还有 `paragraphs[i].text` 的**属性加载**（34.7k 次/轮）与一个额外的循环局部量。这类「属性加载 + 方法调用」组合在剖析里会被拆散记到不同行上，行级自耗系统性低估（与 R158「正则开销不在调用行上」同源）。

## 护栏（`tests/paragraphFilter.round171.test.ts`，16 项）

- **A 组（决策差分）**
  - A1 穷举「占位符位置 × 长度边界」14 例（空串 / 纯占位符 / 前导 / 中部 / 尾部 / 双占位符 / 恰 150 / 151 / 9 / 10）；
  - A2 **前提断言**：不含占位符时 `visibleLen` 必等于 `text.length`（标志位为 0 即可直接复用）；
  - A3 **随机模糊 3,000 条**（字母/中文/占位符/`\u0007`/空白/长串），逐条比对；并断言随机集里含占位符的样本 **>100**（防空转）。
- **B 组（真实语料锚定）**
  - B1 27 份 `parseWithFormat` 全量 **SHA-1 锚定 `8f127d0b…`** + chars **恰 16,247,039**；
  - B2 真实语料里「以占位符开头」的段落确实存在（总段落 >30,000 且 `startsWith` 计数 >0），防改动路径空转；
  - B3 **直接调用 `applyStructuralFormats`**：9 段合成语料（两个 count=3 的候选组 + 前后长正文段 + 含前导占位符的短段），断言被标为列表的段落**落在同一连续区块**（绝对锚点，钉死 `prefixBodyCounts` 参与的打分路径确实被走到）。
- **D 组（骨架负控，证明本文件有鉴别力）**：`round171LenSkeleton(text, hasPic, visibleLen, mode)`，模式 `ok | ignoreFlag | neverStrip | stripAll`。
  D1 正控与 oracle 一致；D2 忽略标志位（**并显式记录「占位符恰在开头时该缺陷零鉴别力」**）、D3 从不剥、D4 剥全部，各自必须偏差；D5 元断言；**D6 行为保持型对照：标志位为 0 时两条路径长度相同**（R164 教训 10 的直接钉子）。
- **C 组（接线元断言，源码文本）**：C1 `picFlags` 声明 + 在 `includes` 分支置位 + **恰 3 处引用**；C2 `prefixBodyCounts` 改读标志位、旧逐段 `startsWith` 形态消失；C3 仍只剥**一个**开头占位符且用 `charCodeAt(0) === 1`；C4 `__hasEmbeddedPic` 置位与 `visibleTextLengths[i] = len` 仍在（未被顺手删掉）。

> **护栏的诚实边界**：本轮 **B1 对「逻辑写错」几乎没有鉴别力** —— 负控 N2/N3/N4 都是真行为改变，但在 27 份语料上**输出不变**（含占位符的 126 段里，没有一段的长度差异会跨过 `>150` 或 `>=1` 这两个阈值）。所以本轮的等价性主要靠 **A 组穷举/随机差分 + 构造性论证**，而**防止改动被静默回退**则完全靠 **C 组源码文本元断言**。这与 R169/R170 的结构一致（A 组 oracle 是本地函数，对生产改动零鉴别力 —— R170 N3 已记）。

## 离树负控（注入生产源码，跑完即还原）

**还原用逐字节回写并断言 sha256 一致**（R161 陷阱 E）。**五组全部检出**：

| 注入 | 性质 | 结果 |
|---|---|---|
| N1 **整体回退为逐段 `startsWith`** | **行为保持型** | **FAIL，3 项**（C1/C2/C3） |
| N2 丢掉标志位分支、一律用 `visibleLen` | 行为改变型 | **FAIL，3 项**（C1/C2/C3） |
| N3 从不剥开头占位符 | 行为改变型 | **FAIL，1 项**（C3） |
| N4 剥掉全部占位符 | 行为改变型 | **FAIL，1 项**（C3） |
| N5 忘记置位标志位 | 行为改变型 | **FAIL，1 项**（C1） |

五组注入后源码 sha256 恢复 `f0f5cca124bdf7810a85e18adc2606e217858e750b5ea6f09a476d6595fbe5ec`（与注入前一致），护栏复跑 **16/16**。

> **N1 延续 R164 通用教训 10**（行为保持型只有源码文本元断言能抓）。**N2/N3/N4 只被 C 组抓住**也印证了上一条「护栏的诚实边界」：它们确实是行为改变，但**在本语料上不可观测** ⇒ 若只靠「比输出」，这三个真 bug 会全部漏检。

## 本轮附带核查（两处「假热点」）

1. **`L446 logger.warn('MiniFAT 链检测到循环')` 0.67%** —— 直接探针（包一层 `console.warn` 计数）实测**该告警在 27 份语料上触发 0 次** ⇒ 该行热度是同函数内相邻代码（MiniFAT 内层 `for`）的**行表塌缩误归因**。**新判据：热点落在「从不执行的语句」上时，先怀疑行表塌缩，再怀疑分支真的被执行。**
2. `detectAlignment` 已被 R164 优化到碎片化（最大单行 `charCodeAt(0)` 0.49%），无可再砍。

## 门禁与产物

- `npm test`：**1961 / 1961 通过（100 文件）**（R170 为 1945/99；+16 = 本轮新护栏，+1 文件）。test 与 lint **串行**执行。
- `vue-tsc --noEmit`：exit 0。`eslint .`：exit 0。
- `npm run build`：`dist/assets/main-DI6PReZL.js` 324.12 kB / gzip 111.85 kB；worker 133.56 kB；css 45.47 kB。
- `npm run build:lib`：`dist-lib/doc-preview.js` **372,621 → 372,749 字节（+128 B）**、`dist-lib/doc-preview.umd.cjs` **276,310 → 276,382 字节（+72 B）**（vite 报 gzip 99.04 kB / 85.13 kB）。
- `node bench-diff.mjs 171`：**cycle-171 与 cycle-170 除 `cycle`/`timestamp` 外 12 个字段全部逐字段相同**，`median` 均 `0.9502433994244857`，`parseSuccess` 27/27。
- **包体记账**：未压缩 esbuild bundle **325,141 → 325,325（+184 B，含说明注释）**；压缩后 dist-lib **+128 B / umd.cjs +72 B**。相对 **≈1.45% 的实测运行时收益**，增量可忽略。

## 下一轮

Round 171 吃掉了 `prefixBodyCounts` 的重复扫描。候选方向：

1. `applyStructuralFormats` 仍 **11.12%** —— 逐行碎片化（最大 0.93%），且**预清洗→Step 1→Step 2 的顺序依赖堵死了并趟**；剩下唯一可试的是 **`prefixBodyCounts` 与 Step 2 并趟**（把 `prefixBodyCounts` 也搬进 Step 2 循环，省一整趟遍历 + 一次 `visibleTextLengths` 回读），但要注意它只在 `candidateGroups.length > 0` 时才有用（多数文档无列表 ⇒ 白算）。**须先量「有候选组的文档占比」**；
2. `createParagraphsWithRealFormats` 11.95% —— 剩余大头是 `mergeCharFormatForParagraph` 调用（4.07%）与 `cleanParagraph`/`detectParagraphFormat`；
3. `bytesToBase64`（单行 2.86%）—— R161 已定 `0x800`，除非能换掉 `String.fromCharCode.apply` 的数组式实参（**须先证 `TextDecoder('latin1')` 不可用**：WHATWG 里 `latin1` 是 windows-1252 的别名，0x80–0x9F 会映射成别的码点）；
4. `buildMagicScanIndex` 6.18% —— R142/143/145/165 已到顶；
5. `decodeRangeWithoutGuard` 4.51% —— 压缩分支 `COMPRESSED_CODES[data[i]]`（0.80%）可试「整段 bulk `set` + 定点修正」，但需处理 `c < 0`（删字符）导致的长度收缩。

目标 1000 轮。
