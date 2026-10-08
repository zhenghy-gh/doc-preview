# T2 · 两大文件拆分契约（contract-split-r1）

> **署名**：architect　**日期**：2026-08-25
> **效力**：本契约为 T3（DocPreview.vue 渲染管线抽离）/ T4（docParser.ts 拆分 ≤1500 行）的唯一实施依据；上板即生效，captain 据此放行。变更须 architect 会签并更新版本号。
> **行号基准**：当前工作区版本（commit 9670a30 + 工作区 tests WIP），实施时一律以**符号名为锚**，行号仅供定位。

---

## 〇、结论速览（三项裁决）

| 裁决点 | 结论 |
|---|---|
| 渲染纯函数落位 | **`src/utils/rendering/` 新子目录**（纯 TS，禁 import vue / 禁 import .vue）；否决 `src/components/preview/`（components 语义=.vue 组件，纯函数放入属归属错位；且 utils 已有 tableText/textRender/searchUtils/markdownExport 同类先例） |
| 解析器子域落位 | **`src/utils/docparser/` 新子目录**；`src/utils/docParser.ts` 保留为兼容门面（re-export），worker/index.ts 的 `from './docParser'` 零改动 |
| 类型新增落位 | 跨模块共享类型一律进 **`src/utils/docFormat.ts`**（单一事实源，兑现 ARCHITECTURE-REVIEW 规约 #1） |

---

## 一、① DocPreview.vue 渲染管线纯函数化抽离方案（T3 依据）

### 1.1 现状依赖实测（重构前钉死）

`formatFormattedTextToHtml`（L1778–2068，~290 行）及其辅助函数对外依赖：

- 响应式读取（实测计数）：`charts.value`×7、`pictures.value`×6、`images.value`×3、`shapes.value`×1、`sections.value`×1、`pageHeight.value`×1；另有 `renderParagraphHtml` 读 `revisionMode.value`（L1290）、`formatTextWithCharacterStyles/DefaultStyles` 读 `showHiddenText` + `getWebFontFamily`、`renderTextboxAnchorHtml/renderChartHtml` 用 `t()`。
- 模块级可变计数器：`globalChartIdx/globalPicIdx`（L1775–1776），每次渲染入口手动清零。
- 死代码：hyperlinkMap 构建（L1784–1794，只写不读，vue-dev-3 已核实）。
- 输出契约：`string[]`（每页一个 `.page-content` div）被 printDocument/downloadHtml/htmlToMarkdown/搜索高亮遍历/虚拟滚动 pageHeights 五处下游消费，容器结构不得变。

### 1.2 目标模块与导出接口（按波次，风险升序）

**共享类型先行**（进 `docFormat.ts`，一次性 PR）：

```ts
/** 渲染层消费的段落视图（提升自 DocPreview.vue 本地 ParaWithList/FormattedParagraphOutput） */
export interface RenderParagraph extends FormattedParagraph {
  listId?: number; listLevel?: number; listType?: string; listStyle?: string
  tableDepth?: number; headingLevel?: number
  _cpStart?: number; _cpEnd?: number
}
export interface FontResolver { (fontName?: string): string }
export type Translator = (key: string) => string
```

**W1 低风险（可并行两人，各新建文件不碰 DocPreview.vue 删改）：**

| 目标文件 | 迁入符号（源位置） | 导出签名（不变项加粗） |
|---|---|---|
| `utils/rendering/chartRenderer.ts` | renderChartSvg(L1467–1655)、renderChartHtml(L1656–1676)、getChartTypeLabel/getChartSubtypeLabel(L441–448) | `renderChartSvg(chart: ChartInfo): string`、`renderChartHtml(chart: ChartInfo, seq: number): string`（seq 显式化，替代闭包读全局计数器）、`chartTypeLabel(type, t)` |
| `utils/rendering/inlineAssetRenderer.ts` | renderTextboxAnchorHtml(L1404–1441)、renderInlinePictureHtml(L1442–1466) | 二者增加末参 `t: Translator`；其余不变 |
| `utils/tableText.ts`（追加，非新建） | collectTableBlock(L1106–1214) 从 DocPreview.vue 迁出 | `collectTableBlock(paragraphs: RenderParagraph[], startIndex: number): TableBlockResult \| null` |

