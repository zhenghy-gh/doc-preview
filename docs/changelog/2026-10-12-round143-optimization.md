# Round 143：把图片魔数扫描并入 Round 142 的共享扫描索引（9 锚点单趟）

## 结论与候选

采纳「把 `imageExtractor` 的图片魔数扫描（四个签名首字节 `0x89`/`0xFF`/`0x47`/`0x42`）并入 Round 142 建立的共享魔数扫描索引，使同一份 `WordDocument` 流**只被整扫一趟**」候选。

- **可合并字节实测**（`r143-imgprobe.mjs`）：`buildMagicScanIndex` 扫 **5.500 MB**、`scanImagesFromStream` 扫 **6.099 MB**，两者**作用在同一对象**上的部分是 **5.414 MB = 46.68% 总扫描量**；仅图片独占 0.684 MB；**26 / 27** 份文件存在共享对象。
- **隔离**（`r143-mergebench.mjs`，纯内存，27 条真实流）：`build + scan` 8.221 ms → `merged + scan` **5.380 ms**，**1.528×**（min 1.564×），27 流零失配（`mismatch=0`）。
- **端到端配对差**（`r143-paired.mjs`，40 对，相邻交替）：NEW 中位 93.45 ms / OLD 95.71 ms，**比值 1.0242×（改善 2.363%）**；NEW−OLD 中位 **−2.489 ms**，**胜 32 / 负 8**，四分位 −4.194 / −0.441 ms，二项零假设 **p ≈ 1.48e-4**。
- **端到端交错**（10 对，5 对 NEW 先 + 5 对 OLD 先，各 20 轮）：中位数之中位数 NEW 91.124 / OLD 92.769 = **0.9823×（改善 1.773%）**；最小值之中位数 NEW 87.468 / OLD 89.521 = **0.9771×（改善 2.293%）**；配对差中位 **−1.915 ms，胜 8 / 10**。
- 27 份完整 `parseWithFormat` 结果 **16,247,039 字符逐字节一致**（esbuild bundle 与 dist-lib 产物**双路**均比对）；`bench-diff 143` 与 `142` 除 `cycle`/`timestamp` 全字段相同。
- 包体（同工具链 HEAD 基线对比）：`doc-preview.js` raw **+1,311 B** / gzip **+531 B**；`umd.cjs` raw +414 B / gzip +128 B。拟从现场 0.7.63 升至 **0.7.64**。

## 候选来源与并发处置

本轮候选正是 Round 142 changelog「已否决与边界」里**明确留给后续轮次**的那一条：*「图片扫描并入同一索引（9 锚点并集 ≈2.68%、预期 ≈7.8%）：图片命中后 `i` 跳到 `end`，需要的是单一升序候选数组而非按锚点分桶；且图片路径不在 `parseFormatRuns` 内，需 Round 139 式跨模块接线。」*

**并发冲突**：本会话 14:01 读状态时 `inFlight=false`（`updatedAt` 05:55:04Z），按协议开启 143。14:15 复核发现**同一轮被并发触发**——另一 worker 自 14:02 起也在做 143（`perf-harness/round143-read*`、`round143-char*`、`round143-imageledcount`、`round143-cand`、`round143-paired`、`round143-scalar*`、`round143-fatcontig`、`round143-buildbench`，另 `/private/tmp/dp143`、`/private/tmp/dp143s` 临时树），并于 14:14:49 改了 `src/utils/docparser/heuristics/textHeuristics.ts`（`detectCharacterStyles` 标量化，**未提交、无护栏、未验证**）。

处置：
1. 显式认领本轮（`inFlight=true`、`updatedAt` 前移、`notes` 追加认领说明）；
2. 对方未提交改动**无损留存**至 `.workbuddy-ai/perf-harness/round143-concurrent/`（`textHeuristics.round143-concurrent.ts` + `round143-concurrent.patch`）；
3. 本会话在**隔离其改动**（`textHeuristics.ts` 还原至 HEAD，`git diff` 为空）的前提下完成验证与提交；
4. 提交后若该文件仍等于 HEAD，则原样还原对方改动，不冒称整个工作区干净。

## 前提与占比

真实 27 份 `WordDocument` 流共 5,767,130 B，9 个锚点实测密度（`round143-anchordensity.mjs`）：

