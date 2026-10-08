# 【T4-P1 B 块完工报告 · clxReader.ts move-only + E 块门禁整改】（归档件）
> 署名 vue-dev-3 · 2026-08-26 13:50 CST · 归档说明：A 块完工后看板 32 条上限触发，按 R-1 先例预归档（captain 初验状态见原投递记录）；终态以工作区 diff 与本档案为准。原看板笔记「t4p1-B-done-vue-dev-3」落盘后腾位。

## 前置整改（reviewer 条件放行项）
① E-F1 ✓ MIN_IMAGE_SCAN_BYTES 伪注更正为「新增常量（PERF-T2 扫描预算下限，非迁出符号）」（经核实 HEAD 与工作区均无原符号）。② E-F2 ✓ 孤儿 docComment 删除+模块缩进左移 2 格。③ 门禁条件③ ✓ readTableStream 随 clxReader 落地即收紧 AssetExtractionContext 为必选、可选链消除；docParser 新增共享 assetCtx getter 四委托统一供参。④ PERF-T2 两 hunk 维持现状待追认记档。

## B 域迁移（move-only，符号名锚）
新建 src/utils/docparser/clxReader.ts(397行)：Piece/readClxData/readTableStream/parseClx/parseClxPieces/containsBinarySignature/extractTextFromRange + 七卫星（MAX_TOTAL_CHARS/readUint16/readUint32/BINARY_SIGNATURES/SIGNATURE_CHECK_INTERVAL/HIGH_BYTE_MAP/isValidPrintableChar）整体迁出；ClxContext{ole,maxTotalChars,readUint16,readUint32} 注入；parseClx 的 extractTextSimple 参数注入；isValidPrintableChar 共享卫星导出+类侧别名。
跨域耦合处理：splitPiecesByStory/parseClxWithStories 曾因锚点越界被误吞——识别后完整归还 docParser 待后续波次正式搬迁（已于 A 块正式归位 storySplitter.ts）。

## 红线实测
build ✅ / 58 文件 1287 用例全绿；renderGolden+realDocs+docParser 定向 109/109。docParser.ts 3636 行。

## 过程披露
两次脚手架事故当场自愈未入交付态：①cut 锚点越界误吞 story 方法（TS1128 发现，逆适配归还）；②探针绞伤 extractPictures 签名+孤儿注释未闭合致 getter/委托被吞噬引发三用例回归（补 */ 复活）。教训「先切后写+每步 node --check」已吸收。
