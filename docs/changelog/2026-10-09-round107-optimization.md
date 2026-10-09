# Round 107 — 剖析驱动的四处热路径优化（图表扫描跳跃 / 字段码守卫 / 占位符长度守卫 / 去 `delete`）

本轮先对**未混淆的真实入口 bundle** 做 CPU 剖析，拿到可读函数名 + 源码行号，再据结果
排序候选。最终**采纳 4 项**、**否决 2 项**（其中 1 项已落地代码后按纪律撤回）。端到端
**1.086x（约 +8.6%）**，是本项目近十轮里端到端收益最大的一轮，也是**第一次让「隔离
收益」与「端到端收益」的量级接近**（3.37x 隔离 → 8.6% 端到端，符合该项在剖析里只占
约 1.85% 的占比）。

---

## 一、起因：用未混淆 bundle 做剖析，拿到源码行号

`dist-lib` 是压缩产物，函数名是 `df`/`Dc`/`rs`/`rh`/`pf`，无法归因。本轮改用 esbuild
以 `--minify=false --keep-names` 重新打包真实入口，跑 `--cpu-prof`（60 轮 × 27 样本，
8 779 samples）。**按函数名聚合时不要带 url**（Round 103 教训：两个 bundle 文件名不同
会让每一行都显示成 ±，前 25 名全是噪声）。结果：

```
12.50% tryBrokerFileTokenSync（node 内部 / 沙箱 shim）
10.84% createParagraphsWithRealFormats
 8.86% detectCharacterStyles
 8.02% (garbage collector)
 7.69% applyStructuralFormats
 7.48% extractImagesFromStream
 5.35% parseFormatRuns
 4.18% detectAlignment
 4.11% guessCharFormat
 2.61% bytesToBase64
```

再按**源码行**（`positionTicks`）深入，发现 `parseFormatRuns` 里有 1.85% 落在
`extractChartsFromWordDocumentStream` 的 `data[offset + 1] === 75` 判断上——即
**图表扫描**藏在调用方 `parseFormatRuns` 的采样里，函数名榜上根本看不到它。

---

## 二、采纳优化 1：`chartParser.extractChartsFromWordDocumentStream` 首字节跳跃

### 锚点密度实测（先量化上界，再动手）

27 份真实 `WordDocument` 流（5.50 MB）逐字节统计：

```
0xd0  0.115 %
0x50  0.528 %
合计  0.643 %   → 99.4 % 的偏移可以被 indexOf 一次跨过
```

密度落在 Round 97/99/100 实测出的「0.08 %–0.13 % 收益 3.5–6.8x」区间附近，值得做。
（对照：`0x00` 在 WordDocument 流里占 31.4 %，任何以它为锚点的方案必然退化——Round 98
曾把密度误记成 0.39 %，由此得出错误结论。）

### 实现（三个可选实现中唯一满足全部硬约束的一个）

```ts
export function extractChartsFromWordDocumentStream(data: Uint8Array): ChartInfo[] {
  const charts: ChartInfo[] = []

  const limit = data.length - 100
  if (limit <= 0) return charts

  // 耗尽哨兵：必须大于任何合法偏移与 limit。
  const EXHAUSTED = data.length + 1
  let oleAt = data.indexOf(0xD0, 0)
  if (oleAt < 0) oleAt = EXHAUSTED
  let zipAt = data.indexOf(0x50, 0)
  if (zipAt < 0) zipAt = EXHAUSTED
  let from = 0

  for (;;) {
    if (oleAt < from) {
      oleAt = data.indexOf(0xD0, from)
      if (oleAt < 0) oleAt = EXHAUSTED
    }
    if (zipAt < from) {
      zipAt = data.indexOf(0x50, from)
      if (zipAt < 0) zipAt = EXHAUSTED
    }

    const offset = oleAt < zipAt ? oleAt : zipAt
    if (offset >= limit) break

    let type: 'oleobject' | 'excel' | undefined
    if (offset === oleAt && data[offset + 1] === 0xCF && data[offset + 2] === 0x11 && data[offset + 3] === 0xE0) {
      type = 'oleobject'
    } else if (offset === zipAt && data[offset + 1] === 0x4B && data[offset + 2] === 0x03 && data[offset + 3] === 0x04) {
      type = 'excel'
    }

    if (offset === oleAt) {
      oleAt = data.indexOf(0xD0, offset + 1)
      if (oleAt < 0) oleAt = EXHAUSTED
    }
    if (offset === zipAt) {
      zipAt = data.indexOf(0x50, offset + 1)
      if (zipAt < 0) zipAt = EXHAUSTED
    }

    if (!type) continue

    let endOffset = offset + 100
    while (endOffset < data.length && endOffset - offset < 10000) {
      if (data[endOffset] === 0 && data[endOffset + 1] === 0 &&
          data[endOffset + 2] === 0 && data[endOffset + 3] === 0) {
        break
      }
      endOffset++
    }

    const chartSize = endOffset - offset
    if (chartSize > 500) {
      charts.push({ /* ...同原实现... */ })
      from = endOffset + 5
    }
  }

  return charts
}
```

