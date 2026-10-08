# FIELD-CP-GOV · HYPERLINK 双轴坐标断裂调查报告与解析侧修复规格

> 署名：vue-dev-3 · 2026-08-26 · 任务卡：captain v50
> 渲染侧修复已落地（src/utils/rendering/documentRenderer.ts，本波）；本文档为 **parser 侧修复规格**，移交 vue-dev-1 链实施（须先于 T4-P1 搬迁 fieldParser/相关域；与 reviewer 高危④ replacePageFieldsInText CP 漂移同族并案）。

## 一、双轴坐标全貌（实证方法：合成夹具直跑 parseDocFileFromBuffer + fieldParser 纯函数对照）

| 轴 | 定义 | 使用者 |
|---|---|---|
| **原始轴（RAW）** | WordDocument 流文本全文的 UTF-16 code unit 下标，**含域字符 \u0013/\u0014/\u0015 与域指令文本** | PlcfFld.aCP（MS-DOC 语义）、fieldTextData 字节切片（docParser.ts:1342 按 fcMin 对齐后 cp×2 寻址）、extractAllFields 的 instruction 提取（instrStart=begin.cp+1 起 decodeUtf16le） |
| **剥离变换系（STRIPPED/MUTATED）** | 经域字符剥离、指令删除、replacePageFieldsInText 域结果替换、清洗去重之后的段落文本坐标系 | 段落 text、_cpStart（实测非纯剥离轴，见 F4）、渲染层 paraCpEnd=_cpStart+text.length |

### 实证记录（合成夹具：两段各含一条 HYPERLINK，raw 全文 96 units）

- E2E 产出 `document.hyperlinks`：
  - L1 `{cpStart:10, cpEnd:47, url:'https://e.com/item', instruction:'HYPERLINK "https://e.com/item"'（完整）, result:'链接字段'（错位！可见结果文本应为'条目链接'）}`
  - L2 `{cpStart:55, cpEnd:92, url:'https://e.com/body', result:'尾。\n'（跨段污染，混入下一段尾字符与换行）}`
- 段落轴：para(_cpStart=0,len=5) / para(6,10) / para(**47**,12)；stripped 全长 90。
- 纯函数对照：extractHyperlinks 在**原始轴条目+原始轴 text** 输入下 instruction/url 提取完全正常。

## 二、断裂点清单（F1–F4）

- **F1（已澄清，非解析器缺陷）**：此前记录「url 不生成」实为合成夹具约定冲突——helpers 注记要求按剥离轴计算 plcfFld CP，而 fieldParser 需要 RAW 轴。原始轴输入下 url/instruction 提取正常。→ 处置：helpers 注记与规格统一为 RAW 轴（见 §四）。
- **F2（解析侧缺陷·本规格主对象）**：`fieldParser.extractAllFields` 中 `result = text.slice(resultStart, resultEnd)` 的 `text` 由调用方传入（docParser 传的是主文本变量），其轴与 begin/sep/end.cp 的 RAW 轴不一致 → result 错位/跨段污染（实证 L1/L2）。instruction 用字节轴、result 用未对齐字符轴，同函数双轴混用。
- **F3（渲染侧·已修复）**：renderParagraphHtml 原 CP 窗口过滤 `link.cpEnd > paraCpStart && link.cpStart < paraCpEnd` 两轴不可比 → 恒空 → `<a>` 端到端不可达。已改为「结果文本锚定」放置（见 §三）。
- **F4（解析侧待深挖·移交 vue-dev-1）**：段落 `_cpStart=47` 与 stripped 轴推算值 17、RAW 轴推算值 53 均不吻合，来源不明（疑与 replacePageFieldsInText 缩短 mainText 后未回写 CP、或段落切分累计基准漂移有关——reviewer 高危④同族）。修复 F2/F4 前渲染层不得恢复 CP 算术路径。

## 三、渲染侧修复（已落地，供评审）

`documentRenderer.renderDocumentToPages`：

1. 主循环前预计算 `placementsByPara: Map<paraIndex, {url,from,to}[]>`——按文档序为每个携带 url 的链接在其 result 文本首次出现的**非列表段落**中锚定（列表项抑制语义 R-1 不变：列表段不参与扫描）；同段多链接升序排列。
2. `renderParagraphHtmlCore` 增加 placements 入参；原 CP 窗口过滤块替换为 placements 应用（降序插入防偏移），hasHyperlinkHtml 相应置位。
3. 正文段变体传该段 placements；列表项变体不传（抑制）。
4. 兼容性：F2 未修期间 result 错位导致部分链接无锚（维持现状不劣化）；vue-dev-1 修复 F2 后无需再动渲染层即可端到端生效。CP 窗口旧路径整体移除（其可达性已被证伪）。

## 四、解析侧修复规格（移交 vue-dev-1）

**目标**：FieldRange 的全部坐标与文本字段统一到单一坐标系，消除 F2/F4。

1. **R-F2-1（必须）** `extractAllFields` 的 result 改从与 CP 同轴的来源切片：优先 `decodeUtf16le(textBytes, resultStart*2, (resultEnd-resultStart)*2)`（与 instruction 同款字节轴），仅当 textBytes 缺失时回退 text.slice 并在返回值标注 `axis:'text'`。
2. **R-F2-2（必须）** docParser 调用点保证传入的 textBytes/text 同轴（当前 fieldTextData 已按 fcMin 对齐 ✓；text 参数改为仅用于 flt 判定等非切片用途或同样按 fcMin 对齐切片）。
3. **R-F4-1（必须，先于一切 CP 恢复）** 审计 `_cpStart` 推导链：定位 para6=47 的成因（嫌疑序位：① replacePageFieldsInText 缩短 mainText 后未同步平移后续 PAPX/CHPX CP；② 域字符剔除发生在 _cpStart 赋值之后但增量未回补；③ 多 story 分流边界计入方式）。产出：单轴不变式测试（对任意文档，相邻段 _cpStart 差 == 前段剥离后 text.length(+1)）。
4. **R-F4-2（建议）** replacePageFieldsInText 替写 mainText 时同步维护「原始轴→剥离轴」映射表（或改为原地等长占位替换），从根上消灭高危④同族漂移。
5. **回归护栏**：① 保留 tests/renderGolden.test.ts `golden/list-hyperlink`（当前钉死无 <a> 现状）；② R-F2 落地后将该用例断言翻转为包含 `<a href="https://e.com/item">条目链接</a>`（列表项内 '条目链接' 因 R-1 抑制保持纯文本）并重录基线——渲染层无需再改；③ 新增 extractAllFields 纯函数用例钉死 result 与 instruction 同轴。
6. **搬迁约束**：以上涉及 fieldParser.ts/docParser.ts 域，务必在 T4-P1 搬迁**之前**落地或与搬迁同一 PR 序列，避免移动后 diff 失焦。

## 五、定级结论

维持 P1 不升 P0：触发前提=文档同时含列表/HYPERLINK 且 CP 窗口偶然命中（现证实恒不可达，属功能缺失而非错误内容注入——错误注入风险仅在 R-1 修复前的短暂窗口存在过且已被抑制语义关闭）。若 R-F4 审计证实 _cpStart 漂移同样影响修订窗口（accepted/rejected 误删正文），届时按 P0 重报。

—— vue-dev-3 · 2026-08-26
