# 规范对照缺口清单

本文档对照 Microsoft 官方规范（[MS-CFB]、[MS-DOC]），列出本项目当前实现与规范之间的差距，作为后续开发的路线图。

> 状态标记：
> - ✅ 已实现
> - ⚠️ 部分实现 / 启发式
> - ❌ 未实现
> - 📋 计划中

> 说明：本表是规范级缺口基线，部分条目的实现状态可能随着代码推进而更新滞后；当前最准确的任务分配与剩余缺口，以 [`docs/MODEL_WORKFLOW.md`](../MODEL_WORKFLOW.md) 和源码为准。

---

## 1. OLE2/CFB 层 (MS-CFB)

| 功能 | 状态 | 规范章节 | 模块 | 优先级 | 备注 |
|------|------|----------|------|--------|------|
| OLE 签名验证 | ✅ | MS-CFB §2.2 | oleParser.ts | — | |
| 文件头解析 | ✅ | MS-CFB §2.2 | oleParser.ts | — | |
| FAT 表解析 | ✅ | MS-CFB §2.3 | oleParser.ts | — | |
| DIFAT 表解析 | ✅ | MS-CFB §2.2/§2.4 | oleParser.ts | — | |
| 目录表解析 | ⚠️ | MS-CFB §2.5 | oleParser.ts | 中 | 只做简单名称匹配，未完整遍历红黑树 |
| 流数据读取 | ✅ | MS-CFB §2.3 | oleParser.ts | — | |
| 迷你流 (Mini Stream) | ✅ | MS-CFB §2.6 | oleParser.ts | 低 | 已接入读取；仍需更多样本回归 |
| v4 格式 (4KB 扇区) | ❌ | MS-CFB §2.2 | oleParser.ts | 低 | 目前只支持 v3 (512B 扇区) |
| 目录树遍历 | ❌ | MS-CFB §2.5 | oleParser.ts | 低 | 未实现红黑树遍历算法 |

---

## 2. FIB 层 (MS-DOC §2.5.1)

| 功能 | 状态 | 规范章节 | 模块 | 优先级 | 备注 |
|------|------|----------|------|--------|------|
| 魔数验证 | ✅ | MS-DOC §2.5.1 | fibParser.ts | — | |
| csw/cslw 链式计算 | ✅ | MS-DOC §2.5.1 | fibParser.ts | — | |
| cbRgFcLcb 读取 | ✅ | MS-DOC §2.5.1 | fibParser.ts | — | |
| fcClx/lcbClx 提取 | ✅ | MS-DOC §2.5.1 | fibParser.ts | — | |
| fcMin/fcMac 提取 | ⚠️ | MS-DOC §2.5.1 | fibParser.ts | 低 | 已弃用字段 |
| fComplex 标志 | ⚠️ | MS-DOC §2.5.1 | fibParser.ts | 高 | macOS textutil 生成的文档不可靠 |
| fWhichTblStm 标志 | ✅ | MS-DOC §2.5.1 | fibParser.ts | — | 已实现 0Table vs 1Table 选择 |
| FibRgLw rgCcp 读取 | ✅ | MS-DOC §2.5.1 | fibParser.ts | — | ccpText/Ftn/Hdd/Atn/Edn/Txbx/HdrTxbx 全部提取 |
| fcStshf (样式表) | ⚠️ | MS-DOC §2.5.1 | fibParser.ts | 中 | 已实现提取，样式表基础解析已实现 |
| fcSttbfFfn (字体表) | ✅ | MS-DOC §2.5.1 | fibParser.ts | 高 | 已实现提取，用于字体名称解析 |
| fcPlcfBteChpx | ⚠️ | MS-DOC §2.5.1 | fibParser.ts | 高 | CHP 表偏移，已读取并用于格式还原 |
| fcPlcfBtePapx | ⚠️ | MS-DOC §2.5.1 | fibParser.ts | 高 | PAP 表偏移，已读取并用于格式还原 |
| 其他 rgFcLcb 字段 | ❌ | MS-DOC §2.5.1 | fibParser.ts | 低 | 大部分未提取 |

---

## 3. Clx/Pcdt/PlcPcd 层 (MS-DOC §2.5.6)