注意：renderChartSvg 内部硬编码演示数据（柱[9,3,4.5..]、饼[35,25,20,20]）**原样保留**，另立缺陷单不搭车。

**W2 中风险（W1 快照通过后）：**

| 目标文件 | 迁入符号 | 关键参数化 |
|---|---|---|
| `utils/rendering/paragraphStyleRenderer.ts` | resolveFontSize(1011)、getTextAlignment(1016)、getBorderStyle/getBorderCss(1051–1084)、FONT_SIZE_MAP/BORDER_COLOR_MAP/BORDER_TYPE_MAP、formatTextWithCharacterStyles(2070–2168)、formatTextWithDefaultStyles(2169–2260±)、CharStyleOptions 接口 | 两个 formatTextWith\* 增加 options 字段 `showHiddenText: boolean`（布尔快照注入，替代 ref 闭包）；fontResolver 以参数传入 |
| `utils/rendering/listRenderer.ts` | extractListItemText(1085–1105)、renderNestedList(1215–1266)、主循环列表组收集段(1930–1996) 整体抽为 `renderListBlock(...)` | renderNestedList 对 renderParagraphHtml 的递归依赖改回调注入；**双层 \u0001 占位符消费顺序原样保留**（列表内先消费一次、主循环对整棵列表 HTML 再 replace 一次），严禁顺手合并 |

**W3 高风险（单人执行，黄金快照全绿才可合入）：**

| 目标文件 | 内容 |
|---|---|
| `utils/rendering/pageBuilder.ts` | `createPageBuilder({ pageHeightPx, sections })` 封装 finalizePage/addToPage/estimateParaHeight/findSectionForCp/currentColumnCount/currentColumnSpacingPt；高度估算魔数群（45字/行、表格100、图表200、锚点24、图片 min(400)+16、空段8）与 `pt→px 1.333` 收敛为导出常量 `PT_TO_PX`，数值逐一原样 |
| `utils/rendering/documentRenderer.ts` | 总编排 `renderDocumentToPages(input: RenderInput): string[]`。`RenderInput = { paragraphs, hyperlinks?, revisions?, revisionMode, shapes, pictures, images, charts, sections, pageHeightPt, showHiddenText, fontResolver, t }`。globalPicIdx/globalChartIdx 收编为 renderer 内部状态（每次调用开头清零，保持现语义，解除跨文档污染隐患） |

**组件侧残留**：DocPreview.vue 仅留薄包装 `applyFormattedPages()`（refs 解包 → 构造 RenderInput → 调 renderDocumentToPages → 写 pages.value）与 3 个调用点（renderResult/toggleHiddenText/setRevisionMode）。hyperlinkMap 死代码删除 = 快照验证通过的独立小 commit。

### 1.3 纯度边界规则

1. `utils/rendering/**` 禁止 `import 'vue'`、禁止 import 任何 `.vue`、禁止触 DOM/window（exporters/printDocument 不在本轮范围）；
2. 一切外部状态（ref 值、i18n、字体解析器）只能经 RenderInput/options 显式入参；
3. 同一输入必须字节同输出（可重入、无隐藏可变模块态；计数器限定在单次调用生命周期内）;
4. composables（vue-dev-2 契约草案 A–E）独立成波，落 `src/composables/`；其"组装红线"与本节兼容，但**实施时序排在 T3 之后**，避免双头修改 DocPreview.vue。

---

## 二、② docParser.ts 分层拆分蓝图（T4 依据）

### 2.1 子域划分与迁移映射（源行段为实测）