三个必须守住的点（都是 Round 97/99/100 换来的教训）：

1. **游标只在被消费后才 `indexOf` 刷新**，绝不每轮取 `Math.min` 重取——否则退化成
   二次方（Round 100：6.7 ms → 940 ms）。
2. **「已耗尽」哨兵是 `data.length + 1`，不能用 `-1`**——`-1 < cursor` 恒真，会导致
   每轮重扫到末尾。
3. **跳跃是条件式的**：只在当前游标落后于 `from` 时才刷新，避免锚点铺满时「每字节一次
   原生调用」（Round 99 全 `0xE0` 退化 5.5x）。
4. 产出图表后原实现是 `offset = endOffset + 4`（`for` 的 `offset++` 再前进一格 = 下一
   考察位 `endOffset + 5`），新实现用 `from = endOffset + 5`，并在循环开头把落后游标
   补齐到 `from`。

### 隔离基准（27 真实流 + 306 合成/边界 = 333 输入，202 个图表产出，mismatch 0）

```
OLD  2314.6 / 2204.3 ms
NEW   674.4 /  664.7 ms   → 3.37x
```

### 常驻护栏 `tests/chartParser.streamScan.test.ts`（5 项）

- 改动前实现**逐行转写**为 `referenceExtractCharts`；
- `buildSynthetic(seed, count)` 用线性同余伪随机生成 300 条随机流，一半埋「长非零区 +
  OLE 签名」以触发真实产出路径；
- `buildBoundaryCases()` 覆盖 0/8/99/100/101 字节与签名紧贴/跨越 `limit`；
- **断言里包含 `produced > 0`**（防空转——Round 100 的空转陷阱）；
- 显式期望值：700 字节全 1 + offset 10 埋签名 → 1 个 `oleobject`、`dataSize === 690`、
  `name === 'Embedded OLE Object 1'`。

---

## 三、采纳优化 2 & 3：`applyStructuralFormats` 的两处守卫

`applyStructuralFormats` 占端到端 7.69%。它对**每个段落**无条件跑三次
`String.replace` 与一次 `String.replace(...).length`，而真实语料里这些模式几乎从不出现。

### 字段码清洗加存在性守卫

隔离基准（34 945 段 × 400 轮）：

```
A baseline 3replace                969.4 ms
B hyperlink-includes + field-test  426.5 ms   ← 采纳
C hyperlink-includes only          235.4 ms
D field-test only                  305.0 ms
```

采纳 B（保留两处守卫；C 虽更快但只守 HYPERLINK 一处，收益/风险比不如 B）。新增
**非全局** `OTHER_FIELD_CODE_TEST_RE`（与 `OTHER_FIELD_CODE_RE` 同形但不带 `g`）：

```ts
const OTHER_FIELD_CODE_RE = /\b(?:EMBED|LIBREOFFICE|INCLUDEPICTURE|INCLUDETEXT)\s+\S+/g
// Round 107：与 OTHER_FIELD_CODE_RE 同形但**不带 `g`**，只用于「是否值得做替换」的
// 前置判断。带 `g` 的正则用 `test()` 会推进 lastIndex，跨调用产生状态，故必须分开。
const OTHER_FIELD_CODE_TEST_RE = /\b(?:EMBED|LIBREOFFICE|INCLUDEPICTURE|INCLUDETEXT)\s+\S+/
```

