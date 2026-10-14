# Round 168/1000 — 2026-10-14 — 采纳（`getHeadingLevel` 按样式名记忆化）；并**整轮否决**「merge 按身份格式签名表」——版本 0.7.81 → 0.7.82

> 结论：**技术采纳 `getHeadingLevel` 记忆化，版本 0.7.81 → 0.7.82，双包发布。** 27 份 `parseWithFormat` 16,247,039 字符**三路逐字节一致**（SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`）。同进程配对端到端**两组独立样本**（800 / 1200 对）：**medianRatio 0.98469 / 0.98504（快 1.53% / 1.50%）、胜率 65.75% / 64.42%**，无符号翻转；**合并 1299/2000 = 64.95%（z≈13.4）**。护栏 `tests/styleParser.round168.test.ts` **16 项** + 六组离树负控全部检出。
>
> **本轮同时整轮否决了另一个候选**（`mergeCharFormatForParagraph` 的按身份格式签名表）：隔离 1.29×、逐字节等价、8/8 骨架负控全过，但**全量门禁暴露出它与既有 Round 134 契约结构性冲突**（3 项失败）⇒ 整段撤回，**未落地任何生产代码**。详见下「被否决的候选 B」。
>
> 本轮的定位：R167「下一轮」第 1 条点名 `createParagraphsWithRealFormats` 12.05%（最大自耗、inclusive 27.96%），其**每段落一次**的 `getHeadingLevel` 调用是其中可独立剥离的一小块（33,690 次/轮、0.70% 自耗）。

## 前提与目标

post-167 HEAD 重建 bundle 重剖析（60 轮，**71.36 ms/轮**）自耗前 10：

| 函数 | 自耗 |
|---|---|
| `createParagraphsWithRealFormats` | 12.61% |
| GC | 11.73% |
| `applyStructuralFormats`（真函数 + 类方法包装器） | 6.52% + 5.84% |
| `buildMagicScanIndex` | 6.37% |
| `decodeRangeWithoutGuard` | 4.19% |
| `mergeCharFormatForParagraph` | 4.12% |
| `extractFormattedText` | 3.74% |
| `bytesToBase64` | 3.39% |
| **`getHeadingLevel`** | **0.70%** |

**先排除了几个方向**（避免重复劳动）：`buildMagicScanIndex`（R142/143/145 已判 u32/位图/三字节展开均无益）、`decodeRangeWithoutGuard`（已表优化）、sprm 解析器（已是扁平 switch）、`applyStructuralFormats`（R157/159/160 已重调，实测无 O(n²)）。

## 先量后改（调用计数插桩，27 份 × 20 轮）

| 项 | 次/轮 | 备注 |
|---|---|---|
| `getHeadingLevel` | **33,690** | = 段落数；仅 25 个不同样式名，**95.9% 是 `"Normal"`（32,317）** |
| `mergeCharFormatForParagraph` | 33,702 | 内层相交扫描 **56,491 次/轮** |
| `run.format` 键组合 | **30 种** / 26,656 个 run | ⇒ 12 处字段读取全部落在**巨态 IC** 上 |

⇒ `getHeadingLevel` 每次调用白跑 2 个锚定正则（`/^heading\s*(\d+)$/i`、`/^标题\s*(\d+)$/`）；`"Normal"` 两个都在**首字符即失配**，纯粹白算。

## 采纳候选 A：`getHeadingLevel` 按样式名记忆化

### 候选（`src/utils/styleParser.ts`）

```ts
const HEADING_LEVEL_CACHE_MAX = 4096
const headingLevelCache = new Map<string, number | null>()

export function getHeadingLevel(styleName: string): number | null {
  const cached = headingLevelCache.get(styleName)
  if (cached !== undefined) return cached
  const computed = computeHeadingLevel(styleName)
  if (headingLevelCache.size >= HEADING_LEVEL_CACHE_MAX) headingLevelCache.clear()
  headingLevelCache.set(styleName, computed)
  return computed
}

