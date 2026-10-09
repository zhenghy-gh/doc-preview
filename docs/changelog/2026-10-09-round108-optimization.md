# Round 108 — 换行切分改 `indexOf` 跳跃 + 图片扫描改查找表分派

本轮先对**未混淆的真实入口 bundle** 重新剖析（Round 107 的改动已落地，分布有变），
再据行级归因筛选候选。最终**采纳 2 项、否决 1 项（外加 2 个变体）**，端到端
**1.047x（约 +4.7%）**。

---

## 一、改动后的剖析分布（未混淆 bundle，60 轮 × 27 样本，7 635 samples）

```
14.09% tryBrokerFileTokenSync（node 内部 / 沙箱 shim）
10.88% createParagraphsWithRealFormats
 9.97% detectCharacterStyles
 8.04% extractImagesFromStream
 6.50% applyStructuralFormats
 6.33% (garbage collector)
 4.83% guessCharFormat
 4.02% detectAlignment
 3.00% bytesToBase64
 2.20% extractFormattedText
 2.19% extractChartsFromWordDocumentStream   ← Round 107 已从 parseFormatRuns 中独立出来
 2.10% mergeCharFormatForParagraph
 2.00% decodeRangeWithoutGuard
 1.26% findJpegEnd
 1.19% detectListInfo
```

**Round 107 的图表扫描改动确实生效**：`parseFormatRuns` 从 5.35 % 降到 0.73 %，
`extractChartsFromWordDocumentStream` 作为独立函数占 2.19 %（其中 1.59 % 是两次
`indexOf` 刷新本身，0.50 % 是初始查找）——合计 2.92 %，低于改动前的 5.35 %。

行级归因（`positionTicks`，按**函数名 + 节点起始行**拆分，避免内联后被错误合并）：

| 函数 | 热点行 | 占比 |
|---|---|---|
| `createParagraphsWithRealFormats` | L7624 `if (i !== text.length && text.charCodeAt(i) !== 10) continue;` | 12.0 % |
| 同上 | L7623 `for (let i = 0; i <= text.length; i++)` | 5.4 % |
| `extractImagesFromStream` | `switch (data[i])` + 四个 `case` 标签 | **66.2 %** |
| `applyStructuralFormats` | 内联进包装方法后全部落在 L8169 | 3.31 % + 2.92 % |

---

## 二、采纳优化 1：段落切分从逐字符扫描改为 `indexOf('\n')` 跳跃

### 起因

`createParagraphsWithRealFormats` 开头把整篇文本按段落标记 '\n'（0x0A）切成 parts：

```ts
let partStart = 0
let partIndex = 0
for (let i = 0; i <= text.length; i++) {
  if (i !== text.length && text.charCodeAt(i) !== 10) continue
  const paraText = text.slice(partStart, i)
  ...
}
```

`i` 从 0 走到 `text.length`，**每个字符**做一次 `charCodeAt` + 比较，只为找 0x0A。
这两行合计占该函数自耗时的 **17.4 %**（≈ 全进程 1.89 %）。

### 密度实测（先量化，再动手）

用 27 份样本解析出的段落文本重建文档文本：**1 491 378 字符 / 34 945 个 '\n'**
→ 密度 **2.34 %**。这个密度按 Round 98/99/100 的经验区间（≥2 % 时 `indexOf` 跳跃
收益归零）看**本该不值得做**——但那条经验是针对「循环体本身很便宜」的场景。
这里循环体是 JS 逐字符 `charCodeAt` + 比较，而 `indexOf` 是原生（SIMD）查找，
**每字符开销差了一个量级**，所以实测仍然是大幅收益。**「密度阈值」不是普适判据，
必须实测。**

### 隔离基准（34 945 段 / 1 491 378 字符，60 轮）

```
OLD  147.9 / 144.4 ms
NEW   38.7 /  37.6 ms   → 3.8x
mismatch 0，产出 34 945 parts
```

