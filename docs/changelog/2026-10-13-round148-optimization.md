# Round 148：同一次解析内共享 `Data` 流读取

## 结论

采纳「同一次 `parse()` / `parseWithFormat()` 内按 **Data 目录条目身份** 共享 `Data` 流读取结果」，
版本 0.7.68 → 0.7.69。这是 Round 146 表格流缓存明确留给后续轮次的「同内容不同对象」型重复：
`OleParser.readStream` 每次 `new Uint8Array`，Round 139 的「视图对象身份」键控抓不到，须换成
**条目对象**键控才可及。

## 前提：真实数据剖析与探针

- `--cpu-prof`（40 轮 × 27 份，median 90.98 ms/轮）：`createParagraphsWithRealFormats` 11.56%、
  GC 10.52%、`applyStructuralFormats` 12.79%（bundle 内两份副本合计）、`buildMagicScanIndex`
  4.24%、`bytesToBase64` 4.16%、`decodeRangeWithoutGuard` 3.80%。
- **探针 r148-dataprobe.mjs**（给 bundle 的 `readStream` 注入堆栈记录）：一次 `parseWithFormat`
  读 `Data` 流 **58 次、共 2,236,262 字节**，四个上游入口——
  `docParser.parseFormatRuns`→`extractShapesFromDataStream`（18）、`documentAssets.extractImages`（18）、
  `documentAssets.extractPictures`（18）、`storySplitter.splitHeaderParts` 页眉页脚图片 `parsePicfAt`（4）。
  约 18–22 份文档带 Data 流，平均 **3.25 次重复读**同一份全流拷贝。
- **测量注记**：`perf-harness/recon-profile.mjs` 硬编码 `/tmp/dp146-ro-bundle.mjs`（Round 146 旧 bundle），
  首次剖析实际跑的是陈旧源码、作废重跑；新建 `r148-profile.mjs` 改为 **bundle 路径参数化**。

## 实现

- 新模块 `src/utils/docparser/dataStreamCache.ts`：`readDataStreamShared(ole, directory, cache?)`
  先 `findStreamByName(directory,'Data')`，命中缓存（按**条目对象**）直接返回视图，miss 才
  `readStream` 并写回；缺流/空流返回 `null` 且**不占键位**。
- `docParser.ts`：实例字段 `dataStreamCache = new Map<DirectoryEntry, Uint8Array|null>()`，
  `parse()` / `parseWithFormat()` 入口 `clear()`；`assetCtx` / `clxCtx` 注入 `dataStreams`。
- 四个消费点全部改走共享函数，各自保留原有长度门槛（`> 0` / `>= 64`），与旧逐调用判断等价；
  `OleParser.readStream` 本体不动（公开契约不变）。
- 条目身份键控相对 Round 146 的 `which` 键控的一个结构优势：不同文档/不同流的条目天然是不同键，
  「跨流/跨文档串键」这一类失败在结构上不存在（护栏负控因此针对本设计真实存在的失败模式）。

## 证据链（最终源码上重跑；base=HEAD 7e3fc1a）

- **隔离基准**（r148-isodata.mjs，27 份真实流、配对 60 轮）：`readStream('Data')` 总耗时
  **0.486 → 0.164 ms/轮**（配对中位差 −0.3135 ms、58/60 胜出）；读取次数 **58 → 18**、字节
  **2,236,262 → 688,052**。
- **下游效应（接线后重测，Round 139 纪律）**：共享视图使 `extractPictures` 的 Data 兜底魔数扫描
  与图片 base64 开始命中 `ImageWorkCache`（旧实现每次读都是新对象、天然不命中）。
  CPU 剖析对比（HEAD 3658 ticks vs 候选 2831 ticks，各 40 轮）：`readRegularStream` 63→41、
  `bytesToBase64` 152→116、`buildMagicScanIndex` 155→129、GC 385→322（绝对 tick；总 tick 同轮
  受负载窗口影响，此处只作方向性佐证）。
