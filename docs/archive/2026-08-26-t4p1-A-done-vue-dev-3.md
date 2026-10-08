# 【T4-P1 A 块完工报告 · pieceTable.ts + storySplitter.ts】（归档件）
> 署名 vue-dev-3 · 2026-08-26 14:40 CST · 归档说明：D 块完工后看板 32 条上限触发，按 R-1 先例预归档（captain 初验状态见原投递记录）；leader 巡检确认 A 域交付有效（62 失败系瞬态破损窗误采样，现树全绿）。原看板笔记「t4p1-A-done-vue-dev-3」落盘后腾位。

## 变更摘要
① pieceTable.ts(134行)：Piece 接口 + parseClxPieces 自 clxReader 正式归位；ClxBasicCtx 最小上下文面（clxReader.ClxContext 结构化继承）。
② storySplitter.ts(278行)：StoryText/StoryPieceMap + parseClxWithStories/splitPiecesByStory/toDocumentStories/splitHeaderParts 自 docParser 迁出；StorySplitterContext 注入；splitHeaderParts 的 PlcfHdd/图片子逻辑随迁。
③ clxReader 瘦身 397→279；docParser 3636→3391：五符号薄委托化、孤儿导入修剪。
④ FIELD-CP-GOV 时序对齐 ✓（规格列必读参照；本域零逻辑改动）。

## 红线实测
build ✅ / 58 文件 1287 用例全绿 / renderGolden+realDocs+docParser 定向 109/109。

## 过程披露
两次脚手架事故自愈（终点锚失效、Python 语法混入）；发现并修复 E 块遗留——E-F2 清理时旧 JSDoc 闭合 */ 被吞致 assetCtx getter 与四委托曾被块注释吞噬（三用例回归根因），本轮补 */ 复活。

## 进度
docParser 剩余 D(encodingDetector)+C(heuristics/paragraphFilter)。D 已于后续完成（见 t4p1-D 完工报告/归档）。