### 实现

把切分逻辑抽成**模块级导出的纯函数** `splitTextByParagraphMark(text)`（在
`src/utils/docParser.ts`），方法体只留一行调用——既让护栏能直接差分，也让改动面变小。

```ts
export function splitTextByParagraphMark(
  text: string,
): Array<{ text: string; cpStart: number; originalIndex: number }> {
  const parts: Array<{ text: string; cpStart: number; originalIndex: number }> = []
  let cp = 0
  let partStart = 0
  let partIndex = 0
  let nl = text.indexOf('\n')
  for (;;) {
    const cut = nl < 0 ? text.length : nl
    const paraText = text.slice(partStart, cut)
    const subParts = paraText.includes('\u0007\u0007')
      ? paraText.split(/(?<=\u0007\u0007)/)
      : [paraText]
    let subOffset = 0
    for (const subText of subParts) {
      parts.push({ text: subText, cpStart: cp + subOffset, originalIndex: partIndex })
      subOffset += subText.length
    }
    cp += paraText.length + 1 // +1 for the \n (paragraph mark)
    partStart = cut + 1
    partIndex++
    if (nl < 0) break
    nl = text.indexOf('\n', partStart)
  }
  return parts
}
```

**等价性**：原循环 `i` 从 0 走到 `text.length` **含端点**，因此当文本以 '\n' 结尾或为
空串时，末尾必定多产出一个（可能为空的）part；`nl < 0` 分支用 `slice(partStart)`
产出同一个末尾 part，`cp += paraText.length + 1` 也照旧。`\u0007\u0007` 子切分那段
逐字未改。

**踩到的一个坑**：抽函数时第一版写成 `allParagraphs.push(...splitTextByParagraphMark(text))`
——文档可以有数万个段落，`push(...arr)` 的实参个数超过阈值会抛
`RangeError: Maximum call stack size exceeded`（Round 104 的教训），改为直接赋值。

---

## 三、采纳优化 2：图片扫描的稀疏 `switch` 改 256 项查找表

### 起因

`extractImagesFromStream` 逐字节扫描流找图片签名：

```ts
switch (data[i]) {
  case PNG_LEAD: { ... }   // 0x89
  case JPEG_LEAD: { ... }  // 0xFF
  case GIF_LEAD: { ... }   // 0x47
  case BMP_LEAD: { ... }   // 0x42
}
```

四个 case 值在 `[0x42, 0xFF]` 上**极度稀疏**（66 / 71 / 137 / 255，跨度 190 而只有 4 个），
V8 不会为它生成跳转表，而是退化成比较链 —— 实测 `switch` 语句本身（14.7 %）与四个
`case` 标签（15.8 + 13.9 + 12.3 + 9.5 %）合计吃掉该函数自耗时的 **66.2 %**。

### 密度实测

7.14 MB 真实流（WordDocument / Data / 1Table / 0Table 共 72 条）：

```
0x42 BMP(B)  0.3432 %
0x47 GIF(G)  0.1240 %
0x89 PNG     0.1182 %
0xFF JPEG    1.1111 %
合计         1.6965 %   → 98.30 % 的字节可被直接跳过
```

（`0xFF` 密度 1.1 % 解释了为什么 Round 107 的「四锚点 `indexOf` 游标」版本反而更慢
0.90x：跳跃收益抵不过四游标维护开销。）

### 隔离基准（72 条流 / 7.14 MB，30 轮；`find*` 未导出，两端用同样的打桩体，
只隔离**分派**成本）

```
OLD        391.3 / 392.9 ms
NEW        287.5 / 298.3 ms   → 1.34x
NEW2（范围守卫 + 表）  375.6 / 379.1 ms   → 与 OLD 打平，否决
dispatch mismatch 0
```

**被证伪的变体**：在查表前再加一道 `data[i] < 0x42` 的范围守卫（真实流里 59.66 % 的
字节满足）**反而与旧实现打平**——多出的那次比较正好抵消了省下的表读取。

