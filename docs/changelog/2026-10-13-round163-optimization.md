# Round 163/1000 — 2026-10-13 — 采纳（同段落跨消费者共享 `text.trim()` / CJK 探针：取值键控单条目记忆）

> 结论：**技术采纳，版本 0.7.76 → 0.7.77，双包发布。** 27 份 `parseWithFormat` 16,247,039 字符逐字节一致（SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`）。同进程配对端到端跑了**六组独立样本**（400 / 800 / 800 / 400 / 800 / 1200 对）：**medianRatio 六组全部 < 1、胜率六组全部 > 56%**；**合并 4400 对 2645 胜 = 60.11%**（z≈13.4，p≈1e-40）。护栏 `tests/textHeuristics.round163.test.ts` 14 项 + 四组离树负控（N1 3 项、N2 3 项、N3 2 项、N4 1 项失败）。

## 前提与目标

Round 162 的 changelog 在「下一轮」小节列了三个候选方向，其中②写得最具体：

> `RegExp:` 汇总里 `HAS_CJK_RE` 占一部分，而它在 `guessCharFormatCore` 与 `detectAlignment` 里对**同一段文本**各跑一次——若能证明两者入参同源，可省掉一半扫描。

本轮就是把这条线索做实。

post-162 HEAD 重建 bundle 重剖析（60 轮，**68.27 ms/轮**，load≈2.5）自耗前 8：

| 函数 | 自耗 |
|---|---|
| `createParagraphsWithRealFormats` | 13.30% |
| GC | 11.43% |
| `applyStructuralFormats` | 10.72% |
| `buildMagicScanIndex` | 5.81% |
| `decodeRangeWithoutGuard` | 3.96% |
| `mergeCharFormatForParagraph` | 3.90% |
| `extractFormattedText` | 3.47% |
| `bytesToBase64` | 3.04% |

`RegExp:` 节点汇总 ≈10%。

## 先量后改：调用树确认「同段落连调」

`createParagraphsWithRealFormats` 对**每个段落**的处理顺序是：

```
detectParagraphFormat(text, i, n)
   ├─ detectAlignment(text, i, n)      → text.trim()   + HAS_CJK_RE.test(text)
   └─ detectListInfo(text)             → text.trim()
guessCharFormat*(text, i)
   └─ guessCharFormatCore(text, i)     → text.trim()   + HAS_CJK_RE.test(text)
```

四个消费者**连续**被调用，**中间不经过任何其它文本**。于是对同一段落：

- `text.trim()` 被算 **3 次**（`detectAlignment` / `detectListInfo` / `guessCharFormatCore`）；
- `HAS_CJK_RE.test(text)` 被算 **2 次**（`detectAlignment` / `guessCharFormatCore`）。

按 33,702 段/轮折算，每轮约 **101,106 次 `trim`** + **67,404 次 CJK 扫描**，其中 **2/3 的 `trim`、1/2 的 CJK 扫描是纯重复**。

## 机制：取值键控的单条目记忆

```ts
let sharedProfileText: string | null = null
let sharedProfileTrimmed = ''
let sharedProfileHasCJK = false

/** 取值变化时重算共享档案；取值相同则保持上次结果。 */
function refreshSharedProfile(text: string): void {
  if (text !== sharedProfileText) {
    sharedProfileText = text
    sharedProfileTrimmed = text.trim()
    sharedProfileHasCJK = HAS_CJK_RE.test(text)
  }
}

/** 共享 `text.trim()`（同取值连调时复用上次结果，逐位等价）。 */
function sharedTrim(text: string): string {
  refreshSharedProfile(text)
  return sharedProfileTrimmed
}