- **端到端（同进程配对，最终源码双 bundle，n=400）**：中位 **+0.544%**、配对中位差 **−0.542 ms**、
  配对均值 −0.275 ms、newMin−oldMin **−0.883 ms**、胜 230/400（57.5%，z≈1.9）。
  累计 6 个独立配对会话（400/800/300×3/400）合计胜 **1389/2400 = 57.9%**（z≈7.7，p≈1e-14）。
  协议交错 4×NEW/4×OLD 独立进程 min：1/4 组候选更快，其余处于跨会话漂移（±4%）内——
  按 Round 146 纪律采信同进程配对差/min 口径。
- **等价性**：27 份完整 `parseWithFormat` 结果 **16,247,039 字符逐字节一致**，三路比对
  （esbuild cand bundle / dist-lib cand / dist-lib HEAD 基线）全部相同。
- `bench-diff 148` 与 `146` 除 `cycle`/`timestamp` **逐字段相同**。
- **门禁**：全量 `npm test` **84 文件 1735 项**（较上轮 +13）、`npx vue-tsc --noEmit`、`npm run lint`、
  `npm run build`、`npm run build:lib` 全通过（test/lint 串行）。
- **包体**（git worktree `/tmp/dp148-head-wt` detached HEAD 7e3fc1a，同工具链基线，用后移除）：
  `doc-preview.js` raw 367,597→369,115（**+1,518 B**）/ gzip-9 95,833→96,310（**+477 B**）；
  `umd.cjs` raw 274,035→274,212（+177 B）/ gzip-9 83,175→83,208（+33 B）。

## 护栏

`tests/dataStreamCache.test.ts` **13 项**：
1. **等价性**：27 份真实语料带/不带缓存双路径逐字节一致，命中返回同一对象，缺流/空流不占键位，
   真实覆盖断言（≥10 份带 Data 流）。
2. **真实覆盖**：Proxy 计数——每文件 `readStream('Data')` 恰 1 次（重复 5 次查询全部命中）。
3. **端到端接线**：真实 `DocParser` 内四个消费点合计只读 1 次；同一实例连续两次解析各读 1 次
   （入口 clear 生效）；有图文档 `document.images` 仍非空（≥3 份实测）。
4. **只读性**：四个真实消费函数（shapes / 魔数扫描 / PICF 兜底扫描 / parsePicfAt）在共享视图上
   逐一运行后字节不变 + 篡改检测元断言。
5. **鉴别力**：独立重写骨架的 3 个负控（命中返回 4 字节切片 / 键退化为流名跨文档串流 /
   miss 时读错流）全部与 oracle 不同 + 慢但等价对照通过。
6. **接线元断言**：源码断言四个调用点与两个注入点在位。

**离树负控（注入生产源码，检出后还原并 `diff` 验证字节级还原）**：①命中返回切片 → 2 项失败；
②`assetCtx` 摘除 `dataStreams` → 2 项失败；③`parseWithFormat` 入口移除 clear → 2 项失败（接线元断言）。
恢复后 13/13。

## 已否决

- `bytesToBase64` 分块 btoa（CHUNK 改 8190=3 的倍数，逐块 btoa 后拼接——数学上严格等价，
  自检 21 种真实尺寸输出逐字符相同）：隔离实测 **0.968×（更慢）**，不落地。`0x2000` 分块
  + 单次 btoa 维持现状。

## 给下一轮的交接

- `createParagraphsWithRealFormats` 仍为第 1 大自耗项（11.56%），剖析内部对象展开/rest 解构
  合计约 2% 可继续复核（注意键序约束：`{...resolved, ...newPara}` 的 resolved-先行序不能
  用原地赋值保持）。
- `applyStructuralFormats` 12.79% 维持默认否决（写-读依赖链、合并上限 <1%、等价风险高）。
- `bytesToBase64` 4.16%：分块 btoa 已否决；`decodeRangeWithoutGuard` 3.80% 本轮未动。
- 本机负载 4.5–7（用户应用占满），端到端效应 ~0.3% 处于噪声底噪；测量纪律以配对差与 min 为准。

版本 0.7.68 → 0.7.69。