### 实现

```ts
const LEAD_KIND = (() => {
  const t = new Uint8Array(256)
  t[PNG_LEAD] = 1
  t[JPEG_LEAD] = 2
  t[GIF_LEAD] = 3
  t[BMP_LEAD] = 4
  return t
})()

for (let i = 0; i < len; i++) {
  const kind = LEAD_KIND[data[i]]
  if (kind === 0) continue
  if (kind === 1) { /* PNG 分支体，逐字未改 */ }
  else if (kind === 2) { /* JPEG */ }
  else if (kind === 3) { /* GIF */ }
  else { /* BMP */ }
}
```

**等价性**：表只把四个签名首字节映射到四个分支号，其余全为 0；四个首字节互不相同，
因此任一偏移至多进入一个分支 —— 与 `switch` 逐位相同，且**无顺序依赖**。原来的
`continue` 只用于让 `for` 的 `i++` 生效，去掉后语义不变。

**一条可证明的边界**：把某个**非首字节**错映射到某分支号是**无害**的——该分支的第一步
是 `bytesEqual(data, i, <该分支签名>)`，而 `bytesEqual` 会连 `data[i]` 一起比较，
签名首字节就是被错映射的那个字节，于是必然为 false。所以只有「把真首字节映射错 /
映射丢」才会产生行为差异，护栏正针对这两种情况（见下）。

---

## 四、否决：`detectCharacterStyles` 的逐字符对象分配（**已证伪，不要再动**）

`detectCharacterStyles` 占 9.97 %，行级归因显示 L6129 `if (currentStyle) {` 13.3 %、
L6131 `styles.push({...})` 9.5 %、`isSameStyle` 本体 15.6 %，看起来像「每字符分配一个
`charStyle` 对象」的锅。于是设计了「用整数键（fontName 码 × underline）比较，只在样式
真正变化时才物化对象」的版本：

```ts
// fnCode: 0 = 无 fontName（空白）, 1 = 'Times New Roman', 2 = '仿宋', 3 = '宋体'
const same = (curFn === 0 || fnCode === 0) ? (curUl === ul) : (curFn === fnCode && curUl === ul)
```

（注意 `isSameStyle` 的语义**不是等价关系**：任一 `fontName` 为 `undefined` 时只比
`underline`，因此 A≈B、B≉C 但 A≈C —— 键比较必须显式复刻这条。）

**等价性成立**（mismatch 0，33 819 段有产出），但**性能反向**：

```
OLD            1566.1 / 1604.5 ms
NEW（辅助函数） 2149.6 / 2152.4 ms   → 1.39x **更慢**
NEW2（内联物化）2174.5 / 2205.3 ms   → 同样更慢
```

结论：**V8 已经把「每字符一个短命对象字面量」的开销抹掉了**（对象形状稳定、
分配是 bump 分配，且 `charStyle` 只在比较里用、可被逃逸分析/标量替换消掉），
而我的版本多出的标量簿记与分支反而更贵。**剖析的行归属在这里是误导性的**
——L6129 那 13.3 % 不是分配成本。按纪律否决，未落地任何生产代码。

---

## 五、常驻护栏（2 份 / 12 项）与鉴别力

### `tests/docParser.newlineSplit.test.ts`（5 项）

- 参照实现 `referenceSplit` 是**改动前**的逐行转写（i 走到 `text.length` 含端点）。
- 固定用例 25 个（空串、首/尾/连续 '\n'、`\u0007\u0007` 表格行、CRLF、代理对、emoji）；
- **穷尽**：长度 ≤ 4 的 `{a, \n, \u0007}` 字母表全枚举；
- **随机** 3000 组（长度 ≤ 80，含 `\n` / `\r` / `\u0007` / `\u0000` / CJK / emoji）；
- **长文本**：10 万字符 / 5000 段；
- **非空转**断言：part 总数 > 0、≥3 段的用例 ≥5 个，并校验 CP 不变式
  （同 `originalIndex` 的相邻 part 相差前一 part 长度；跨 `originalIndex` 再多加 1）。