/** 共享 `HAS_CJK_RE.test(text)`（同取值连调时复用上次结果，逐位等价）。 */
function sharedHasCJK(text: string): boolean {
  refreshSharedProfile(text)
  return sharedProfileHasCJK
}
```

**等价性前提**：`String.prototype.trim` 与 `HAS_CJK_RE.test` 都是**文本取值的纯函数**——对同一个字符串恒返回同一结果。因此「命中记忆」与「重新计算」的结果**必然逐位相同**；命中与否只影响耗时，不影响任何可观察输出。

**唯一真实风险 = 陈旧记忆**：取值变了却没重算，就会返回上一段的结果。这个缺陷**单次调用测试完全看不出来**——它只在**连续喂入不同文本**时显形（与 Round 162 的「世代号必须自增」同构：都是模块级状态在跨调用边界的正确性）。

## 接线（5 处）

| 位置 | 改动 |
|---|---|
| `guessCharFormatCore` L275 | `if (HAS_CJK_RE.test(text))` → `if (sharedHasCJK(text))` |
| `guessCharFormatCore` L282 | `const trimmed = text.trim()` → `const trimmed = sharedTrim(text)` |
| `detectListInfo` L604 | `const trimmed = text.trim()` → `const trimmed = sharedTrim(text)` |
| `detectAlignment` L687 | `const trimmed = text.trim()` → `const trimmed = sharedTrim(text)` |
| `detectAlignment` L699 | `if (HAS_CJK_RE.test(text))` → `if (sharedHasCJK(text))` |

函数体、分支、返回结构一律不动。

## 等价性（逐字节）

- 27 份 `parseWithFormat` 结果序列化后 **`cmp` 逐字节一致**，16,247,039 字符，SHA-1 双方均 `8f127d0bdbb0a63718a5663f48d267972c753b0e`。
- **实现标记核对**（陷阱 B）：基线 bundle 中 `refreshSharedProfile` / `sharedProfileText` / `sharedTrim` / `sharedHasCJK` / `text !== sharedProfileText` **全部 0 次**；候选 bundle **4 / 3 / 5 / 4 / 1 次** ⇒ 确认两侧装的确实是不同实现。
- **构建确定性双向核对**：
  - ① 用**最终源码**重建候选 bundle == 跑性能证据的候选 bundle `/tmp/r163-cand.mjs`（`cmp` 逐字节相同，320,346 B）；
  - ② 用 `git worktree`（detached HEAD `119ee6b`）重建的基线 bundle == 跑性能证据的基线 bundle `/tmp/r163-head.mjs`（构建时**传绝对入口**规避陷阱 A；绝对入口会把 bundle 内的 `// src/…` 路径注释改写成 `// ../../../../private/tmp/dp163-head-wt/src/…`，**归一化该路径注释后** `cmp` 逐字节相同，319,735 B；差异仅 66 行注释、0 行代码）。
- 包体：未压缩 esbuild bundle **319,735 → 320,346 字节（+611 B）**。

## 性能证据（同进程配对端到端，正反交错）

`r149-paired.mjs`，基线/候选同进程交替、逐对记录差值。本轮跑了**六组独立样本**（因为单次 400/800 对可能符号翻转，是噪声特征）：

| 样本 | 对数 | baseMedian | candMedian | medianDiff | **medianRatio** | meanRatio | **胜率** |
|---|---|---|---|---|---|---|---|
| 1 | 400 | — | — | — | **0.98842** | 0.99328 | **254/400 = 63.50%** |
| 2 | 800 | — | — | — | **0.99146** | — | **479/800 = 59.88%** |
| 3 | 800 | — | — | — | **0.99058** | — | **479/800 = 59.88%** |
| 4 | 400 | 69.588 | 69.354 | −0.603 ms | **0.99124** | 0.99379 | **235/400 = 58.75%** |
| 5 | 800 | 69.704 | 69.686 | −0.378 ms | **0.99460** | 1.00029 | **451/800 = 56.37%** |
| 6 | 1200 | 69.794 | 69.222 | −0.740 ms | **0.98935** | 0.99252 | **747/1200 = 62.25%** |
| **合并** | **4400** | — | — | — | ≈ 0.9909 | — | **2645/4400 = 60.11%** |

**判读**：

- **medianRatio 六组全部 < 1、胜率六组全部 > 56%**，方向完全一致，无 400→800 符号翻转。最低一组 56.37% 仍高于 ~54% 的噪声地板。
- 胜率是最稳健的指标（配对符号检验）：合并 60.11% ⇒ z≈13.4、p≈1e-40，远超噪声地板（~54%）与阈值（57%）。
- 量级与 **Round 162（合并 3600 对胜 60.08%）几乎重合**——两轮都是「砍真实工作」得到的**小收益**（本轮少 2/3 的 `trim` 与 1/2 的 CJK 扫描），与 R156/157/158/160/161 同侧。
- **候选侧剖析复核机制**（同进程 60 轮）：CJK 正则 **1.11% → 0.55%**（≈腰斩）、`detectListInfo` 0.55% → 0.21%、`detectAlignment` 1.47% → 1.26%、`guessCharFormatCore` 1.81% → 1.66% ⇒ 收益来源与设计一致。

> **注意**：样本 1–3 的 `meanRatio` / 中位绝对值未单独留存（本轮只记了 medianRatio 与胜率），表中以「—」标注，不做补造。合并 medianRatio 是六组 medianRatio 的算术均值。

## 护栏（`tests/textHeuristics.round163.test.ts`，14 项）

本轮独有的、逐字节 dump **抓不到**的风险是「**陈旧记忆**」——模块级档案在跨调用边界没有正确失效。

- **A 组（记忆命中 ≡ 强制重算）**：`tripleMemo`（同段连续喂三个消费者，走命中路径）vs `tripleRecompute`（每次调用前用唯一串 `flush()` 强制未命中）。
  - A1 合成语料 30 条逐条对照；
  - A2 两种取值 A/B 交错 8 轮；
  - A3 值相等但不同 String 实例；
  - A4 真实 27 份文档全部段落（>500 段）逐段对照。
