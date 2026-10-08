# 【分析报告】formatFormattedTextToHtml 渲染管线函数边界与模块化建议
> 署名：vue-dev-3 · 2026-08-25 · 原看板笔记「vue-dev-3 render-pipeline-analysis」归档件
> 归档原因：内容已被 docs/CONTRACT-split-r1.md（contract-split-r1 v1.0）§一/§四 采纳吸收，按看板管理规则 R-1 落盘后腾位。M1–M6 与 R1–R11 编号被契约直接引用。

## 管线全景（DocPreview.vue 共 5990 行，其中渲染管线约 1200 行）
入口链：applyFormattedPages(:1677) → formatFormattedTextToHtml(:1778–2068，主循环约 290 行)。调用点仅 3 个：renderResult(:961 首渲)、toggleHiddenText(:2291)、setRevisionMode(:2311 重渲)。纯文本降级路径(:987)不走此管线。

## 主函数内部结构
- :1775–1782 模块级可变计数器 globalChartIdx/globalPicIdx，每次渲染入口重置
- :1784–1794 hyperlinkMap 构建 = 死代码（只写不读）
- :1796–1809 textBoxShapes/inlinePictures 过滤排序（直读 shapes/pictures refs）
- :1811–1862 分页状态机闭包组：findSectionForCp(:1823)/finalizePage(:1830 分栏CSS注入)/addToPage(:1847)/estimateParaHeight(:1855)；pageHeightPx = pageHeight.value*1.333
- :1872–2035 主 while 循环：空段落占位 → justFinishedList 图表启发式插入(:1891) → 分栏切换强制换页(:1909) → 表格块 collectTableBlock(:1920) → 列表组收集+listCounters 编号续接(:1930–1996) → 普通段落 renderParagraphHtml(:2001)+pageBreakBefore(:2003)+文本框锚点标记(:2011)+内联图片(:2023)
- :2037–2063 尾部未消费图表/图片兜底；:2065 最终 finalizePage

## 辅助函数纯度盘点（均在 DocPreview.vue 内）
extractListItemText(:1085) 纯｜collectTableBlock(:1106) 纯｜renderNestedList(:1215) 半纯(递归调 renderParagraphHtml)｜renderParagraphHtml(:1267) 组件耦合(revisionMode/pictures/images/charts refs+全局计数器)｜renderTextboxAnchorHtml(:1404) 近纯(需注入 t())｜renderInlinePictureHtml(:1442) 纯｜renderChartSvg(:1467,~190行) 纯但内含硬编码假数据｜renderChartHtml(:1656) 近纯(i18n label)｜formatTextWithCharacterStyles(:2070)/formatTextWithDefaultStyles(:2169) 组件耦合(showHiddenText/fontResolver)

## 建议模块边界（按风险从低到高，目标形态：utils 内 renderDocumentToPages(paragraphs, ctx) 纯函数，组件只留 applyFormattedPages 薄包装）
M1 表格块收集 collectTableBlock → 可并入 tableText.ts（低风险）
M2 inlineAssetRenderer：renderChartSvg/renderChartHtml/renderInlinePictureHtml/renderTextboxAnchorHtml，注入 labelResolver(i18n)+twipsToPx（低风险，约250行）
M3 paragraphStyleRenderer：两个 formatTextWith*Styles + resolveFontSize/getTextAlignment/getBorderCss/getWebFontFamily，注入 {showHiddenText getter, fontResolver}（中风险）
M4 listRenderer：列表组收集循环+listCounters+renderNestedList，renderParagraphHtml 以回调注入（中风险）
M5 PageBuilder 分页状态机：finalizePage/addToPage/estimateParaHeight/findSectionForCp/分栏跟踪 → createPageBuilder({pageHeightPx, sections})（低-中风险）
M6 PlaceholderConsumer：统一 \u0001 占位符消费 —— 当前在三处重复实现（正文段:1336–1362、列表分支:1967–1990、尾部兜底:2050–2063），共享全局计数器。合并价值最高但行为等价性最难证明，建议放最后或单独立项

## 风险点
R1 全局可变计数器跨函数共享，提取时不封装进管线对象会有重入污染
R2 \u0001 双层消费：列表项占位符先被 renderNestedList→renderParagraphHtml 消费一次，主循环再对整棵列表 HTML 全局 replace 一次——行为正确但极难推理，是拆分最大坑
R3 justFinishedList 启发式（visibleLen>=100 魔数、空占位段不重置标志）必须整体搬移不可拆散
R4 高度估算魔数群（45字/行、表格100、图表200、锚点24、图片min(400)+16、空段8）决定分页断点，不得"顺手优化"，否则分页变化=功能回退
R5 pt→px 的 1.333 在 :1814 与 getPagePlaceholderHeight(:1697) 两处重复，应提共享常量
R6 refs 深耦合 8 处（revisionMode/showHiddenText/pictures/images/charts/shapes/pageHeight/t），必须上下文对象注入否则 utils 无法单测
R7 hasHtml 传播链决定是否跳过 escapeHtml，丢失即转义回归（安全相关）
R8 顺序敏感：修订与超链接互斥(:1300)；软换行 \v→<br> 必须在所有偏移类处理之后(:1364–1371)
R9 输出契约：pages:string[]（每页一个 .page-content div）被 printDocument/downloadHtml/htmlToMarkdown(优先找.page-content)/搜索高亮DOM遍历/虚拟滚动 pageHeights 五处下游消费，容器结构不能变
R10 renderChartSvg 硬编码演示数据＝既有正确性问题（后立 CHART-DATA-INV），提取时原样保留
R11 hyperlinkMap 死代码可删

## 验证基线建议
tests/ 已有 vitest，textRender/tableText 有测试先例；本管线零单测覆盖。重构前用固定 .doc 样例产出 golden pages HTML 快照作 diff 基线（后由 TG-1 落地为 renderGolden.test.ts + tests/__snapshots__/render-golden/）。
