# Round 142：合并四个魔数扫描器的 5 趟原生 `indexOf` 为单趟共享扫描索引

## 结论与候选

采纳「同一次解析内，为 `WordDocument` 流建一次共享魔数扫描索引，把 shapes / equations / charts / wordart 四个扫描器合计 **5 趟**原生 `indexOf` 合并成 **1 趟** JS 扫描」候选。

- 隔离（`round143-mergebench.mjs`，纯内存）：5 趟原生 `indexOf` 7.549 ms → 单趟合并 3.452 ms，**2.19×**，27 条流 × 5 个锚点的位置序列零失配。
- 端到端（安静窗口原型实测）：**改善 5.681%，四组零重叠**。
- 端到端（本轮配对差，机器高负载下）：NEW−OLD 中位差 **−4.258 ms（胜 33 / 负 7）** 与 **−2.792 ms（胜 42 / 负 18）**；同轮原型对 M1−M0 为 **−3.133 ms（31 / 9）** 与 **−2.695 ms（45 / 15）**。两对方向与量级一致，确认「移植保真 + 效应真实」。
- 27 份完整 `parseWithFormat` 结果 **16,247,039 字符逐字节一致**；`bench-diff 142` 与 `141` 除 `cycle`/`timestamp` 全字段相同。
- 包体（同工具链 HEAD 基线对比）：raw **+1,152 B**、gzip **+304 B**。拟从现场 0.7.62 升至 **0.7.63**。

## 本轮起点：接管被废弃的 142 in-flight

本轮开始前状态为 `completedRounds 141 / currentRound 142 / inFlight true / updatedAt 2026-10-12T03:39:28Z`。至本次触发已逾 90 分钟门禁（118.9 分钟）、HEAD 仍为 `d91fb2d` 无新提交、进程表内无任何 `vitest`/`esbuild`/`npm` 进程（仅有 IDE 与 MCP 常驻）——按 Round 139 先例判定该 in-flight **已废弃**，按协议接管 142。

前一位 worker 的未提交候选（`detectCharacterStyles` 主循环标量化 + 惰性物化，`textHeuristics.ts` +12/−10，另附差分 oracle 测试）**未落地任何生产代码**：其自有隔离测量为 1.36×、而该函数在本轮剖析中占比约 0.87%，低于本项目历史上多次被否决的亚 1% 阈值（Round 117/134/140），且其 142 未完成任何验证。故本轮改选「合并魔数扫描」这一端到端已实测稳赢的候选。前者的源码、测试与 patch **已无损留存**于 `.workbuddy-ai/perf-harness/round142-abandoned/`（`textHeuristics.round142.ts`、`textHeuristics.round142.test.ts`、`round142.patch`），工作区已还原至 HEAD。

## 前提与占比

真实语料 27 份 `WordDocument` 流共 5,767,130 B，五个锚点实测密度：

| 锚点 | 用途 | 命中数 | 占比 |
|---|---|---:|---:|
| `0xD0` | 图表 OLE | 6,610 | 0.115% |
| `0x50` | 图表 ZIP | 30,439 | 0.528% |
| `0xF0` | shapes FDG | 6,752 | 0.117% |
| `0xEF` | equations | 4,878 | 0.085% |
| `0xE0` | wordart | 7,278 | 0.126% |
| **并集** | | **55,957** | **0.970%** |

并集远低于「锚点 ≥2% 时 `indexOf` 跳跃无益」的经验门槛，故单趟合并扫描（字节对查表跳 2）在 94.7% 的迭代上只付两次数组读取。

bundle 层插桩（`round143-scanpatch.mjs` / `round143-scanrun.mjs`，未改 src）在真实 `parseWithFormat` 内量到的占比与剖析自耗吻合：`shapesData` 0.197 ms、`shapesDoc` 1.559、`equations` 1.468、`charts` 3.337、`wordart` 1.607，**5 趟合计 8.186 ms = 8.78%**（剖析自耗 8.04%）。

> 口径修正：`93.2 ms` 是**整个语料（27 份）一轮**的 `parseWithFormat` 时间，不是单份；5 趟扫描 8.19 ms/轮 与之同量级，模型自洽（5 趟 × 5.77 MB ÷ 3.91 GB/s ≈ 7.4 ms）。

## 实现与等价性

新增 `src/utils/docparser/magicScanIndex.ts`：模块级 `LEAD_SLOT`（256）与 `PAIR_HAS_LEAD`（65536）两张零分配查表；`buildMagicScanIndex(data)` 单趟扫描、按锚点分桶（末字节单独收尾）；`nextMagicOffset(index, data, lead, from)` 在桶上二分，**`index` 省略、`index.data !== data` 或锚点不在索引内时一律退回原生 `data.indexOf`**。