| 功能 | 状态 | 规范章节 | 模块 | 优先级 | 备注 |
|------|------|----------|------|--------|------|
| clxt 类型判断 | ✅ | MS-DOC §2.5.6 | docParser.ts | — | |
| Pcdt 解析 (reserved 跳过) | ✅ | MS-DOC §2.5.6 | docParser.ts | — | 已修复 |
| n 字段读取 | ✅ | MS-DOC §2.5.6 | docParser.ts | — | 已修复 |
| rgCcp 读取 (n+1个) | ✅ | MS-DOC §2.5.6 | docParser.ts | — | |
| rgPcd 读取 | ✅ | MS-DOC §2.5.6 | docParser.ts | — | |
| fc 压缩标志解析 | ✅ | MS-DOC §2.5.6 | docParser.ts | — | |
| 8-bit 编码文本提取 | ✅ | MS-DOC §2.5.6 | docParser.ts | — | |
| UTF-16LE 编码文本提取 | ✅ | MS-DOC §2.5.6 | docParser.ts | — | |
| 多 piece 拼接 | ✅ | MS-DOC §2.5.6 | docParser.ts | — | 已支持 story 级严格分流 |
| Story 分流 (rgCcp 边界切片) | ✅ | MS-DOC §2.5.6 | docParser.ts | — | 主文档/脚注/页眉页脚/尾注/批注/文本框 按 cp 边界拆分 |
| prm 字段解析 | ✅ | MS-DOC §2.5.6 | docParser.ts | 高 | 属性修饰符，关联 CHPX：已实现 piece 级别 CHPX 关联，应用于 piece 范围内的字符 |
| 安全限制 | ✅ | N/A | docParser.ts | — | MAX_PIECE_COUNT, MAX_TOTAL_CHARS |

---

## 4. 字符格式 CHP (MS-DOC §2.6)

| 功能 | 状态 | 规范章节 | 模块 | 优先级 | 备注 |
|------|------|----------|------|--------|------|
| PlcfBteChpx 解析 | ✅ | MS-DOC §2.6 | formatParser.ts | 高 | 字符属性位置表，已实现规范级解析（CP 递增扫描 + aPcb 链式验证） |
| CHP 结构解析 | ✅ | MS-DOC §2.6 | formatParser.ts | 高 | 已实现常用 SPRM 解码，包括小型大写字母/全部大写/双删除线/边框/阴影 |
| 字体名称解析 | ✅ | MS-DOC §2.6 | formatParser.ts + fontParser.ts | 高 | 已支持 sprmCFFont + STTB Ffn 字体表 |
| 字号 (half-points) | ✅ | MS-DOC §2.6 | formatParser.ts | 高 | 已支持 sprmCSziHalf (SPRM_HPS) |
| 加粗 / 斜体 | ✅ | MS-DOC §2.6 | formatParser.ts | 高 | 已支持 sprmCBold / sprmCItalic |
| 下划线 | ✅ | MS-DOC §2.6 | formatParser.ts | 中 | 已支持 sprmCUnderline / sprmCKul |
| 删除线 | ✅ | MS-DOC §2.6 | formatParser.ts | 低 | 已支持 sprmCStrike / sprmCFStrikeBiDi (双删除线) |
| 上标 / 下标 | ✅ | MS-DOC §2.6 | formatParser.ts | 低 | 已支持 sprmCDxasPos |
| 小型大写字母 | ✅ | MS-DOC §2.6 | formatParser.ts | 低 | 已支持 sprmCFSmallCaps |
| 全部大写字母 | ✅ | MS-DOC §2.6 | formatParser.ts | 低 | 已支持 sprmCFCaps |
| 字符边框 | ✅ | MS-DOC §2.6 | formatParser.ts | 低 | 已支持 sprmCFOutline |
| 字符阴影 | ✅ | MS-DOC §2.6 | formatParser.ts | 低 | 已支持 sprmCFShadow |
| 文字颜色 | ✅ | MS-DOC §2.6 | formatParser.ts | 中 | 已支持 sprmCCv (24-bit RGB) |
| 高亮 | ✅ | MS-DOC §2.6 | formatParser.ts | 低 | 已支持 sprmCHighlight |

> **当前状态**：已实现 CHP 表的规范级解析，支持常用字符格式（加粗、斜体、下划线、删除线、双删除线、上标、下标、字号、颜色、高亮、字体名称、小型大写字母、全部大写字母、字符边框、字符阴影），通过 SPRM 解码获取真实格式。字体名称通过 sprmCFFont 索引字体表获取。字符间距等高级属性待实现。

---

## 5. 段落格式 PAP (MS-DOC §2.6)