### `tests/imageExtractor.dispatch.test.ts`（7 项）

不转写 `find*`（改动未触及），而是用**最小合法图片字节**驱动真实的
`extractImagesFromStream`：PNG（签名 + length=0 的 IEND chunk）、JPEG（SOI+EOI）、
GIF（GIF87a + 7 字节 LSD + 0x3B）、BMP（BM + size=54 + 填充）。

- 四种格式各自单独出现时都能被识别（**首字节映射未丢**）；
- 四图混排顺序与数量正确；5 种排列都得到对应序列（**无分支互换**）；
- **非空转**：确实产出 4 张图；
- 全部 256 个字节值循环三次 → **零误报**；
- 只有签名首字节、没有后续字节 → 零误报；
- 签名明显不完整（PNG 截到 12 字节等）→ 零误报。

### 鉴别力（负控，4 组）

| 负控 | 注入 | 结果 |
|---|---|---|
| 1a | `partStart = cut`（切点不前进） | **进程被 SIGTERM**（`indexOf` 反复命中同一个 `\n` → 死循环被 OOM kill），**非形式化捕获** |
| 1b | `partStart = cut + 2`（切点偏移一格） | **4 failed / 1 passed** ✓ |
| 2a | `t[PNG_LEAD] = 4`（映射到 BMP 分支） | **4 failed / 3 passed** ✓ |
| 2b | `t[GIF_LEAD] = 0`（映射丢失） | **4 failed / 3 passed** ✓ |

负控 1a 与 Round 107 的负控 B 同类：**结论靠「进程无法跑完」而非断言输出**，
属非形式化证据，已如实标明。

### 护栏自身修的两处错

1. CP 不变式的第一版写成「`cpStart` = 此前所有 part 长度 + 1 之和」——错了，
   `\u0007\u0007` 再切出的同一 `\n`-part 内相邻 part 只相差**前一个 part 的长度**。
2. 「截断的签名」用例第一版用 `PNG.subarray(0, 19)`（只砍 1 字节）——`findPngEnd`
   **不校验 CRC**，少 1 字节的 PNG 仍被判定为完整（**这是改动前就有的行为**），
   改用明显不足的 `subarray(0, 12)`。

---

## 六、端到端验证

27 份样本 / 7.6 MB 语料，独立进程，`git stash` 切换源码分别打包（各 15 轮/进程），
**交错重复 4×NEW / 4×OLD**：

```
NEW 中位数: 119.6 / 119.0 / 119.2 / 122.1 ms   （中位数之中位数 ≈ 119.4）
OLD 中位数: 125.0 / 124.0 / 125.1 / 126.1 ms   （中位数之中位数 ≈ 125.05）
→ 端到端 ≈ 1.047x（约 +4.7%）

NEW 最小值: 115.1 / 116.0 / 116.1 / 117.0 ms
OLD 最小值: 121.8 / 121.0 / 121.1 / 122.4 ms
→ 按最小值 ≈ 1.048x
```

四组 NEW 与四组 OLD 各自紧聚且清晰分离。

**一个必须记下来的观察**：同一份「OLD」（即 0.7.51 的代码）在 Round 107 的会话里
量到中位数 ≈ 130.8 ms，本次会话量到 ≈ 125.05 ms——**跨会话有约 4.4 % 的机器漂移**。
这正好说明「交错重复 + 同会话对比」是必需的；单看某一轮的绝对毫秒数会得出错误结论。

---

## 七、等价性证据

1. **端到端逐字节一致（最强）**：27 份 `parseWithFormat()` 的**完整结果**（含段落、
   格式、图片 data URL）序列化后 `cmp`——**27 文件 / 16 247 039 字节，0 处差异**。