四个扫描器各加**可选**第 2 参 `magicIndex?: MagicScanIndex`（`extractChartsFromWordDocumentStream`、`extractShapesFromWordDocumentStream` → 内部 `extractShapes`、`extractEquationsFromWordDocumentStream`、`extractWordArtFromDrawingData`），共替换 9 处 `indexOf`（charts 6 / shapes 1 / equations 1 / wordart 1）。`parseFormatRuns`（`docParser.ts:595`）在四个 WordDocument 调用点之前**惰性建一次**索引并下传——四个消费者共用同一个 `wordDocData` 参数对象，按构造即同一身份，无需身份探针；`extractShapesFromDataStream` 用的是 Data 流的另一对象，不传索引（688 KB × 1 趟 ≈ 0.18 ms，不值得合并）。

**不传索引 = 逐字节等价旧实现**，故既有护栏（全部以单参数调用）自动覆盖旧路径。可证等价：对任意 `from`，`nextMagicOffset` 返回 `bucket[lead]` 中第一个 `>= from` 的元素，正是反复 `data.indexOf(lead, from)` 的枚举结果；四个循环的 `from` 单调性（含 `shapes` 的 `offset = p - 3` 回退）不再是证明前提，因为二分对任意 `from` 恒等。

**护栏查出的真实缺陷（本轮自纠）**：初版把负 `from` 当成 0，且用 `Math.floor` 归一化。`Uint8Array.prototype.indexOf` 的 `ToIntegerOrInfinity` 实际是「**向零截断**、**负数相对流末尾**（`max(length + from, 0)`）、`NaN` → 0」。生产调用点全部传非负整数故行为未受影响，但原语必须真正等价——已改为 `Math.trunc` + 负值相对末尾，并补一条显式负非整数用例（`from = -2.5` 且锚点落在 `len-2` 与 `len-3` 上，可区分「向零截断」与「向下取整」）钉死语义。

## 常驻护栏与鉴别力

新增 `tests/magicScanIndex.test.ts` 共 **18 项**：

- **原语等价**：对抗性用例（len 0/1、锚点铺满、锚点只在首/末字节、全零）与 200 个随机小缓冲上**穷尽 `from ∈ [-3, len+2]`**；27 份真实流上穷尽全部命中位置及其后一位、加 400 步**前进/回退各半**的 `from` 序列（正是 `shapes` 的回退形态），检查数 > 50,000；负 `from` / `NaN` / `±Infinity` 归一化；索引错配与锚点未入索引时退回原生。
- **分桶完整**：合成流与对抗流上分桶 `toEqual` 逐个 `indexOf` 的完整枚举；27 份真实流同样逐锚点 `toEqual`，并断言总命中数 **> 50,000**（防空转）。
- **扫描器双路径一致**：4 个扫描器在 27 份真实流、合成流（**断言真实产出图表数 > 0**）与对抗长度上，「传索引」与「不传索引」输出逐项相同。
- **鉴别力**：慢但等价的对照（两趟计数建表 + 线性扫描）必须与 oracle 相同；3 个故意改错的变体必须与 oracle 不同。
- **复杂度**：5.8 MB 全锚点与稀疏锚点缓冲区建表 < 5000 ms。

**离树负控注入**（在内存改生产源后跑同一份护栏，逐项恢复并复核）——三者均被检出，且恢复后 18/18 全绿：

| 注入 | 改错内容 | 失败项 |
|---|---|---:|
| NC-A | 删掉末字节收尾 | 7 |
| NC-B | 二分写成 `bucket[mid] <= target` | 5（**含 27 份真实流的扫描器双路径一致性**，证明扫描器级护栏非空转） |
| NC-C | 字节对查表只填一半（漏 `(other << 8) | lead`） | 10 |

NC-A 只影响 `from > len - 100` 的查询，故扫描器级用例仍通过——这正是「扫描器永远不查 `limit` 之后」的预期行为，已在护栏里以「末字节是锚点时也被收录」的独立原语用例覆盖。

## 全门禁与端到端

候选 `npm test` 全量 **80 文件 1661 项**、`npx vue-tsc --noEmit`、`npm run lint`、`npm run build`（main gzip 110.41 kB）、`npm run build:lib`（doc-preview.js 355.65 kB / gzip 95.96 kB）全部通过；test 与 lint **串行**执行，未并发。

双 bundle **预先构建**（`round142-build.mjs`：OLD 来自 `git archive HEAD src` 的临时解包，NEW 来自工作区），交错运行中不 stash、不重建。

### 端到端判定：为什么改用配对差

