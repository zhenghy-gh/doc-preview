# 【FIELD-CP-GOV 完工报告 · 双轴调查+渲染侧修复+规格移交】（归档件）
> 署名 vue-dev-3 · 2026-08-26 12:10 CST · 归档说明：captain 初验流程中因看板 32 条上限按 R-1 预归档；权威技术内容已由 docs/changelog/2026-08-26-field-cp-gov-parser-spec.md（规格全文）承载，本档案保留完工摘要。原看板笔记「field-cp-gov-done-vue-dev-3」落盘后腾位。

## 调查结论（双轴全貌）
两轴定义：RAW=流全文 UTF-16 下标（PlcfFld.aCP/fieldTextData 字节切片/instruction 提取）；STRIPPED/MUTATED=段落 text 与渲染层 paraCpEnd。
F1 已澄清非解析器缺陷：「url 不生成」系 helpers 剥离轴注记 vs fieldParser RAW 轴需求的约定冲突；纯函数对照证明原始轴输入下 url/instruction 提取正常。
F2 解析侧缺陷：extractAllFields result=text.slice(...) 的 text 轴与 CP 的 RAW 轴不一致 → result 错位/跨段污染（实证 L1 '链接字段'应为'条目链接'、L2 '尾。\n' 跨段混入）。
F3 渲染侧断裂：CP 窗口过滤两轴不可比恒空 → <a> 端到端不可达（已修复面）。
F4 待深挖：_cpStart=47 与 stripped(17)/raw(53) 推算均不吻合，疑 replacePageFieldsInText 漂移同族（高危④）→ 随规格移交 vue-dev-1。
定级维持 P1，升级触发条件已写明。

## 渲染侧修复（已落地）
documentRenderer.renderDocumentToPages：placementsByPara 结果文本锚定预计算（列表项抑制 R-1 不变）；Core 增 placements 入参替换 CP 窗口过滤块；正文段变体传段索引查表、列表项变体不传；F2 未修期间不劣化、parser 修复后零改动生效；CP 窗口旧路径移除。

## 规格移交（vue-dev-1）
docs/changelog/2026-08-26-field-cp-gov-parser-spec.md §四：R-F2-1/R-F2-2/R-F4-1/R-F4-2 四条+回归护栏三条+golden list-hyperlink 翻转指引。

## 黄金基线
list-hyperlink 注释更新翻转前置条件与形态；基线不动钉现状；renderGolden 全量 11/11 绿。

## 红线实测
build ✅ / 55 文件 1268 用例全绿；诊断探针已清除。
