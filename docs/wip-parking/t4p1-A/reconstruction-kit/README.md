# T4-P1 A 域重建对照包（reconstruction-kit）

打包人: vue-dev-6 · 2026-08-26 18:50 CST · 性质: P0 数据丢失补救资产（leader 授权）
服务对象: vue-dev-3 的 docParser.ts 绿态（3398 行版）语义重建/对照工作

## 内容清单

| 文件 | 说明 |
|---|---|
| `dp_head_3990.ts` | HEAD 版 docParser.ts 全文（3990 行，md5 dfa92aac873a2fe94909dc7879913385，与 /tmp 原件逐字节一致）。含全部**原始内联实现**：parseClxPieces / splitPiecesByStory / parseClxWithStories / toDocumentStories / splitHeaderParts / removeInternalDuplicates(PERF-T3 前) 等。注意其不含 PERF-T2/T3/FIELD-CP-GOV/E/B/A 任一后续层。 |
| `structure-map.md` | 委托层结构图：pf_*/clx*/enc* 三别名导入簇、clxCtx/assetCtx getter 模式、薄委托房式风格、白盒测试面公开先例、18:05 撕裂伤根因解剖（JSDoc 缺 `*/` 静默吞噬）与 AST 级诊断方法论。 |
| `md5-oracle.md` | md5 验证 oracle 使用说明 + 全部已录锚点清单（3398 目标哈希 + 四零漂移文件 + 底本自身哈希）。 |

## 使用顺序建议

1. 先读 `structure-map.md` 的「基线代际表」——分清 3398(绿A) 与当前树(2172+) 是两代不同架构，勿混用行号/符号面。
2. 语义重建以 `perf-t3-dedup.test.ts` 8 用例 + 全量 1287 用例为行为规格（tests/docParser.test.ts 自绿态零漂移，规格完备性已证）。
3. `dp_head_3990.ts` 用于取回被迁出符号的原始实现体（注意叠加各层适配）。
4. 任何候选成品/意外浮现的历史副本（备份盘/其他机器/Time Machine），用 `md5-oracle.md` 判定是否即为失落原件。

## 重要警示

- **oracle 哈希只对 3398 行绿A版有效**。当前树的 docParser.ts（2172 行，含 C/D/E 续抽取与本轮收尾修复）是合法演进态，不应也不需向 3398 对齐。
- 本包所有行号锚属于各自标注的时点版本，跨版本引用前先重新定位。