| 锚点 | 用途 | 命中数 | 占比 |
|---|---|---:|---:|
| `0xD0` | 图表 OLE | 6,610 | 0.1146% |
| `0x50` | 图表 ZIP | 30,439 | 0.5278% |
| `0xF0` | shapes FDG | 6,752 | 0.1171% |
| `0xEF` | equations | 4,878 | 0.0846% |
| `0xE0` | wordart | 7,278 | 0.1262% |
| `0x89` | PNG | 7,766 | 0.1347% |
| `0xFF` | JPEG | 60,604 | 1.0509% |
| `0x47` | GIF | 7,782 | 0.1349% |
| `0x42` | BMP | 22,354 | 0.3876% |
| **并集** | | **154,463** | **2.6783%** |

并集从 5 锚点的 **0.970%** 升到 9 锚点的 **2.6783%**——仍远低于「锚点 ≥2% 时 `indexOf` 跳跃无益」的经验门槛附近，但已明显压缩「字节对查表跳 2」的命中率。最差单流为 `unicode-form.doc` 的 `WordDocument` 7.377%。

## 代价分解：代价来自密度，不是存储

`r143-mergeexp.mjs`（25 轮 median，27 条流建表）把「9 锚点」与「候选存储」两个因素拆开：

| 策略 | 建表 median (ms) | 说明 |
|---|---:|---|
| `OLD_magic`（5 锚点、只分桶） | 3.599 | Round 142 现状 |
| `V3_count`（9 锚点、候选**只计数不存储**） | 4.213 | 隔离「密度」代价 |
| `V1_push`（9 锚点、候选 `Array.push`） | **4.433** | **本轮采用** |
| `V5_9bucket`（9 锚点、候选进 4 个独立桶） | 4.301 | 替代存储布局 |
| `V2_u32`（9 锚点、`Uint32Array` 倍增扩容） | 4.816 | 替代存储布局 |

- 候选数各策略一致 **98,506**（与隔离基准的「候选总数 98506」互证）。
- `OLD_magic → V3_count` 的 **+0.614 ms** 是**纯密度**代价（配对跳过命中率下降）。
- `V3_count → V1_push` 的 **+0.220 ms** 才是**存储**代价。
- `V2_u32`（4.816）比 `V1_push`（4.433）**慢 0.383 ms**：倍增扩容的拷贝开销超过 `Array.push` 的写放大，故本轮用 **JS 数组 push**（与 Round 101/139 的历史结论一致：不为小片段纳秒差异引共享可变 scratch，优先简单结构）。
- 净收益：多付约 0.83 ms 建表，换掉一整趟 5.4 MB 的逐字节扫描——隔离基准实测净赚 **2.841 ms（1.528×）**。

## 实现与等价性

**`src/utils/docparser/magicScanIndex.ts`**（117 → 175 行）：

- `SCAN_LEADS = [...MAGIC_SCAN_LEADS, ...IMAGE_SIGNATURE_LEADS]`——9 个锚点作为单一事实来源；`LEAD_SLOT` 槽位 1..5 为魔数、6..9 为图片；`PAIR_HAS_LEAD` 按 9 锚点填充。
- `buildMagicScanIndex` 单趟同时分桶与收集：`slot <= MAGIC_SCAN_LEADS.length` 进对应桶，否则 `imageCandidates.push(i)`（**升序**）。
- `MagicScanIndex` 增加 `readonly imageCandidates: number[]`。
- `nextMagicOffset` 对图片首字节（`slot > MAGIC_SCAN_LEADS.length`）**显式退回原生 `indexOf`**——因为 `imageCandidates` 是四个首字节的**并集**，按单一首字节查询会串结果，不能当单锚点桶用。

**`src/utils/imageExtractor.ts`**：

- 导出 `IMAGE_SIGNATURE_LEADS = [PNG_LEAD, JPEG_LEAD, GIF_LEAD, BMP_LEAD]`（顺序与内部 `LEAD_KIND` 分支一致，避免两处各写一份漂移）。
- 新增**最小结构视图** `ImageScanIndexView { readonly data; readonly imageCandidates }`——刻意**不** `import` `magicScanIndex`，以免 `imageExtractor ↔ magicScanIndex` 形成循环依赖（`MagicScanIndex` 结构性满足它）。
- `scanImagesFromStream(data, index?)` 增加候选数组路径；`extractImagesFromStream(data, cache?, index?)` 透传。

**跨模块接线**（Round 139 式）：

