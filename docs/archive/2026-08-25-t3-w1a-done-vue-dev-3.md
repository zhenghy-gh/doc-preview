# 【T3-W1a 完工报告 + CHART-DATA-INV 定级】（归档件）
> 署名 vue-dev-3 · 2026-08-25 19:50 CST · 归档原因：captain-queue-master v30 已初验销账并追认三项实现裁决；CHART-DATA 终裁 P2 与次生发现 ESCAPE-QUOTE/I18N-SWEEP 均已由 v30 登记吸收。原看板笔记「t3-w1a-done-vue-dev-3」按 R-1 落盘后腾位。

## 变更摘要（D4）
① 新建 src/utils/rendering/chartRenderer.ts(239行)：renderChartSvg/renderChartHtml/chartTypeLabel/chartSubtypeLabel 自 DocPreview.vue 程序化原样迁出（sed 抽取+diff 校验函数体逐字节一致），i18n 以 Translator 注入，seq 显式化为预留入参；② 新建 src/utils/rendering/inlineAssetRenderer.ts(89行)：renderTextboxAnchorHtml/renderInlinePictureHtml 同法迁出+末参 Translator，twipsToPx(Math.round(twips/15)) 提升为模块导出；③ docFormat.ts 文件尾纯追加契约共享类型块 RenderParagraph/FontResolver/Translator(+31行)；④ 新增 tests/chartRenderer.test.ts + tests/inlineAssetRenderer.test.ts 共 26 用例。

## 关键实现裁决（v30 全部追认）
① renderChartHtml 实际签名 (chart, _seq: number, t: Translator)：契约字面只列 seq，但 §1.3 纯度规则强制 i18n 入参，参照 inlineAssetRenderer「增加末参 t」先例补第三参；_seq/_t 下划线前缀系 noUnusedParameters=true 所需（记入团队命名规约备查）。③ twipsToPx 取模块导出方案（W3 随 PT_TO_PX 收敛）。

## 红线实测
npm run build ✅ vue-tsc 0 错误；npm test ✅ 46文件/1187用例全绿（基线1147 只增不减）。迁移保真度：三个函数体 diff=0，renderChartHtml 仅两处 label 调用重命名（预期内）。renderGolden 黄金快照 8 基线全绿。测试环境：两测试文件需 @vitest-environment happy-dom。

## CHART-DATA-INV 定级（v30 终裁 P2，修正原 P1 建议）
F1：renderChartSvg 全部 9 分支数值均为硬编码演示数据；证据链=ChartInfo 无数值序列字段（Data 流从未解析）＋dataUrl 优先＋回归库图表覆盖 0。修复 S1 中性占位卡（小）/S2 真实系列解析（大，P3 挂起）。
F2（P2）：i18n 死回退——locale#t 缺键返回键名本身致 || 回退不可达，未知类型显示原始键名。
F3（P2）：escapeHtml 引号盲区——textContent→innerHTML 不转义双引号，title 属性理论可注入、当前插值均为数字/受信文案实际不可达（v30 登记 ESCAPE-QUOTE 排队）。