```ts
if (cleanedText.includes('HYPERLINK')) {
  cleanedText = cleanedText.replace(HYPERLINK_QUOTED_RE, '')
  if (cleanedText.includes('HYPERLINK')) {
    cleanedText = cleanedText.replace(HYPERLINK_BARE_RE, '')
  }
}
if (OTHER_FIELD_CODE_TEST_RE.test(cleanedText)) {
  cleanedText = cleanedText.replace(OTHER_FIELD_CODE_RE, '')
}
```

**等价性**：`\bHYPERLINK` 与 `(?:EMBED|LIBREOFFICE|INCLUDEPICTURE|INCLUDETEXT)` 都要求
字面量出现；字面量不存在时 `replace` 必为空操作。**守卫必须落在该次 `replace` 的输入串
上**——所以 HYPERLINK 的第二个守卫要看「第一次 replace 之后」的串，而不是原串。

### 图片占位符长度守卫

原实现：

```ts
const textToCheck = text.replace(PIC_PLACEHOLDER_RE, '')
if (textToCheck.length < 10) { /* ... */ }
```

占位符 `\u0001` 极稀少，改为：

```ts
const len = text.includes('\u0001')
  ? text.replace(PIC_PLACEHOLDER_RE, '').length
  : text.length
```

实测（34 945 段 × 400 轮）：`replace-always 444.3 ms → guarded 318.9 ms`（**1.39x**）。

### 常驻护栏 `tests/structuralFormatCleanup.test.ts`（4 项）

复刻 4 个正则与 `referenceCleanText` / `referenceVisibleLength`，通过
`(new DocParser(new ArrayBuffer(512)) as any).applyStructuralFormats(paras)` 驱动
（与既有 `tests/docParser.test.ts:1182` 写法一致）。用例：

1. 字段码守卫交互（`INCLUDETEXT HYPERLINK "..."`、`HYPERHYPERLINK "..."LINK ...`、
   `EMB${'HYPERLINK "http://x"'}ED Excel`、`INCLUDE${'HYPERLINK "http://x"'}TEXT` 等 12 例）；
2. 非空转：含字段码段落确实被改写；
3. 占位符长度上界：`\u0001` + `'正'.repeat(150)` → 仍判为列表项；
4. 占位符长度下界：`\u0001` + `'正'.repeat(9)` → 可见长度 9 < 10，不判为列表项。

**鉴别力（负控）**：

- 负控 C（守卫从 `cleanedText` 改为 `para.text`）→ **4/4 仍通过**。已诚实分析并在文件头
  注释记录：HYPERLINK 剥离**只删除字符**，不可能凭空造出紧邻字段关键字的空白，故
  「清洗后命中」蕴含「原串命中」，守卫落两处确实等价。这不是护栏失灵，是那个「bug」
  根本不是 bug。
- 负控 D（`cleanedText.includes('EMBED')`，漏掉 LIBREOFFICE / INCLUDETEXT / INCLUDEPICTURE）
  → **1 failed / 3 passed，成功捕获**。故鉴别力目标定为「守卫漏掉关键字」。

---

## 四、采纳优化 4：`docParser.ts` 去掉 `delete` 造成的字典模式

`createParagraphsWithRealFormats` 内原实现：

```ts
newPara.charFormat = { ...newPara.charFormat, ...merged }
newPara.charFormatFromReal = true
delete newPara.charFormat.styles
```

剖析显示该 `delete` 行占 **1.59%**（`createParagraphsWithRealFormats` 内 self 最高的行
之一）。隔离基准（34 945 对象 × 300 轮）：

```
spread+delete          1271.9 ms
rest-destructure        674.0 ms   ← 采纳
delete-then-spread     4395.2 ms
```

新写法：

```ts
const { styles: _heuristicStyles, ...realCharFormat } = {
  ...newPara.charFormat,
  ...merged,
}
newPara.charFormat = realCharFormat
newPara.charFormatFromReal = true
```