- `docparser/assets/documentAssets.ts`：`extractImages` / `extractPictures` 加可选 `index?` 并透传。
- `pictureParser.ts`：`extractPicturesFromDataStream(dataStream, cache?, index?)` 透传。
- `docParser.ts`：新增实例字段 `private magicScanIndex: MagicScanIndex | undefined`；`parseWithFormat` 开头 `this.magicScanIndex = undefined`（每轮重置）；`parseFormatRuns` 建索引后 `this.magicScanIndex = magicIndex`；`extractImages` / `extractPictures` 透传 `this.magicScanIndex`。

**候选路径的等价性论证**（写在 `scanImagesFromStream` 上方）：

逐字节版本**唯一会产生副作用**的位置就是四个签名首字节处——`pushImageAt` 首行查 `LEAD_KIND`，非首字节立即 `return -1`，无副作用。因此：

- 候选数组 = 全部首字节位置（升序），恰好覆盖所有可能产出图片的位置；
- 配对跳过（`i += 2`）只会跳过两个**都**不是首字节的位置，不漏候选；
- `i = end` 的跳跃在两条路径上完全一致（命中后都跳到图片末尾）；
- 末字节：逐字节版主循环退出后 `if (i < len)` 收尾，必然落在 `len - 1`；候选数组里若 `len - 1` 是首字节则同样会被访问（未被跳跃跳过时）。

**回退保障**：`index === undefined`、`index.data !== data`（例如 `Data` 流与建索引的 `WordDocument` 不是同一条，或调用方截断了窗口）时一律退回逐字节路径，故**不传索引 = 逐字节等价旧实现**，既有护栏（单参数调用）自动覆盖旧路径。

## 常驻护栏与鉴别力

`tests/magicScanIndex.test.ts` 扩至 **789 行 / 31 项**（Round 142 的 18 项 + 本轮新增 13 项）：

**新增 Round 143 四组**：

1. **候选内容完整**：`IMAGE_SIGNATURE_LEADS` 与四个签名常量一致且互不重复；合成/对抗流上候选 == 四个首字节位置的**升序并集**；27 份真实流上候选完整、**严格升序无重复**且非空转；候选**不得**把非首字节收进来（与「收全部字节」区分）。
2. **双路径一致**：27 真实流 + 对抗流 + 随机流上「传索引」与「不传索引」逐项相同；**跳跃语义**——BMP 内部内嵌 PNG 时只产出 BMP（不被内部签名干扰，夹具 `bmpWithEmbeddedPng` 显式清零 PNG 块 length 字段）；多图流（`twoBmpStream`）产出顺序与逐字节路径一致；索引不属于该流、或窗口被截断时退回逐字节路径。
3. **回退保障**：`nextMagicOffset` 对图片首字节退回原生（并集候选不能当单锚点桶用）。
4. **鉴别力**：慢但等价的对照（两趟计数 + 填充）必须与 oracle 相同；负控 A（候选漏掉 BMP 首字节）、B（候选逆序）、C（候选含重复位置）必须与 oracle 不同。

**离树负控注入**（在内存改生产源后跑同一份护栏，逐项恢复并复核）——**6 组全部被检出**，恢复后 0 失败：

| 注入 | 改错内容 | 失败项 |
|---|---|---:|
| NC-1 | 删掉 `buildMagicScanIndex` 末字节收尾块 | 10 |
| NC-2 | `nextMagicOffset` 对图片首字节**不**退回原生 | 1 |
| NC-3 | 图片候选改 `unshift`（逆序，注入 2 处） | 9 |
| NC-4 | `LEAD_SLOT` / `PAIR_HAS_LEAD` 只填 5 个魔数 | 10 |
| NC-5 | 候选路径 `i = end > p ? end : p + 1` 改成 `i = p + 1` | 2 |
| NC-6 | 候选路径不校验 `index.data === data` | 1 |

NC-2 / NC-6 各只触发 1 项失败，但**确实被检出**（分别命中「图片首字节退回原生」与「索引不属于该流时退回」两条专项用例），不是空转。

## 全门禁与端到端

候选 `npm test` 全量 **80 文件 1674 项**、`npx vue-tsc --noEmit`、`npm run lint`、`npm run build`（main gzip 110.58 kB）、`npm run build:lib`（`doc-preview.js` 356.69 kB / gzip 96.51 kB）全部通过；test 与 lint **串行**执行，未并发。