| 功能 | 状态 | 规范章节 | 模块 | 优先级 | 备注 |
|------|------|----------|------|--------|------|
| PlcfBtePapx 解析 | ✅ | MS-DOC §2.6 | formatParser.ts | 高 | 段落属性位置表，已实现规范级解析（CP 递增扫描 + aPcb 链式验证） |
| PAP 结构解析 | ✅ | MS-DOC §2.6 | formatParser.ts | 高 | 已实现常用 SPRM 解码 |
| 对齐方式 | ✅ | MS-DOC §2.6 | formatParser.ts | 高 | 已支持 sprmPJc（含分散对齐） |
| 左缩进 | ✅ | MS-DOC §2.6 | formatParser.ts | 中 | 已支持 sprmPDxaLeft |
| 右缩进 | ✅ | MS-DOC §2.6 | formatParser.ts | 中 | 已支持 sprmPDxaRight |
| 首行缩进 | ✅ | MS-DOC §2.6 | formatParser.ts | 中 | 已支持 sprmPDxaIndent（修正 0x2404 映射） |
| 行距 | ✅ | MS-DOC §2.6 | formatParser.ts | 中 | 已支持 sprmPLine |
| 段前段后间距 | ✅ | MS-DOC §2.6 | formatParser.ts | 中 | 已支持 sprmPDyaBefore / sprmPDyaAfter |
| 大纲级别 | ✅ | MS-DOC §2.6 | formatParser.ts | 中 | 已支持 sprmPOutlineLvl（0-8） |
| 段落底纹 | ✅ | MS-DOC §2.6 | formatParser.ts | 低 | 已支持 sprmPShd（背景色） |
| 段落边框 | ✅ | MS-DOC §2.6 | formatParser.ts | 低 | 已支持 sprmPBrc |
| 制表位 | ❌ | MS-DOC §2.6 | formatParser.ts | 低 | |

> **当前状态**：已实现 PAP 表的规范级解析，支持常用段落格式（对齐含分散对齐、左缩进、右缩进、首行缩进、行距、段前/段后间距、大纲级别、段落底纹、段落边框），通过 SPRM 解码获取真实格式。制表位等高级属性待实现。

---

## 6. 样式表 (STSH)

| 功能 | 状态 | 规范章节 | 模块 | 优先级 | 备注 |
|------|------|----------|------|--------|------|
| STSH 结构解析 | ✅ | MS-DOC §2.8 | styleParser.ts | 中 | 已实现 STD 结构解析，提取样式名称/类型/grpprl |
| 样式名称提取 | ✅ | MS-DOC §2.8 | styleParser.ts | 中 | 已支持 STD xstzName 解析 + 内置样式 fallback |
| 内置样式映射 | ✅ | MS-DOC §2.8 | styleParser.ts | 中 | Heading 1-9、Normal、Header/Footer 等 50+ 内置样式 |
| 样式继承 | ✅ | MS-DOC §2.8 | styleParser.ts + docParser.ts | 低 | 已实现基于 istdNext 的样式格式继承 |
| 样式属性提取 | ✅ | MS-DOC §2.8 | styleParser.ts | 中 | 已解析 STD 中的 CHP/PAP grpprl（UPX 结构） |

> **当前状态**：已实现样式表规范级解析，支持 STD 结构解析、样式名称提取、CHP/PAP grpprl 提取和样式继承。样式基础格式通过 istd 匹配应用到段落，PAPX/CHPX 增量修改叠加其上。

---

## 7. 表格 (Table)

| 功能 | 状态 | 规范章节 | 模块 | 优先级 | 备注 |
|------|------|----------|------|--------|------|
| 表格行检测 | ✅ | MS-DOC §2.6 | tableText.ts / docParser.ts | — | 同时支持 0x07 单元格终结符与 tab 分隔 |
| 单元格内容提取 | ✅ | MS-DOC §2.6 | tableText.ts | — | `splitTableCells` 优先按 0x07 切分 |
| 表格结构重建 | ✅ | MS-DOC §2.6 | DocPreview.vue / tableText.ts | — | 连续行拼接为 `<table>`，已解析 TAP 表属性 |
| 合并单元格 | ✅ | MS-DOC §2.6 | formatParser.ts / tableText.ts | — | sprmTDefTable 的 rgtc / TC.fVertMerge，rowspan 渲染 |
| 表格边框 | ✅ | MS-DOC §2.6 | formatParser.ts / tableText.ts | — | sprmTTableBorders 的 brcTop/Left/Bottom/Right/InsideH/InsideV → CSS border |

> **当前状态**：基于 0x07 单元格终结符识别真实 Word 表格行，连续行拼接为 HTML `<table>`；已实现 TAP（Table Properties）SPRM 解析：sprmPFInTable / sprmPTableDepth 标记表格段落与嵌套深度，sprmTDefTable 解析 rgtc 提取 fVertMerge 实现 rowspan 垂直合并，sprmTTableBorders 解析 6 个 Brc 还原表格边框（top/left/bottom/right/insideH/insideV）并映射到 CSS border。

