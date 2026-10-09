# Round 109 — 图片扫描改「整对跳过」

本轮继续在 Round 108 落地后的分布上找候选。最终**采纳 1 项、否决 4 个变体 + 4 个前置候选**，
端到端 **1.048x（约 +4.8%）**。

本轮最重要的产出不是那 1.34x，而是一条**方法学教训**：同一份实现在**同一会话的不同时刻**
量到 128.7 ms 与 121.5 ms（**约 6 % 的会话内漂移**），只有把「逐字副本」也放进基准才看得出来
（见第五节）。

---

## 一、改动后的剖析分布（未混淆 bundle，7 798 samples）

```
 9.66% detectCharacterStyles
 8.26% createParagraphsWithRealFormats
 7.45% (garbage collector)
 6.75% applyStructuralFormats
 6.25% extractImagesFromStream        ← Round 108 的 8.04 % 已降下来
 4.78% guessCharFormat
 4.44% detectAlignment
 3.10% bytesToBase64
```

行级归因（`positionTicks`，按**函数名 + 节点起始行**拆分）：

| 函数 | 热点行 | 占该函数 |
|---|---|---|
| `detectCharacterStyles` | `isSameStyle` 内联体（`return fn1 === fn2 && …`） | 1.15 % |
| 同上 | `if (currentStyle)` / `styles.push(...)` / `charCodeAt(i)` / 循环头 | 0.83 / 0.82 / 0.69 / 0.64 % |
| `createParagraphsWithRealFormats` | `merged = mergeCharFormatForParagraph(...)` | 1.92 % |
| 同上 | spread + 解构 rest（L7824–7826） | 1.35 % |
| `extractImagesFromStream` | 逐字节 `LEAD_KIND[data[i]]` 循环 | 分散，无单行集中 |

### 前置候选（在动手前就排除的 4 项）

- **`countChineseAndWhitespace` 合并**：两个调用点（`textHeuristics.ts:186` 用 `text`、
  `:475` 用 `trimmed`）是**不同输入**，不可共享一次扫描。
- **`findJpegEnd`（1.24 %）**：数据相关扫描（要跳过 `0xFF00` 转义、找 SOS/EOI），无安全跳跃方式。
- **`applyStructuralFormats`（6.75 %）**：内部行很分散（最大单行 0.40 %），未找到集中热点。
- **`detectCharacterStyles`（9.66 %）**：Round 108 已证伪「键比较去分配」路线（慢 1.39x），
  本轮未再重复尝试。

---

## 二、采纳：`extractImagesFromStream` 的「整对跳过」

### 起因

Round 108 已把「四个 `bytesEqual` 的线性尝试」换成 `LEAD_KIND` 首字节分流（256 项表），
但**每字节**仍需「一次数组读取 + 一次比较」。真实流里 98.3 % 的字节不是任何签名的首字节，
所以「两个字节一起判定、都不像首字节就前进 2」应当再省一半。

### 隔离基准（72 条真实流 / 7.49 MB，交错 9 轮取中位数）

```
OLD（git show HEAD: 逐字切片）  162.7 / 163.2 / 163.6 / 163.9 ms
NEW（当前 src）                 121.5 / 128.4 / 128.7 ms        → 1.34x
mismatch 0，产出 125 张图片
```

### 实现

```ts
const PAIR_HAS_LEAD = (() => {
  const t = new Uint8Array(65536)
  for (const lead of [PNG_LEAD, JPEG_LEAD, GIF_LEAD, BMP_LEAD]) {
    for (let lo = 0; lo < 256; lo++) t[(lead << 8) | lo] = 1   // 高字节 == lead
    for (let hi = 0; hi < 256; hi++) t[(hi << 8) | lead] = 1   // 低字节 == lead
  }
  return t
})()

export function extractImagesFromStream(data: Uint8Array): ExtractedImage[] {
  if (!data || data.length < 8) return []
  const images: ExtractedImage[] = []
  const len = data.length
  let i = 0

  // 主循环只处理「有配对」的位置（i ≤ len - 2）；末字节在循环后单独收尾。
  while (i + 1 < len) {
    if (PAIR_HAS_LEAD[(data[i] << 8) | data[i + 1]] === 0) { i += 2; continue }
    const end = pushImageAt(data, i, len, images)
    i = end > i ? end : i + 1
  }
  if (i < len) pushImageAt(data, i, len, images)

  return images
}
```

