# Round 166/1000 — 2026-10-14 — 采纳（两处顺序游标：`mergeCharFormatForParagraph` 的 runs 下界 + papx run 包含查询）

> 结论：**技术采纳，版本 0.7.79 → 0.7.80，双包发布。** 27 份 `parseWithFormat` 16,247,039 字符逐字节一致（SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`）。同进程配对端到端共跑**五组样本**（400 / 800 / 1200 / 800 干净复跑 / 1200 干净复跑）：**medianRatio 全部 ≈0.978–0.989、胜率 61–68%（唯一样本 2 受并发干扰为 54.25%，干净复跑同规模为 62%）**；干净两组 2000 对 **1308 胜 = 65.4%**。护栏 `tests/formatParser.round166.test.ts` 22 项 + 六组离树负控（N1 4 项、N2 2 项、N3 3 项、N4 3 项、N5 4 项、N6 1 项失败）。**≈2% 端到端，是 R158（≈5.6%）、R164（≈2.1%）、R165（≈2.3%）之后又一个大收益轮次。**

## 前提与目标

post-165 HEAD 重建 bundle 重剖析（60 轮，**68.07 ms/轮**，load≈2.7）自耗前 10：

| 函数 | 自耗 |
|---|---|
| `createParagraphsWithRealFormats` | 13.89% |
| GC | 10.75% |
| `applyStructuralFormats`（真函数 + 类方法包装器） | 10.72% |
| `buildMagicScanIndex` | 6.74% |
| `decodeRangeWithoutGuard` | 4.53% |
| `mergeCharFormatForParagraph` | 4.03% |
| `extractFormattedText` | 3.76% |
| `bytesToBase64` | 3.17% |
| `parseChpxGrpprlWithFont` | 2.77% |
| `parsePapxGrpprl` | 2.19% |

Round 165 的「下一轮」里点名过 `mergeCharFormatForParagraph` 的二分游标（与 R165 同构）。本轮照例**先做调用计数插桩**，把「谁被真正高频调用、每次花多少步」量清楚，再决定改哪里。

## 先量后改

### 1) 调用计数插桩（27 份 × 20 轮，patch 后跑真实 parse）

| 查询 | 次/轮 | 二分迭代/轮 | 均步/次 |
|---|---|---|---|
| `mergeCharFormatForParagraph` 的 runs 下界 | **33,702** | **276,405** | 8.2 |
| papx run 包含查询（`createParagraphsWithRealFormats` 内） | **33,702** | **429,089** | 12.73 |
| **合计** | 67,404 | **705,494** | — |

⇒ 两处查询都是**每段落一次**（33,702 = 段落数），每次在数组上做一次全量二分，单轮合计 **~70.5 万次迭代**，量级与 R165 的 ~66 万相当。

### 2) 顺序命中率实测（真实调用序列回放）

| 查询 | 命中率 | 平均前进 | 回退次数 |
|---|---|---|---|
| merge（`cpStart` 单调） | **99.92%**（33,675/33,702） | **0.773 步** | **0** |
| papx（`markCp` 单调） | **99.999%**（33,701.9/33,702） | **1.166 步** | **0** |

### 3) 采纳方向的关键观察

**调用方都按文档序逐段处理 ⇒ 查询键单调不减**：

- `mergeCharFormatForParagraph` 的调用方（`createParagraphsWithRealFormats`）逐段推进 ⇒ `cpStart` 单调不减；`runs` 已按 `cpStart`/`cpEnd` 升序且互不重叠 ⇒ `cpEnd` 单调不减 ⇒ 谓词 `cpEnd > cpStart` 单调 ⇒ **上次求出的下界是本次下界的下界**。
- papx 查询的 `markCp = cpStart + len`（段落首尾相接：下一段 `cpStart` 即上一段 `cpEnd`）⇒ 单调不减；`papxRuns` 已按 `cpStart` 升序且**互不重叠**（`parsePapxRunsFromFkp` 由互不相交的 piece × fc 区间构造）⇒ **包含 `markCp` 的 run 下标单调不减**。

> **前提核实**：真实 27 份语料实测 `papxRuns` 共 **39,657 个 run、零重叠**（单份文档最大 **27,537** 项）。若重叠，游标等价性论证不成立，故必须先量。

## 候选与等价性论证

### merge（`formatParser.ts`）

```ts
const MERGE_HINT_MAX_STEPS = 8
let mergeHintRuns: ChpxRun[] | null = null
let mergeHintCpStart = -1
let mergeHintLo = 0