---

## 8. 页眉页脚 / 多 Story

| 功能 | 状态 | 规范章节 | 模块 | 优先级 | 备注 |
|------|------|----------|------|--------|------|
| 多 piece Story 识别 | ✅ | MS-DOC §2.5.6 | docParser.ts | — | 已按 rgCcp 边界拆分 |
| 页眉提取 | ✅ | MS-DOC §2.5.6 | docParser.ts | — | ccpHdd 段落已分流 |
| 页脚提取 | ✅ | MS-DOC §2.5.6 | docParser.ts | — | 与页眉合并为 headers story |
| 首页不同 | ✅ | MS-DOC §2.8.55 | dopParser.ts | 低 | 已解析 DOP 的 fTitlePage 标志，UI 展示 |
| 奇偶页不同 | ✅ | MS-DOC §2.8.55 | dopParser.ts | 低 | 已解析 DOP 的 fFacingPages 标志，UI 展示 |
| 页码域 (PAGE/NUMPAGES) | ✅ | MS-DOC §2.8 | fieldParser.ts | 低 | 域结果已包含页码文本，无需特殊处理 |
| 页眉页脚渲染 | ✅ | N/A | DocPreview.vue | — | UI 可折叠面板展示 |
| 脚注 / 尾注 | ✅ | MS-DOC | docParser.ts | — | ccpFtn / ccpEdn 已分流 |

---

## 9. 图片 / 对象

| 功能 | 状态 | 规范章节 | 模块 | 优先级 | 备注 |
|------|------|----------|------|--------|------|
| Data 流读取 | ✅ | MS-DOC | oleParser.ts | 中 | 通过 `findStreamByName('Data')` 读取 |
| 嵌入式图片提取 | ✅ PICF | MS-DOC §2.9 | pictureParser.ts | 高 | PICF 结构解析 + CHPX fcPic 定位；保留魔数扫描回退 |
| 浮动图片 | ⚠️ 部分 | MS-DOC §2.9 | pictureParser.ts | 中 | 可通过 PICF 提取图片；形状锚点定位待完善 |
| 图片格式识别 | ✅ | MS-DOC §2.9 | pictureParser.ts | 中 | 支持 PNG/JPEG/BMP/GIF；WMF/EMF 跳过（误报率高） |
| 图片渲染 | ✅ | N/A | DocPreview.vue | 高 | 折叠面板展示，含格式/尺寸/浮动状态元数据 |
| 形状 (Shape) | ❌ | MS-DOC §2.9 | 新模块 | 低 | |
| 文本框内容 | ✅ | MS-DOC | docParser.ts | 中 | ccpTxbx + ccpHdrTxbx 已分流到 stories.textboxes |
| SPRM sprmCFSpec/sprmCPicLocation | ✅ | MS-DOC §2.6.1 | formatParser.ts | 中 | fSpec 特殊字符标志 + fcPic Data 流偏移 |

---

## 10. 文档属性

| 功能 | 状态 | 规范章节 | 模块 | 优先级 | 备注 |
|------|------|----------|------|--------|------|
| SummaryInformation 流 | ✅ | MS-OLEPS | propertyParser.ts | 中 | 已实现标题、作者、主题、关键词、备注、字数、页码、编辑时间等完整属性 |
| DocumentSummaryInformation | ✅ | MS-OLEPS | propertyParser.ts | 低 | 已实现类别、公司、经理、行数、段落数等扩展属性解析 |
| 属性展示 | ✅ | N/A | DocPreview.vue | 低 | UI 折叠面板展示全部属性 |

---

## 11. 其他

| 功能 | 状态 | 规范章节 | 模块 | 优先级 | 备注 |
|------|------|----------|------|--------|------|
| 列表 (List) | ✅ 规范解析 | MS-DOC §2.8 | listParser.ts + formatParser.ts + docParser.ts | 中 | 已实现 LST/LVLF 解析、sprmPIlvl/ilst/ilfo 提取、getListFormat 格式映射；启发式降为备用方案 |
| 超链接 | ✅ | MS-DOC §2.8 | fieldParser.ts + docParser.ts + DocPreview.vue | 中 | 已实现 PlcfFld 解析、HYPERLINK 提取、渲染可点击 `<a>` 标签 |
| 批注 (Comments) | ✅ | MS-DOC | docParser.ts | — | ccpAtn 已分流到 stories.comments |
| 修订 (Track Changes) | ✅ 内容解析 | MS-DOC §2.8.55 / §2.4.3 | revisionParser.ts / formatParser.ts / dopParser.ts | 中 | 已解析 DOP fRMW 开关 + SttbfRMark 作者表（FIB 索引 90/91）+ RMRK 结构（ibstRMark + DTTM）；通过 sprmCFRMark/sprmCFRMarkDel/sprmCRMark/sprmCRMarkDel 提取插入/删除修订范围、作者、时间 |
| 脚注 / 尾注 | ✅ | MS-DOC | docParser.ts | — | 见 §8（ccpFtn / ccpEdn） |
| 目录 (TOC) | ✅ | MS-DOC §2.8 | fieldParser.ts + docParser.ts + DocPreview.vue | 中 | 已实现 PlcfFld 解析、TOC 域提取、层级渲染 |
| 宏 (VBA) | ❌ | 不支持 | N/A | — | 安全考虑，不计划支持 |
| 加密文档 | ❌ | 不支持 | N/A | — | 不计划支持 |