`pushImageAt(data, i, len, images)` 是把原来的四个分支体抽成的**纯推进函数**：
命中就 push 并返回结束偏移，否则返回 `-1`。抽函数本身也带来收益（见下）。

### 等价性

只有「两个字节都**不是**首字节」时才会跳过；此时逐字节版本在这两个位置上都只会走
`kind === 0 → continue`，没有任何副作用。所以**被跳过的每一步都是逐字节版本的空转**，
扫到的位置集合与产出完全一致。三条附带性质：

1. 表只映射「是否含首字节」，不含任何签名顺序依赖；
2. 表对**调换高低字节是对称的**，所以索引的字节顺序不影响结果；
3. 边界：末字节（`i + 1 === len`）没有配对，由循环后的单字节收尾处理，不会被漏掉。

---

## 三、被否决的 4 个变体

| 变体 | 形态 | 实测 | 处置 |
|---|---|---|---|
| **W1g** `Uint16Array` 视图 + 奇偶守卫 | 一次 `u16[i>>1]` 代替两次字节读取 | **118.7 ms，与不带视图完全打平** | 否决：`byteOffset` 奇偶取决于 OLE 扇区偏移（本次样本 72/72 偶数属巧合），加上守卫后收益被比较抵消，白背一个对齐前提 |
| **V_oob** 去掉 `i + 1 < len` 守卫 | 靠 `data[len]` 越界返回 `undefined`（`ToInt32` = 0）参与位或 | **1.156x（140.6 ms）** | 否决：语义等价但**更慢**，越界读取不便宜 |
| **V1** 分支内 `i = end; continue` | 第一版生产形态（无辅助函数） | **1.249x（130.2 ms）** | 改进为辅助函数形态后 **1.339x**，**+7.8 %** |
| **V2** 2 字节合并表（早期合成语料基准） | 只看「无命中快速跳过」 | 1.87x | 只作方向筛选，真实结构下不可复现，未采信 |

`W1g` 那条值得单记：**`Uint16Array` 视图在理想情形下确实更省一次读取，但把它变成安全代码
所需的奇偶守卫正好吃掉全部收益**——所以选没有对齐前提、也不需要 `try/catch` 回退的形态。

---

## 四、常驻护栏与鉴别力

### `tests/imageExtractor.pairSkip.test.ts`（5 项）

不转写 `find*`（本轮未触及），用**最小合法图片字节**（与 Round 108 护栏同源）驱动真实的
`extractImagesFromStream`，断言一律写成「**恰好 1 张且字节完全相同**」——既抓漏报也抓误报。

1. **偏移 0..9 × 8 种填充字节**（320 组）：填充字节刻意取遍四个签名首字节（`0x89` / `0xff` /
   `0x47` / `0x42`）与若干普通值，覆盖「填充与图片首字节相邻」「填充自身成对」两种形态。
2. **穷尽 65536 个字节对**：缓冲区最前面放 `(b0, b1)`，紧随其后是最小 JPEG `FF D8 FF D9`。
   只有「含 `0xff` 的字节对被误判为不含」时才会漏。
3. **穷尽长度 ≤ 3 的首字节前缀**（`{0x00, 0x01, 0x0a, 0x42, 0x47, 0x89, 0xff}`，399 组）：
   覆盖连续首字节。
4. **末字节边界**：长度 0..9 不越界、不误报。
5. 多图顺序与去重（命中后从 `end` 继续）。

### 鉴别力（负控，5 组）

| 负控 | 注入 | 结果 |
|---|---|---|
| 1 | 表只标记「高字节 == lead」的一半（漏掉低字节分支） | **3 failed / 2 passed** ✓ |
| 2 | 表全部填 1（**更慢但等价**） | **5 passed**（正确地零差异）✓ |
| 3 | 跳过 3 字节（`i += 3`） | **3 failed / 2 passed** ✓ |
| 4 | `i += 1`（**更慢但等价**） | **5 passed**（正确地零差异）✓ |
| 5 | 只标记「签名的前两个字节」这一对（看似合理的设计） | **4 failed / 1 passed** ✓ |

