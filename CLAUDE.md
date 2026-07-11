# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

纯前端 `.doc` 文件在线预览工具。核心是一个基于 Vue 3 + TypeScript + Vite 的 OLE2/CFB 复合文档解析器，无需服务端支持即可解析 `.doc` 文件中的文本和基础格式信息。

## Commands

```bash
# 启动开发服务器 (默认 http://localhost:5173)
npm run dev

# 构建生产版本 (vue-tsc 类型检查 + vite build)
npm run build

# 预览构建产物
npm run preview
```

注意：该项目使用 npm，提交代码前确保 `package-lock.json` 已更新。

## Project Structure

```
src/
  main.ts                 # 应用入口
  App.vue                 # 主页面：文件拖拽/选择上传，切换到 DocPreview
  style.css               # 全局样式
  components/
    DocPreview.vue        # 文档预览组件：调用 parser 解析 .doc，渲染为 HTML
  utils/
    docParser.ts          # 核心解析器：OLE2 格式解析、FIB 解析、文本/格式提取
    docFormat.ts          # 格式化类型定义 (CharacterFormat, ParagraphFormat 等)
    docFormatTypes.ts     # 旧的/备选类型定义
    oleParser.ts          # OLE2/CFB 容器层解析：签名验证、FAT/DIFAT/目录表、流读取
    fibParser.ts          # FIB 解析：文件信息块、关键偏移提取
    formatParser.ts       # 格式表解析：CHPX/PAPX 结构、SPRM 解码、字符/段落格式恢复
    propertyParser.ts     # OLE 属性集解析：SummaryInformation 流、文档元数据提取
    styleParser.ts        # 样式表解析：STSH 结构、STD 样式定义、样式继承
    fontParser.ts         # 字体表解析：STTB Ffn、字体名称映射
    listParser.ts         # 列表解析：LST/LVLF/PlcfLfo、列表编号格式
    fieldParser.ts        # 域解析：PlcfFld、超链接/文档元数据/页码域/交叉引用（REF/NOTEREF）提取
    imageExtractor.ts     # 图片提取：Data 流魔数扫描、嵌入式图片识别（基础）
    pictureParser.ts      # 图片增强解析：PICF/FCPic 结构、sprmCPicLocation 定位、结构化返回
    tableText.ts          # 表格处理：0x07 单元格终结符识别、表格结构重建
    revisionParser.ts     # 修订痕迹解析：SttbfRMark 作者表、RMRK 结构、DTTM 时间戳
    revisionRender.ts     # 修订渲染：applyRevisionsToText 纯函数，支持 marks/accepted/rejected 三种模式
    dopParser.ts          # DOP 解析：文档属性容器、奇偶页/首页/修订模式标志
    bookmarkParser.ts     # 书签解析：PlcfBkf/PlcfBkl + SttbfBkmk、文档内跳转
    sectionParser.ts      # 分节解析：PlcfSed + SEPX、纸张/边距/方向/分栏/起始页码
    shapeParser.ts        # 形状解析：Office Art Drawing Container、形状类型/位置/尺寸/锚点提取
    equationParser.ts    # 公式解析：Equation Editor OLE 对象、EquationText 流提取、eqn 到 LaTeX 转换
    chartParser.ts       # 图表解析：MSGraph/Excel/SmartArt OLE 对象、图表类型识别、图表面板展示
    wordArtParser.ts     # 艺术字解析：Office Art WordArt 对象解析、文本/效果/颜色提取、艺术字面板展示
    headerFooterParser.ts # 页眉页脚解析：PlcfHdd 位置表解析、首页/奇偶页页眉页脚拆分、启发式回退
    docParser.worker.ts   # Web Worker 后台解析
    parseWithWorker.ts    # Worker 封装：大文件异步解析
```

## Architecture

### .doc Parser (`src/utils/docParser.ts`)

解析流程遵循 OLE2 复合文档规范：

