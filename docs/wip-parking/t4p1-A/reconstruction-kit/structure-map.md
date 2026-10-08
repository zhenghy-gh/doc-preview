# 委托层结构图 · vue-dev-6 测绘（2026-08-26，两时点版本对照）

## 一、基线代际表（防混用）

| 代际 | docParser.ts 行数 | 特征 | 状态 |
|---|---|---|---|
| HEAD@9670a30 | 3990 | 全部实现内联单文件 | 见 dp_head_3990.ts |
| B 块完成态 | 3636 | +E/B 迁移(clxReader 397/documentAssets 290)、story 四函数内联归还、FIELD-CP-GOV/PERF-T2/T3 已叠加 | 已失落，无内容留存 |
| 绿A 完整态 (15:19:30) | **3398** | +A 块(pieceTable/storySplitter/clxReader 瘦身至279)，md5 oracle 目标 | 已失落，**仅哈希** |
| 当前树 (18:05:56+) | ~2172 | +C/D 续抽取(encodingDetector 365/heuristics/*)+vue-dev-6 三点收尾修复 | 在盘，57/58 绿 |

## 二、三别名导入簇（绿A版 L30-73 形态）

```
import { extractImages, extractPictures, extractProperties, extractDop } from './docparser/assets/documentAssets'
import { extractTextWithAutoDetect as encExtractTextWithAutoDetect, extractTextSimple as encExtractTextSimple,
         detectEncodingFromBinary as encDetectEncodingFromBinary, scoreRawParagraphs as encScoreRawParagraphs,
         shouldTryCrossEncodingRetry as encShouldTryCrossEncodingRetry, crossEncodingRetryWins as encCrossEncodingRetryWins,
         isValidChar as encIsValidChar, scorePlainText as encScorePlainText,
         stripBinaryPrefix as encStripBinaryPrefix } from './docparser/encodingDetector'
import { parseClx as clxParseClx, readClxData as clxReadClxData, readTableStream as clxReadTableStream,
         containsBinarySignature as clxContainsBinarySignature, readUint16 as clxReadUint16,
         readUint32 as clxReadUint32, MAX_TOTAL_CHARS as CLX_MAX_TOTAL_CHARS,
         isValidPrintableChar as clxIsValidPrintableChar } from './docparser/clxReader'
import { parseClxPieces, type Piece } from './docparser/pieceTable'
import { parseClxWithStories, splitPiecesByStory, toDocumentStories, splitHeaderParts,
         type StoryText, type StoryPieceMap } from './docparser/storySplitter'
import { cleanParagraph, shouldSkipParagraph, hasSignificantContent,        // ← 裸名直调组
         filterParagraphsWithGenericLogic as pf_filterParagraphsWithGenericLogic,
         filterAndEnhanceParagraphs as pf_filterAndEnhanceParagraphs,
         applyStructuralFormats as pf_applyStructuralFormats,
         removeInternalDuplicates as pf_removeInternalDuplicates,
         collapseWholeBlockRepeats as pf_collapseWholeBlockRepeats,
         cleanWordFieldCodes as pf_cleanWordFieldCodes,
         replacePageFieldsInText as pf_replacePageFieldsInText,
         splitMultiRowTables as pf_splitMultiRowTables,
         normalizeParagraphCpAxis as pf_normalizeParagraphCpAxis,
       } from './docparser/heuristics/paragraphFilter'
```

## 三、上下文 getter 模式

```ts
// 共享 assetCtx getter（B 块门禁③产物）：四委托统一供参，消除可选链静默降级
private get assetCtx(): import('./docparser/assets/documentAssets').AssetExtractionContext { ... }
// CLX 上下文 getter
private get clxCtx(): import('./docparser/clxReader').ClxContext {
  return { ole: this.ole, maxTotalChars: CLX_MAX_TOTAL_CHARS, readUint16: ..., readUint32: ... }
}
```
配套薄委托房式风格：`private x(args) { return pf_x(args) }`；模块函数一律无 this，静态依赖经 ctx 注入。

## 四、白盒测试面公开先例（重要！）

以下成员**类内零调用点但必须公开保留**（docParser.test.ts / perf-t3-dedup.test.ts 经 `(parser as any).x()` 直调）：
- `extractTextFromRange`（table-like 组）
- `stripBinaryPrefix`（CJK noise 组 ×5）
- `removeInternalDuplicates` / `cleanWordFieldCodes` / `collapseWholeBlockRepeats`
豁免依据：public 成员不受 noUnusedLocals 约束。漏保 = 测试面断裂（18:04 删委托事故即此）。

## 五、18:05 撕裂伤根因解剖（诊断方法论可复用）

现象：tsc 只报 TS2339/2551/6133（"成员缺失/未用"），**零语法错误**。
根因：L1811 PERF-T3 JSDoc 缺闭合 `*/` → 其后 ~125 行（8 薄委托+extractParagraphsWithFormat 实现+ENC-04 助手）被静默吞入注释。文本肉眼可见、编译器视而不见。
诊断套路（按序）：
1. `vue-tsc --noEmit` 全量清单 + 错误码直方图（勿只看 tail）
2. parse-only SourceFile 数 members 边界 → 找 >40 行的"HOLE"（成员间距异常段）
3. 对 HOLE 起点查缺失的 `*/`（`grep -n '\*/' file | awk 起点之后首现`）
4. ⚠️ 朴素花括号深度计数不可信——模板串/注释内的 {} 会污染统计；以 AST 为准
修复 = 补一行闭合符；连带"缺失成员/未用别名"全部自然消解。

## 六、当前树相对绿A 的已知演进（重建者须知）

- heuristics/paragraphFilter.ts(773) + textHeuristics.ts(294)、encodingDetector.ts(365) 为绿A 后新抽取域
- docParser 内 stripBinaryPrefix/extractTextFromRange 等白盒委托为收尾期新增
- collapseWholeBlockRepeats 存在语义分歧未决（perf-t3-dedup「纯幂串×8 定点」1 用例红，vue-dev-3 pad 对齐中）
