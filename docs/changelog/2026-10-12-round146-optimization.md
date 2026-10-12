# Round 146：一次解析内按 `which` 共享表格流（0Table/1Table）读取结果

## 结论与候选

采纳「同一次解析内按 `which`(0|1) 缓存表格流解析结果，命中不再 `readStream` 出新拷贝」。
这是 Round 145 收尾侦察（`perf-harness/recon-readprobe*.mjs`）定位到但未开轮的候选。

## 前提：真实数据探针（当前 HEAD bundle 复测）

- `readStream` 每轮（27 份）共 **280 次**调用；按流名：`1Table` **141**、`Data` 58、
  `WordDocument`/`SummaryInformation`/`DocumentSummaryInformation` 各 27。
- **重复读取 6.143 MB/轮**（占全部读取字节约 43%）：
  `1Table` 141 次调用总读 5,790 kB、唯一 1,011 kB = **5.73×**（重复 4,779 kB）；
  `Data` 58 次总读 2,184 kB、唯一 672 kB = 3.25×（重复 1,512 kB）。
- 根因：`findTableStream` 每次调用都 `readStream` 出一份新拷贝，而一次 `parseWithFormat()`
  有 5 个上游入口反复调它（`docParser.parseFormatRuns`：640、FKP 惰性建表：657、
  `extractFormattedText`：1455、`storySplitter` PlcfHdd：240、`documentAssets` DOP：295；
  `formatRecovery` 的同名函数是全仓无引用的停放 WIP，已 tree-shake）。
- `--cpu-prof`（80 轮 × 27 份，per-round 93.28 ms）：`readRegularStream` 自耗 **2.56%**
  （整轮第 10 大项）；其余大头不变（`createParagraphsWithRealFormats` 14.59%、GC 11.14%、
  `applyStructuralFormats` 10.24%、`buildMagicScanIndex` 4.33%）。

## 实现

- `clxReader.ts`：`ClxContext` 新增可选字段 `tableStreams?: Map<0|1, StreamData | null>`；
  两处 `ctx.ole.findTableStream(...)` 收敛到 `findTableStreamForClx()`——先查缓存
  （`undefined`=miss / `null`=已解析且无表格流，两者严格区分），miss 才解析并写回。
  缓存省略时行为与改动前逐字节一致。
- `docParser.ts`：新增实例字段 `tableStreamCache`，经 `clxCtx` getter 注入；
  `parse()` 与 `parseWithFormat()` 入口处 `clear()`（Round139/143 同模式，
  缓存只服务于「同一次解析」）。`OleParser.readStream` 本体不动，其
  「每次返回调用方独占副本」的公开契约（tests/oleParser.test.ts:790-799）不受影响。
- **等价前提已逐一读码确认**：全部表格流消费方只读——`readClxData`/`readTableStream`
  只 `subarray`；`parseFormatRuns` 系（CHPX/PAPX/STSH/Ffn/LST/LFO/Fld/RMark/书签/分节）、
  `storySplitter` 的 `parsePlcfHdd`、`documentAssets` 的 `parseDop` 均为边界检查后的读表解析。
  守卫测试对 27 份真实流逐一运行这些消费函数并断言共享数组字节不变。

## 证据链（全部在最终源码上重跑，bundle 与最终源码 cmp 一致）

- **探针（候选）**：`1Table` 141 → **27** 次调用；总 `readStream` 280 → 166；
  重复读取字节 6.143 MB → **1.476 MB**（剩余全部是 `Data` 流，留作后续轮次）。
- **隔离基准**（`round146-isobench.mjs`，clxReader 函数级、27 份真实表格流、
  每份 5 次调用 = 真实均值 5.22、配对 60 轮）：OLD 0.849 ms → NEW 0.166 ms = **5.103×**；
  双路径产出逐字节一致。
- **端到端配对**（同进程相邻交错、逐对反转顺序，27 份 `parseWithFormat`）：
  n=400 中位 **+1.595%** / 胜 226/400 / 块 8/10 为正；
  n=400 中位 **+1.059%** / 胜 267/400 / 块 **10/10** 为正；
  n=600 中位 **+1.185%** / 胜 388/600（64.7%）/ 块 **10/10** 为正、块中位差之中位数 +1.042 ms。
  合计 n=1400 胜 881/1400 = 62.9%（二项 z≈9.7 ⇒ p≈1e-21）。每次运行均带 27 份
  16,247,039 字符逐字符一致性核验。
- 独立进程交错（e2e.mjs，NEW/OLD 各 6 个 20 轮进程、正反序）：本机当时负载 3.3–4.2，
  OLD 方差极大（83–97 ms）导致中位数口径失真，但 NEW 的 min-of-min 79.997 < OLD 80.509；
  采信同进程配对口径（Round144/145 同惯例）。
- **等价性**：27 份完整 `parseWithFormat` **16,247,039 字符逐字节一致**（dump cmp）。
- `bench-diff 146` 与 `145` 除 `cycle`/`timestamp` **逐字段相同**
  （`median` 0.9502433994244857）。
- **门禁**：82 文件 1711 项 + vue-tsc + lint + app/lib 双构建全通过（test/lint 串行）。
- **包体**（git worktree `/tmp/dp146-head-wt` detached HEAD 2ee11b4、同工具链
  `npm run build:lib` 基线，用后已移除）：`doc-preview.js` raw 365,927→367,368
  （**+1,441 B**）/ gzip-9 95,201→95,783（**+582 B**）；`umd.cjs` raw 273,613→273,895
  （+282 B）/ gzip-9 83,026→83,119（+93 B）。以 +1.0–1.6% 的实测端到端收益接受。

## 护栏（tests/clxReader.tableStreamCache.test.ts，446 行 11 项）

1. **等价性**（3 项）：27 份真实文件 `readTableStream`/`readClxData` 双路径逐字节一致、
   命中返回同一对象且内容稳定；合成双表格流 OLE 上 `which=0/1` 同缓存互不串键。
2. **真实覆盖**（2 项）：27 份文件每份 5 次调用下 `findTableStream` 只解析 1 次
   （Proxy 计数）；无表格流目录下 miss 的 `null` 也被缓存（`undefined`/`null` 区分）。
3. **只读性**（2 项）：27 份真实流上对共享数组运行全部真实消费函数后字节不变
   （两轮共 >1000 个产出项）+ 篡改检测元断言。
4. **鉴别力**（4 项）：独立重写骨架的 3 个负控（wrongKey / sliceHit / stale 跨文档不清）
   必须与 oracle 不同；「慢但等价对照」（不带缓存）与生产带缓存路径 27 份一致。
- **离树负控**：把生产 `findTableStreamForClx` 的键临时改为恒 0，4 个用例失败
   （等价 2 + 覆盖 2），恢复后 11/11。

## 给下一轮的交接

- `Data` 流重复读取仍在：58 次调用、重复 1,512 kB/轮（4 个调用点
  docParser:1022 / formatRecovery:460 / documentAssets:147 / storySplitter:221）。
  注意 `readStream` 每次 `new Uint8Array`，「同内容不同对象」不能按身份键控，
  且 Data 流消费方是否只读需另行读码确认（本轮未动）。
- `bytesToBase64` 分块 `fromCharCode.apply`（约 2.90%）与
  `createParagraphsWithRealFormats` 对象展开（约 3.7%）仍待独立复核。
- 剖析 top4（`createParagraphsWithRealFormats` / GC / `applyStructuralFormats` /
  `buildMagicScanIndex`）均为千刀万剐型，后续优先找可合并的整块工作。

版本 0.7.66 → 0.7.67。