双 bundle **预先构建**：`r143-base.mjs`（HEAD 未压缩 bundle）、`r143-new.mjs`（工作区）；`lib-old.mjs` / `lib-new.mjs`（dist-lib 产物）。**基线可靠性校验**：`r143-base.mjs` 与从 `git worktree`（`/tmp/dp143-head-wt`，detached HEAD `196b566`）重新构建的 bundle 在 27 份样本上**输出逐字节相同**（仅 esbuild 源路径注释不同），故配对差基线确为 HEAD 行为。交错运行中不 stash、不重建。

### 端到端判定

| 设计 | 结果 |
|---|---|
| 配对差 n=40（`r143-paired.mjs`） | NEW−OLD 中位 **−2.489 ms**，胜 **32 / 8**，p ≈ **1.48e-4**，比值 **1.0242×** |
| 交错 e2e 10 对（5 NEW 先 + 5 OLD 先，各 20 轮） | 中位数之中位数 **0.9823×（改善 1.773%）**；最小值之中位数 **0.9771×（改善 2.293%）**；配对差中位 **−1.915 ms**，胜 8 / 10 |

交错测量后半段（OLD 先的 pair 2–5）环境噪声明显抬升（出现 136.7 ms、151.8 ms 的离群值），未配对设计的绝对中位因此上抬到 98–100 ms 区间——但**配对差仍为负**（−1.915 ms），方向与配对差基准（−2.489 ms）一致，量级受争用噪声压制。两条独立设计互证：**效应真实、方向稳定、显著**。

不择优挑组、不以隔离值（1.528×）冒称端到端收益、不跨轮比较绝对 ms。

## 包体

用 `git worktree add --detach /tmp/dp143-head-wt HEAD` + 符号链接 `node_modules` 在**同一工具链**下构建 HEAD 基线，与工作区产物对比（不触碰主工作区）：

| 产物 | raw B | gzip | gzip -9 |
|---|---:|---:|---:|
| `doc-preview.js` OLD（HEAD `196b566`） | 364,069 | 95,409 | 94,501 |
| `doc-preview.js` NEW（本轮） | 365,380 | 95,940 | 95,059 |
| **差** | **+1,311** | **+531** | **+558** |
| `doc-preview.umd.cjs` OLD | 272,887 | 83,007 | 82,762 |
| `doc-preview.umd.cjs` NEW | 273,301 | 83,135 | 82,906 |
| **差** | **+414** | **+128** | **+144** |

增长来自真实代码（`SCAN_LEADS` 并集、候选数组收集与消费、`ImageScanIndexView` 视图、跨 4 个模块的可选参数透传）与保留的说明注释，以 **1.8%–2.4%** 端到端收益为代价，予以接受。

## 已否决与边界

- **`Uint32Array` + 倍增扩容存储候选**：`V2_u32` 4.816 ms 比 `V1_push` 4.433 ms **慢 0.383 ms**（扩容拷贝开销），不采纳。
- **候选进 4 个独立锚点桶（`V5_9bucket`）**：4.301 ms，且消费端需四次二分取 min 才能保持升序，复杂度与收益不成比例，不采纳。
- **`round143-concurrent/` 的 `detectCharacterStyles` 标量化**：并发 worker 的未提交候选，**未落地生产代码**（未提交、无护栏、未验证），源码/测试/patch 已无损留存，不并入本轮。
- 本轮未做 CPU 剖析（直接沿用 Round 142 的隔离基准 + 探针 + bundle 层占比口径）；未承诺整机空载、统计显著性外推或任意 DOC 收益；覆盖边界为 27 份 DOC/DOT。

## 收尾

证据常驻 `.workbuddy-ai/perf-harness/`（`r143-base/new/lib-*/dump*/libdump*/imgprobe/mergeexp/mergebench/paired/e2e-interleave/wdocs/collect/magic-old/img-old` 与 `round143-concurrent/`），均为 gitignore 的常驻脚手架，不清理。根目录 `.prof*` / `.bench*` / `.e2e-*` 为零；`git worktree list` 中 `/tmp/dp143-head-wt` 用后移除。既有状态文件自然修改、`outputs/` 未跟踪均保留，不冒称整个工作区干净。历史 `progress.md` 缺号与 Round67 重复、`docs/changelog/` 缺号属历史账本，不补造。下一轮 144，目标 208。
