# Round 147：真实 CHPX 格式可用时跳过 `styles` 计算

## 结论与候选

采纳「真实 CHPX 格式可用时，`createParagraphsWithRealFormats` 不再调用 `detectCharacterStyles`
（即 `guessCharFormat` 始终携带的 `styles` 键整段丢弃的那部分代价）」。

此候选由并发 worker 在 2026-10-12 的 Round 147 in-flight 窗口内实做并提交到工作树（未提交源码），
本会话在 90 分钟门禁解锁后按 Round 139/142/143 先例接管并补护栏、闭环。

## 前提：真实数据剖析

- `guessCharFormat` 每次都无条件调用 `detectCharacterStyles`。但 `createParagraphsWithRealFormats`
  在真实 CHPX 格式可用时，会把合并结果里的 `styles` 键**整个丢弃**（`{...charFormat, ...merged}`
  的 rest 解构排除 styles）——真实 27 份语料实测 **97% 的段落走这条路**。
- 即绝大部分 `detectCharacterStyles` 的产出（自耗 **4.02%** + 正则 **1.10%**，合计约 5.1%）
  与每段落一次多余的样式段对象分配**纯属浪费**。这正是 `--cpu-prof` 里
  `createParagraphsWithRealFormats` 自耗（整轮第 1 大项 ~13–15%）中可被整块拿掉的一块工作。

## 实现

- `textHeuristics.ts`：提取唯一实现体 `guessCharFormatCore(text, withStyles)`；
  `withStyles=false` 时**不建 `styles` 键**（不是「建空数组再删」）；`guessCharFormat`
  在 core 之上补 `styles = detectCharacterStyles(text)`，`guessCharFormatWithoutStyles` 直接返回 core。
  两者的产出**逐键相同，只差 `styles` 键是否存在**。
- `docParser.ts`：把 `merged`（piece-level CHPX + `mergeCharFormatForParagraph` 回退）的计算
  **前移**到 `guessCharFormat` 之前；用 `hasRealCharFormat = Object.keys(merged).length > 0`
  路由——真实格式段落走 `guessCharFormatWithoutStyles`（省一次 `detectCharacterStyles` + 一次对象分配），
  非真实段落仍走 `this.guessCharFormat`（旧语义完全保留）。合并块从「两处展开 + rest 解构」改为
  「一次展开 + `if ('styles' in)` 兜底」，键集合与顺序（除 styles 外）与旧版一致；`in` 兜底保证
  未来 `merged` 万一带 styles 键时仍整键丢弃。

## 证据链（全部在最终源码上重跑；base=HEAD 69f4470、cand=工作树双 bundle，均绝对入口重建、grep 标记 base=0/cand=3）

- **等价性**：27 份完整 `parseWithFormat` 结果 **16,247,039 字符逐字节 cmp 一致**（dump + `cmp` 退出 0）。
- **端到端配对**（同进程相邻交错、逐对反转顺序，27 份 `parseWithFormat`，`r147-paired.mjs` 400 轮）：
  中位差 **+7.657 ms/轮**、均值 +7.54 ms、cand 更快 **378/400（94.5%）**、二项 z=17.8、p≈0；
  相对整轮（Round145 基线 ~94 ms/轮）约 **+8.1%**。每次运行均带 16,247,039 字符逐字符一致性核验。
- `bench-diff 147` 与 `146` 除 `cycle`/`timestamp` **逐字段相同**（候选产物与 146 逐字节一致，自动等同）。
- **门禁**：全量 `npm test` **83 文件 1722 项**全过、`npx vue-tsc --noEmit`、`npm run lint`、
  `npm run build`、`npm run build:lib` 全通过（test/lint 串行）。
- **包体**（base/cand 同工具链 docParser bundle 代理度量，且 cand 已在主仓库 `npm run build:lib` 复测）：
  bundle raw **−583 B** / gzip **+45 B**，纯重构净中性；主仓库 `npm run build:lib` 产
  `doc-preview.js` 367,597 B / gzip 96,727 B（dist-lib 与本地逐字一致）。

## 护栏

1. **并发 worker 新护栏** `tests/docParser.round147.test.ts`（293 行，**11/11**）：65,536 码元穷举
   （除 `styles` 键外逐键逐值逐键序相同）+ 决策层差分（真实语料 × 9 个 `merged` 变体含对抗，
   JSON 逐字节相同）+ 真实语料不变量（97% 段落 `charFormatFromReal` 且无 `styles` 键；
   >1000 个无真实格式段落 `styles` 仍等于 `detectCharacterStyles`）+ 4 个负控 + 元断言
   （源码确实接线新函数与 `in` 兜底）。
2. **更新 3 个已有护栏**（不改动候选，仅随新路由更新；对 textHeuristics 模块导出
   `vi.spyOn(...).mockReturnValue(base)` 拦截 `guessCharFormatWithoutStyles`）：
   - `tests/docParser.test.ts` `Round126/133 expectLegacyMerge`：增 `guessCharFormatWithoutStyles` spy，
     调用断言改指该模块函数；真实格式段落原走实例方法 `guessCharFormat`，现走模块函数需同步 mock。
   - `tests/docParser.test.ts` `Round128 check`：同上增 spy；调用计数断言改为
     `guessCharFormat` 与 `guessCharFormatWithoutStyles` 合计 = 段落数（真实段走后者、非真实段走前者）。
   - `tests/textHeuristics.round140.test.ts`：包裹并验证 `guessCharFormatWithoutStyles` 产物等于
     `guessCharFormat` 减 `styles` 键；计数断言更新为 `guessCharFormat` 仅非真实段 **1012** 次、
     `guessCharFormatWithoutStyles` 真实段 **32690** 次、合计 **33702** 不变，且非真实段仍产出 styles、
     真实段不再产出 styles。

## 给下一轮的交接

- `createParagraphsWithRealFormats` 仍是整轮第 1 大自耗项（~13–15%），其内部可继续找整块工作：
  候选已省下真实段的 `detectCharacterStyles` 与一次对象分配，但非真实段（<3%）仍走旧路径；
  该函数的对象展开/解构（约 3.7%）与 `bytesToBase64` 分块 `fromCharCode.apply`（约 2.90%）仍待独立复核。
- `applyStructuralFormats`（写-读依赖链、合并上限 <1%、等价风险高）本轮已评估为**默认否决、降级备份候选**，未落地。
- 剖析 top4（`createParagraphsWithRealFormats` / GC / `applyStructuralFormats` / `buildMagicScanIndex`）
  均为千刀万剐型，后续优先找可合并的整块工作。本轮未做新的多轮剖析；不承诺整机空载/统计显著性
  外推/任意 DOC 收益，覆盖边界 27 份 DOC/DOT。

版本 0.7.67 → 0.7.68。