1. **OLE2 签名验证** — 检查 D0 CF 11 E0 A1 B1 1A E1 魔数（`oleParser.ts`）
2. **文件头解析** — 读取扇区大小、DIFAT/FAT 位置等元信息（`oleParser.ts`）
3. **FAT/DIFAT 表解析** — 构建扇区分配表（FAT 数组按扇区号索引，`fat[sectorNumber] = nextSector`）（`oleParser.ts`）
4. **目录表解析** — 查找 WordDocument 流（`oleParser.ts`）
5. **FIB (File Information Block) 解析** — 读取 fcClx/lcbClx、fcPlcfBteChpx、fcPlcfBtePapx 等关键偏移定位文本和格式数据。注意：**FibRgW/cslw/cbRgFcLcb 的偏移量取决于 csw 值**（`fibParser.ts`）
6. **CLX/Pcdt/Piece Table 解析** — 通过 prm 字段关联 CHPX，按 rgCcp 边界分流 story（主文档、脚注、页眉页脚、尾注、批注、文本框）
7. **真实格式恢复（规范级）** — 通过 CHP/PAP 格式表解析获取真实字符和段落格式：
   - **CHPX 解析**（`formatParser.ts`）：PlcfBteChpx 结构解析、SPRM 解码（加粗、斜体、下划线、删除线、双删除线、上标、下标、字号、颜色、高亮、字体名称、小型大写、全部大写、字符边框、字符阴影、字符间距）
   - **PAPX 解析**（`formatParser.ts`）：PlcfBtePapx 结构解析、SPRM 解码（对齐、左/右/首行缩进、行距、段前/段后间距、大纲级别、段落底纹、段落边框、制表位、列表格式）
   - **样式表解析**（`styleParser.ts`）：STSH/STD 结构解析、CHP/PAP grpprl 提取、样式继承、50+ 内置样式映射
   - **字体表解析**（`fontParser.ts`）：STTB Ffn 结构解析、sprmCFFont 字体名称映射
   - **列表解析**（`listParser.ts`）：LST/LVLF/PlcfLfo 完整解析、sprmPIlvl/ilst/ilfo 提取、getListFormat 格式映射