**等价性**：`delete` 后的键集合与顺序（除 `styles` 外）与「解构 rest 时排除 `styles`」
完全一致。`delete` 会把新建对象打成**字典模式**（V8 上比对象展开本身还贵），解构 rest
不改变对象形状。

---

## 五、否决的两个候选（按纪律撤回 / 不落地）

### 否决 A：段落格式共享文本上下文（**已落地代码后撤回**）

- 设想：`detectParagraphFormat` 依次调用 `detectAlignment` 与 `detectListInfo`，二者各做
  一次 `trim()` + 前导空白扫描 → 抽私有 `prepareParagraphText(text)` 返回
  `{ trimmed, leadingSpaces, trailingSpaces, leadingIndentWidth }`，配合私有
  `detectAlignmentWithContext` / `detectListInfoWithContext`。
- 隔离微基准（合成 33 819 段）：NEW ≈ 1 910–2 085 ms vs OLD ≈ 2 229–2 287 ms，看似略快
  （噪声内）。
- **真实样本段落基准（从 27 份样本解析出 34 945 段，2×NEW / 2×OLD 交错）**：

```
NEW: 1267.8 / 1285.4 / 1303.9 / 1284.9 / 1321.0 / 1281.0 ms
OLD: 1073.1 / 1070.6 / 1060.4 / 1072.9 ms
→ NEW 慢约 19–23%
```

- 结论：共享预处理需**同时**准备 trim、首尾空白、缩进宽度，让**短段落**路径更重。已
  `git restore` 撤回全部生产改动，删除新增测试文件 `tests/textHeuristics.paragraphFormat.test.ts`。
  **合成语料与真实语料的结论相反——这是「尺寸/分布必须插桩实测」纪律的又一例。**

### 否决 B：`imageExtractor.extractImagesFromStream` 四锚点游标（未落地）

- 原实现已是「按首字节 switch 分流」（早前优化：3 060 万次 `bytesEqual` → 单次数组读取）。
- 四锚点 `indexOf` 游标版**差分零差异**（45 流，125 张图），但实测：

```
OLD  640.5 / 612.8 ms
NEW  690.9 / 693.5 ms   → 0.90x（更慢，否决）
```

- 原因：`0xFF` 在真实流中密度 1–2.5%，跳跃收益不足以抵消四游标维护开销。

### 已识别但本轮不做

`findJpegEnd` 内层逐字节扫 `0xFF`（熵编码段，1.01%）——这是数据相关扫描，无安全跳跃
方式。`extractImagesFromStream` 里 JPEG/PNG/GIF 三个分支各占 1.17/1.16/1.08%。

---

## 六、端到端验证（真实收益）

27 份样本 / 7.6 MB 语料，独立进程，`git stash` 切换源码分别打包（各 15 轮/进程），
**交错重复 4×NEW / 4×OLD** 以控制机器漂移：

```
NEW 中位数: 129.5 / 127.1 / 134.6 / 132.1 ms   （中位数之中位数 ≈ 130.8）
OLD 中位数: 139.9 / 141.1 / 143.7 / 142.9 ms   （中位数之中位数 ≈ 142.0）
→ 端到端 ≈ 1.086x（约 +8.6%）

NEW 最小值: 124.9 / 123.0 / 122.8 / 125.1 ms
OLD 最小值: 134.6 / 135.7 / 136.1 / 141.6 ms
→ 按最小值 ≈ 1.105x
```

四组 NEW 与四组 OLD 各自紧聚且清晰分离，故 8.6% 是真实的、非噪声的。**这是近十轮里
端到端收益最大的一轮**，也是第一次「隔离收益」与「端到端收益」量级接近——因为本轮是
**多项叠加**，且其中最大的两项（图表扫描、`delete`）在剖析里占比本就不低。

---

## 七、等价性证据

1. **端到端逐字节一致（最强证据）**：把 27 份样本 `parseWithFormat()` 的**完整结果**
   （含段落、格式、图片 data URL）序列化，OLD 与 NEW 各落一份，
   `cmp` **逐字节相同**——**27 文件 / 16 247 039 字节，0 处差异**。
2. **常驻差分护栏 2 份 / 9 项**（见上）：`tests/chartParser.streamScan.test.ts`（5）、
   `tests/structuralFormatCleanup.test.ts`（4）。
