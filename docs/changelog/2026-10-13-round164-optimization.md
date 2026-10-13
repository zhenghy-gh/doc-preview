# Round 164/1000 — 2026-10-13 — 采纳（`guessCharFormatCore` 标题分支 3 次扫描 → 1 次合并正则 + `detectAlignment` 日期分支首字符守卫）

> 结论：**技术采纳，版本 0.7.77 → 0.7.78，双包发布。** 27 份 `parseWithFormat` 16,247,039 字符逐字节一致（SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`）。同进程配对端到端跑了**三组独立样本**（400 / 800 / 1200 对）：**medianRatio 三组全部 < 1（0.98027 / 0.97702 / 0.97907）、胜率三组全部 > 64%（64.75 / 69.87 / 67.58 %）**；合并 2400 对 **1629 胜 = 67.88%**（z≈17.5）。护栏 `tests/textHeuristics.round164.test.ts` 17 项 + 五组离树负控（N1 4 项、N2 1 项、N3 2 项、N4 2 项、N5 1 项失败）。**这是自 Round 158（≈5.6%）以来单轮最大的端到端收益（≈2.1%）。**

## 前提与目标

post-163 HEAD 重建 bundle 重剖析（60 轮，**69.27 ms/轮**，load≈2.3）自耗前 8：

| 函数 | 自耗 |
|---|---|
| `createParagraphsWithRealFormats` | 12.70% |
| GC | 10.50% |
| `applyStructuralFormats`（真函数 + 类方法包装器） | 5.71% + 5.07% |
| `buildMagicScanIndex` | 5.53% |
| `decodeRangeWithoutGuard` | 4.46% |
| `mergeCharFormatForParagraph` | 4.03% |
| `extractFormattedText` | 3.79% |
| `bytesToBase64` | 3.51% |

`RegExp:` 节点汇总 **4.79%**（R158 时期约 7.01%，R163 已削掉 CJK 探测的一半）。

## 先量后改

### 1) 调用计数插桩（27 份 × 20 轮，patch 后跑真实 parse）

| 函数 | 次/轮 |
|---|---|
| `parsePapxGrpprl` | 39,909 |
| `cleanParagraph` / `shouldSkipParagraph` / `hasTooManyJunkChars` | 34,348 |
| `detectParagraphFormat` / `detectAlignment` / `detectListInfo` / `guessCharFormatCore` / `mergeCharFormatForParagraph` / `leadingWhitespaceCount` / `trailingWhitespaceCount` | 33,702 |
| `guessCharFormatWithoutStyles` | 32,690 |
| `parseChpxGrpprlWithFont` | 27,989 |
| `guessCharFormat`（真实格式路径） | 1,012 |
| `leadingIndentWidth` | 215 |
| `decodeRangeWithoutGuard` | 140 |
| `countChineseAndWhitespace` | 16 |
| `buildMagicScanIndex` / `splitTextByParagraphMark` / `parsePapxRunsFromFkp` | 27 |

⇒ 结论：**这些函数都没有「重复调用」冗余**（33,702 = 段落数，1/段落），收益只能来自**单次调用内部**。

### 2) 行级归因：两个「多次扫描同一串」的位置

`guessCharFormatCore`（函数自耗 1.80%）里**最热的一行独占 1.04%**：

```js
if (!pureName && noSentencePunct && !text.includes('：') && !text.includes(':')) {
```

即对**同一串 `text`** 连做 **3 次独立整串扫描**：`SENTENCE_PUNCT_RE.test(text)`（`/[，。！？、；.!?]/`）、`text.includes('：')`、`text.includes(':')`。

`detectAlignment` 的日期行 `ALIGN_YEAR_RE.test(trimmed) || ALIGN_MONTH_RE.test(trimmed)`：行级 0.34% + 两个 RegExp 节点各 0.21% ≈ **0.76%**。

## 候选与等价性论证

### 改动 1：3 次扫描 → 1 次合并字符类

```ts
const TITLE_STOP_RE = /[，。！？、；.!?:：]/   // = SENTENCE_PUNCT_RE 的字符集 ∪ {：, :}
...
if (!pureName && !TITLE_STOP_RE.test(text)) {
```

**等价性**：三个扫描都只是在问「`text` 里有没有这些字符」，合并字符类是**并集** ⇒
`!TITLE_STOP_RE.test(text)` ⟺ `!SENTENCE_PUNCT_RE.test(text) && !text.includes('：') && !text.includes(':')`。
（`noSentencePunct` 只在该条件里被使用，故可一并内联。）

### 改动 2：日期分支的「首字符数字」守卫

```ts
const firstCode = trimmed.charCodeAt(0)
if (firstCode >= 48 && firstCode <= 57 && (ALIGN_YEAR_RE.test(trimmed) || ALIGN_MONTH_RE.test(trimmed))) return 'right'
```

**等价性（必要条件论证）**：`trimmed` 已无前导空白 ⇒ 模式里的 `^\s*` 只能匹配空串 ⇒
`ALIGN_YEAR_RE`/`ALIGN_MONTH_RE` 命中 ⟹ `trimmed` 首字符必为数字。
守卫只是把这条必要条件前置；**它不可能抑制真实命中，也不可能引入新命中**（纯门控）。
护栏 E1 用**穷举 65,536 个首字符 × 8 种后缀**直接证明该必要条件（命中数 > 0，非空转）。

> **量级提醒**：真实语料只有 **2.37%** 的段落以数字开头 ⇒ 其余 97.6% 可整次跳过两次正则调用。

## 隔离基准（真实语料回放，R161 纪律）

语料 = 27 份文档的全部段落文本（34,945 段 / 1,456,460 字符），同进程交错 9 次取中位、每次 7 遍：

**改动 1（标题分支）**

| 变体 | ms | 比值 |
|---|---|---|
| v0 = 现状（3 次扫描） | 8.903 | 1.0000 |
| **vA = 单个合并字符类正则** | **4.790** | **0.5380** |
| vB = ASCII 子类 + 宽字符子类（两次正则短路） | 7.267 | 0.8162 |
| vC = `search(合并类) < 0` | 6.132 | 0.6887 |
| vD = 重排 `includes` 顺序 | 9.430 | 1.0591 |

五个变体在 34,945 段上**输出零失配**。⇒ 采纳 vA（隔离快 **1.86×**）。

**改动 2（日期守卫）**

| 变体 | ms | 比值 |
|---|---|---|
| v0 = 现状 | 5.310 | 1.0000 |
| **vGuard = 首字符数字守卫** | **2.664** | **0.5017** |
| vFused = 融合正则（去掉 `^\s*`） | 3.326 | 0.6265 |
| vGuardFused = 守卫 + 融合正则 | 2.750 | 0.5179 |

⇒ 采纳 vGuard（隔离快 **1.99×**）。**注意**：融合正则（0.6265）明显不如「保留原正则 + 前置守卫」（0.5017）——改写正则文本本身并没有省下真正的开销，**省下的是「根本不去调用正则引擎」**。

## 等价性（逐字节）

- 27 份 `parseWithFormat` 结果序列化后 **`cmp` 逐字节一致**，16,247,039 字符，SHA-1 双方均 `8f127d0bdbb0a63718a5663f48d267972c753b0e`。
- **实现标记核对**（陷阱 B）：基线 bundle `TITLE_STOP_RE` 0 / `firstCode >= 48 && firstCode <= 57` 0 / `noSentencePunct` 2；候选 **2 / 1 / 0** ⇒ 确认两侧装的确实是不同实现。
- **构建确定性双向核对**：① 用**最终源码**重建候选 bundle == 跑性能证据的候选 bundle（`cmp` 逐字节相同，320,337 B）；② 用 `git worktree`（detached HEAD `8113daa`）重建的基线 bundle == 跑证据的基线 bundle（**传绝对入口**规避陷阱 A；归一化 `// src/…` 路径注释后逐字节相同，320,346 B）。
- **既有差分 oracle 全部通过（独立佐证）**：`tests/textHeuristics.round140.test.ts`（旧 `guessCharFormat` 逐行转写，穷举 65,536 码元 × 首/尾/中 + 27 份真实文档）、`tests/textHeuristics.cjkGuard.test.ts`（R112/R137 两套 `detectAlignment` oracle，含穷举与真实语料）、`tests/textHeuristics.round144/158/163.test.ts` —— 共 **44 项全部通过**。其中 R140/R137 oracle 内**逐字包含改动前的两次判断原文**，等于对本次改动做了一次独立的差分复核。

## 性能证据（同进程配对端到端，正反交错）

`r149-paired.mjs`，基线/候选同进程交替、逐对记录差值（load≈3.5）：

| 样本 | 对数 | baseMedian | candMedian | medianDiff | **medianRatio** | meanRatio | **胜率** |
|---|---|---|---|---|---|---|---|
| 1 | 400 | 70.650 | 69.528 | −1.344 ms | **0.98027** | 0.99237 | **259/400 = 64.75%** |
| 2 | 800 | 68.564 | 67.533 | −1.574 ms | **0.97702** | 0.98497 | **559/800 = 69.87%** |
| 3 | 1200 | 71.285 | 70.111 | −1.461 ms | **0.97907** | 0.98685 | **811/1200 = 67.58%** |
| **合并** | **2400** | — | — | ≈ −1.46 ms | ≈ **0.9788** | — | **1629/2400 = 67.88%** |

**判读**：

- **medianRatio 三组全部 ≈0.978–0.980、胜率三组全部 > 64%**，方向完全一致，无 400→800 符号翻转；合并 67.88% ⇒ z≈17.5。
- 绝对中位差稳定在 **−1.34 ~ −1.57 ms/轮**，与隔离折算（改动 1 省 0.59 ms + 改动 2 省 0.38 ms ≈ 0.97 ms）同向且略大（合理：隔离基准只覆盖扫描本身，未计正则引擎的调用/回溯准备开销）。
- 量级 **2.1%**，是 R156/157/158/160/161/162/163 序列里仅次于 R158（5.6%）的第二大收益；机制同类（**砍真实工作：整串扫描次数从 3+2 降到 1+1**）。

## 护栏（`tests/textHeuristics.round164.test.ts`，17 项）

- **A 组（差分：生产 ≡ 改动前逐行转写）**：把改动前的 `guessCharFormatCore(text, false)` 完整转写为 `oldCoreNoStyles`，与生产 `guessCharFormatWithoutStyles` 比较**完整对象 + JSON 键序**。
  A1 穷举 65,536 码元插入标题中部（两种形状）；A2 穷举 65,536 码元作首字符；A3 真实 27 份文档全部段落（>500）；A4 合成语料（11 个类字符 × 3 个位置）。
- **B 组（绝对锚点）**：B1 非空转（基准串 `'This Is A Title'` 确实是标题 → `{fontSize:22, bold:true}`）；B2 **11 个类字符逐个「追加/前插/内嵌」都阻断标题分支**（→ `{fontSize:12}`）；B3 非类字符（空格/字母/中文/数字/全角空格/`（`/`《`/`#`）**不阻断**（证明字符类没有被扩大）。
- **C 组（骨架负控）**：`makeSkeleton(drop)` 复刻「合并时漏掉一个字符」；C1 正控（不丢时 `merged ≡ oldWay`）、C2 丢 `：` 可辨、C3 丢 `.` 可辨。
- **D 组（接线元断言）**：D1 `const TITLE_STOP_RE = /[，。！？、；.!?:：]/`；D2 旧的 `noSentencePunct` / `text.includes('：')` / `text.includes(':')` 已消失；D3 `if (!pureName && !TITLE_STOP_RE.test(text)) {`；D4 `SENTENCE_PUNCT_RE` 仍保留（`isEnglishTitle` 仍在用，**不可误删**）；D5 守卫落在 `trimmed` 且范围为 48..57。
- **E 组（日期守卫）**：E1 必要条件穷举证明（见上）；E2 绝对锚点 18 条，含 `'9月'`（上界边界）、`'999月'`→null、`'２０２４年'`（全角数字）→null，以及 **`' 2024年 abcdef'`/`' 12月 abcdef'`/`'  9月 abcdefghij'`（前导空白用例，钉死守卫必须落在 `trimmed` 而非 `text` 上）**。

## 离树负控（注入生产源码，跑完即还原）

**还原用 `cp` 回写而非 `git checkout`**（Round 161 陷阱 E 的教训）。

| 注入 | 失败项数 |
|---|---|
| N1 合并字符类丢掉全角冒号 `：` | **4 failed** |
| N2 合并字符类丢掉 ASCII 句点 `.` | **1 failed** |
| N3 日期守卫上界右移（48..57 → 48..56，丢掉 `'9'`） | **2 failed** |
| N4 日期守卫落在 `text` 而非 `trimmed`（前导空白日期失效） | **2 failed** |
| N5 **整体回退为改动前**（移除合并判定与守卫）—— **行为完全等价** | **1 failed**（仅 D5 元断言） |

五组注入后源码 sha256 恢复为 `29c175899e113de860ab41b01ffc28e27a9c8484a5d50c94e2c3029c6012208f`（与注入前一致），护栏复跑 17/17。

> **N5 是本轮方法论要点**：把代码改回**行为等价**的旧写法，任何「比输出」的测试都抓不住 —— 只有**源码文本元断言**能抓。这与 R161 的 N1（块大小改回旧值）同构，再次印证「当改动是行为保持型时，元断言不可省」。

## 门禁与产物

- `npm test`：**1829 / 1829 通过（93 文件）**（R163 为 1812/92；+17 = 本轮新护栏，+1 文件）。test 与 lint **串行**执行。
- `vue-tsc --noEmit`：exit 0。`eslint .`：exit 0。
- `npm run build`：`dist/assets/main-CEsx6cOS.js` 322.40 kB / gzip 111.12 kB。
- `npm run build:lib`：`dist-lib/doc-preview.js` **369,894 → 369,944 字节（+50 B）**、`dist-lib/doc-preview.umd.cjs` **274,643 → 274,684 字节（+41 B）**（vite 报 gzip 98.17 → 98.18 kB）；`style.css` 37.71 kB。
- `node bench-diff.mjs 164`：**cycle-164 与 cycle-163 除 `cycle`/`timestamp` 外 12 个字段全部逐字段相同**，`median` 均 `0.9502433994244857`，`parseSuccess` 27/27。
- **包体记账**：未压缩 esbuild bundle **320,346 → 320,337（−9 B）**（删掉的条件与新增的常量/守卫基本抵消）；压缩后 dist-lib **+50 B / umd.cjs +41 B**。相对 **2.1% 的实测运行时收益**，这个增量可忽略。

## 下一轮

Round 164 吃掉了 `guessCharFormatCore` 与 `detectAlignment` 里最后的整串扫描冗余。Round 165 候选方向：

1. `createParagraphsWithRealFormats` 自身 12.70%（仍是最大自耗）；行级里 `mergeCharFormatForParagraph` 调用 3.48%、`{...newPara.charFormat, ...merged}` 1.47%、`includes('\f')` 0.64%、papx 二分 0.61%；
2. `mergeCharFormatForParagraph` 4.03%（33,702 次/轮，R156 判「成本在调用 + 二分非分配」）——**二分可改为随 cpStart 单调推进的游标**（段落按文档序处理 ⇒ `lo` 单调不减），需先证调用序单调；
3. `applyStructuralFormats` 的预清洗 `includes('HYPERLINK')`（0.92%）与 `OTHER_FIELD_CODE_TEST_RE`（0.46% + 0.18%）——R159 已否决「超集门」方案（非严格等价），但可考虑按文档级一次性门控；
4. FKP 解析链合计约 11.5%（`parsePapxGrpprl` 39,909 次/轮、`parseChpxGrpprlWithFont` 27,989 次/轮），尚未被任何一轮触及。

目标 1000 轮。
