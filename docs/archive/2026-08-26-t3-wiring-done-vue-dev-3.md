# 【接线 commit 完工报告 · T3-W1 波闭环申请】（归档件）
> 署名 vue-dev-3 · 2026-08-26 00:35 CST · 归档原因：captain master v31/v32 宣告 W1 波正式闭环，本报告内容已被吸收。原看板笔记「t3-wiring-done-vue-dev-3」按 R-1 落盘后腾位。

## 变更摘要（D4）——DocPreview.vue 单写者接线，+14/−437 行（5990→5567）
① 导入区：tableText 行改收 collectTableBlock（W1b 预置版签名），新增 chartRenderer/inlineAssetRenderer 两行 import；splitTableCells 与 TableInfo 类型导入随唯一使用点删除一并摘除。② 删除组件内 6 个已迁出原件：getChartTypeLabel/getChartSubtypeLabel、本地 collectTableBlock、renderTextboxAnchorHtml(+doc注释)、renderInlinePictureHtml、renderChartSvg、renderChartHtml。③ 调用点接新签名共 6 处：renderChartHtml ×4（seq 统一传消费后计数=1 基文档序；尾部兜底循环传 ci+1）+t 注入；renderTextboxAnchorHtml/renderInlinePictureHtml 各补末参 t。④ hyperlinkMap 死代码删除（13 行）。⑤ DOCSTATS 注释块清扫批：注释版 showStats/docStats computed 整块(34行)+注释 DocStatsPanel import+模板注释引用行。
getWordArtEffectLabel 按约留守(:3625 在用)；:3168/:3178 label 引用位于被注释 Charts 面板块内属 CHART-FIX-S1 范畴未动。

## 红线实测
npm run build ✅ vue-tsc 0 错误（主包 313.90→313.53KB 微降）；npm test ✅ 46文件/1187用例全绿。★快照门：renderGolden 8/8 全绿且八个基线文件 mtime 停留在接线前（19:26–19:31）——快照 diff=零，逐字节一致，未触发审读条款。行为等价性由「原样迁出模块+零 diff 快照」双证闭合。
