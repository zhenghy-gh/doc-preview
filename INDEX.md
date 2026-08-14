# 项目索引 — doc-preview

> 本文件为项目导航索引，自动生成于 2026-08-14。点击文件名即可跳转。
> 纯前端 Vue 3 + TypeScript + Vite 的 **.doc (OLE2/CFB) 在线预览工具**，无需服务端。

## 快速开始

| 命令 | 用途 |
|---|---|
| `npm run dev` | 启动开发服务器 (http://localhost:5173) |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run build:lib` | 构建 npm 库产物（vite --mode lib + dts） |
| `npm run preview` | 预览构建产物 |
| `npm run test` / `test:watch` / `test:coverage` | Vitest 测试 / 监听 / 覆盖率 |

- 包名：`@zhenghy/doc-preview`，版本 **0.7.3**，MIT 协议，npm 发布库
- 在线体验：https://zhenghy-gh.github.io/doc-preview/

## 目录总览

```
doc-preview/
├── src/                  # 全部源码（入口 + 组件 + 28 个解析工具模块）
├── tests/                # 29 个 Vitest 测试文件（约 700+ 用例）
├── docs/                 # 架构文档 + 27 个 .doc 样例文件 + MS-DOC 规范笔记
├── docs/specs/           # 规范研读笔记（CFB/CLX/FIB/CHP-PAP）
├── scripts/              # 发布脚本
├── examples/             # 独立 HTML 示例
├── public/               # 静态资源（404/favicon/样例 doc）
├── *.mjs                 # 根目录调试探针脚本（scout/score/probe/bench）
└── 配置                  # package.json / vite.config.ts / vitest.config.ts / tsconfig*
```

## 源码索引 — src/

### 应用入口与组件 (src/)

| 文件 | 规模 | 说明 |
|---|---|---|
| [main.ts](src/main.ts) | 6 行 | 应用入口 |
| [App.vue](src/App.vue) | 575 行 | 主页面：拖拽/选择上传、语言切换、切换到 DocPreview |
| [index.ts](src/index.ts) | 11 行 | 库导出入口（npm 包） |
| [style.css](src/style.css) | 94 行 | 全局样式 + 响应式布局断点 |

### 组件 (src/components/)

| 文件 | 规模 | 说明 |
|---|---|---|
| [DocPreview.vue](src/components/DocPreview.vue) | 6370 行 | **核心预览组件**：渲染、搜索、缩放、分页、虚拟滚动、修订/索引/TOC/形状等全部面板 |
| [CollapsiblePanel.vue](src/components/CollapsiblePanel.vue) | 46 行 | 通用折叠面板 |
| [DocStatsPanel.vue](src/components/DocStatsPanel.vue) | 53 行 | 6 项文档统计面板 |
| [ErrorDisplay.vue](src/components/ErrorDisplay.vue) | 47 行 | 分类错误展示 + 重试 |
| [LoadingOverlay.vue](src/components/LoadingOverlay.vue) | 56 行 | 加载遮罩（indeterminate/百分比两种模式） |
| [ShortcutsPanel.vue](src/components/ShortcutsPanel.vue) | 56 行 | 快捷键说明模态面板 |

### 解析工具 (src/utils/，按解析流水线顺序)

#### 容器层 / 底层
| 文件 | 规模 | 导出 |
|---|---|---|
| [oleParser.ts](src/utils/oleParser.ts) | 727 行 | `OleParser` — OLE2/CFB 签名验证、FAT/DIFAT/目录表、流读取 |
| [fibParser.ts](src/utils/fibParser.ts) | 430 行 | `parseFib` — FIB 文件信息块、csw 链式偏移、`detectWordVersion`、`isTextutilFib` |
| [docParser.ts](src/utils/docParser.ts) | 3821 行 | **核心解析器** — `DocParser`、`parseDocFile(WithFormat)`、CLX/Piece Table、进度回调 |
| [docParser.worker.ts](src/utils/docParser.worker.ts) | 48 行 | Web Worker 后台解析（progress/result 双消息协议） |
| [parseWithWorker.ts](src/utils/parseWithWorker.ts) | 88 行 | `parseWithWorker` — Worker 封装，大文件 >1MB 异步解析 |
| [docFormat.ts](src/utils/docFormat.ts) | 692 行 | **全部类型定义**：CharacterFormat / ParagraphFormat / ParsedDocument / ParseResult 等 |
| [logger.ts](src/utils/logger.ts) | 49 行 | 调试日志（默认关闭，`enableDebugMode`） |

#### 格式恢复层（规范级）
| 文件 | 规模 | 导出 |
|---|---|---|
| [formatParser.ts](src/utils/formatParser.ts) | 1326 行 | `parseChpxRuns`/`parsePapxRuns` — CHPX/PAPX、SPRM 解码、FKP bin 表 |
| [styleParser.ts](src/utils/styleParser.ts) | 655 行 | `parseStylesheet` — STSH/STD 样式表、继承、`detectStyleSet` 样式集检测 |
| [fontParser.ts](src/utils/fontParser.ts) | 69 行 | `parseFontTable` — STTB Ffn 字体名称 |
| [listParser.ts](src/utils/listParser.ts) | 451 行 | `parseListTable` — LST/LVLF/PlcfLfo、编号格式、`computeListContinuity` 续接 |
| [sectionParser.ts](src/utils/sectionParser.ts) | 278 行 | `extractSections` — PlcfSed + SEPX 纸张/边距/方向/分栏 |
| [tableText.ts](src/utils/tableText.ts) | 383 行 | 表格重建、嵌套表格 `renderNestedTableHtml` |
| [propertyParser.ts](src/utils/propertyParser.ts) | 471 行 | SummaryInformation / DocumentSummaryInformation 元数据 |
| [dopParser.ts](src/utils/dopParser.ts) | 101 行 | `parseDop` — 文档属性标志（fFacingPages/fTitlePage/修订模式） |

#### 高级内容提取层
| 文件 | 规模 | 导出 |
|---|---|---|
| [fieldParser.ts](src/utils/fieldParser.ts) | 826 行 | PlcfFld 域解析：超链接、页码域、TOC(`parseTocInstruction`)、索引(`parseIndexResult`)、交叉引用、文档元数据域 |
| [bookmarkParser.ts](src/utils/bookmarkParser.ts) | 201 行 | `extractBookmarks` — PlcfBkf/Bkl + SttbfBkmk |
| [revisionParser.ts](src/utils/revisionParser.ts) | 139 行 | 修订痕迹：SttbfRMark、RMRK、DTTM 时间戳 |
| [revisionRender.ts](src/utils/revisionRender.ts) | 134 行 | `applyRevisionsToText` — marks/accepted/rejected 三模式渲染 |
| [headerFooterParser.ts](src/utils/headerFooterParser.ts) | 373 行 | PlcfHdd 页眉页脚拆分（首页/奇偶页）+ 启发式回退 |
| [imageExtractor.ts](src/utils/imageExtractor.ts) | 321 行 | Data 流魔数扫描（PNG/JPEG/BMP/GIF 双层校验） |
| [pictureParser.ts](src/utils/pictureParser.ts) | 444 行 | PICF/FCPic 结构化图片解析（fcPic 定位、sprmCPicLocation） |
| [shapeParser.ts](src/utils/shapeParser.ts) | 337 行 | Office Art Drawing 形状（类型/位置/尺寸/锚点） |
| [equationParser.ts](src/utils/equationParser.ts) | 242 行 | Equation Editor OLE 对象 + `eqnToLatex` 转换 |
| [chartParser.ts](src/utils/chartParser.ts) | 227 行 | MSGraph/Excel/SmartArt 图表识别 |
| [wordArtParser.ts](src/utils/wordArtParser.ts) | 286 行 | WordArt 对象：文本/效果/颜色提取 |
| [errorClassifier.ts](src/utils/errorClassifier.ts) | 215 行 | `classifyError` — 6 类错误分类 + 建议 |
| [locale.ts](src/utils/locale.ts) | 772 行 | i18n：chn/en 双字典 180+ 条目，`t()`/`tMap()` |

## 测试索引 — tests/（29 个文件，Vitest）

| 文件 | 用例数 | 覆盖目标 |
|---|---|---|
| [oleParser.test.ts](tests/oleParser.test.ts) | 68 | OLE 格式检测、目录表、流读取 |
| [fieldParser.test.ts](tests/fieldParser.test.ts) | 61 | PlcfFld、超链接、TOC/索引/交叉引用域 |
| [listParser.test.ts](tests/listParser.test.ts) | 44 | LST/LVLF、编号格式、CJK 编号 |
| [listDetection.test.ts](tests/listDetection.test.ts) | 40 | 列表启发式检测（阿拉伯/拉丁/多级） |
| [revisionRender.test.ts](tests/revisionRender.test.ts) | 38 | 修订渲染三模式、转义、时间格式化 |
| [fibParser.test.ts](tests/fibParser.test.ts) | 36 | FIB 解析、csw 链、回退逻辑 |
| [styleParser.test.ts](tests/styleParser.test.ts) | 34 | STSH/STD、样式继承、循环保护 |
| [headerFooterParser.test.ts](tests/headerFooterParser.test.ts) | 29 | 页眉页脚拆分、PlcfHdd |
| [errorClassifier.test.ts](tests/errorClassifier.test.ts) | 29 | 错误分类（中英文） |
| [clxParser.test.ts](tests/clxParser.test.ts) | 28 | CLX/Pcdt/Piece Table 鲁棒性 |
| [propertyParser.test.ts](tests/propertyParser.test.ts) | 27 | 文档属性解析 |
| [docParser.test.ts](tests/docParser.test.ts) | 26 | 入口、签名校验、maxScanBytes |
| [revisionParser.test.ts](tests/revisionParser.test.ts) | 24 | RMRK、DTTM 时间戳 |
| [chartParser.test.ts](tests/chartParser.test.ts) | 24 | 图表类型检测 |
| [formatParser.test.ts](tests/formatParser.test.ts) | 22 | CHPX/PAPX、SPRM 解码 |
| [tableText.test.ts](tests/tableText.test.ts) | 19 | 表格识别与渲染、0x07 单元格 |
| [imageExtractor.test.ts](tests/imageExtractor.test.ts) | 18 | 图片魔数扫描、防误报 |
| [equationParser.test.ts](tests/equationParser.test.ts) | 18 | eqn→LaTeX 转换 |
| [wordArtParser.test.ts](tests/wordArtParser.test.ts) | 18 | WordArt 提取 |
| [shapeParser.test.ts](tests/shapeParser.test.ts) | 17 | spid→形状类型 |
| [dopParser.test.ts](tests/dopParser.test.ts) | 15 | DOP 标志位 |
| [pictureParser.test.ts](tests/pictureParser.test.ts) | 13 | PICF 结构 |
| [tapParser.test.ts](tests/tapParser.test.ts) | 13 | TAP SPRM（表格属性） |
| [fkpParser.test.ts](tests/fkpParser.test.ts) | 11 | FKP bin 表 → CP 转换 |
| [sectionParser.test.ts](tests/sectionParser.test.ts) | 11 | 分节属性 |
| [logger.test.ts](tests/logger.test.ts) | 13 | 日志开关 |
| [parseWithWorker.test.ts](tests/parseWithWorker.test.ts) | 5 | Worker 回退逻辑 |
| [parseProgress.test.ts](tests/parseProgress.test.ts) | 4 | 进度回调、单调递增 |
| [parsePerformance.test.ts](tests/parsePerformance.test.ts) | 1 | 性能回归 |

## 文档索引 — docs/

### 设计文档
| 文件 | 说明 |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构设计 |
| [MODEL_WORKFLOW.md](docs/MODEL_WORKFLOW.md) | 模型工作流说明 |
| [BLOG_FOLLOWUP_v0.7.3.md](docs/BLOG_FOLLOWUP_v0.7.3.md) | CSDN 博客续篇：从启发式到规范级解析（v0.7.3 能力全景） |

### 规范研读笔记 (docs/specs/)
| 文件 | 说明 |
|---|---|
| [README.md](docs/specs/README.md) | 规范笔记入口 |
| [MS-CFB-SUMMARY.md](docs/specs/MS-CFB-SUMMARY.md) | CFB 复合文档规范摘要 |
| [MS-DOC-SUMMARY.md](docs/specs/MS-DOC-SUMMARY.md) | MS-DOC 规范摘要 |
| [MS-DOC-FIB.md](docs/specs/MS-DOC-FIB.md) | FIB 结构笔记 |
| [MS-DOC-CLX.md](docs/specs/MS-DOC-CLX.md) | CLX/Piece Table 笔记 |
| [MS-DOC-CHP-PAP.md](docs/specs/MS-DOC-CHP-PAP.md) | CHP/PAP 格式笔记 |
| [GAPS.md](docs/specs/GAPS.md) | 已知差距 |
| [implementation-plan.md](docs/specs/implementation-plan.md) | 实现计划 |

### 测试样例 .doc（27 个，docs/ + 根目录 + public/）
| 分类 | 文件 |
|---|---|
| 大小测试 | [doc-100kb.doc](docs/doc-100kb.doc) (98KB)、[doc-500kb.doc](docs/doc-500kb.doc) (492KB)、[doc-1mb.doc](docs/doc-1mb.doc) (1003KB)、[ftd-1.35mb.doc](docs/ftd-1.35mb.doc) (447KB) |
| 小文件变体 | doc-101 / doc-161 / doc-261 / doc-321（各 32KB，编码/结构变体） |
| 规范样例 | [fsample1.doc](docs/fsample1.doc)、[fsample3.doc](docs/fsample3.doc)、[fsample4.doc](docs/fsample4.doc) (1.2MB) |
| 标准文档 | [openstd-n961.doc](docs/openstd-n961.doc) (73KB) |
| Unicode 系列 | unicode-01022 / unicode-01351-N2376 (1.5MB) / unicode-02006-zia / unicode-02086-n2398 / unicode-03042-voting / unicode-form / unicode-n1750w97 / n2298 / n2532 / n4100 / n4250 / n4350 / n4400 |
| 大学文档 | [uow-bio.doc](docs/uow-bio.doc)、[uow-cfp.doc](docs/uow-cfp.doc) |
| 演示文件 | [file-sample_100kB.doc](public/file-sample_100kB.doc)（public/，上传页演示用）、根目录同名副本 |

## 调试探针脚本（根目录 *.mjs）

| 文件 | 用途 |
|---|---|
| [scout8.mjs](scout8.mjs) ~ [scout11.mjs](scout11.mjs) | 扫描流内 0x0D/编码特征的侦察脚本 |
| [probe-doc101.mjs](probe-doc101.mjs) | 定位 doc-101.doc 首段实际位置 |
| [score-debug.mjs](score-debug.mjs) / [score-debug2.mjs](score-debug2.mjs) | 编码评分调试 |
| [dbg-detect.mjs](dbg-detect.mjs) | 模拟 detectEncodingFromBinary |
| [bench-diff.mjs](bench-diff.mjs) | /diff 单轮评测：解析 vs textutil 基准、相似度、报告 |
| [parse-result.json](parse-result.json) | 某次解析结果快照 |

## 其他

| 文件 | 说明 |
|---|---|
| [examples/standalone.html](examples/standalone.html) | 独立 HTML 使用示例（CDN/单文件） |
| [scripts/publish.mjs](scripts/publish.mjs) | npm 发布脚本 |
| [vite.config.ts](vite.config.ts) | Vite 配置（@ 别名 → src/，库模式） |
| [vitest.config.ts](vitest.config.ts) | 测试配置 |
| [CHANGELOG.md](CHANGELOG.md) / [FEATURES.md](FEATURES.md) / [README.md](README.md) | 变更日志 / 功能清单 / 项目说明 |
| AGENTS.md / CLAUDE.md | AI 助手工作指引（本项目解析能力全景，49 项特性清单） |
| BENCH.md / SECURITY.md / CONTRIBUTING.md / CODE_OF_CONDUCT.md | 基准说明 / 安全 / 贡献指南 / 行为准则 |

## 解析流水线一览

```
.doc 文件
  → oleParser  OLE2 签名/FAT/DIFAT/目录表 → WordDocument 流
  → fibParser  FIB 结构（csw→FibRgW→cslw→FibRgLw→cbRgFcLcb 链式偏移）
  → docParser  CLX/Pcdt/Piece Table → 文本 + story 分流
  → formatParser  CHPX/PAPX SPRM 解码（字符/段落格式）
  → styleParser / fontParser / listParser / sectionParser / tableText
  → fieldParser / bookmarkParser / revisionParser / headerFooterParser
  → imageExtractor / pictureParser / shapeParser / equationParser / chartParser / wordArtParser
  → propertyParser / dopParser / errorClassifier
  → DocPreview.vue 渲染（分页/虚拟滚动/搜索/修订模式/各面板）
```

## 关键约定

- Vite 别名 `@` → `src/`；库导出走 `src/index.ts`
- 解析双路径：`parse()`（纯文本）/`parseWithFormat()`（完整格式，DocPreview 使用）
- `docParser.ts` 有 `DEBUG_MODE = true` 调试开关；`logger.ts` 提供运行时日志
- macOS `textutil` 生成文件（byte 10 = 0xBF）有专门兼容路径 `isTextutilFib()`
- 图片双层策略：CHPX fcPic + PICF 精确解析优先，Data 流魔数扫描回退
- 提交前确保 `package-lock.json` 已更新（使用 npm）