2. **常驻差分护栏 2 份 / 12 项**（见上）。
3. **隔离差分**：切分 mismatch 0（34 945 parts）；图片分派 mismatch 0（72 条流）。
4. **负控 4 组**（见上）。
5. 全量测试 / 类型 / lint / 构建 / bench-diff：见下方清单。

---

## 八、验证清单

- `npx vitest run tests/docParser.newlineSplit.test.ts tests/imageExtractor.dispatch.test.ts` → **12 passed**
- `npm test` → **72 文件 / 1428 项**通过（较 Round 107 的 70/1416 **+2 文件 +12 项**）
- `npx vue-tsc --noEmit` → 0 错误
- `npm run lint` → 0 错误
- `npm run build` / `npm run build:lib` → 通过
- `node bench-diff.mjs 1080` → 27/27 解析成功，0 失败，与 `cycle-1070` 零新增回归
- 端到端解析：OLD ≈ 125.05 ms → NEW ≈ 119.4 ms（**约 4.7%**）
- 端到端逐字节：27 文件 / 16 247 039 字节 `cmp` 完全相同

---

## 九、指标

| 改动 | 隔离收益 | 端到端证据 |
|---|---|---|
| `splitTextByParagraphMark`（`indexOf` 跳跃） | **3.8x**（147.9 → 38.7 ms） | mismatch 0 / 34 945 parts |
| `extractImagesFromStream`（查找表分派） | **1.32x**（374.6 → 283.8 ms） | mismatch 0 / 72 条流 |
| **合计端到端** | — | **1.047x（约 +4.7%）** |

- 类型/体积：`dist-lib/doc-preview.js` raw 351.72 → **351.78 kB**、gzip 94.58 →
  **94.61 kB**（**+0.03 kB gzip**）；`dist-lib/doc-preview.umd.cjs` raw 262.62 →
  **262.72 kB**、gzip 82.79 → **82.82 kB**。体积增长已论证：+0.03 kB gzip 换 4.7 % 端到端。

## 十、清理的临时产物

`.prof108-entry.ts`、`.prof108-bundle.mjs`、`.prof108-analyze.mjs`、`.prof108-lines.mjs`、
`.prof108-nodes.mjs`、`.prof108/`、`.bench108-density.ts`、`.bench108-density.mjs`、
`.bench108a.ts`、`.bench108a.mjs`、`.bench108b.ts`、`.bench108b.mjs`、`.bench108c.ts`、
`.bench108c.mjs`、`.e2e-new.mjs`、`.e2e-old.mjs`（16 项）。

## 十一、发布

版本 `0.7.51 → 0.7.52`，双包已发布。

## 十二、下一轮候选

- `createParagraphsWithRealFormats`（10.88 %）仍是最大单项。剩余可动的是
  L7815–7817 的「spread + 解构 rest」（占该函数 14.3 %）——但要注意 Round 107 的
  隔离基准（spread+delete 1271.9 → rest 674.0 ms）与实际剖析口径不一致，需要
  **在真实对象上**重新 A/B（Round 103 教训）。
- `detectCharacterStyles`（9.97 %）已证伪「去分配」路线，需换角度。
- `extractImagesFromStream`（8.04 %）分派已优化；剩余大头是 `findJpegEnd` 的
  **数据相关**扫描（1.26 %），无安全跳跃方式。
- `applyStructuralFormats`（6.50 %）内部行很分散，未找到集中热点。
- `mergeCharFormatForParagraph`（2.10 %）的二分查找与格式归并。

**已被证伪、不要动**：`detectCharacterStyles` 键比较去分配（慢 1.39x）；图片扫描
「范围守卫 + 表」（与旧实现打平）；`imageExtractor` 四锚点游标（0.90x）；段落格式
共享文本上下文（真实样本慢 19–23 %）；OLE 层 `readRegularStream`（1.16 %）；
Round 103 七条证伪项；`DATE_TIME_RE` 已删；Round 104–108 的重复遍历合并已完成。