报错信息精确到具体输入，例如 `png padLen=1 pad=0x0: expected 0 to be 1`、
`字节对 (0x42, 0x0) 出错：产出 0 张`。

---

## 五、**本轮最重要的教训：会话内也有约 6 % 漂移**

第一版生产实现（`V1`，分支内 `i = end; continue`）在基准里量到 **130.2 ms**。
把它改成辅助函数形态（`pushImageAt` + 末字节收尾）后，**import 进来的生产实现**仍然量到
**128.7 ms**，而同文件内联的等价写法 `V_tail` 是 **120.8 ms**——看起来像是「抽函数没用」。

于是把当前 `src` 的实现**逐字**搬进基准（只重命名标识符，记为 `V_prod`）作为对照：

```
OLD     162.7 ms
NEW     121.5 ms   （import 的生产实现）
V_prod  120.6 ms   （逐字副本）
V_tail  119.5 ms   （同文件内联）
```

**三者一致**。也就是说，先前那 128.7 ms 不是算法差异，而是**同一实现在不同时刻的会话态漂移**
（JIT 分层、GC 时机、后台负载）。复跑确认 NEW/OLD 稳定在 **1.339x / 1.359x**。

**纪律**：隔离基准里**不能只 import 一份被测实现**——必须同时放一份**逐字副本**当对照。
若两者相差超过噪声，说明测到的是会话态而不是算法。（这条与 Round 108 的「跨会话 4.4 % 漂移」
是同一现象的两个方向：跨会话漂移要交错重复，会话内漂移要同轮内放副本。）

---

## 六、端到端验证

27 份样本 / 7.6 MB 语料，独立进程，`git stash` 切换源码分别打包，**交错 6×NEW / 6×OLD，
每个进程 20 轮**：

```
每进程中位数 NEW: 137.6 138.6 127.9 133.5 128.1 132.1  → 中位数 133.5
每进程中位数 OLD: 133.8 140.5 131.4 134.8 144.3 140.7  → 中位数 140.5
→ 中位数之比 1.0524x

每进程最小值 NEW: 123.0 122.0 120.8 127.2 121.9 123.1  → 中位数 ≈ 122.5
每进程最小值 OLD: 126.4 128.4 124.0 123.8 131.3 133.3  → 中位数 ≈ 127.4
→ 最小值之比 1.0439x

全样本中位数 NEW 131.2 / OLD 137.5  → 1.0480x
全样本 p25      NEW 127.3 / OLD 131.4  → 1.032x
全样本 min      NEW 120.8 / OLD 123.8  → 1.025x
```

**四个估计量一致落在 1.03–1.05x**，取 **≈1.048x（约 +4.8 %）**。

### 剖析口径与端到端不符，已查清原因

剖析给 `extractImagesFromStream` **6.25 %**，按此推算端到端只该有约 1.6 %，实测却是 4.8 %。
原因是**该函数每份文档被调用多次、且扫描的字节量远超 6.25 % 所暗示的**：

- `documentAssets.ts:71` 对 **Data 流与 WordDocument 流各扫一遍**（有 `maxScanBytes` 预算）；
- `pictureParser.ts:427` 走 fcPic 结构化路径时再扫一次 Data 流；
- `chartParser.ts:91` 对每个图表流再扫一次。

所以「单函数 tick 占比」低估了它的实际权重。**后续轮次的剖析要拿端到端数字交叉验证**，
不能只看 tick 百分比。

---

## 七、等价性证据

1. **端到端逐字节一致（最强）**：27 份 `parseWithFormat()` 的**完整结果**（含段落、格式、
   图片 data URL）序列化后 `diff`——**27 文件 / 16 247 039 字节，0 处差异**。
2. **常驻护栏 1 份 / 5 项**，含 320 组偏移×填充、穷尽 65536 字节对、399 组前缀穷尽。
3. **负控 5 组**，其中 2 组是「更慢但等价」的阴性对照，正确地零差异。
4. **隔离差分**：72 条真实流 / 7.49 MB，`mismatch 0`，产出 125 张图片（非空转）。
5. 全量测试 / 类型 / lint / 构建 / bench-diff：见下方清单。

