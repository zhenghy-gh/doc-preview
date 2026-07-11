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
| Word 6.0 / 95 格式 | ⚠️ 部分支持 | 可提取文本，格式支持有限 |
| UTF-16LE（Unicode）编码 | ✅ 已实现 | 完整支持 |
| 8-bit 压缩编码 | ✅ 已实现 | 支持 fComplex 标志位检测 |
| 编码自动检测 | ✅ 已实现 | 基于二进制模式 + 评分机制 |
| macOS textutil 生成的 .doc | ⚠️ 部分支持 | fComplex 标志不可靠，使用自动检测兜底 |
| .dot 模板文件 | ✅ 已实现 | 扩展名白名单支持 |
| DOCX (Open XML) | ❌ 不支持 | 建议使用专门的 DOCX 解析器 |

---

## 2. 文本内容

| 功能 | 状态 | 说明 |
|------|------|------|
| 纯文本提取 | ✅ 已实现 | 支持 `parse()` 方法获取纯文本 |
| 多字节字符（中文/日文/韩文） | ✅ 已实现 | 完整支持 CJK 字符 |
| 特殊符号 | ⚠️ 部分支持 | 支持常见标点、引号等，部分符号可能遗漏 |
| 换行符（段落标记） | ✅ 已实现 | 正确识别 0x0D 段落标记 |
| 分页符 | ✅ 已实现 | 识别 0x0C Form Feed，渲染分页标记
| 分节符 | ✅ 已实现 | PlcfSed + SEPX 解析，节属性面板展示 |
| 制表符（Tab） | ✅ 已实现 | 支持自定义制表位位置，Canvas 精确测量对齐 |
| 软换行（Shift+Enter） | ✅ 已实现 | 识别 0x0B 垂直制表符，渲染为 <br> |
| 不间断空格 | ✅ 已实现 | 识别 0xA0 NBSP，保留为 Unicode 不间断空格 |
| 可选连字符 | ✅ 已实现 | 识别 0xAD 软连字符 + 0x1E 不间断连字符 |
| 文本框内容 | ⚠️ 部分支持 | 从 textbox story 提取纯文本，内联定位未实现 |

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
| 分栏 | ✅ 已实现 | sprmSCcolumns/sprmSDxaColumns SPRM 解码（仅解析属性，未实际分栏渲染） |
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
| 页眉页脚中的图片 | ❌ 待实现 | |

> **说明**：页眉页脚内容通过 Piece Table 的 rgCcp 边界分流提取，在侧边栏"非正文内容"面板中展示，不混入正文。

---

## 7. 列表

| 功能 | 状态 | 说明 |
|------|------|------|
| 编号列表（有序） | ✅ 已实现 | LST/LVLF/PlcfLfo 完整解析，sprmPIlst/ilfo 提取 |
| 项目符号列表（无序） | ✅ 已实现 | 同上，支持项目符号格式映射 |
| 多级列表 | ✅ 已实现 | sprmPIlvl 层级提取，嵌套列表渲染 |
| 列表编号续接 | ⚠️ 部分支持 | 独立判断每段，不追踪编号连续性 |
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
| 嵌套表格 | ⚠️ 部分支持 | 表格深度检测，嵌套渲染有限 |

---

## 9. 图片与图形

| 功能 | 状态 | 说明 |
|------|------|------|
| 嵌入式图片（Inline） | ✅ 已实现 | PICF/FCPic 结构解析，sprmCPicLocation 定位，内联渲染 |
| 浮动图片（Floating） | ✅ 已实现 | Office Art Drawing Container 解析，形状锚点定位，位置/尺寸/浮动状态提取 |
| 图片格式（JPEG/PNG/BMP/WMF/EMF） | ✅ 已实现 | Data 流魔数扫描，多格式支持 |
| 形状（Shape） | ✅ 已实现 | Office Art 形状解析，矩形/椭圆/线条/自由形状/文本框/图片/组合类型识别 |
| SmartArt | ✅ 已实现 | OLE 对象解析，SmartArt 类型识别（流程/循环/层次结构/矩阵/组织结构图），图表面板展示 |
| 图表（Chart） | ✅ 已实现 | MSGraph/Excel OLE 对象解析，图表类型识别，Picture/Data 流检测，图表面板展示 |
| 艺术字（WordArt） | ✅ 已实现 | OLE 目录表扫描，WordArt.N 存储对象解析，文本/效果/颜色提取，艺术字面板展示 |
| 文本框（Text Box） | ⚠️ 部分支持 | 文本提取可用，位置渲染未实现 |

---

## 10. 域与公式

| 功能 | 状态 | 说明 |
|------|------|------|
| 页码域（PAGE / NUMPAGES） | ✅ 已实现 | PlcfFld 解析，PAGE/NUMPAGES/SECTION/SECTIONPAGES 域提取，页码域面板展示 |
| 日期时间域（DATE / TIME） | ✅ 已实现 | PlcfFld 解析，DATE/TIME/CREATEDATE/LASTSAVEDATE 域提取 |
| 目录域（TOC） | ⚠️ 部分支持 | TOC 大纲提取可用，域结构未完整解析 |
| 索引域（INDEX） | ❌ 待实现 | |
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
| 样式集 | ❌ 待实现 | |

---

## 14. 其他功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 文档属性（标题/作者/主题等） | ✅ 已实现 | SummaryInformation 流解析，元数据面板展示 |
| 脚注 / 尾注 | ✅ 已实现 | 从 footnotes/endnotes story 提取，"非正文内容"面板展示 |
| 目录（Table of Contents） | ⚠️ 部分支持 | 大纲提取可用，TOC 域结构未完整解析 |
| 索引（Index） | ❌ 待实现 | |
| 书签 | ✅ 已实现 | PlcfBkf/PlcfBkl + SttbfBkmk 解析，书签面板展示名称与 CP 范围 |
| 宏（VBA） | ❌ 不支持 | 纯预览，不执行宏 |
| 密码保护文档 | ❌ 不支持 | 加密文档无法解析 |
| 数字签名 | ❌ 不支持 | |

---

## 📊 实现统计

| 类别 | 总数 | 已实现 | 部分实现 | 待实现 | 完成度 |
|------|------|--------|----------|--------|--------|
| 文件格式支持 | 9 | 5 | 3 | 1 | **72%** |
| 文本内容 | 10 | 8 | 1 | 1 | **85%** |
| 字符格式 | 13 | 13 | 0 | 0 | **100%** |
| 段落格式 | 11 | 11 | 0 | 0 | **100%** |
| 页面布局 | 9 | 9 | 0 | 0 | **100%** |
| 页眉页脚 | 6 | 5 | 0 | 1 | **83%** |
| 列表 | 5 | 4 | 1 | 0 | **90%** |
| 表格 | 6 | 5 | 1 | 0 | **92%** |
| 图片与图形 | 8 | 7 | 1 | 0 | **88%** |
| 域与公式 | 8 | 6 | 1 | 1 | **81%** |
| 批注与修订 | 4 | 4 | 0 | 0 | **100%** |
| 超链接 | 4 | 4 | 0 | 0 | **100%** |
| 样式与模板 | 5 | 4 | 0 | 1 | **80%** |
| 其他功能 | 8 | 3 | 1 | 4 | **44%** |
| **总计** | **108** | **87** | **9** | **12** | **~88%** |

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
