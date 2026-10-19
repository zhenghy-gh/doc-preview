# Round 170/1000 — 2026-10-19 — 采纳（`createParagraphsWithRealFormats` 的 charFormat「样式基数推迟展开」：两次展开 → 一次三源展开）——版本 0.7.83 → 0.7.84

> 结论：**技术采纳，版本 0.7.83 → 0.7.84，双包发布。** 27 份 `parseWithFormat` 16,247,039 字符**三路逐字节一致**（SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`；esbuild 基线 == esbuild 候选 == 构建后 dist-lib）。同进程配对端到端**两组独立样本**（800 / 1200 对）：**medianRatio 0.97235 / 0.97621（快 2.77% / 2.38%）、胜率 71.50% / 68.67%**，**合并 1396/2000 = 69.80%**，无符号翻转。护栏 `tests/docParser.round170.test.ts` **17 项** + **五组**离树负控全部检出。
>
> 本轮还发现并修正了一个**测量工具缺陷**（陷阱 F）：行级归因脚本未按 `callFrame.url` 过滤，把**其他脚本的同号行**并进了 bundle —— 由此凭空造出两个「热点」（沙箱 FS shim 的 2.55% 落到 bundle L345 的注释行、原生 `TextDecoder.decode` 的 tick 落到 bundle L464），并据此一度误判 OLE 读表路径占 6–8%。修正后该路径**根本不在热点表里**。

## 前提与目标

post-169 HEAD 重建 bundle 重剖析（60 轮，**65.96 ms/轮**，3,845 samples，load≈2.9）自耗前 12：

| 函数 | 自耗 |
|---|---|
| `createParagraphsWithRealFormats` | 12.48% |
| GC | 10.59% |
| `buildMagicScanIndex` | 6.61% |
| `applyStructuralFormats`（类方法包装器 + 真函数） | 6.16% + 5.93% |
| `decodeRangeWithoutGuard` | 4.14% |
| `bytesToBase64` | 4.06% |
| `mergeCharFormatForParagraph` | 3.82% |
| `tryBrokerFileTokenSync`（**沙箱 FS shim，非被测代码**） | 3.80% |
| `parseChpxGrpprlWithFont` | 3.15% |
| `extractFormattedText` | 2.89% |
| `parsePapxGrpprl` | 2.55% |

**先排除**（避免重复劳动）：`buildMagicScanIndex`（R142/143/145/165 已判 u32/位图/三字节/顺序提示均到顶）、`decodeRangeWithoutGuard`（R149 已试 scratch 复用，中性）、`bytesToBase64`（R161 已按真实尺寸分布回放定 `0x800`）、`applyStructuralFormats`（R157/159/160 已重调，逐行极薄）、`formatParser` 两处 `runs.sort`（R132 契约 + R167 D5 元断言钉死）。

## 本轮工具修正：测量陷阱 F（行级归因必须按脚本过滤）

`lines.mjs` 原实现把每个 node 的 `positionTicks` **无条件**按行号累加，但 `positionTicks` 的行号是**相对该 node 自身脚本**的。于是：

| 假热点 | 真实归属 |
|---|---|
| bundle **L345**（`findTableStream` 的 JSDoc 注释行）2.55% | `node-brokered-fs-shim.cjs:345`（沙箱 FS 拦截） |
| bundle **L348**（`findTableStream(...) {`）1.22% | 同上 |
| bundle **L464**（MiniFAT 链）2.37% | 原生 `TextDecoder.decode`（url 为空、行号无意义） |
| bundle **L339/L342**（注释行）1.88% / 0.80% | 同上 |

修正：先用 `path.basename(callFrame.url) === path.basename(bundle)` 过滤，只统计被测 bundle 的节点。**排除 877/3845 = 22.8% 的外部样本**后，热点表变得干净且与直觉一致（OLE 路径彻底消失）。

> **新教训（可复用）**：**任何按 `positionTicks` 的行级归因，第一步必须按 `callFrame.url` 过滤到目标脚本。** 否则「注释行很热」就是必然出现的伪信号 —— 而它极容易被误读成「某条被内联的调用把成本记到了注释上」。判据：**若某热点落在注释行、空行或函数声明行，先怀疑跨文件归因，再怀疑内联**。

## 先量后改（计数插桩 + 键规模统计，27 份 × 20 轮）

| 项 | 每轮 |
|---|---|
| 段落数 | **33,702** |
| `hasRealCharFormat` 为真 | **32,690（97.0%）** |
| **`entry.charHasKeys && hasRealCharFormat`（本轮标的）** | **32,261（95.7% 段落）** |
| `entry.charHasKeys && !hasRealCharFormat` | 432 |
| 该组合下平均键数 | `resolved.charFormat` **1.00** / `newPara.charFormat` **2.01** / `merged` **1.14** |

⇒ 两行展开在剖析里合计 **3.56%**（`...resolved.charFormat,` 0.96% + `...newPara.charFormat` 1.07% + `{ ...newPara.charFormat, ...merged }` 1.53%）。**键数这么小，说明这 3.56% 主要花在「每次展开的固定开销」上（新建对象 + 巨型 IC），不是键复制** —— 这正是「整段省掉一次展开」比「优化键复制」更有效的原因。

> 这条量化同时**否决了另一个候选**：「合并键复制」类改写最多只省 ~3 次键拷贝/段落（≈0.2%），而 R149/150/153/154 已证纯分配削减会被 V8 分代 GC 吸收 ⇒ 只有**整段删掉一次展开**才可能转成端到端收益。

## 采纳候选：样式基数推迟展开

### 候选（`src/utils/docParser.ts`）

原实现（`entry.charHasKeys && hasRealCharFormat` 时展开**两次**）：

```ts
// 样式块
if (entry.charHasKeys) {
  newPara.charFormat = { ...resolved.charFormat, ...newPara.charFormat }   // ①
}
// ……
// 真实格式块
const realCharFormat = { ...newPara.charFormat, ...merged }                // ②
```

**② 的输入正是 ① 的输出 ⇒ ① 在最终结果里完全被覆盖，只贡献键序。** 改为把样式基数**推迟**到 ② 里三源一次展开：

```ts
// 声明（每段落一次）
let charStyleBase: Partial<CharacterFormat> | undefined

// 样式块
if (entry.charHasKeys) {
  if (hasRealCharFormat) {
    charStyleBase = resolved.charFormat        // 推迟
  } else {
    newPara.charFormat = { ...resolved.charFormat, ...newPara.charFormat }  // 保持原样
  }
}

// 真实格式块
const realCharFormat = charStyleBase
  ? { ...charStyleBase, ...newPara.charFormat, ...merged }
  : { ...newPara.charFormat, ...merged }
```

### 等价性（三条，均可自证）

1. **键集合与键序**：对象展开按「**首次出现顺序**」插入键、重复键保留首次位置 ⇒ `{...a, ...b}` 之后再 `{...x, ...c}` 与 `{...a, ...b, ...c}` 的键集合与键序**完全相同**。A 组用 7 × 6 × 6 = **252 例穷举叉积**（含三源共享同一键、含 `styles` 键）把这条钉死，逐例断言 `JSON.stringify` **与** `Object.keys` 双重一致。
2. **两次展开之间无人读 `newPara.charFormat`**：该区间内唯一的读取是 `/* v8 ignore */` 标注的不可达块（R147 已证 `guessCharFormat` 恒播种 `fontName`）。
3. **`styles` 丢弃语义不变**：`'styles' in realCharFormat` 守卫仍在，三源里任一来源带入 `styles` 都整键丢弃（A4 三个方向逐一验证）。

## 等价性（逐字节）

- 27 份 `parseWithFormat` 序列化后 `cmp` **逐字节一致**，16,247,039 字符，SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`（dump 16,261,351 字节）。
- **三路互核**：esbuild 基线 == esbuild 候选 == **构建后 `dist-lib/doc-preview.js`**，三份 dump 的 SHA-1 全同。
- **实现标记核对**（陷阱 B）：基线 bundle `charStyleBase` 计数 **0**，候选 **3**。（`dist-lib` 经压缩改名后计数为 0，故标记核对只在未压缩 esbuild bundle 上做，dist-lib 侧改用逐字节 dump 互核。）
- **构建确定性**：用**最终源码**重建的候选 bundle == 跑端到端证据的候选 bundle（**325,141 B**）；基线 324,894 B。

## 性能证据（同进程配对端到端，正反交错）

`r149-paired.mjs`（`/tmp/r170-head.mjs` vs `/tmp/r170-cand.mjs`，load≈2.9–3.1）：

| 样本 | 对数 | **medianRatio** | meanRatio | **胜率** | baseMedian / candMedian |
|---|---|---|---|---|---|
| 1 | 800 | **0.97235** | 0.98257 | **572/800 = 71.50%** | 63.217 / 61.793 ms |
| 2 | 1200 | **0.97621** | 0.98228 | **824/1200 = 68.67%** | 68.432 / 67.269 ms |
| **合并** | **2000** | ≈ **0.9747** | ≈ 0.9824 | **1396/2000 = 69.80%（z≈17.7）** | −1.6 ~ −1.7 ms/轮 |

**判读**：两组独立样本 medianRatio 同向（0.97235 / 0.97621）、**无符号翻转**，胜率 71.5% / 68.7% 远高于 57% 采纳阈值与 ~54% 噪声地板。量级 **≈2.4–2.8%**，绝对省 **≈1.6 ms/轮**。机制属 R156/157/158/160/161/163/164/165/166/167/169 同一类（**砍真实工作**：32,261 次/轮的对象分配 + 展开整段删除），与 R149/150/153/154「只减分配 ⇒ 中性」方向相反 —— 关键差别是这次**删掉的是一整个展开动作**，而不是把同一个展开换成更省的做法。

## 护栏（`tests/docParser.round170.test.ts`，17 项）

- **A 组（决策差分，穷举）**
  - A1 **7 × 6 × 6 = 252 例**叉积，逐例断言「值 + 键序」都与改动前 oracle 一致；
  - A2 三源共享同一键（键数 1..6）：最终值必须来自 `merged`（优先级不变）；
  - A3 键序「首次出现位置」：base 独有键在最前、merged 独有键在最后；
  - A4 `styles` 键必须被整键丢弃（base / orig / merged 三个方向逐一验证）。
- **B 组（真实语料锚定 + 防空转）**
  - B1 27 份 `parseWithFormat` 全量 **SHA-1 锚定 `8f127d0b…`** + chars **恰 16,247,039**；
  - B2 真实语料上融合路径确实被走到：`charFormatFromReal` **恰 32,690**、`styleName` > 30,000、`charFormat` 键数 ≥ 2 的段落 > 30,000。
- **D 组（骨架负控，证明本文件有鉴别力）**：`round170MergeSkeleton(base, orig, merged, mode)`，模式 `ok | dropBase | wrongOrder | ignoreMerged | twoStep`。
  D1 正控与 oracle 一致；D2 丢样式基数、D3 展开顺序颠倒（值同键序异）、D4 丢真实格式各自必须分歧；**D5 行为保持型对照：`twoStep`（两次展开）与一次展开输出完全相同**（R164 教训 10 的直接钉子）；D6 元断言（三个缺陷模式在探针上确有分歧点）。
- **C 组（接线元断言，源码文本）**：C1 `charStyleBase` 声明形态 + **恰 4 处引用**（声明 / 赋值 / 三元式条件 / 三元式取值）；C2 样式块「`hasRealCharFormat` 时推迟、否则保留原两次展开」的结构串 + 推迟分支**不得**再给 `newPara.charFormat` 赋值；C3 三源三元式逐字存在、且旧两源展开**只剩**三元式的 else 一支（`{ ...newPara.charFormat, ...merged }` 恰 1 处）；C4 `styles` 守卫与 `charFormatFromReal` 标记仍在；C5 推迟基数只用于 charFormat（`paraFormat` 的展开保持原样）。

## 离树负控（注入生产源码，跑完即还原）

**还原用逐字节回写并断言 sha256 一致**（R161 陷阱 E）。**五组全部检出**：

| 注入 | 性质 | 结果 |
|---|---|---|
| N1 **整体回退为两次展开** | **行为保持型** | **FAIL，3 项**（C1/C2/C3） |
| N2 三元式丢掉样式基数 | 行为改变型（键丢失） | **FAIL，3 项**（B1/C1/C3） |
| N3 三源展开顺序颠倒 | 行为改变型（仅键序） | **FAIL，2 项**（B1/C3） |
| N4 去掉 else 分支（总是推迟） | 行为改变型（432 段丢样式键） | **FAIL，2 项**（B1/C2） |
| N5 去掉三元式、无条件展开 | **行为保持型**（展开 `undefined` 是 no-op） | **FAIL，2 项**（C1/C3） |

五组注入后源码 sha256 恢复 `75991b5b9435b20abe03ab1c8df83ca93791c6015c38b30e5246542b82583fa0`（与注入前一致），护栏复跑 **17/17**。

> **N1 / N5 延续 R164 通用教训 10**：两组都是把代码改回**行为完全等价**的写法，任何「比输出」的断言都抓不住 —— **只有 C 组源码文本元断言能抓**。**N3 也值得记一笔**：只改键序、值全同的缺陷，**只有逐字节 dump（B1）能抓**，A 组的 oracle 是本地函数、对生产代码改动零鉴别力。

## 门禁与产物

- `npm test`：**1945 / 1945 通过（99 文件）**（R169 为 1928/98；+17 = 本轮新护栏，+1 文件）。test 与 lint **串行**执行。
- `vue-tsc --noEmit`：exit 0。`eslint .`：exit 0。
- `npm run build`：`dist/assets/main-4C5Ak0DE.js` 324.06 kB / gzip 111.81 kB；worker 133.49 kB；css 45.47 kB。
- `npm run build:lib`：`dist-lib/doc-preview.js` **372,531 → 372,621 字节（+90 B）**、`dist-lib/doc-preview.umd.cjs` **276,251 → 276,310 字节（+59 B）**（vite 报 gzip 99.02 kB / 85.08 kB）。
- `node bench-diff.mjs 170`：**cycle-170 与 cycle-169 除 `cycle`/`timestamp` 外 12 个字段全部逐字段相同**，`median` 均 `0.9502433994244857`，`parseSuccess` 27/27。
- **包体记账**：未压缩 esbuild bundle **324,894 → 325,141（+247 B，含说明注释）**；压缩后 dist-lib **+90 B / umd.cjs +59 B**。相对 **≈2.4–2.8% 的实测运行时收益**，增量可忽略。

## 下一轮

Round 170 吃掉了 charFormat 的重复展开。候选方向：

1. `applyStructuralFormats` 合计 **12.09%**（仍是第 2 大自耗）—— 逐行极薄（最大单行 HYPERLINK 扫描 0.86%），说明成本分布在**约 6 趟全段落遍历**的循环开销上 ⇒ 值得评估「合并遍历」（如把 HYPERLINK 预处理并进 Step 2 的列表检测循环），**须先量出每趟遍历的独立占比**；
2. `createParagraphsWithRealFormats` 仍 12.48%（第 1 大）—— 剩余大头是 `mergeCharFormatForParagraph` 调用（3.22%）与 `cleanParagraph`/`detectParagraphFormat`；须继续避开跨调用身份键控（R168 教训 11）；
3. `bytesToBase64` 4.06%（单行 3.69%）—— R161 已定 `0x800`，**除非**能换掉 `String.fromCharCode.apply` 的数组式实参（需先证 `TextDecoder('latin1')` **不可用**：WHATWG 里 `latin1` 是 windows-1252 的别名，0x80–0x9F 会映射成别的码点）；
4. `buildMagicScanIndex` 6.61% —— R142/143/145/165 已到顶，仅余「4 字节双表跳跃」这一未试变体，但 R145 已证同类展开端到端退化 0.788%，须谨慎；
5. `parseChpxGrpprlWithFont` 3.15% + `parsePapxGrpprl` 2.55% —— 已是扁平 switch，分布极散。

> **工具备忘**：`lines.mjs` 已加 `callFrame.url` 过滤（陷阱 F）。今后任何行级归因**先看「热点是否落在注释/空行/函数声明行」**——若是，先怀疑跨文件归因。

目标 1000 轮。