- **A5 / A6 绝对锚点（本轮关键补强）**：A1–A4 只比较**两条都走生产代码**的路径，对「记忆永久冻结」（两路同时变错）**零鉴别力**。故补两条直接断言可观察输出的绝对锚点，并**连续喂入不同文本**：
  - A5 断言由 `trimmed` 唯一决定的列表识别：`1.`→`ordered/decimal`、`•`→`unordered/disc`、`  （一）`→`ordered/cjk-ideographic/level 1`、`a.`→`ordered/lower-alpha`、`plain text`→`null`、`①②带圈数字`→`null`；
  - A6 断言由 `hasCJK` 决定的字体分支：`中文 abcdefgh`→宋体/16、`plain english paragraph`→Times New Roman/12、7 个连续 CJK→仿宋_GB2312/22、`another ascii line here`→Times New Roman/12。
- **D 组（语料非空转）**：D1 真实语料同时含「有 CJK」与「无 CJK」段落（两条分支都被走到）；D2 合成语料覆盖空白 / 空串 / 长串。
- **B 组（接线元断言，只数代码行、不数注释）**：B1 三个共享函数存在；B2 `const trimmed = sharedTrim(text)` 恰 3 处、`sharedHasCJK(text)` 恰 2 处；B3 直接形式已消失（`text.trim()` 与 `HAS_CJK_RE.test(text)` 各仅存于 `refreshSharedProfile` 内 1 处）；B4 重算判据为 `if (text !== sharedProfileText) {`。
- **C 组（骨架负控，证明 A 组对照有鉴别力）**：`makeSkeleton(recomputeOnChange)`——C1 正控（`true`）恒与直接计算一致；C2 负控（`false`，复刻「忘记在取值变化时重算」）第二次不同文本返回**陈旧值**，且与正确结果不同 ⇒ 可辨。

## 离树负控（注入生产源码，跑完即还原）

**还原用 `cp` 回写而非 `git checkout`**（Round 161 陷阱 E 的教训）。

| 注入 | 失败项数 |
|---|---|
| N1 忘记在取值变化时重算（改成仅首次 `=== null` 时算） | **3 failed** / 11 passed |
| N2 重算判据取反（`!==` → `===`，同值才重算） | **3 failed** / 11 passed |
| N3 单个消费者回退为 `text.trim()`（`detectAlignment` 一处漏改） | **2 failed** / 12 passed |
| N4 `sharedHasCJK` 恒返回 `false` | **1 failed** / 13 passed |

四组注入后源码 sha256 恢复为 `993b317ef0c9e43b91a0bc75168fbfb42c35717673eeacd8b57615b10c7a56e9`（与注入前一致），护栏复跑 14/14；另跑既有 `textHeuristics` / `listDetection` 相关 **92 项**全通过。

> **N4 只被 A5/A6 两项中的 1 项抓住**——A1–A4 因「两条路径同时冻结」而全过。这正是本轮补 A5/A6 绝对锚点的直接理由；也再次印证：**只比较两条都经过生产代码的路径，无法发现「整块状态被冻结」型缺陷。**

## 门禁与产物

- `npm test`：**1812 / 1812 通过（92 文件）**（R162 为 1798/91；+14 = 本轮新护栏，+1 文件）。test 与 lint **串行**执行。
- `vue-tsc --noEmit`：exit 0。`eslint .`：exit 0。
- `npm run build`：`dist/assets/main-BjUYzKgj.js` 322.37 kB / gzip 111.11 kB。
- `npm run build:lib`：**`dist-lib/doc-preview.js` 369,727 → 369,894 字节（+167 B）**、**`dist-lib/doc-preview.umd.cjs` 274,520 → 274,643 字节（+123 B）**（vite 报 gzip 98.08 → 98.17 kB）；`style.css` 37.71 kB、`docParser.worker` 131.84 kB。
- `node bench-diff.mjs 163`：**cycle-163 与 cycle-162 除 `cycle`/`timestamp` 外 12 个字段全部逐字段相同**，`median` 均 `0.9502433994244857`，`parseSuccess` 27/27。

> **包体记账（须明说）**：未压缩 esbuild bundle **+611 B**，压缩后 dist-lib **+167 B / umd.cjs +123 B / gzip +0.09 kB** —— 新增的是 1 组模块级变量 + 3 个极小函数，但三个消费者的调用点从「直接 `trim`/`test`」变成「函数调用 + 共享读取」。按项目纪律「微优化包体增长需有明确运行时收益」：本轮的运行时收益是实测的（合并 4400 对 medianRatio≈0.9909、胜 60.11%），故接受；但**收益量级小，属边际采纳**。

## 下一轮

Round 163 把 R162 changelog 的方向②吃完。Round 164 候选方向：

1. `createParagraphsWithRealFormats`（13.30%，仍是最大自耗；R156 只覆盖了 piece-CHPX 门控）；
2. `mergeCharFormatForParagraph` 3.90%（33,702 次/轮，R156 判定「成本在调用 + 二分非分配」）；
3. `RegExp:` 汇总里剩余的 `detectListInfo` 分派后仍存的 CJK 类模式（R158 分派后仅 0.00% 段落命中，或可进一步省）；
4. `extractFormattedText` 3.47%（R152 曾判「无安全微优化点」，但当时结论基于不同剖析口径）。

目标 1000 轮。