| 目标文件（`utils/docparser/`） | 迁入类私有方法/接口（源行段≈） | 必迁? |
|---|---|---|
| `pieceTable.ts` | `Piece` 接口(76–96)、parseClxPieces(606–720) | ✅ |
| `storySplitter.ts` | StoryText/StoryPieceMap(97–133)、splitPiecesByStory(721–824)、parseClxWithStories(825–848)、toDocumentStories(1979–2012)、splitHeaderParts(2013–2098) | ✅ |
| `clxReader.ts` | readClxData(273–305)、readTableStream(306–321)、parseClx(562–605)、containsBinarySignature(849–853)、extractTextFromRange(854–943) | ✅ |
| `encodingDetector.ts` | extractTextWithAutoDetect(322–446)、extractTextSimple(447–561)、detectEncodingFromBinary(2960–2993)、scoreRawParagraphs/scorePlainText(2994–3028)、JUNK_CHAR_CLASS/EXTRA_JUNK_CHARS/isValidPrintableChar 静态成员、stripBinaryPrefix(3378–3501) | ✅ ⚠️与 DEF-002(T1) 同区，见时序 |
| `heuristics/textHeuristics.ts` | guessCharFormat(3029–3082)、detectCharacterStyles(3083–3145)、shouldHaveUnderline/isSameStyle(3146–3167)、detectParagraphFormat(3168–3201)、detectListInfo(3202–3270)、detectAlignment(3271–3309) | ✅ |
| `heuristics/paragraphFilter.ts` | filterParagraphsWithGenericLogic(2435–2434?)、filterAndEnhanceParagraphs(2507–2539)、applyStructuralFormats(2540–2959)、cleanParagraph/removeInternalDuplicates(3310–3377)、cleanWordFieldCodes/isValidChar/replacePageFieldsInText(3502–3571+)、hasSignificantContent/shouldSkipParagraph/hasTooManyJunkChars(3572–3605)、splitMultiRowTables(3629–3658) | ✅ |
| `assets/documentAssets.ts` | extractImages(2099–2155)、extractPictures(2156–2286)、extractProperties(2287–2330)、extractDop(2331–2356) | ✅ |
| `formatRecovery.ts` | parseFormatRuns(944–1461)、createParagraphsWithRealFormats(1462–1739)、tryParseFormatsFromTableStream(3659–3747)、applyParsedStylesToParagraphs(3748–3768) | 二期（必迁清单完成后视行数决定） |
| **留在 docParser.ts** | 类壳（字段+constructor）、parse()、parseWithFormat() 编排委托、extractFormattedText(1740–1978)、extractParagraphsWithFormat(2357–2434)、createFormattedParagraphsFromText(3606–3628)、extractTextFromFullFile(3769+)、三个公共 facade 函数 | — |

行数量化：必迁清单合计 ≈3,000 行外移 → docParser.ts 余 ≈950 行（≤1500 达标，余量给 formatRecovery 二期后 ≈450）。

### 2.2 结构与依赖规则

1. **会话上下文对象**代替超长参数表：
```ts
// utils/docparser/context.ts
export interface ParseSession {
  ole: OleParser
  directory: DirectoryEntry[]
  wordDocumentStream: StreamData
  tableStream: Uint8Array | null
}
```
子域函数签名形态：`(session: ParseSession, ...域内参数)`；无状态的纯函数（encodingDetector 多数、textHeuristics 全部）不许收 session，只收所需标量/缓冲。
2. `docparser/**` 禁止反向 import `../docParser`（防环）；`Piece/StoryText` 等随迁并 `export`。
3. **搬移纪律**：每子域一个 commit，只做 move + re-export，不改任何逻辑与日志文案；textutil 兼容、编码评分、"Unreachable/v8 ignore"注释逐字随码走；每 commit 前 `npm run build && npx vitest run` 全绿。
4. 门面形态：docParser.ts 底部保留 `export { parseDocFile, parseDocFileFromBuffer, parseDocFileWithFormat, DocParser, enableDebugMode } from './docparser/*'` 形式的 re-export（或类壳内薄委托），`index.ts`、`docParser.worker.ts`、`parseWithWorker.ts` 零改动。
5. DEBUG/logger 调用点原样保留；DEBUG_MODE 语义不变。

---

## 三、③ 硬约束与验证协议（T3/T4 共同红线）

### 3.1 公共 API 冻结清单（签名原文，逐字符不动）

```ts
parseDocFile(file: File, debug?: boolean): Promise<{ text: string; success: boolean; error?: string }>
parseDocFileFromBuffer(buffer: ArrayBuffer, fileName?: string): { success: boolean; document?: any; text?: string; error?: string }
parseDocFileWithFormat(file: File, debug?: boolean): Promise<{ success: boolean; document?: any; text?: string; error?: string }>
class DocParser { constructor(buffer: ArrayBuffer, maxScanBytes?: number); parse(); parseWithFormat(onProgress?) }
```

- 运行时签名、参数序、返回形状、错误文案语义全部冻结；`document?: any` 注解窄化为 `ParsedDocument` **不属于 T3/T4**，走 P0 独立 PR（captain 会签）。
- 连带冻结：`index.ts` 导出面、worker 消息协议 `{type:'progress'|'result'}`、`ParseProgressStage` 十阶段枚举及百分比锚点、`defineExpose(reload/getPlainText/focusContent)`。

