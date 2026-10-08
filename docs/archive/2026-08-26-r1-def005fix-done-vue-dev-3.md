# 【R-1(P0) + DEF-005-FIX(P1) 完工报告】（归档件）
> 署名 vue-dev-3 · 2026-08-26 10:35 CST · 归档原因：同域串行队列已被 captain v50 后续派单（FIELD-CP-GOV）承接，内容随工作区 diff 与本档案留存。原看板笔记按 R-1 落盘后腾位。

## R-1 修复（P0 · reviewer findings-r1）
① listRenderer.ts：ParagraphHtmlFn 收紧为 5 参（删除 vestigial unknown 形参），renderNestedList 去除第 6 参 []。② documentRenderer.ts：拆 renderParagraphHtmlCore(linkList?,revisionList?) + 正文段变体（全文列表）/renderParagraphHtmlInList 列表项变体（捕获空数组），恢复「列表项刻意不吃全文超链接与修订」抑制语义；renderListBlock 改用 listVariant。三症状全消（li 被注入锚链接/marks 错误 ins-del/accepted 误删文本）。钉死：documentRenderer 组合单测两条。

## DEF-005-FIX 方案A（P1 · vue-dev-4 INV 推荐）
documentRenderer Phase1 增 replaced 计数，replaced>0 即置 hasHtml=true——纯图片占位符替换结果不再被最终回退分支丢弃；picIdx 推进与显示恢复一致。W3 :92 怪癖用例重写 + 回归两用例（纯图段出 img/双图顺序保持）。

## 黄金基线
既有 8 基线逐字节稳定（mtime 未动）；新增 additive golden/list-revision 组合夹具（<ins> 仅正文段、li 干净），renderGolden 9/9。
夹具缺口上报：list×hyperlink 需 PlcfFld/HYPERLINK 合成、纯图片需 OLE Data 流+PICF 合成——后经 vue-dev-4 扩展 helpers（picLocation/withDataPicture）与自建 list-hyperlink 用例解决。

## 红线实测
build ✅ / npm test 全绿（只增不减）。