8. **文档属性提取** — 通过 SummaryInformation 流解析获取标题、作者、主题、关键词、字数等元数据（`propertyParser.ts`）
9. **超链接提取** — PlcfFld 解析、HYPERLINK 域提取（`fieldParser.ts`）
10. **图片提取** — Data 流魔数扫描（基础）+ PICF/FCPic 结构解析（增强），sprmCFSpec/sprmCPicLocation SPRM 解码，结构化返回格式/尺寸/浮动状态（`imageExtractor.ts` + `pictureParser.ts`）
11. **修订痕迹** — SttbfRMark 作者表解析 + RMRK 结构 + DTTM 时间戳，sprmCFRMark/sprmCFRMarkDel/sprmCRMark/sprmCRMarkDel SPRM 解码（`revisionParser.ts`）
12. **文档标志与元数据域** — DOP 解析（fFacingPages/fTitlePage/fRMW 等，`dopParser.ts`）；PlcfFld 文档域提取（AUTHOR/TITLE/DATE/REVNUM 等，`fieldParser.ts`）
13. **书签解析** — PlcfBkf/PlcfBkl 位置表 + SttbfBkmk 名称表解析，文档内跳转范围（`bookmarkParser.ts`）
14. **分节解析** — PlcfSed 位置表 + SEPX 分节属性提取（纸张大小、页边距、方向、装订线、分栏、起始页码，`sectionParser.ts`）
15. **页码域解析** — PlcfFld 中 PAGE/NUMPAGES/SECTION/SECTIONPAGES 域识别（通过 instruction 文本关键字匹配，无专门 flt 值），域结果替换正文中的 instruction+result 连接串（`fieldParser.ts` + `docParser.ts`）
16. **交叉引用解析** — PlcfFld 中 REF/NOTEREF 域识别（通过 instruction 文本关键字匹配），提取目标书签名称与域开关（\h/\n/\r/\w/\p/\f/\d），交叉引用面板展示（`fieldParser.ts`）
17. **形状解析** — Office Art Drawing Container 解析（MS-ODRAW 规范），提取形状类型（矩形/椭圆/线条/文本框/图片/组合）、位置/尺寸（twips）、锚点类型/CP、浮动状态、关联图片 fcPic（`shapeParser.ts`）
18. **公式解析** — Equation Editor OLE 对象解析，从 EquationText 流提取公式文本，将 eqn 格式转换为 LaTeX，支持希腊字母、分数、根号、上下标、运算符、三角函数、求和/积分等（`equationParser.ts`）
19. **图表解析** — MSGraph/Excel/SmartArt OLE 对象解析，从目录表提取图表名称和类型，检测 Picture/Data 流，支持图表类型（柱状图/条形图/折线图/饼图等）和 SmartArt 类型（流程/循环/层次结构/矩阵/组织结构图）（`chartParser.ts`）
20. **艺术字解析** — Office Art WordArt 对象解析，扫描 OLE 目录表中名称匹配 `^WordArt\.\d+` 的存储对象，提取 WordArt 流中的文本、效果（渐变/阴影/浮雕/斜角/轮廓/填充/3D/旋转/翻转/拉伸）和颜色信息，艺术字面板展示（`wordArtParser.ts`）
21. **页眉页脚拆分** — PlcfHdd 位置表解析（FIB fcPlcfHdd/lcbPlcfHdd 偏移），根据 DOP fTitlePage/fFacingPages 标志位将 ccpHdd story 拆分为首页/奇数页/偶数页页眉页脚，PlcfHdd 不可用时回退到启发式段落拆分（`headerFooterParser.ts`）
22. **修订模式切换（接受/拒绝修订）** — `applyRevisionsToText` 纯函数（`revisionRender.ts`）支持三种渲染模式：marks（生成 `<ins>`/`<del>` 标签）、accepted（insert 保留文本，delete 移除文本）、rejected（insert 移除文本，delete 保留文本）；DocPreview.vue 修订面板提供按钮切换模式并实时重新渲染文档
23. **分页支持** — 按页面高度（A4 默认 842pt）自动分割内容为 `.page-content` 容器，工具栏分页导航控件（上一页/下一页/页码显示），支持 `pageBreakBefore` 段落强制换页，基于节信息动态计算页面尺寸
24. **表格增强** — sprmTDefTable 完整解析 TC 结构（TCGrpf 位域 + 4 个 Brc 边框），单元格级边框渲染（上/下/左/右），水平合并（fHorzMerge → colspan）+ 垂直合并（fVertMerge → rowspan）完整支持
25. **表格对齐与缩进** — sprmTJTable (0xD632) 表格对齐方式（左/居中/右），sprmTDxaTableIndent (0xD609) 表格缩进（twips），CSS margin 实现表格居中/右对齐/缩进渲染

两条解析路径：
- `parse()` — 只提取纯文本
- `parseWithFormat()` — 提取文本 + 完整格式信息（段落、字符样式、列表、超链接、文档属性），在 DocPreview.vue 中使用

### FIB 解析

关键逻辑在 `parseFib()` 中：
- 读取 Byte 12 的 bit 0 作为 `fComplex` 标志（1=8-bit 压缩，0=UTF-16LE）
- 通过 csw->FibRgW->cslw->FibRgLw->cbRgFcLcb 的链式计算 rgFcLcb 偏移
- `cbRgFcLcb < 16` 视为无有效偏移，回退到自动检测
- 已知问题：macOS `textutil` 创建的 .doc 文件 byte 12 始终为 0xBF，fComplex 不可靠

### 编码自动检测

当 FIB 无有效 fcMin/fcMac 时（常见于 textutil 创建的文件），使用 `detectEncodingFromBinary()` 方法：

1. 从 WordDocument 流 offset 2048 开始扫描 0x0D 字节
2. 计算 0x0D 后跟 0x00 的比例
3. **比例 < 30% → 8-bit 压缩**（段落标记为单独 0x0D）
4. **比例 >= 30% → UTF-16LE**（段落标记为 0x0D 0x00）
5. 如果无法通过二进制判断（无 0x0D），回退到评分机制：尝试两种编码并对结果评分