---

## 12. 优先级路线图

### 阶段一：格式真实化（高价值）

**目标**：从启发式格式推断升级为读取真实格式表

1. ✅ 修复 Clx/PlcPcd 解析（已完成）
2. ✅ 实现 CHP 表解析 — 已实现规范级解析，支持常用字符格式（加粗、斜体、下划线、删除线、双删除线、上标、下标、字号、颜色、高亮、字体名称、小型大写字母、全部大写字母）
3. ✅ 实现 PAP 表解析 — 已实现规范级解析，支持常用段落格式（对齐含分散对齐、左缩进、右缩进、首行缩进、行距、段前/段后间距、大纲级别）
4. ✅ 实现样式表解析 — 已实现 STD 结构解析、CHP/PAP grpprl 提取、样式继承；标题样式用于生成大纲和 h1-h6 标签
5. ✅ CHP/PAP 与段落精确匹配 — 已实现：保留原始段落索引用于 PAPX 精确匹配，基于文本位置的 cp 估计用于 CHPX 匹配
6. ✅ 字体表（STTB Ffn）解析 — 已实现：通过 sprmCFFont 索引字体表，获取真实字体名称
7. 📋 移除启发式推断代码（或降级为备用方案）

### 阶段二：内容完整性

6. ✅ 表格支持 — 0x07 单元格终结符识别真实 Word 表格行 + 连续行渲染为 HTML `<table>`；TAP 增强已完成：sprmTDefTable 解析合并单元格（rowspan）、sprmTTableBorders 还原表格边框
7. ✅ 图片支持（启发式）— 扫描 Data 流魔数提取 PNG/JPEG/BMP/GIF，UI 折叠面板展示
8. 📋 超链接支持 — 可点击的 URL
9. 📋 文档属性 — 显示标题/作者等元信息

### 阶段三：功能增强

10. ✅ 页眉页脚（可选展示）— 已实现 story 分流 + UI 折叠面板
11. ✅ 列表编号增强 — 已实现 LST/LVLF/PlcfLfo 完整解析（sprmPIlvl/ilst/ilfo → getListFormat/getListFormatFromLfo，LFO 优先于 ilst）；启发式降为备用方案
12. ✅ 脚注/尾注 — 已按 ccpFtn/ccpEdn 分流
13. 目录生成

### 阶段四：锦上添花

14. ✅ 批注显示 — ccpAtn 已分流到 stories.comments，UI 折叠面板展示
15. ✅ 修订模式显示 — DOP fRMW 开关 + SttbfRMark 作者表 + RMRK（作者/时间/类型）已解析，UI 渲染插入下划线/删除删除线 + 作者 tooltip
16. 形状/文本框
17. 更多域支持

---

## 13. 参考规范

| 规范 | 版本 | 链接 |
|------|------|------|
| [MS-CFB] Compound File Binary | v12.0 | [官方 PDF](https://winprotocoldocs-bhdugrdyduf5h2e4.b02.azurefd.net/MS-CFB/%5bMS-CFB%5d.pdf) |
| [MS-DOC] Word Binary Format | v12.5 | [官方 PDF](https://officeprotocoldocs-f5hpbjgea6b8gneq.b02.azurefd.net/files/MS-DOC/%5bMS-DOC%5d.pdf) |
| [MS-OLEPS] OLE Property Set | — | [在线文档](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-oleps) |

### 本地文档

- [规范索引](./README.md)
- [MS-CFB 摘要](./MS-CFB-SUMMARY.md)
- [MS-DOC 总览](./MS-DOC-SUMMARY.md)
- [FIB 结构详解](./MS-DOC-FIB.md)
- [Clx/Pcdt/PlcPcd 详解](./MS-DOC-CLX.md)