3. **护栏鉴别力**：负控 A（游标步进 `offset + 2`）→ 1 failed / 4 passed；
   负控 D（守卫漏关键字）→ 1 failed / 3 passed。负控 B（`EXHAUSTED = -1`）→ 进程被
   SIGTERM（Exit 137，疑似死循环被 OOM kill），**非形式化地被捕获**（结论靠推断，已在
   记录中标明）；负控 C 未被捕获且**证明其为等价改写**（见上）。
4. **全量测试 / 类型 / lint / 构建**：见下方清单。

---

## 八、验证清单

- `npx vitest run tests/chartParser.streamScan.test.ts tests/structuralFormatCleanup.test.ts` → **9 passed**
- `npm test` → **70 文件 / 1416 项**通过（较 Round 106 的 68/1407 **+2 文件 +9 项**）
- `npx vue-tsc --noEmit` → 0 错误
- `npm run lint` → 0 错误
- `npm run build` / `npm run build:lib` → 通过
- `node bench-diff.mjs 1070` → 27/27 解析成功，0 失败，与 `cycle-1060` 零新增回归
- 端到端解析：OLD ≈ 142.0 ms → NEW ≈ 130.8 ms（**约 8.6%**）
- 端到端逐字节：27 文件 / 16 247 039 字节 `cmp` 完全相同

---

## 九、指标

| 改动 | 隔离收益 | 端到端证据 |
|---|---|---|
| `chartParser` 首字节跳跃 | **3.37x**（2314 → 674 ms） | 333 输入 mismatch 0，产出 202 图 |
| `paragraphFilter` 字段码守卫 | 969.4 → 426.5 ms | 4/4 + 负控 D 捕获 |
| 占位符长度守卫 | 444.3 → 318.9 ms（**1.39x**） | 上界 150 / 下界 9 两用例 |
| `docParser` 去 `delete` | 1271.9 → 674.0 ms | 键集合与顺序逐位一致 |
| **合计端到端** | — | **1.086x（约 +8.6%）** |

- 类型/体积：纯控制流改写，净 **+88 −13 行**（3 文件）；
  - `dist-lib/doc-preview.js` raw 351.11 → **351.72 kB**、gzip 94.40 → **94.58 kB**
    （**+0.18 kB gzip**）；
  - `dist-lib/doc-preview.umd.cjs` raw 262.20 → **262.62 kB**、gzip 82.62 → **82.79 kB**。
  - 体积增长已论证：+0.18 kB gzip 换 8.6% 端到端，收益明确。

## 十、清理的临时产物

`.bench107-chart.mjs`、`.bench107c.mjs`、`.bench107c2.mjs`、`.bench107d.mjs`、
`.bench107d2.mjs`、`.bench107del.mjs`、`.bench107i.mjs`、`.bench107p-ole.mjs`、
`.bench107p-run.mjs`、`.bench107p.mjs`、`.prof107-bundle.mjs`、`.prof107b-analyze.mjs`、
`.prof107b.mjs`、`.prof107b/`、`.e2e-new.mjs`、`.e2e-old.mjs`（16 项）。

## 十一、发布

版本 `0.7.50 → 0.7.51`，双包已发布。

## 十二、下一轮候选

- `createParagraphsWithRealFormats`（10.84%）仍是最大单项，但已被反复拆分；
- `detectCharacterStyles`（8.86%）Round 106 刚动过；
- `extractImagesFromStream`（7.48%）—— 大头上是 `findJpegEnd` 的数据相关扫描，
  无安全跳跃方式，但可考察「按首字节分流」是否还能细化为「按前两字节」；
- `parseFormatRuns`（5.35%）、`detectAlignment`（4.18%）、`guessCharFormat`（4.11%）。

**已被证伪、不要动**：`imageExtractor` 四锚点游标（0.90x）；段落格式共享文本上下文
（真实样本慢 19–23%）；OLE 层 `readRegularStream`（1.16%）；Round 103 七条证伪项；
`DATE_TIME_RE` 已删；Round 104/105/106/107 的重复遍历合并已完成。