首轮采用「4×NEW / 4×OLD 取中位」得 `NEW/OLD = 1.0392`（**退化 3.92%**），与安静窗口原型的 +5.681% 矛盾。同轮把**四个模块**（NEW / OLD / 原型 M1 / 原型基线 M0）放进一次交错后发现：**原型 M1 也退化 3.674%，与 NEW 的 3.531% 相差仅 0.14%** —— 移植保真，差异全部来自环境。实测当时 **load average 一度到 13.07（10 核）**，`OLD` 中位从安静期的 ~95 ms 涨到 108–176 ms，未配对设计的噪声（±5%）已盖过候选效应（~4%）。

改**配对差**设计（每对内相邻测 NEW 与 OLD、顺序逐对交替，慢变负载在差里相消），并把原型对 (M1, M0) 作为第二对同时测量：

| 轮次 | 对 | 中位差 | 胜出 |
|---|---|---:|---|
| n=40 | NEW − OLD | **−4.258 ms** | 33 / 7 |
| n=40 | M1 − M0 | **−3.133 ms** | 31 / 9 |
| n=60 | NEW − OLD | **−2.792 ms** | 42 / 18 |
| n=60 | M1 − M0 | **−2.695 ms** | 45 / 15 |

两对方向一致、量级一致；合并 NEW 胜 **75 / 25**（二项零假设下 p ≈ 3e-7）。相对安静期 ~93 ms 基线，效应量级约 **3.0%–4.6%**。安静窗口的 +5.681%（四组零重叠）是同一候选在低负载下的直接测量，两者不冲突：配对差在高负载下是**保守下界**（中位差里仍含争用噪声）。

不择优挑组、不以隔离值冒称端到端收益、不跨轮比较绝对 ms。

## 包体

用 `git worktree add --detach /tmp/dp-head-wt HEAD` + 符号链接 `node_modules` 构建 HEAD 基线，与工作区产物在同一工具链下对比（不触碰主工作区，用后 `git worktree remove` 清理）：

| | raw B | gzip（默认级别） | gzip -9 |
|---|---:|---:|---:|
| OLD（HEAD `d91fb2d`） | 362,917 | 95,105 | 94,198 |
| NEW（本轮） | 364,069 | 95,409 | 94,501 |
| **差** | **+1,152** | **+304** | **+303** |

同工具链的 esbuild bundle 亦为 raw +758 B / gzip +457 B，与上表同量级。增长来自真实代码（两张查表 + 单趟扫描 + 9 处替换 + 可选参数透传）与保留的说明注释，以 **3.0%–4.6%** 端到端收益为代价，予以接受。

## 已否决与边界

- **`scanImagesFromStream` 改原生 `indexOf` 跳跃**：真实锚点密度实测四签首字节并集 `Data` 流 2.93%（0xFF 单项 2.52%）、`WordDocument` 流 1.71%，最差单流达 15.16%，远超 2% 门槛 → 否决。
- **`extractChartsFromWordDocumentStream` 自身改单锚点**：2 趟原生 `indexOf` 已占其 3.34 ms 的 83%，换单锚点只省 0.59 ms（≈0.6% 总量），不达可分辨度 → 否决。
- **`readStream` 按 entry 身份缓存**：`tests/oleParser.test.ts:790-799` 是既有公开契约（每次返回调用方独占新副本），不可证等价 → 否决。
- **`detectCharacterStyles` 标量化**：本会话独立实测 1.36× / 1581-1581 等价，但占比约 0.87% → 本轮未采纳（见上文接管说明）。
- **图片扫描并入同一索引**（9 锚点并集 ≈2.68%，预期 ≈7.8%）：图片命中后 `i` 跳到 `end`，需要的是单一升序候选数组而非按锚点分桶；且图片路径不在 `parseFormatRuns` 内，需 Round 139 式跨模块接线 → 留作后续轮次，不与本轮混做。
- 本轮未做 CPU 剖析（直接沿用 141 遗留 `round141-profile.mjs` / `round141.cpuprofile` 与 bundle 层插桩占比，二者互证）；未承诺整机空载、统计显著性外推或任意 DOC 收益；覆盖边界为 27 份 DOC/DOT。

## 收尾

证据常驻 `.workbuddy-ai/perf-harness/`（`round142-*`、`round143-anchordensity/mergebench/lowerbound-fuzz/mergepatch/merged/mergerun/scanpatch/scanrun`），均为 gitignore 的常驻脚手架，不清理。根目录 `.prof*` / `.bench*` / `.e2e-*` 为零；`git worktree list` 已无本次临时工作树。既有状态文件自然修改、`outputs/` 未跟踪、memory 本地忽略均保留，不冒称整个工作区干净。历史 `progress.md` 缺号与 Round67 重复、`docs/changelog/` 缺号属历史账本，不补造。下一轮 143，目标 208。
