# R432 A 域隔离待命方案（已撤单留档）· vue-dev-6 · 2026-08-26

状态：**作废未执行，留档备用**。leader 仲裁选 A：docParser.ts 单点语法错误已被 vue-dev-3 长回合自行修复（captain 两采样实证），其存活收敛中；本预案若未来确需隔离可直接复用。方案基于 15:00-15:10 时点现场测绘，复用前须重新校验行数/足迹。

## ⭐ v2 增补（15:40 · vue-dev-6 独立验证后）——基线语义已变更

vue-dev-3 于 15:19:30 停笔交回，声称树为**全绿 A 完整态**。我于 15:35 只读独立验证全数证实：
- `npm run build` ✅ vue-tsc 0 错误（vite 0.80s）
- `npm test` ✅ **58 文件 / 1287 用例全绿**
- renderGolden ✅ **11/11**
- docParser.ts = **3398 行（含完整 A 块）**；写入静默自 15:19:30

**推论**：R432 的隔离前提（62 失败不收敛）已消失——A 域自行收敛成功，当前树即新基线。

### 新基线快照（md5 清单 @15:35，快进/比对锚点）
| 文件 | 行数 | md5 |
|---|---|---|
| src/utils/docParser.ts | 3398 | bdf33e642605ccd026fb71d124650307 |
| src/utils/docparser/clxReader.ts | 279 | ec88e61e8f1bc64c36b942c4cdf64a97 |
| src/utils/docparser/pieceTable.ts | 134 | 23474e4329fac0b3067fd8eae865da62 |
| src/utils/docparser/storySplitter.ts | 278 | 241ca073386e2644bda0cf1b1c8990c7 |
| tests/docParser.test.ts | — | f6c6412fbf2e8dc555b3e874669b8ef4 |

### 复用裁决树（替代原"一律回退 B 基线"语义）
1. 若 A 域后续出现回归需隔离 → **先做内容级快照**（cp docParser.ts + docparser/*.ts + 相关 tests 至 parking 目录，保住可快进的绿态），再按本方案手术；
2. 回退目标改为二选一由 captain 裁定：a) 旧 B 态（本文原方案，3636 行）或 b) 快照保全的绿-A 态定点修复；
3. vue-dev-3 移交的「四条 restart 必知坑位」分析全文尚未到达我处（leader 转呈中）——收到后补录本档 §六。

## 一、适用前提（触发条件）
A 域(pieceTable/storySplitter) WIP 需隔离回退、且确认**单写者窗**（vue-dev-3 明确放笔或会话终断）。双写者并存时禁止执行——本次即因 14:45 预案发布后仍检出 14:53/14:58/15:04 三连写而仲裁撤单。

## 二、B 块完成态基线（还原目标）
- docParser.ts = **3636 行整**；npm test = **58 文件/1287 用例全绿**；renderGolden/realDocs 同绿
- 符号归属：`src/utils/docparser/clxReader.ts`（B 态 397 行）持有 Piece 接口 + parseClxPieces + CLX 全家；storySplitter/pieceTable 不存在
- docParser.ts 内：splitPiecesByStory / parseClxWithStories / toDocumentStories / splitHeaderParts 为**内联方法**（B 报告："曾因锚点越界被误吞——完整归还 docParser（逆适配还原 this. 形态）"）；parseClxPieces 为薄委托指向 clxReader

## 三、A 域足迹（需隔离面）
1. `src/utils/docparser/pieceTable.ts`（134 行）：头注自证"自 clxReader.ts 正式归位（move-only，符号名锚）：Piece / parseClxPieces"→ **原样退回 clxReader 即字节级还原 B 态**
2. `src/utils/docparser/storySplitter.ts`(276 行)：四函数 move-out → 移入 parking 后由 HEAD 底本内联回还
3. `docParser.ts` L44/L45 两条 import + 委托桩簇（parseClxPieces / parseClxWithStories / toDocumentStories 三处薄委托，约 L1745-1775）→ 删改
4. 无 A 域专属测试文件（tests/ 实测零引用 pieceTable|storySplitter）；62 失败全部来自既有测试被委托化破坏

## 四、执行步骤（单写者窗内）
1. 事前证据：wc -l、git diff --stat docParser.ts、npx vitest run tests/docParser.test.ts 快照
2. `git show HEAD:src/utils/docParser.ts > /tmp/dp_head.ts` 取底本；HEAD 锚点：parseClxPieces@739 / splitPiecesByStory@854 / parseClxWithStories@958 / toDocumentStories@2112 / splitHeaderParts@2146（3990 行版）
3. clxReader.ts：把 pieceTable.ts 的 ClxBasicCtx(如需)/Piece/parseClxPieces 原样移回，恢复 397 行形态
4. storySplitter.ts：四函数体与 HEAD 底本 diff 校验漂移量 → 按 HEAD 版内联回 docParser（this.-形态），注意 B 后上下文适配点：clxCtx getter（L1719）、readUint16/readUint32 经 clxReader 别名（import 块 L33-43 已有 clxReadUint16/clxReadUint32）
5. docParser.ts import 区：删 L44/L45；parseClxPieces 与 Piece 并入 L43 clxReader 花括号（对齐既有 `clx*` 别名风格或裸名，以 3636 行校和为准）
6. 双校验和验收：wc -l=3636 且全量 58 文件/1287 绿（含 renderGolden）
7. WIP 文件 mv 入 docs/wip-parking/t4p1-A/（保留 src 目录结构 + MANIFEST 注明来源/时刻/回迁方式）；事后 build+test+diff stat 证据追加至 captain 队列

## 五、风险与注意
- 若 A 域后续波次已部分落地他处引用（实测当前无），先 grep 全仓再动
- tests/docParser.test.ts 等 M 文件混有多层已验收改动（FIELD-CP-GOV 夹具修正等），**不回退测试文件**——以"现行测试全绿"为验收口径
- 本方案行号锚基于 2026-08-26 15:00 时点；复用前重跑第三节足迹辨认
