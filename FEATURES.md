# DOC 文件功能支持清单

本文件列出 Microsoft Word `.doc`（Word 97-2003 / OLE2 / CFB 复合文档格式）的完整功能，以及本项目的实现状态。

---

## 📑 目录

1. [文件格式支持](#1-文件格式支持)
2. [文本内容](#2-文本内容)
3. [字符格式](#3-字符格式)
4. [段落格式](#4-段落格式)
5. [页面布局](#5-页面布局)
6. [页眉页脚](#6-页眉页脚)
7. [列表](#7-列表)
8. [表格](#8-表格)
9. [图片与图形](#9-图片与图形)
10. [域与公式](#10-域与公式)
11. [批注与修订](#11-批注与修订)
12. [超链接](#12-超链接)
13. [样式与模板](#13-样式与模板)
14. [其他功能](#14-其他功能)

---

## 1. 文件格式支持

| 功能 | 状态 | 说明 |
|------|------|------|
| OLE2 / CFB 复合文档解析 | ✅ 已实现 | 完整的 FAT/DIFAT/目录表解析 |
| Word 97-2003 二进制格式 | ✅ 已实现 | 支持主流 .doc 文件 |
| Word 6.0 / 95 格式 | ✅ 已实现 | nFib 版本检测（Word 6.0/95/97/2000/2002/2003/2007+），文本提取 + 编码自动检测，文档属性面板展示版本信息 |
| UTF-16LE（Unicode）编码 | ✅ 已实现 | 完整支持 |
| 8-bit 压缩编码 | ✅ 已实现 | 支持 fComplex 标志位检测 |
| 编码自动检测 | ✅ 已实现 | 基于二进制模式 + 评分机制 |
| macOS textutil 生成的 .doc | ✅ 已实现 | 特征检测 + 编码优化（忽略不可靠 fComplex 标志，优先 UTF-16） |
| .dot 模板文件 | ✅ 已实现 | 扩展名白名单支持 |
| DOCX (Open XML) | ❌ 不支持 | 建议使用专门的 DOCX 解析器 |

---

## 2. 文本内容

| 功能 | 状态 | 说明 |
|------|------|------|
| 纯文本提取 | ✅ 已实现 | 支持 `parse()` 方法获取纯文本 |
| 多字节字符（中文/日文/韩文） | ✅ 已实现 | 完整支持 CJK 字符 |
| 特殊符号 | ✅ 已实现 | 完整支持 Unicode 可打印字符，8-bit 模式支持 Windows-1252 高字节映射（em dash、en dash、省略号、弯引号等） |
| 换行符（段落标记） | ✅ 已实现 | 正确识别 0x0D 段落标记 |
| 分页符 | ✅ 已实现 | 识别 0x0C Form Feed，渲染分页标记
| 分节符 | ✅ 已实现 | PlcfSed + SEPX 解析，节属性面板展示 |
| 制表符（Tab） | ✅ 已实现 | 支持自定义制表位位置，Canvas 精确测量对齐 |
| 软换行（Shift+Enter） | ✅ 已实现 | 识别 0x0B 垂直制表符，渲染为 <br> |
| 不间断空格 | ✅ 已实现 | 识别 0xA0 NBSP，保留为 Unicode 不间断空格 |
| 可选连字符 | ✅ 已实现 | 识别 0xAD 软连字符 + 0x1E 不间断连字符 |
| 文本框内容 | ✅ 已实现 | 从 textbox story 提取文本，保留段落结构/缩进，渲染软换行/分页符/表格单元格标记 |

---

## 3. 字符格式

| 功能 | 状态 | 说明 |
|------|------|------|
| 字体名称 | ✅ 已实现 | STTB Ffn 字体表解析，sprmCFFont 映射 |
| 字体大小 | ✅ 已实现 | sprmHps SPRM 解码，FONT_SIZE_MAP 映射 |
| 加粗（Bold） | ✅ 已实现 | sprmCFBold SPRM 解码 |
| 斜体（Italic） | ✅ 已实现 | sprmCFItalic SPRM 解码 |
| 下划线（Underline） | ✅ 已实现 | sprmCFUnderline / sprmCKul SPRM 解码 |
| 删除线（Strikethrough） | ✅ 已实现 | sprmCFStrike / sprmCFStrikeBidi SPRM 解码 |
| 文字颜色 | ✅ 已实现 | sprmCV SPRM 解码，Word 颜色调色板映射 |
| 高亮（Highlight） | ✅ 已实现 | sprmCHighlight SPRM 解码 |
| 上标 / 下标 | ✅ 已实现 | sprmDxaPos / sprmHpsPos SPRM 解码 |
| 字符间距 | ✅ 已实现 | sprmDxaSpace / sprmKern SPRM 解码 |
| 字符边框 / 底纹 | ✅ 已实现 | sprmCFOutline / sprmCFShadow SPRM 解码 |
| 隐藏文字 | ✅ 已实现 | sprmCFVanish SPRM 解码，工具栏可切换显示 |
| 小型大写 / 全部大写 | ✅ 已实现 | sprmCFSmallCaps / sprmCFCaps SPRM 解码 |

> **说明**：字符格式通过 CHPX 格式表解析获取真实格式，支持样式继承和字符级细粒度样式段。

---

## 4. 段落格式

| 功能 | 状态 | 说明 |
|------|------|------|
| 段落分隔 | ✅ 已实现 | 正确识别段落边界 |
| 对齐方式（左/中/右/两端） | ✅ 已实现 | sprmPJc SPRM 解码 |
| 首行缩进 | ✅ 已实现 | sprmPDxaIndent SPRM 解码 |
| 左缩进 / 右缩进 | ✅ 已实现 | sprmPDxaLeft / sprmPDxaRight SPRM 解码 |
| 行距（Line Spacing） | ✅ 已实现 | sprmPLine SPRM 解码 |
| 段前间距 / 段后间距 | ✅ 已实现 | sprmPDyaBefore / sprmPDyaAfter SPRM 解码 |
| 段落边框 / 底纹 | ✅ 已实现 | sprmPBrcTop/Left/Bottom/Right + sprmPShd SPRM 解码 |
| 段落样式（Heading 1/2/3 等） | ✅ 已实现 | STSH 样式表解析，样式继承，50+ 内置样式映射 |
| 大纲级别 | ✅ 已实现 | sprmPOutlineLvl SPRM 解码，映射为 HTML h1-h6 |
| 制表位 | ✅ 已实现 | sprmPDxaTab / sprmPChgTabs SPRM 解码，Canvas 精确对齐 |
| 段前分页 | ✅ 已实现 | 0x0C Form Feed 识别，page-break-before CSS |

---

## 5. 页面布局

| 功能 | 状态 | 说明 |
|------|------|------|
| 纸张大小（A4/Letter 等） | ✅ 已实现 | sprmSXaPage/sprmSYaPage SPRM 解码，磅/cm 单位展示 |
| 页边距（上下左右） | ✅ 已实现 | sprmSDxaLeft/Right/sprmSDyaTop/Bottom SPRM 解码 |
| 纸张方向（纵向/横向） | ✅ 已实现 | sprmSBOrientation SPRM 解码 |
| 装订线 | ✅ 已实现 | sprmSDxaGutter SPRM 解码 |
| 分栏 | ✅ 已实现 | sprmSCcolumns/sprmSDxaColumns SPRM 解码，CSS column-count 实际分栏渲染（栏数+栏间距），section 切换时自动分页确保分栏独立 |
| 分节（Section Break） | ✅ 已实现 | PlcfSed + SED + SEPX 完整解析，节中断类型识别 |
| 起始页码 | ✅ 已实现 | sprmSPgnStart SPRM 解码 |
| 分页 | ✅ 已实现 | 按页面高度自动分页，支持上一页/下一页导航，页码显示 |
| 页码 | ✅ 已实现 | 属于页眉页脚范畴，分页导航显示当前页码/总页数 |

---

## 6. 页眉页脚

| 功能 | 状态 | 说明 |
|------|------|------|
| 页眉（Header） | ✅ 已实现 | 从 headers story 提取，在"非正文内容"面板展示 |
| 页脚（Footer） | ✅ 已实现 | 同上，合并到 headers story |
| 首页不同 | ✅ 已实现 | DOP fTitlePage 标志位检测，PlcfHdd 精确拆分首页页眉页脚，启发式回退 |
| 奇偶页不同 | ✅ 已实现 | DOP fFacingPages 标志位检测，PlcfHdd 精确拆分偶数页页眉页脚，启发式回退 |
| 页码域（PAGE / NUMPAGES） | ✅ 已实现 | PlcfFld 解析，PAGE/NUMPAGES/SECTION/SECTIONPAGES 域提取，页码域面板展示 |
| 页眉页脚中的图片 | ✅ 已实现 | 通过 chpxRuns 中的 fcPic 指针提取页眉页脚区域图片，按 PlcfHdd 子范围拆分，非正文内容面板展示 |

> **说明**：页眉页脚内容通过 Piece Table 的 rgCcp 边界分流提取，在侧边栏"非正文内容"面板中展示，不混入正文。

---

## 7. 列表

| 功能 | 状态 | 说明 |
|------|------|------|
| 编号列表（有序） | ✅ 已实现 | LST/LVLF/PlcfLfo 完整解析，sprmPIlst/ilfo 提取 |
| 项目符号列表（无序） | ✅ 已实现 | 同上，支持项目符号格式映射 |
| 多级列表 | ✅ 已实现 | sprmPIlvl 层级提取，嵌套列表渲染 |
| 列表编号续接 | ✅ 已实现 | 按 listId（ilst/ilfo）追踪编号连续性，跨非列表段落续接编号 |
| 自定义列表样式 | ✅ 已实现 | LST 结构解析，自定义编号格式/符号 |

---

## 8. 表格

| 功能 | 状态 | 说明 |
|------|------|------|
| 表格结构识别 | ✅ 已实现 | 0x07 单元格终结符识别，sprmPFInTable 检测 |
| 单元格内容提取 | ✅ 已实现 | 表格行/列结构重建 |
| 表格边框 | ✅ 已实现 | sprmTTableBorders 表格级边框 + sprmTDefTable 单元格级边框 |
| 合并单元格（行/列） | ✅ 已实现 | sprmTDefTable 解析，fVertMerge（rowspan）+ fHorzMerge（colspan）完整支持 |
| 表格对齐方式 | ✅ 已实现 | sprmTJTable 表格对齐（左/居中/右）+ sprmTDxaTableIndent 表格缩进 |
| 嵌套表格 | ✅ 已实现 | sprmPTableDepth 深度检测，renderNestedTableHtml 递归渲染嵌套表格 |

---

## 9. 图片与图形

| 功能 | 状态 | 说明 |
|------|------|------|
| 嵌入式图片（Inline） | ✅ 已实现 | PICF/FCPic 结构解析，sprmCPicLocation 定位，基于 CP 位置在正文中内联渲染，带尺寸限制和说明文字 |
| 浮动图片（Floating） | ✅ 已实现 | Office Art Drawing Container 解析，形状锚点定位，位置/尺寸/浮动状态提取 |
| 图片格式（JPEG/PNG/BMP/WMF/EMF） | ✅ 已实现 | Data 流魔数扫描，多格式支持 |
| 形状（Shape） | ✅ 已实现 | Office Art 形状解析，矩形/椭圆/线条/自由形状/文本框/图片/组合类型识别 |
| SmartArt | ✅ 已实现 | OLE 对象解析，SmartArt 类型识别（流程/循环/层次结构/矩阵/组织结构图），图表面板展示 |
| 图表（Chart） | ✅ 已实现 | MSGraph/Excel OLE 对象解析，图表类型识别，Picture/Data 流检测，图表面板展示 |
| 艺术字（WordArt） | ✅ 已实现 | OLE 目录表扫描，WordArt.N 存储对象解析，文本/效果/颜色提取，艺术字面板展示 |
| 文本框（Text Box） | ✅ 已实现 | 文本提取保留段落结构/缩进，渲染软换行/分页符/表格单元格标记；浮动位置标记渲染（通过 anchorCp 定位锚点段落，展示位置/尺寸/锚点信息） |

---

## 10. 域与公式

| 功能 | 状态 | 说明 |
|------|------|------|
| 页码域（PAGE / NUMPAGES） | ✅ 已实现 | PlcfFld 解析，PAGE/NUMPAGES/SECTION/SECTIONPAGES 域提取，页码域面板展示 |
| 日期时间域（DATE / TIME） | ✅ 已实现 | PlcfFld 解析，DATE/TIME/CREATEDATE/LASTSAVEDATE 域提取 |
| 目录域（TOC） | ✅ 已实现 | PlcfFld 解析，TOC 域识别，instruction 开关解析（\o/\t/\f/\p/\h/\n/\z/\u/\l），大纲条目提取 |
| 索引域（INDEX） | ✅ 已实现 | PlcfFld 解析，INDEX 域识别，主项/子项/页码提取，索引面板展示 |
| 交叉引用（REF） | ✅ 已实现 | PlcfFld 解析，REF/NOTEREF 域提取，目标书签+开关识别，交叉引用面板展示 |
| 公式编辑器（Equation Editor） | ✅ 已实现 | OLE 对象解析，EquationText 流提取，eqn 到 LaTeX 转换，公式面板展示 |
| 超链接域（HYPERLINK） | ✅ 已实现 | PlcfFld 解析，HYPERLINK 域提取，可点击链接 |
| 文档元数据域（AUTHOR/TITLE/REVNUM） | ✅ 已实现 | 8 种文档域类型提取，元数据面板展示 |

---

## 11. 批注与修订

| 功能 | 状态 | 说明 |
|------|------|------|
| 批注（Comments） | ✅ 已实现 | 从 comments story 提取，在"非正文内容"面板展示 |
| 修订模式（Track Changes） | ✅ 已实现 | SttbfRMark 作者表 + RMRK 结构 + DTTM 时间戳，插入/删除标记渲染 |
| 接受修订 / 拒绝修订 | ✅ 已实现 | 三种模式切换（显示标记 / 接受全部 / 拒绝全部），实时重新渲染文档 |
| 作者信息 | ✅ 已实现 | SttbfRMark 作者表解析，修订面板展示作者+时间 |

---

## 12. 超链接

| 功能 | 状态 | 说明 |
|------|------|------|
| URL 超链接 | ✅ 已实现 | PlcfFld HYPERLINK 域提取，可点击跳转 |
| 电子邮件链接 | ✅ 已实现 | mailto: 协议支持 |
| 文档内跳转（书签） | ✅ 已实现 | PlcfBkf/PlcfBkl + SttbfBkmk 解析，书签面板展示 |
| 超链接格式（蓝色下划线） | ✅ 已实现 | 默认渲染为蓝色下划线样式 |

---

## 13. 样式与模板

| 功能 | 状态 | 说明 |
|------|------|------|
| 内置样式（Normal/Heading 等） | ✅ 已实现 | STSH 样式表解析，50+ 内置样式映射 |
| 用户自定义样式 | ✅ 已实现 | STD 结构解析，用户样式提取 |
| 样式继承 | ✅ 已实现 | 样式继承链解析，baseStyle 应用 |
| 模板（.dot） | ✅ 已实现 | 文件扩展名支持，内容同 .doc |
| 样式集 | ✅ 已实现 | detectStyleSet 样式集检测（Default/Elegant/Formal/Modern 等），样式集信息在文档属性面板展示 |

---

## 14. 其他功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 文档属性（标题/作者/主题等） | ✅ 已实现 | SummaryInformation 流解析，元数据面板展示 |
| 脚注 / 尾注 | ✅ 已实现 | 从 footnotes/endnotes story 提取，"非正文内容"面板展示 |
| 目录（Table of Contents） | ✅ 已实现 | TOC 域解析，instruction 开关（\o/\t/\f/\p/\h/\n/\z/\u/\l）完整解析，大纲条目提取 |
| 索引（Index） | ✅ 已实现 | INDEX 域解析，主项/子项/页码提取，索引面板展示 |
| 书签 | ✅ 已实现 | PlcfBkf/PlcfBkl + SttbfBkmk 解析，书签面板展示名称与 CP 范围 |
| 复制为富文本 | ✅ 已实现 | 支持保留格式（加粗/斜体/下划线等）复制到剪贴板，多策略回退（ClipboardItem API → execCommand → 纯文本） |
| 暗黑模式 | ✅ 已实现 | 深色主题支持，预览页面工具栏添加切换按钮，localStorage 持久化 |
| 导出为 HTML | ✅ 已实现 | 将预览内容导出为完整 HTML 文件，包含内联样式，保留格式和图片 |
| 导出为 PDF | ✅ 已实现 | 通过浏览器打印功能导出 PDF，支持 A4 纸张、页眉页脚、页码 |
| 导出为 Markdown | ✅ 已实现 | 使用 DOM 解析器将预览 HTML 转换为标准 Markdown 格式，支持标题/加粗/斜体/删除线/链接/图片/表格/有序无序列表/代码块/引用 |
| 快捷键面板 | ✅ 已实现 | ⌨️ 面板展示全部快捷键列表（搜索/缩放/分页导航等），工具栏按钮 + ? + Ctrl+/ 触发，点击遮罩或 Escape 关闭 |
| 虚拟滚动（性能优化） | ✅ 已实现 | 页面级虚拟滚动，仅渲染可视区域 ±1 页内容，非可视页面用占位 div（高度缓存）保持滚动条正确；搜索/大纲导航时临时禁用确保全部页面可查询 |
| 移动端适配 | ✅ 已实现 | CSS 三断点响应式布局（900px/640px/480px），工具栏水平滚动，全宽面板，大触控目标（44px） |
| 文档统计 | ✅ 已实现 | 折叠面板展示字数/字符数/段落数/页数/图片数/表格数 6 项统计 |
| 国际化（中英文切换） | ✅ 已实现 | locale.ts 翻译模块（180+ 条目），App.vue 语言切换按钮，全部组件模板字符串替换为 t() 调用 |
| 加载进度条 | ✅ 已实现 | CSS 动画进度条（indeterminate + shimmer 效果），阶段文字提示（读取/下载/解析/渲染），异步阶段自动切换 |
| 解析百分比进度 | ✅ 已实现 | `parseWithFormat` 支持 `onProgress` 回调，Worker 消息协议升级为 progress/result 双类型，10 阶段进度报告（5%/15%/25%/35%/55%/65%/80%/85%/92%/100%） |
| 错误分类与重试 | ✅ 已实现 | `errorClassifier.ts` 6 类错误分类（network/format/parse/corrupted/memory/unknown），ErrorDisplay 组件含重试按钮 + 解决建议 + 技术细节折叠 |
| 组件拆分 | ✅ 已实现 | DocPreview.vue 拆分出 CollapsiblePanel/DocStatsPanel/ShortcutsPanel/LoadingOverlay/ErrorDisplay 5 个子组件，减少代码重复 |
| 宏（VBA） | ❌ 不支持 | 纯预览，不执行宏 |
| 密码保护文档 | ❌ 不支持 | 加密文档无法解析 |
| 数字签名 | ❌ 不支持 | |

---

## 📊 实现统计

| 类别 | 总数 | 已实现 | 部分实现 | 待实现 | 完成度 |
|------|------|--------|----------|--------|--------|
| 文件格式支持 | 9 | 8 | 0 | 1 | **89%** |
| 文本内容 | 10 | 10 | 0 | 0 | **100%** |
| 字符格式 | 13 | 13 | 0 | 0 | **100%** |
| 段落格式 | 11 | 11 | 0 | 0 | **100%** |
| 页面布局 | 9 | 9 | 0 | 0 | **100%** |
| 页眉页脚 | 6 | 6 | 0 | 0 | **100%** |
| 列表 | 5 | 5 | 0 | 0 | **100%** |
| 表格 | 6 | 6 | 0 | 0 | **100%** |
| 图片与图形 | 8 | 8 | 0 | 0 | **100%** |
| 域与公式 | 8 | 8 | 0 | 0 | **100%** |
| 批注与修订 | 4 | 4 | 0 | 0 | **100%** |
| 超链接 | 4 | 4 | 0 | 0 | **100%** |
| 样式与模板 | 5 | 5 | 0 | 0 | **100%** |
| 其他功能 | 20 | 18 | 0 | 2 | **90%** |
| **总计** | **119** | **115** | **0** | **4** | **~97%** |

> **说明**：完成度基于"功能点数量"计算。字符格式、段落格式、列表、样式等核心解析功能已全面实现规范级格式恢复。剩余待实现功能主要集中在页面布局、高级域和复杂图形领域。

---

## 🎯 优先级路线图（建议）

### 已完成 ✅

1. **表格支持** - 0x07 单元格终结符识别，TAP SPRM 解析，表格结构重建
2. **页眉页脚** - rgCcp 边界分流，story 提取，侧边栏展示
3. **超链接支持** - PlcfFld HYPERLINK 域提取，可点击跳转
4. **图片提取与展示** - PICF/FCPic 结构解析，内联渲染
5. **真实 CHP/PAP 格式解析** - 规范级格式恢复，SPRM 全量解码
6. **文档属性读取** - SummaryInformation 流解析，元数据面板
7. **目录生成** - 大纲提取，文档大纲导航
8. **脚注/尾注** - story 提取，侧边栏展示
9. **批注显示** - comments story 提取
10. **修订痕迹** - SttbfRMark + RMRK + DTTM 完整解析
11. **列表支持** - LST/LVLF/PlcfLfo 完整解析，多级列表
12. **样式表解析** - STSH/STD 结构，样式继承
13. **制表位/分页符/隐藏文字** - 特殊字符与格式支持
14. **分节符与页面布局** - PlcfSed + SEPX 解析，纸张/边距/方向/分栏/起始页码
15. **书签** - PlcfBkf/PlcfBkl + SttbfBkmk 解析，文档内跳转
16. **页码域** - PAGE/NUMPAGES/SECTION/SECTIONPAGES 域解析与面板展示
17. **交叉引用** - REF/NOTEREF 域解析，目标书签与开关识别，交叉引用面板
18. **浮动图片形状锚点** - Office Art Drawing Container 解析，形状类型识别，位置/尺寸/锚点信息提取，形状面板展示
19. **公式编辑器** - Equation Editor OLE 对象解析，EquationText 流提取，eqn 到 LaTeX 转换，公式面板展示
20. **图表与 SmartArt** - MSGraph/Excel OLE 对象解析，图表类型识别，SmartArt 类型识别，图表面板展示
21. **艺术字（WordArt）** - Office Art WordArt 对象解析，OLE 目录表扫描，文本/效果/颜色提取，艺术字面板展示
22. **首页不同/奇偶页不同页眉页脚** - PlcfHdd 位置表解析，DOP fTitlePage/fFacingPages 标志位检测，首页/奇偶页页眉页脚精确拆分，启发式回退
23. **接受修订/拒绝修订** - 三种模式切换（显示标记/接受全部/拒绝全部），修订面板按钮实时重新渲染文档，纯函数 applyRevisionsToText 支持单元测试
24. **分页支持** - 按页面高度（A4 默认 842pt）自动分割内容为页面块，工具栏分页导航控件（上一页/下一页/页码显示），支持 pageBreakBefore 段落强制换页
25. **表格增强（单元格边框+水平合并）** - sprmTDefTable 完整解析 TC 结构，单元格级边框（BrcTop/BrcLeft/BrcBottom/BrcRight），水平合并（fHorzMerge → colspan），单元格级样式渲染
26. **表格对齐与缩进** - sprmTJTable 表格对齐方式（左/居中/右），sprmTDxaTableIndent 表格缩进（twips），CSS margin 实现表格居中/右对齐/缩进
27. **索引域解析** - PlcfFld 中 INDEX 域（flt=14）识别，parseIndexResult 函数解析索引结果文本（点引导符/制表符分隔），提取主索引项（mainTerm）、子索引项（subTerm）和页码（pageNumber），索引面板展示
28. **样式集检测** - detectStyleSet 函数基于样式名称模式匹配识别内置样式集（Default/Elegant/Formal/Modern/Professional/Simple/Traditional），根据样式数量和标题存在性推断自定义样式集，样式集信息在文档属性面板展示
29. **嵌套表格渲染** - renderNestedTableHtml 函数根据 sprmPTableDepth 深度字段递归渲染嵌套表格，更深的行作为父表格最后一个单元格内的子表格，使用占位符机制避免 escapeHtml 转义子表格 HTML
30. **TOC 域指令开关解析** - parseTocInstruction 函数解析 TOC 域 instruction 中的所有开关（\o 大纲级别范围、\t 自定义样式、\f 包含 TC 域、\p 分隔符、\h 超链接、\n 隐藏页码、\z 隐藏 TabLeader、\u 使用应用大纲级别、\l 仅指定级别），TocOptions 结构化返回，TOC 域完整解析
31. **列表编号续接** - computeListContinuity 纯函数按 listId（ilst/ilfo）追踪编号连续性，跨非列表段落续接编号，不同列表ID使用独立计数器，支持多级列表（仅 level-0 计入编号），<ol start="N"> HTML 属性实现续接渲染
32. **特殊符号增强** - 将 UTF-16 模式字符识别从白名单升级为黑名单策略，完整支持所有可打印 Unicode 字符；8-bit 压缩模式新增 Windows-1252 高字节映射（27 个排版符号：em dash、en dash、省略号、弯引号、项目符号、商标符号等）；新增 isValidPrintableChar 统一字符有效性判断
33. **文本框内容增强** - formatStoryText 函数改进：按单个段落标记分割保留段落结构，保留前导空格（缩进），压缩连续空段落，渲染软换行（`<br>`）、分页符（`[分页]` 标记）、表格单元格标记（`│` 分隔符）；惠及所有 story（页眉页脚/脚注/尾注/批注/文本框）的展示
34. **文本框浮动位置渲染** - 通过 ShapeInfo.anchorCp 将文本框形状定位到主文档锚点段落，renderTextboxAnchorHtml 函数生成浮动标记（位置/尺寸 px + 锚点类型 + tooltip 完整 twips/CP/SPID 信息），暗黑模式适配，文本框从"部分支持"升级为"已实现"
35. **虚拟滚动（性能优化）** - 页面级虚拟滚动，仅渲染可视区域 ±1 页内容，非可视页面用占位 div（高度缓存）保持滚动条正确；formatFormattedTextToHtml 返回页面数组 string[]，模板用 v-for 渲染配合 isPageVisible/getPagePlaceholderHeight；搜索/大纲导航时临时禁用虚拟滚动确保全部页面可查询；window scroll/resize 监听 + requestAnimationFrame throttle；小文档（≤3 页）自动跳过虚拟滚动
36. **导出为 Markdown** - DOM 解析器将预览 HTML 转换为标准 Markdown 格式（标题/加粗/斜体/删除线/链接/图片/表格/列表/代码块/引用），工具栏 📝 按钮一键下载 .md 文件
37. **快捷键面板** - ⌨️ 面板展示全部快捷键列表（搜索/缩放/分页导航等），工具栏按钮 + ? + Ctrl+/ 触发，点击遮罩或 Escape 关闭，kbd 标签样式渲染按键
38. **移动端适配** - CSS 三断点响应式布局（900px 工具栏折叠 + 侧边栏内嵌、640px 全宽面板、480px 44px 触控目标），工具栏水平滚动按钮
39. **文档统计** - 折叠面板展示字数/字符数/段落数/页数/图片数/表格数 6 项统计，基于 ParsedDocument 实时计算
40. **国际化 i18n（中英文切换）** - 轻量级 i18n 方案（无 vue-i18n 依赖），locale.ts 含 180+ 中英文翻译条目，App.vue 语言切换按钮 + localStorage 持久化，DocPreview.vue 全部模板字符串替换为 t() 响应式调用
41. **加载进度条** - CSS 动画进度条（indeterminate + shimmer 双重动画），阶段文字提示（读取/下载/解析/渲染），异步阶段自动切换
42. **解析百分比进度** - `parseWithFormat` 支持 `onProgress` 回调穿透，Worker 消息协议升级为 `{type:'progress'|'result'}` 双类型分流，10 阶段进度报告（verifying 5% → parsing_fib 15% → parsing_clx 25% → parsing_formats 35% → parsing_fields 55% → parsing_shapes 65% → building_paragraphs 80% → extracting_properties 85% → extracting_images 92% → finalizing 100%）
43. **错误分类与重试** - `errorClassifier.ts` 6 类错误分类（network/format/parse/corrupted/memory/unknown），每类含友好标题 + 详细描述 + 解决建议列表 + retryable 标志；ErrorDisplay 组件展示分类图标 + 标题 + 建议 + 重试按钮 + 技术细节折叠（details/summary）
44. **组件拆分** - DocPreview.vue 拆分出 5 个子组件：`CollapsiblePanel`（通用折叠面板，slot 模式）、`DocStatsPanel`、`ShortcutsPanel`、`LoadingOverlay`（支持 indeterminate 和百分比两种模式）、`ErrorDisplay`；减少代码重复，为后续面板迁移到 CollapsiblePanel 奠定基础

### 待实现（按优先级）

#### 高优先级
（暂无）

#### 中优先级
（暂无）

#### 低优先级
（暂无）

---

## 🔧 技术参考

- [Microsoft Word 97-2007 Binary File Format (.doc) Specification](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc)
- [OLE2 / CFB 复合文档格式](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb)
- 项目架构文档：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
