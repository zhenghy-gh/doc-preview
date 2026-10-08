# 架构现状与优化路线（doc-preview v0.7.3）

> **署名**：architect（双栈架构师）　**日期**：2026-08-25
> **性质**：首轮架构评审结论 + 分阶段优化路线，供 captain 裁决后拆解派发。
> 数据均来自当日源码实测（wc -l / 符号清单 / 依赖图扫描），非估算。

---

## 一、现状盘点（实测数据）

### 1.1 代码量分布（src 共 21,890 行）

| 区域 | 行数 | 占比 | 备注 |
|---|---|---|---|
| `components/DocPreview.vue` | **5,990** | 27% | script ≈2,867 / template ≈832 / **scoped CSS ≈2,287** |
| `utils/docParser.ts` | **3,990** | 18% | 单类 `DocParser` 占 ≈3,780 行（L134–3915），47 个方法 |
| `utils/formatParser.ts` | 1,337 | 6% | SPRM 解码核心，0 处 any，质量良好 |
| `utils/fieldParser.ts` | 828 | 4% | |
| 其余 27 个 utils 模块 | ≈8,100 | 37% | 单模块 45–771 行，粒度健康 |
| `App.vue` + 5 个子组件 | ≈780 | 4% | 子组件化已起步（CollapsiblePanel/LoadingOverlay/ErrorDisplay/DocStatsPanel/ShortcutsPanel） |

### 1.2 工程形态

- **双形态发布**：应用（dev/preview）+ npm 库 `@zhenghy/doc-preview`（`build:lib`，入口 `src/index.ts`，external vue，dts 生成）。**index.ts 导出面是公共契约，重构不得破坏。**
- **测试基建完善**：37+ 个测试文件（含 realDocs 真实样本回归、性能、进度协议），vitest 全量覆盖 utils 层 —— 这是本轮所有重构的护栏。
- **已知盲区**：`vitest.config.ts` coverage 显式排除 `DocPreview.vue` —— 5,990 行组件**零单测**，渲染逻辑只能靠手验。
- **依赖图健康**：星形无环。`docParser` 唯一枢纽扇出 20 个模块；utils 无任何反向依赖 components；`formatParser/styleParser/listParser` 自成子图。

---

## 二、核心诊断（三个病灶）

### 病灶 1：类型契约「三处重复、中间断裂」 ⚠️ 最高优先级

实测证据：

```
docFormat.ts        ParsedDocument（42 个导出类型，字段与实际输出吻合）
     ↑                    ↑ 但无人使用！仅 index.ts re-export 给库用户
docParser.ts        parseWithFormat(): { document?: any ... }   ← 生产者返回 any（42 处 any）
     ↓
DocPreview.vue      本地重declare ParserOutput / FormattedParagraphOutput /
                    ParaWithList                              ← 消费者镜像类型
```

后果：同一个「文档解析输出」形状存在 **3 份描述**（官方类型、any、组件镜像）。任何新增文档特性（如 wordArts、styleSet 都是这么加进来的）要人肉同步三处，漏一处只能等运行时发现。这是当前最大的返工风险源。

### 病灶 2：DocPreview.vue 是「上帝组件」

script 内实测职责 ≥15 类：加载调度（1MB worker 阈值）、进度映射、**HTML 渲染引擎**（`formatFormattedTextToHtml` 及其辅助约 700 行：分页 finalizePage/estimateParaHeight、分栏 section 跟踪、表格块收集 collectTableBlock、嵌套列表递归 renderNestedList、chart SVG 手绘 renderChartSvg≈180 行）、搜索调度、修订模式、大纲构建、缩放、暗黑、分页导航、虚拟滚动、**13+ 面板的 show\* ref + 数据装配**、4 种导出（txt/html/md/copy）、打印窗口拼 HTML、全局键盘快捷键、web 字体注入（FONT_ALIASES/loadWebFonts/injectWebFontOverrides）、i18n 标签映射函数群。

结构性问题：
1. **渲染函数读响应式 `.value`**（`shapes.value` / `pictures.value` / `sections.value` 直接进纯算法）→ 「伪纯函数」，脱离 Vue 无法测试 → 于是被 coverage 排除 → 更没人敢动。恶性循环的根。
2. 2,287 行 scoped CSS 与逻辑同文件，色值未 token 化，暗黑靠 `.dark` 选择器成对复制。

### 病灶 3：`DocParser` 单类五职责并存

类内按内聚度可切出 5 块（行号为实测区间）：

