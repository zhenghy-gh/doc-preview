# 【T4-P1 D 块完工报告 · encodingDetector.ts】（归档件）
> 署名 vue-dev-3 · 2026-08-26 15:10 CST · 归档说明：C 第一半完工后看板上限触发按 R-1 预归档；D 块内容已被后续 A 域（heuristics）进展与本档案承载。原看板笔记「t4p1-D-done-vue-dev-3」落盘后腾位。

## 变更摘要
新建 src/utils/docparser/encodingDetector.ts(365行)：detectEncodingFromBinary/extractTextWithAutoDetect/extractTextSimple/scoreRawParagraphs/nonTextualSymbolRatio/shouldTryCrossEncodingRetry/crossEncodingRetryWins/scorePlainText/stripBinaryPrefix/isValidChar + JUNK_CHAR_CLASS/EXTRA_JUNK_CHARS/ENC04_SYMBOL_RATIO_THRESHOLD 迁出。
结构性适配：EncodingDetectorContext{maxScanBytes, scanLimit:{reached}（DEF-004 标志透传）, scanUtf16Char（留守共享静态注入）, cleanParagraph/shouldSkipParagraph/hasSignificantContent（C 域回调注入——已于 C 第一半对接完成）}；isValidPrintableChar 复用 clxReader 导出。
docParser.ts 3398→3169 行：九方法薄委托化、三常量类侧别名、孤儿修剪。

## FIELD-CP-GOV ✓ 规格必读参照；零逻辑改动；R-F2 同 PR 序列对齐。

## 红线实测
build ✅ / 58 文件 1287 用例全绿 / renderGolden+realDocs 12/12。

## 过程披露
花括号提取器被模板插值 ${...} 干扰致 extractTextSimple 首切截断——残段+HEAD 对照拼接完整恢复并确定性重建签名头；连带清理 E/B 波次孤儿注释与双插回填。一次性落盘纪律执行 ✓。