// … 在 mergeCharFormatForParagraph 内：
let lo = 0
if (runs === mergeHintRuns && cpStart >= mergeHintCpStart) lo = mergeHintLo  // 提示只抬高起点
const mergeScanLimit = lo + MERGE_HINT_MAX_STEPS
while (lo < runs.length && runs[lo].cpEnd <= cpStart && lo < mergeScanLimit) lo++   // 有界线性前推
if (!(lo < runs.length && runs[lo].cpEnd > cpStart)) { /* 从 lo 起全量二分 */ }
mergeHintRuns = runs; mergeHintCpStart = cpStart; mergeHintLo = lo
```

### papx（`formatParser.ts`，收口为导出函数 `findPapxRunContaining`）

```ts
const PAPX_HINT_MAX_STEPS = 8
let papxHintRuns: PapxRun[] | null = null
let papxHintMarkCp = -1
let papxHintLo = 0

export function findPapxRunContaining(papxRuns: PapxRun[], markCp: number): number {
  let lo = 0
  const hi = papxRuns.length - 1
  if (papxRuns === papxHintRuns && markCp >= papxHintMarkCp) {
    lo = papxHintLo
    const lim = lo + PAPX_HINT_MAX_STEPS
    while (lo <= hi && papxRuns[lo].cpEnd <= markCp && lo < lim) lo++
    if (lo <= hi && papxRuns[lo].cpEnd > markCp && papxRuns[lo].cpStart <= markCp) {
      papxHintMarkCp = markCp; papxHintLo = lo
      return lo                                    // 仅当「真正包含」才直接返回
    }
  }
  /* 否则从 lo 起全量二分；写回 papxHintLo = found >= 0 ? found : lo */
}
```

**等价性（提示自证，不依赖调用方守序）**：

- merge：`hintLo` 是上次 `cpStart` 的首个 `cpEnd > 上次 cpStart` 的下标 ⇒ 对一切 `i < hintLo` 有 `runs[i].cpEnd <= 上次 cpStart <= cpStart` ⇒ 这些下标**都不可能**是本次答案，起点仍是合法下界。有界线性前推同理：只在确认 `runs[lo].cpEnd <= cpStart` 时才前进，退出时 `lo` 仍是合法下界。
- papx：命中时 `papxHintLo` 是「包含上次 `markCp` 的 run」下标，而 run 互不重叠 ⇒ 对一切 `i < papxHintLo` 有 `papxRuns[i].cpEnd <= 上次 markCp <= markCp` ⇒ 起点仍是合法下界。**额外加了包含性确认**（`cpEnd > markCp && cpStart <= markCp`）—— 因为落在 gap 中的 `markCp` 无包含 run，缺此确认会把 gap 后的 run 误当作答案。
- 两者：**守卫不成立时起点退回 0，与旧实现逐字节相同；即使某个调用方乱序调用，也只会退回全量二分而不会算错。** 数组构造后只读，故「同一数组对象」即「同一内容」，跨文档身份不同自动失效。

**为什么用「数组对象身份」而非长度/内容哈希**：与 R165 同理——身份比较 O(1) 零歧义；长度会撞（同长不同内容），内容哈希是 O(n) 反而更贵。

## 隔离基准（真实调用序列回放，R161 纪律）

回放真实 **33,702 次调用序列 + 27 份真实 runs/papxRuns**（同进程交错取中位）：

| 变体 | 结果 | 累加器 | 墙钟 |
|---|---|---|---|
| merge v0 = 现状（每次全量二分） | 逐项相同 | 11,730,939 | 1.012 ms |
| **merge v1 = 顺序提示 + 有界线性前推** | **逐项相同** | **11,730,939** | **0.455 ms（2.22×）** |
| papx v0 = 现状 | 逐项相同 | 381,657,051 | 2.804 ms |
| **papx v1 = 顺序游标** | **逐项相同** | **381,657,051** | **0.544 ms（5.15×）** |

## 等价性（逐字节）

- 27 份 `parseWithFormat` 结果序列化后 **`cmp` 逐字节一致**，16,247,039 字符，SHA-1 双方均 `8f127d0bdbb0a63718a5663f48d267972c753b0e`（dump 16,261,351 字节）。
- **实现标记核对**（陷阱 B）：基线 bundle `MERGE_HINT_MAX_STEPS`/`mergeHintRuns`/`findPapxRunContaining`/`PAPX_HINT_MAX_STEPS`/`papxHintRuns` 计数 **0/0/0/0/0**；候选 **2/3/4/2/3** ⇒ 确认两侧装的确实是不同实现。
- **构建确定性核对**：用**最终源码**重建候选 bundle == 跑性能证据的候选 bundle（**322,170 B**）；基线 320,966 B。
- **既有差分 oracle 全部通过（独立佐证）**：`tests/formatParser.test.ts` 等 6 个文件 **305 项全过**（含 R131/132/134 的 FKP oracle），等于对本次改动做了一次独立差分复核。

## 性能证据（同进程配对端到端，正反交错）

`r149-paired.mjs`，基线/候选同进程交替、逐对记录差值：

| 样本 | 对数 | **medianRatio** | meanRatio | **胜率** |
|---|---|---|---|---|
| 1 | 400 | **0.98025** | 1.00611 | **244/400 = 61.0%** |
| 2（并发干扰） | 800 | **0.98936** | 1.03024 | **434/800 = 54.25%** |
| 3 | 1200 | **0.98251** | 1.01349 | **732/1200 = 61.0%** |
| 4（干净复跑） | 800 | **0.98386** | 0.98672 | **496/800 = 62.0%** |
| 5（干净复跑） | 1200 | **0.97824** | 0.98617 | **812/1200 = 67.67%** |
| **合并（全部 5 组）** | **4400** | ≈ **0.982** | — | **2718/4400 = 61.77%** |
| **合并（干净 4+5）** | **2000** | ≈ **0.980** | — | **1308/2000 = 65.4%** |

**判读**：

- **medianRatio 五组全部 ≈0.978–0.989**，方向完全一致，无符号翻转。
- **样本 2 是并发污染的产物**：该 800 对跑在我同时编译/跑护栏/跑 dump/跑隔离基准时（load 高），胜率掉到 54.25%（= 噪声底线）、`meanRatio` 反号到 1.03。**干净复跑同规模（样本 4）为 62.0%、`meanRatio` 0.987** ⇒ 采信干净口径。
- 干净两组合并 **65.4%** ⇒ z≈13.8（p≪1e-40）；全部五组合并 61.77% ⇒ z≈15.6。
- 量级 **≈2%**，机制同类（**砍真实工作：把 ~70.5 万次二分迭代降到 ~0**）。
- 与 R165（≈2.3%、70.5% 胜率）相比略弱：本轮省下的迭代数相当（70.5 万 vs 66 万），但其中 papx 侧改为了**函数调用**（`findPapxRunContaining`），单次调用边界成本抵消了一部分收益——与 R145 教训一致（引入新调用边界必须端到端复核）。

## 护栏（`tests/formatParser.round166.test.ts`，22 项）

- **A 组（差分：生产 ≡ 改动前逐行转写 `refMergeCharFormatForParagraph` / `refFindPapxRunContaining`）**：
  - A1 merge：真实 27 份 `chpxRuns`，单调 + 随机 + 逐 run 边界（含 gap、相邻、越界）> 20,000 次查询；
  - A2 papx：真实 27 份 `papxRuns`，单调 + 随机 + 全部边界 > 20,000 次查询；
  - A3 对抗性 runs（空 / 单元素 / 相邻 / 密集 / 大 gap）穷举查询；
  - A4 乱序 / 跨数组身份（**同内容** twin）/ 交替访问；
  - **A5 跨文档交替访问（不同 runs 内容）**——见下。
- **B 组（绝对锚点，防「两路同时冻结」的零鉴别力）**：B1 各段落合并结果逐字段固定；B2 gap/段间只看到重叠部分（含「color/highlight/fontName 取首个出现而非按比例」这一语义钉死）；B3 空 runs / 非正长度 → `{}`；B4 papx 每个 run 内任意点命中该 run、gap → −1；B5 空数组 → −1。
- **C 组（骨架负控，证明本文件有鉴别力）**：`makeMergeSkeleton` / `makePapxSkeleton` 与实现同形、各去掉一处守卫。C1 两个正控与 oracle 一致；C2 缺回退守卫可辨；C3 缺数组身份守卫可辨；C4 papx 缺包含性确认可辨；**C5 行为保持型回退（去掉写回）仍与 oracle 相同**（用于说明元断言不可省）。
- **D 组（接线元断言，源码文本）**：D1–D3 merge 常量/守卫/写回计数；D4–D6 papx 常量/守卫+包含性确认/写回计数；D7 `docParser` 查询已收口到 `findPapxRunContaining` 且旧内联二分已移除。

> **A5 的由来（本轮教训）**：初版 A 组的「跨数组身份」用的是**同内容 twin**（`runs.map(r => ({...r}))`），此时陈旧提示的下标**仍然合法**，于是「缺数组身份守卫」这个**行为改变型** bug 在行为层**完全抓不住**（只有 D2 源码断言抓到）。补 A5：在两个**内容不同**的真实文档之间交替访问，使陈旧提示下标越界/错位，行为层即可辨。**教训：差分负控的「跨身份」必须用「内容确实不同」的对象，同内容副本不具鉴别力。**

## 离树负控（注入生产源码，跑完即还原）

**还原用 `cp` 回写而非 `git checkout`**（Round 161 陷阱 E 的教训）。

| 注入 | 性质 | 失败项 |
|---|---|---|
| N1 merge 缺回退守卫（`cpStart >= mergeHintCpStart`） | 行为改变型 | **4 failed**（A1/A4/B2/D2） |
| N2 merge 缺数组身份守卫（`runs === mergeHintRuns`） | 行为改变型 | **2 failed**（A5/D2） |
| N3 papx 缺包含性确认（`cpStart <= markCp`） | 行为改变型 | **3 failed**（A3/B4/D5） |
| N4 papx 缺回退守卫（`markCp >= papxHintMarkCp`） | 行为改变型 | **3 failed**（A2/A4/D5） |
| N5 **整体回退两处提示** —— **行为完全等价** | 行为保持型 | **4 failed**（仅 D2/D3/D5/D6 元断言） |
| N6 **docParser 接线回退为内联二分** —— **行为完全等价** | 行为保持型 | **1 failed**（仅 D7 元断言） |

六组注入后源码 sha256 恢复一致（`formatParser.ts` `a5526a580b02c580…`、`docParser.ts` `74d8c238d4f67b40…`），护栏复跑 22/22。

> **N5/N6 延续 R164 通用教训 10**：把代码改回**行为等价**的旧写法，任何「比输出」的测试都抓不住 —— **只有源码文本元断言能抓**。N5 由 D2/D3/D5/D6 抓到，N6 只由 D7（「查询已收口」+「旧内联二分已移除」）抓到。

## 门禁与产物

- `npm test`：**1873 / 1873 通过（95 文件）**（R165 为 1851/94；+22 = 本轮新护栏，+1 文件）。test 与 lint **串行**执行。
- `vue-tsc --noEmit`：exit 0。`eslint .`：exit 0。
- `npm run build`：`dist/assets/main-XOJe8HLx.js` 323.07 kB / gzip 111.39 kB；worker 132.54 kB；css 45.47 kB。
- `npm run build:lib`：`dist-lib/doc-preview.js` **370,284 → 370,845 字节（+561 B）**、`dist-lib/doc-preview.umd.cjs` **274,937 → 275,358 字节（+421 B）**（vite 报 gzip 98.49 kB / 84.64 kB）。
- `node bench-diff.mjs 166`：**cycle-166 与 cycle-165 除 `cycle`/`timestamp` 外 12 个字段全部逐字段相同**，`median` 均 `0.9502433994244857`，`parseSuccess` 27/27。
- **包体记账**：未压缩 esbuild bundle **320,966 → 322,170（+1,204 B）**（含两段模块顶部说明注释）；压缩后 dist-lib **+561 B / umd.cjs +421 B**。相对 **≈2% 的实测运行时收益**，这个增量可忽略。

## 下一轮

Round 166 吃掉了 `mergeCharFormatForParagraph` 与 papx 两处查询开销。Round 166 之后候选方向：

1. `createParagraphsWithRealFormats` 自身 13.89%（仍是最大自耗）；
2. `applyStructuralFormats` 合计 10.72%（R159 已否决「超集门」，但可考虑按文档级一次性门控）；
3. `buildMagicScanIndex` 6.74%（R165 已判 u32/位图/三字节展开均无益）；
4. `decodeRangeWithoutGuard` 4.53%（`runs.sort` 带比较器闭包）；
5. FKP 解析链合计约 9%（`parseChpxGrpprlWithFont` 2.77% + `parsePapxGrpprl` 2.19% + `parseChpxRunsFromFkp` 2.06% + `parsePapxRunsFromFkp` 1.94%），尚未被任何一轮触及。

目标 1000 轮。