| 块 | 内容 | 约行数 |
|---|---|---|
| A 文本提取核 | extractTextWithFib / readClxData / parseClx* / splitPiecesByStory / story 分流 | ~900 |
| B 编码探测与降级 | extractTextWithAutoDetect / detectEncodingFromBinary / score* / extractTextSimple / stripBinaryPrefix / extractTextFromFullFile | ~600 |
| C 规范级格式恢复编排 | **parseFormatRuns（518 行单方法）** / createParagraphsWithRealFormats（280 行）/ tryParseFormatsFromTableStream / applyParsedStylesToParagraphs | ~1,000 |
| D 启发式回退管线 | extractParagraphsWithFormat / filterAndEnhanceParagraphs / **applyStructuralFormats（420 行单方法）** / guessCharFormat / detectListInfo / detectAlignment / clean* 系列 | ~1,100 |
| E 外围资产提取 | extractImages / extractPictures / extractProperties / extractDop / toDocumentStories / splitHeaderParts / replacePageFieldsInText | ~500 |

要点：**C 与 D 是两代并存的格式策略**（规范级 vs 启发式推断），共享同一 `this` 状态纠缠在一起；`parseWithFormat` 尾部 ~60 行 `if (x) document.y = x` 的 any 装配散落在编排方法里。textutil 兼容、编码评分等关键 gotcha 都埋在 B/D 中间，搬移时必须原样保注释。

---

## 三、优化路线（三阶段，每阶段独立可交付，测试护栏全程在线）

### Phase 0｜契约定桩（先行，1 个 PR，≈半天）

1. `parseWithFormat()` 返回类型改为 `ParsedDocument`；把尾部 any 装配抽成纯函数 `buildParsedDocument(extracted): ParsedDocument`。
2. 盘点渲染侧实际消费的段落字段（`headingLevel`、`_cpStart/_cpEnd`、`table`、list 相关等），补进 `FormattedParagraph`；**禁止 any 溜回**。
3. DocPreview.vue 删除本地 `ParserOutput/FormattedParagraphOutput/ParaWithList` 镜像，全部 `import type` from `./utils/docFormat`（或 fieldParser 等归属模块）。
4. 加 ESLint 规则 `@typescript-eslint/no-explicit-any: warn`（utils 目录 error）兜底回归。

**验收**：`vue-tsc` 通过 + `npm test` 全绿 + `index.ts` 导出面 diff 为零。

### Phase 1｜渲染层剥离（DocPreview.vue script 2,867 → 目标 <1,200 行）

新建 `src/rendering/` 与 `src/composables/`（components/ 只留 .vue）：

| 新家 | 迁入物（均为实测符号） | 关键改造 |
|---|---|---|
| `rendering/pageBuilder.ts` | formatFormattedTextToHtml、collectTableBlock、renderNestedList、renderParagraphHtml、renderChartSvg/Html、renderTextboxAnchorHtml、renderInlinePictureHtml、formatTextWithCharacterStyles/DefaultStyles、BORDER/FONT_SIZE 映射 | 改真纯函数：`(paragraphs, ctx)`，`ctx` 是调用方解包后的普通对象（shapes/pictures/sections/hyperlinks/revisions/pageHeight…）；**从此可进 vitest** |
| `rendering/fonts.ts` | FONT_ALIASES、loadWebFonts、getWebFontFamily、injectWebFontOverrides | 无改动 |
| `rendering/exporters.ts` | downloadText/Html/Markdown、copyText、printDocument | 输入收敛为 `(html, text, fileName)` |
| `composables/usePagination.ts` | currentPage/goToPage/updateTotalPages/updatePageHeight | |
| `composables/useVirtualScroll.ts` | visibleStart/End、pageHeights、updateVisibleRange、measureVisiblePageHeights、handleVirtualScroll | 连同「搜索时临时禁用」语义一起迁移并补行为测试 |
| `composables/useSearch.ts` | searchQuery/results/index、performSearch、scrollToMatch、next/prevMatch | |
| `composables/useZoom.ts` / `useDarkMode.ts` / `useKeyboardShortcuts.ts` | 各自对应符号 | 快捷键表数据化 |
| `composables/useDocumentPanels.ts` | 13+ 个 `showXxx` ref | 收敛为 `panels: Record<PanelId, boolean>` + `toggle(id)`，模板 `v-if="panels('toc')"` |

组件续拆（模板 832 行）：`Toolbar.vue`、`SearchBar.vue`、`OutlineSidebar.vue`、`PageContentView.vue`；面板体按域拆 `PropertiesPanel/StoriesPanel/RevisionsPanel/...`（已有 CollapsiblePanel 底座，props 传数据即可）。

CSS：2,287 行迁 `styles/{base,toolbar,page-content,search,panels,error}.css`，色值/间距收敛为 `:root` CSS 变量（现有 `.dark` 类切换机制天然承接 token 化）。