---

## 八、验证清单

- `npx vitest run tests/imageExtractor.pairSkip.test.ts tests/imageExtractor.dispatch.test.ts` → **12 passed**
- `npm test` → **73 文件 / 1433 项**通过（较 Round 108 的 72/1428 **+1 文件 +5 项**）
- `npx vue-tsc --noEmit` → 0 错误
- `npm run lint` → 0 错误
- `npm run build` / `npm run build:lib` → 通过
- `node bench-diff.mjs 1090` → 27/27 解析成功、0 失败、0 baseline 缺失，
  与 `cycle-1080` **除 `cycle`/`timestamp` 外逐字段相同**
- 端到端解析：OLD ≈ 140.5 ms → NEW ≈ 133.5 ms（**约 4.8 %**）
- 端到端逐字节：27 文件 / 16 247 039 字节 `diff` 完全相同

---

## 九、指标

| 改动 | 隔离收益 | 端到端证据 |
|---|---|---|
| `extractImagesFromStream` 整对跳过 | **1.34x**（162.7 → 121.5 ms） | mismatch 0 / 125 张图 / 72 条流 |
| **合计端到端** | — | **1.048x（约 +4.8 %）** |

- 类型/体积：`dist-lib/doc-preview.js` raw 351.78 → **352.15 kB**、gzip 94.61 →
  **94.72 kB**（**+0.11 kB gzip**）；`dist-lib/doc-preview.umd.cjs` raw 262.72 →
  **263.01 kB**、gzip 82.82 → **82.92 kB**（+0.10 kB）。
  体积增长已论证：65536 项表是**运行时生成**的（不占包体），进包体的只有约 50 行代码；
  +0.11 kB gzip 换 4.8 % 端到端。

## 十、清理的临时产物

`.prof109-entry.ts`、`.prof109-bundle.mjs`、`.prof109-analyze.mjs`、`.prof109-lines.mjs`、
`.prof109/`、`.bench109a.ts`/`.mjs`、`.bench109b.ts`/`.mjs`、`.bench109c.ts`/`.mjs`、
`.bench109d.ts`/`.mjs`、`.bench109d-gen.mjs`、`.e2e-entry.ts`、`.e2e-new.mjs`、
`.e2e-old.mjs`（**17 项**）。

## 十一、发布

版本 `0.7.52 → 0.7.53`，双包已发布。

## 十二、下一轮候选

- `createParagraphsWithRealFormats`（8.26 %）的 spread + 解构 rest（L7824–7826，占该函数
  1.35 %）与 `mergeCharFormatForParagraph` 调用点（1.92 %）。注意 Round 107 的隔离基准
  与真实剖析口径不一致，**要在真实对象上重新 A/B**。
- `detectCharacterStyles`（9.66 %）需换角度（「去分配」已证伪）。
- `applyStructuralFormats`（6.75 %）内部行分散，需要先做**调用点级**归因而不是行级。
- `bytesToBase64`（3.10 %）的 `String.fromCharCode.apply(null, bytes.subarray(...))` 占该函数
  2.83 %，但 Round 103 已确认分块 0x2000 接近最优、不能用 `Buffer`/`TextDecoder('latin1')`。
- `guessCharFormat`（4.78 %）/ `detectAlignment`（4.44 %）尚未做过行级归因。

**已被证伪、不要动**：`Uint16Array` 视图 + 奇偶守卫（与不带视图打平）；越界读取代替守卫
（1.156x 更慢）；`detectCharacterStyles` 键比较去分配（慢 1.39x）；图片扫描「范围守卫 + 表」
（打平）；`imageExtractor` 四锚点游标（0.90x）；段落格式共享文本上下文（真实样本慢 19–23 %）；
`countChineseAndWhitespace` 合并（两个调用点输入不同）；OLE 层 `readRegularStream`（1.16 %）；
Round 103 七条证伪项；`DATE_TIME_RE` 已删；Round 104–108 的重复遍历合并已完成。