function computeHeadingLevel(styleName: string): number | null { /* 原函数体，逐字未改 */ }
```

**等价性前提（可自证）**：`getHeadingLevel` 是**样式名的纯函数** —— 只读入参、无模块状态、无副作用 ⇒「同名 ⇒ 同结果」；缓存命中与重算**逐位相同**；缓存上界只丢缓存、**不改语义**。

**两个细节是刻意的**：
- 判据必须写 `cached !== undefined` 而**不能**写 `if (cached)`：`null` 是合法结果（非标题样式），真值判定会把它当成未命中 ⇒ 语义不变但**记忆化对 24/25 个样式名失效**。
- 缓存键必须是**原始入参**，不能 `trim()` / 取首字符：`/^heading\s*(\d+)$/` 的 `$` 锚定使 `"Heading 1 "`（尾随空格）判 **null**，而 `"Heading 1"` 判 **1** —— 键一旦归一化就产生**真实语义分歧**。

### 隔离基准（真实单轮 33,690 次调用的样式名多重集回放）

| 变体 | 墙钟 | 比值 | 输出 |
|---|---|---|---|
| OLD（每次跑正则） | **0.974 ms** | 1.0000 | — |
| **NEW（按名记忆化）** | **0.234 ms** | **0.2397** | **diffs 0** |

⇒ **4.171×**，零失配。

### 等价性（逐字节）

- 27 份 `parseWithFormat` 结果序列化后 `cmp` **逐字节一致**，16,247,039 字符，SHA-1 三路均 `8f127d0bdbb0a63718a5663f48d267972c753b0e`（dump 16,261,351 字节）：
  **esbuild 基线 == esbuild 候选 == 构建后 dist-lib 候选**。
- **实现标记核对**（陷阱 B）：基线 bundle `HEADING_LEVEL_CACHE_MAX`/`function computeHeadingLevel` 计数 **0/0**；候选 **2/1** ⇒ 确认两侧装的确实是不同实现。
- **基线保真核对**：worktree `/tmp/dp168-head-wt`（detached HEAD `b97e24b`，**传绝对入口**规避陷阱 A）重建的基线 bundle，与主仓库 HEAD 基线 bundle **路径注释归一化后逐字节相同** ⇒ 两处取到的是同一份 HEAD 源码。
- **构建确定性**：用**最终源码**重建候选 bundle == 跑端到端证据的候选 bundle（**324,076 B**）。

### 性能证据（同进程配对端到端，正反交错）

`r149-paired.mjs`（`/tmp/r168-head.mjs` vs `/tmp/r168-cand2.mjs`，load 7.5/10 核 —— 高负载，故按 R146 纪律采信**配对差与胜率**口径）：

| 样本 | 对数 | **medianRatio** | meanRatio | **胜率** | baseMedian / candMedian |
|---|---|---|---|---|---|
| 1 | 800 | **0.98469** | 0.98555 | **526/800 = 65.75%** | 67.101 / 66.203 ms |
| 2 | 1200 | **0.98504** | 0.98747 | **773/1200 = 64.42%** | 66.739 / 65.941 ms |
| **合并** | **2000** | ≈ **0.9849** | ≈ 0.9867 | **1299/2000 = 64.95%（z≈13.4）** | −1.0 ms/轮 |

**判读**：两组独立样本 medianRatio **几乎重合（0.98469 / 0.98504）**、方向一致、**无符号翻转**；胜率两组均 **>64%**，远高于 57% 采纳阈值与 ~54% 噪声地板。量级 **≈1.5%**，绝对省 **≈1.0 ms/轮**。机制与 R156/157/158/160/161/163/164 同类（**砍真实工作**：每段落 2 次正则引擎进入 → 1 次 Map 查找），与 R149/150/153/154「只减分配 ⇒ 中性」的教训方向相反、结果为正。

## 被否决的候选 B：`mergeCharFormatForParagraph` 按身份格式签名表

**动机**：33,702 次/轮、56,491 次内层相交，每次相交读 12 个 `run.format` 字段；而 26,656 个 run 上有 **30 种键组合**（`"fontSize"` 39.1%、`""` 31.3%、`"fontSize,letterSpacing"` 12.0%……）⇒ 全部取值点落在**巨态 IC** 上。经典修法是摊平为 typed-array 侧表。

**做法**：模块级 `mergeSigRuns`/`mergeSigFontNames`/`mergeSigStyleFormats` 三个身份键 + `buildMergeSignature(runs, fontNames, styleFormats)`，把 8 个布尔位压进 `Uint8Array` 位图、`fontSize` 用**独立存在位 + Float64Array**（不用 NaN 哨兵）、color/highlight/fontName 折叠为「首个真值」；内层循环改为位测试。

**它通过了除门禁之外的全部验证**：

| 验证项 | 结果 |
|---|---|
| 隔离基准（真实调用序列回放） | 5.27 ms → 4.09 ms（**1.29×**），输出零失配 |
| 27 份逐字节 | **一致**（SHA-1 `8f127d0b…`） |
| 骨架负控 8 组 | 8/8 全部检出 |
| 离树负控 8 组 | 8/8 全部检出 |
| **全量 `npm test`** | ❌ **3 项失败**（既有 Round 134 护栏） |

**失败原文**：

```
Test Files  1 failed | 96 passed (97)
Tests  3 failed | 1911 passed (1914)
TypeError: Cannot read properties of null (reading 'bold')
❯ buildMergeSignature src/utils/formatParser.ts:1143:16
```

**根因（结构性，非可修 bug）**：既有 Round 134 护栏（`tests/formatParser.test.ts:1601–1930`）显式钉死了两条契约：

1. `mergeCharFormatForParagraph` 必须在**跨调用**时观察到 `run.format` / `fontNames` / `styleFormats` 的**原地改动**（用例 `'跨调用修改普通run、样式和字体数组立即可见，首值状态不跨段落缓存'` 直接改 `runs[0].format.color`、`names[0]`、`styles.set(1, …)` 后期望新值）；
2. 非法 `format`（`null`）**只在被取用到的 run 上**抛 `TypeError` —— `merge(invalid, 0, 0)` 与 `merge(invalid, 10, 20)`（不覆盖该 run）必须**返回 `{}`**。

⇒ **任何身份键控的预计算表都结构性不满足**：表在**首次调用**时就把全部 run 的字段读了一遍，于是（a）后续原地改动不可见，（b）非法 format 在**建表时**而非取用时抛错。这不是「缓存失效策略没写好」，而是**缓存与契约的不兼容**。

**处置**：**整段撤回** —— `git checkout -- src/utils/formatParser.ts`，sha256 恢复 `2de5480e9a35e9d002435e91acd0e853a731b1a2453b8310ad32c8df5685946e`（= HEAD）。撤回后 `tests/formatParser.test.ts` 恢复全绿，**未落地任何生产代码**。

> **本轮教训（新，可复用）**：**「可观察的原地可变性」是身份键控缓存的硬性禁区。** 判据：若被键控对象在两次调用之间可能被**原地修改**（而不是替换为新对象），则身份键控**必然**破坏等价性 —— 此时正确做法是**放弃缓存**，改去减少单次调用的真实工作量。反例对照：R163 的 `text.trim()` 记忆化之所以安全，是因为键控对象是**字符串**（不可变）；R148 的 Data 流缓存之所以安全，是因为键控对象是**只读目录条目**。
>
> 附带教训：**候选在隔离 + 逐字节 + 骨架负控 + 离树负控全过之后，仍可能被既有契约否决** ⇒ 全量 `npm test` 不可省略、不可用「已有等价性证据」替代。

## 护栏（`tests/styleParser.round168.test.ts`，16 项）

- **A 组（原语等价：生产 ≡ 改动前逐行转写 `round168OldGetHeadingLevel`）**
  - A1 真实样式名多重集：**锚定 33,690 次调用 / 25 个不同名 / `"Normal"` 恰 32,317**，逐次相同；
  - A2 **顺序无关性**：原序 vs 确定性 Fisher–Yates 乱序（LCG 种子 `0x16802`）逐次相同 + 同一名字连打 1,000 次稳定（全命中路径）；
  - A3 **穷举 9,900 条**（前缀 11 × 分隔 6 × 数字 15 × 后缀 10 的完整叉积）+ 53 条对抗性名字（大小写/空白/`\t`/`\n`/中文/全角数字/`\u00a0`/`\u2028`/非 ASCII），并断言对抗集**两侧都非空**（非空返回 >10、null 返回 >10）以防空转；
  - A4 **随机模糊 5,000 条**任意码元串（确定性 LCG）；
  - A5 **缓存上界路径**：注入 5,000 个不同名字（> 4,096 ⇒ 必然触发 `clear()`）后，已知名字与真实多重集仍逐次正确 ⇒ 钉死「清空只丢缓存、不改语义」。
- **B 组（骨架负控，证明本文件有鉴别力）**：`round168HeadingSkeleton(name, mode)` 与实现同形、可逐一注错。
  B1 正控与 oracle 在真实 + 穷举 + 对抗 + 随机上完全一致；**B2 丢 1..9 界**、**B3 丢中文分支**、**B4 丢 `i` 标志**、**B5 缓存键塌缩为首字符**、**B6 缓存键 `trim`** 五组负控各必须与 oracle 不同；B7 元断言（五组缺陷模式在真实+穷举前 500 上确有分歧点）。
- **C 组（接线元断言，源码文本）**：C1 缓存声明 + 上界常量 + 纯函数分离且各只定义一次；C2 判据为 `cached !== undefined`、上界清空后仍写入、**缓存键就是原始入参**（显式断言 `styleName.trim()` / `styleName.charAt(0)` **不出现**）；C3 原正则与 `1..9` 界判定原样保留（该行恰 2 处）；C4 调用点仍在（`docParser.ts` 每段落 + `detectStyleSet` 探测）。

## 离树负控（注入生产源码，跑完即还原）

**还原用逐字节回写并断言 sha256 一致**（R161 陷阱 E 的教训）。

| 注入 | 性质 | 结果 |
|---|---|---|
| N1 **整体回退为无缓存**（直接 `return computeHeadingLevel(...)`） | **行为保持型**（仅变慢） | **FAIL，1 项**（C1） |
| N2 判据改为真值判定 `if (cached) return cached` | **行为保持型**（`null` 结果永不缓存） | **FAIL，1 项**（C2） |
| N3 缓存键改用 `trim()` 后的名字 | 行为改变型 | **FAIL，2 项** |
| N4 丢掉 `1..9` 界检查 | 行为改变型 | **FAIL，2 项** |
| N5 丢掉正则 `i` 标志 | 行为改变型 | **FAIL，5 项** |
| N6 丢掉中文标题分支 | 行为改变型 | **FAIL，3 项** |

六组注入后源码 sha256 恢复 `290db4f428af5eabd0af49485b4254d3368a26fff254f901728d7de21d736eb2`（与注入前一致），护栏复跑 **16/16**。

> **N1/N2 延续 R164 通用教训 10**：把代码改回**行为完全等价**的写法（无缓存 / 真值判定），任何「比输出」的测试都抓不住 —— **只有源码文本元断言能抓**。这两组正是本轮「记忆化是行为保持型改动」的直接钉子。

## 门禁与产物

- `npm test`：**1909 / 1909 通过（97 文件）**（R167 为 1893/96；+16 = 本轮新护栏，+1 文件）。test 与 lint **串行**执行。
- `vue-tsc --noEmit`：exit 0。`eslint .`：exit 0。
- `npm run build`：`dist/assets/main-CEZqnB5F.js` 323.72 kB / gzip 111.66 kB；worker 133.18 kB；css 45.47 kB。
- `npm run build:lib`：`dist-lib/doc-preview.js` **371,729 → 371,924 字节（+195 B）**、`dist-lib/doc-preview.umd.cjs` **275,851 → 275,991 字节（+140 B）**（vite 报 gzip 98.80 kB / 84.93 kB）。
- `node bench-diff.mjs 168`：**cycle-168 与 cycle-167 除 `cycle`/`timestamp` 外 12 个字段全部逐字段相同**，`median` 均 `0.9502433994244857`，`parseSuccess` 27/27。
- **包体记账**：未压缩 esbuild bundle **323,602 → 324,076（+474 B）**；压缩后 dist-lib **+195 B / umd.cjs +140 B**。相对 **≈1.5% 的实测运行时收益**，增量可忽略。

## 下一轮

Round 168 吃掉了 `createParagraphsWithRealFormats` 内的 `getHeadingLevel` 调用。候选方向：

1. `createParagraphsWithRealFormats` 自身 12.61%（仍是最大自耗，inclusive 27.96%）—— 但**须避开**「身份键控缓存」类想法（本轮候选 B 的否决理由）；
2. `applyStructuralFormats` 合计 12.36%（R157/159/160 已重调；实测无 O(n²)，需换角度）；
3. `buildMagicScanIndex` 6.37%（R142/143/145 已判 u32/位图/三字节展开均无益）；
4. **`formatParser.ts` 两处无条件 `runs.sort((a,b) => a.cpStart - b.cpStart || a.cpEnd - b.cpEnd)`（L1424 `parsePapxRunsFromFkp` / L1519 `parseChpxRunsFromFkp`）** —— 剖析中两条 sort 行各约 0.55% 自耗（本轮新发现）；**须先核实是否真的逆序**，且 **Round 132 契约要求稳定 sort 不得跳过**（R167 曾误加 sort-skip 致 R132 护栏 4 项失败）；
5. `mergeCharFormatForParagraph` 4.12%（R166 已做顺序游标；**本轮已证身份键控不可行**，若要再动只能减少单次调用的真实工作量）；
6. `decodeRangeWithoutGuard` 4.19%。

目标 1000 轮。