**分层边界规约**：`rendering/` 禁止 `import vue`；`composables/` 只管状态与监听、不产 DOM 字符串；`.vue` 只做装配与事件转发。完成后将 `rendering/pageBuilder.ts` 纳入 coverage 并设阈值（≥70% 起步）。

### Phase 2｜解析器分层（docParser.ts 3,990 → 门面 <400 行）

新建 `src/parser/`，`docParser.ts` 保留为兼容门面（re-export，index.ts 与 worker 协议不动）：

```
src/parser/
  text/clxReader.ts pieceTable.ts storySplitter.ts   ← A 块
  text/encodingDetector.ts                            ← B 块
  format/formatRunParser.ts                           ← C 块 parseFormatRuns（518 行独占一文件，SPRM→中间表示 PieceFcRange/ChpxRun/PapxRun）
  format/paragraphAssembler.ts                        ← createParagraphsWithRealFormats + tryParseFormatsFromTableStream + applyParsedStylesToParagraphs
  heuristic/structuralFormats.ts                      ← applyStructuralFormats（420 行）
  heuristic/textHeuristics.ts                         ← guessCharFormat / detectCharacterStyles / detectListInfo / detectAlignment
  heuristic/paragraphFilter.ts                        ← filter* / clean* / shouldSkip / removeInternalDuplicates / stripBinaryPrefix
  assets/imageAssets.ts propertyAssets.ts dopAsset.ts storyAssets.ts   ← E 块
  pipeline.ts                                         ← parseWithFormat 十阶段编排（onProgress 协议不变）
  index.ts                                            ← 门面
```

**搬移纪律**：每次只做 move + re-export，不改逻辑，commit 前全量测试；顺序 **E → B → A → D → C**（由独立到纠缠）；textutil/编码评分相关注释随代码走。
**策略隔离**：以 `interface FormatRecoveryStrategy { apply(paragraphs, runs): void }` 切开 C/D 两代策略，pipeline 按 FIB 有效性选择实现 —— 为将来「启发式退役」预留开关，也让 D 块可以单独被冻结维护。

### 里程碑与人日预估

| 阶段 | 工作量 | 并行性 | 建议人力 |
|---|---|---|---|
| P0 契约定桩 | 0.5 天 | 串行，阻塞后续 | architect + 1 vue-dev |
| P1 渲染层剥离 | 2–3 天 | 可双线：rendering 线 / composable+面板线 | 2 名 vue-dev |
| P2 解析器分层 | 3–4 天 | 串行为主（搬移纪律） | 1 名工程师 + reviewer 每步过目 |

---

## 四、类型契约规范（团队规约，即刻生效）

1. **单一事实源**：跨文件 DTO 只定义在 `docFormat.ts`（或其归属 parser 模块）并 `export`；**禁止消费方镜像 declare**（本轮 ParserOutput 即教训案例）。
2. **类型先行**：新增文档特性 = 先改类型 → 再实现解析 → 再接 UI；PR 描述必须含类型 diff。
3. **any 清零计划**：现存 42 处 any 集中在 docParser.ts 私有中间态，随 Phase 2 搬移顺手收窄为具名 interface（沿用 Piece/StoryText 的私有 interface 做法）；新增 any 需 architect 会签。
4. **三大冻结契约**（变更须上板公告 + captain 会签）：`index.ts` 公共导出面；worker 消息协议 `{type:'progress'|'result'}`；`ParseProgressStage` 十阶段枚举及百分比锚点。
5. **命名约定**：解析产物 `*Info / *Range / *Entry`；渲染上下文 `RenderContext`；组合式函数 `useXxx`；单位换算 twips↔pt↔px 统一走工具函数（现散布 magic number `20 / 1.333`）。
6. **样式 token**：颜色、间距、纸张尺寸常量一律 CSS 变量或 TS 常量导出，禁止组件内裸写。

## 五、明确不做的事（防过度设计）

- ❌ 不引 Pinia/外部状态库 —— 组件树浅，composable 足够；
- ❌ 不改两条解析入口语义（`parse` / `parseWithFormat`）与 lib API；
- ❌ 不在本轮重写虚拟滚动/搜索互斥语义，只做搬迁 + 行为测试锁定；
- ❌ 不追求一次性大爆炸重构 —— 三阶段各自可停、可回滚（git tag 每阶段收口）。

---

**结论**：项目底子好（依赖图干净、测试护栏厚、子模块粒度健康），病灶集中在「契约断点」与两个巨型文件。按 P0→P1→P2 推进，预计 6–8 人日内 DocPreview.vue script 减半、docParser.ts 变薄门面，且每一步都有全量测试兜底。

—— architect · 2026-08-25