### 二进制前缀清除

`stripBinaryPrefix()` 处理第一个段落中的 FIB 头部噪声：
- **8-bit 模式**：检测高字节（>0x7E）比例，用 `\b[A-Z][a-z]+\b` 或元音单词定位正文起始
- **UTF-16LE 模式**：检测 CJK/ASCII 交替模式（FIB 噪声特征），定位第一个连续 4+ 中文字符
- 在 `filterParagraphsWithGenericLogic` 中对 filtered[0] 调用

### DocPreview 渲染

`DocPreview.vue` 接收 parseWithFormat 的结果，将段落按以下优先级渲染为 HTML：
1. 如果解析器返回了字符级样式 (`charFormat.styles`) — 逐字符应用字体/下划线
2. 如果只有段落级格式 — 使用整体字体/对齐/加粗设置
3. 纯文本降级 — 短文本居中加粗作为标题，其余正文

**制表位渲染**：`applyTabStops()` 函数使用 Canvas 精确测量文本宽度，将 `\t` 替换为对应宽度的 `<span>`，实现与 Word 一致的制表位对齐效果；无自定义制表位时使用 CSS `tab-size` 回退。

### 关键类型 (`src/utils/docFormat.ts`)

- `CharacterFormat` — fontName, fontSize, bold, italic, underline, strikethrough, superscript, subscript, color, highlight, smallCaps, allCaps, outline, shadow, letterSpacing
- `ParagraphFormat` — alignment, indent, rightIndent, firstLineIndent, lineSpacing, spaceBefore, spaceAfter, outlineLevel, backgroundColor, tabs, borders, table, pageBreakBefore
- `ParsedDocument` — paragraphs: FormattedText[], lists, hyperlinks, properties, stories (headers, footnotes, endnotes, comments, textboxes), toc, docFlags, revisions, documentFields, bookmarks, sections, pageFields, crossReferences, shapes
- `ParseResult` — success, document?, text?, error?

### 文档属性类型 (`src/utils/propertyParser.ts`)

- `DocumentProperties` — title, subject, author, keywords, comments, template, lastAuthor, revisionNumber, appName, editTime, lastPrinted, createdTime, lastSavedTime, pageCount, wordCount, charCount, thumbnail

## Known Issues & Gotchas

- 解析器已实现**规范级格式恢复**，通过 CHP/PAP 格式表解析获取真实字符和段落格式；启发式推断已降级为备用方案
- 编码自动检测依赖 0x0D/0x00 二进制模式。对于无段落标记（无 0x0D）的 Word 95 文件，回退评分可能误选编码
- `detectEncodingFromBinary` 从 offset 2048 开始扫描，以避免 FIB 头部中的伪 0x0D
- `stripBinaryPrefix` 的 CJK 噪声检测（`[一-鿿]{4,}`）在 FIB 噪声 CJK 字符紧邻真实 CJK 文本时可能残留 1 个字符
- FAT 表实现：`fat = new Array(totalSectors).fill(-2)`，DIFAT 中每个条目对应 `d * entriesPerSector` 个扇区
- 流读取：使用 `sectorToOffset(currentSector)` 而非 `sectorToOffset(fat[currentSector])` 计算物理偏移
- App.vue 的 `isValidFile` 同时接受 `.doc` 和 `.dot` 扩展名
- `docParser.ts` 有 `DEBUG_MODE = true` 常量，控制调试日志输出
- Vite resolve 别名 `@` 指向 `src/` 目录
- 确认无任何硬编码的文档特定模式；所有规则均基于通用文本特征
- macOS `textutil` 创建的 .doc 文件 byte 12 始终为 0xBF，fComplex 标志不可靠
- 图片提取采用双层策略：优先通过 CHPX `fcPic` + PICF 结构精确解析，回退到 Data 流魔数扫描；浮动图片通过 Office Art Drawing Container 解析获取形状锚点定位
- `ParsedDocument.images`（data URL 数组）保留用于向后兼容；新增 `pictures` 字段提供结构化信息（format/widthPx/heightPx/floating/cp）