### 3.2 可单测标准

- 抽离函数须能在 vitest（happy-dom 环境）中**不挂载 Vue 组件**直接调用并断言输出；
- 纯度分级：完全纯（同输入字节同输出）≥ 渲染管线的全部模块；含注入依赖的（t/fontResolver）测试中用固定桩保证确定性；
- 最小用例面（T3 交付时须存在）：collectTableBlock 合并单元格(colspan/rowspan)、renderNestedList 嵌套深度、renderListBlock `<ol start>` 续接、pageBuilder 分栏 CSS 注入(column-count/gap)、documentRenderer 三种 revisionMode 与"修订-超链接互斥"、encodingDetector 0x0D 比例两侧 + 评分回退、storySplitter rgCcp 分流、pieceTable 压缩/UTF-16 两 piece 形态。

### 3.3 HTML 逐字节一致协议（黄金快照）

1. **先建基线后动刀**：T3 第一个 commit 是测试设施——用 `@vue/test-utils` 挂载 DocPreview.vue，喂入固定样本，序列化全部 `.page-content` 元素的 outerHTML（按页序）存 `tests/__snapshots__/render-golden/<sample>.json`；
2. 样本集（qa T6 矩阵对齐，docs/ 现成可用）：`doc-100kb.doc`（常规）、`unicode-n2298.doc`（Unicode）、`fsample1.doc`（结构丰富）、`uow-cfp.doc`（表格列表）、任一含修订/图表样本（qa 提供）；textutil 类样本若缺则由 qa 补造；
3. 此后**每个 commit** 重跑同一挂载流程，与 golden JSON 严格相等（字节级，禁止 normalize/diff 容差）；不等即停，禁止"看起来一样就过"；
4. 快照设施本身不含任何业务改动，评审时可独立合入；
5. W3（documentRenderer）合入前额外做双向验证：新旧实现并存于同一 commit 内对比输出一致后，再删旧实现（删旧为独立 commit）。

### 3.4 时序与单写者规则

- **T1（sdet 评分回退修复）先于 T4 开工**：两者同改 docParser.ts 编码检测区域，并行必冲突；T3 不受 T1 牵制可与 T1 并行。
- 任意时刻 `DocPreview.vue` 唯一写者 = 当前波次负责人；`docParser.ts` 唯一写者同理。T3 与 T4 分属不同文件可双人并行。
- 每 commit 独立可回滚；波次完成判据挂钩 pm《验收基线》DoD：D1 build ✅、D2 测试棘轮不劣化、D3(a)(b)(c) 不回退、D4 上板变更摘要。
- 明确不做：不合并三处 \u0001 占位符实现（单独立项）、不动虚拟滚动/搜索语义、不顺手修 renderChartSvg 假数据、不做 exporters/composables 抽离（另行派单）。

---

## 四、对既有看板分析的采纳/修正记录

| 来源 | 处理 |
|---|---|
| vue-dev-3《render-pipeline-analysis》M1–M5 | **采纳**并固化为上文文件级方案；M6 占位符统一**否决出本轮**（等价性证明成本最高，单独立项） |
| vue-dev-3 R1–R11 风险清单 | 全部纳入 3.3/1.3 约束（R5 的 1.333 双处收敛为 PT_TO_PX 常量） |
| vue-dev-1《split-units》#18–23、波次框架、单写者规则 | **采纳**；其 #29 导出族/#27 webfonts 移出 T3 范围另行派单 |
| vue-dev-2《composables 契约草案》A–E | 作为 T3 后续波次基线采纳；其实施时序排 T3 之后；文案缺口(A4/A5/E④)不搭车 |
| vue-dev-4 类型债审计 | `document:any` 窄化、平行声明收敛走 P0 独立 PR，不混入 T3/T4 |
| leader 转登《ARCHITECTURE-REVIEW》P1/P2 路线 | 本文为其 T3/T4 部分的可执行细化；`src/rendering/`、`src/parser/` 命名修正为 `src/utils/rendering/`、`src/utils/docparser/`（理由：与既有 utils 平铺生态同根，import 路径扰动最小） |

—— architect · 2026-08-25 · contract-split-r1 v1.0
