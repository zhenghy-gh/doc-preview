# 测试计划 v1 —— doc-preview

| 项 | 内容 |
|---|---|
| 版本 | v1.0 |
| 作者 | qa（测试工程师） |
| 日期 | 2025-08-25 |
| 被测版本 | `9670a30` + 工作区未提交改动（tests/docParser.test.ts） |
| 范围 | 解析器正确性（Part A）+ UI 回归（Part B） |
| 关联文档 | AGENTS.md / CLAUDE.md 特性清单 #1–#49、FEATURES.md、docs/ARCHITECTURE.md |

---

## 1. 测试目标与退出标准

- **目标**：验证 .doc（OLE2/CFB）解析器对已知特性变体的正确性，以及预览 UI 各功能模块的回归稳定性。
- **退出标准**：
  - P0/P1 用例 100% 执行，P0 通过率 100%，P1 通过率 ≥ 95%；
  - 单测基线全绿（`npm test` 0 failed）；
  - 无未闭环的 S 级缺陷。

## 2. 测试环境与资产

| 项 | 值 |
|---|---|
| 运行环境 | Chrome 最新稳定版 / macOS（移动端另加 iOS Safari、Android Chrome 视口仿真） |
| 单测命令 | `npm test`（vitest run）、`npm run test:coverage` |
| 手工入口 | `npm run dev` → http://localhost:5173 |
| .doc 样本库 | `docs/*.doc`（unicode-* 系列 13 个、uow-* 2 个、fsample* 3 个、doc-{100kb,101,161,261,321,500kb,1mb}.doc、ftd-1.35mb.doc、openstd-n961.doc）、根目录 `file-sample_100kB.doc` |
| 边界构造 | tests/docParser.test.ts 内手工构造的 OLE 夹具（FIB 变体/无 CLX/评分回退/textutil 特征） |

## 3. 当前单测基线

**最新（2026-08-25 19:16 qa 实测）：`npx vitest run` → 1146/1146 全绿（5.11s），无调试残留。**
时间线：18:35 首轮 1114/1116（2 failed）→ captain 补参修复 withChart 笔误 → 18:43 1115/1116（唯一失败 scoring fallback）→ W1-A/T1 关闭（sdet 裁定测试夹具错误并重构，leader R3 独立验证 DBG2=0 全绿）→ 19:03 1140/1140 → 19:16 1146/1146（团队持续补用例）。
历史基线存档 @9670a30：1115 passed / 1 failed（1116），8.08s；失败项 "scoring fallback can pick UTF-16..." 即原 DEF-002 触发点（处置结论见 A4/ENC-04 行注与看板 t1-scoring-rootcause）。

---

# Part A 解析器正确性用例矩阵

优先级：P0=核心路径/发布阻塞；P1=重要特性；P2=增强/边界。
**L级**＝pm《预览保真度分级标准》v1.0（看板 pm-fidelity-r1）映射：L1=必须还原（缺失即 P0 正确性缺陷，全样本必测+正例+边界反例）；L2=应该还原（中档样本抽测，≥90% 特征性质正确）；L3=尽力而为（已实现者受 DoD-D3 无回退保护）。另用 SEC=XSS 等安全问题（P0 级）、UX=体验类、PERF=性能口径 §2。归属争议按 pm R4 裁决。
"自动化"列指向现有测试文件；✅=已覆盖，⚠️=部分覆盖，❌=缺失。

## A1 OLE2/CFB 容器层（oleParser.ts）

| ID | 场景/变体 | 验收点 | P | L级 | 自动化 |
|---|---|---|---|---|---|
| OLE-01 | 签名校验 | 魔数 D0 CF 11 E0 A1 B1 1A E1 缺失/错位时解析失败且错误信息明确（classifyError 归为 format 类） | P0 | L1 | ✅ oleParser.test.ts |
| OLE-02 | FAT/DIFAT 链 | 多扇区 FAT、DIFAT 扩展条目（d×entriesPerSector 映射）正确串联；fat[sector]=nextSector 语义 | P0 | L1 | ⚠️ |
| OLE-03 | 目录表 | 嵌套 storage 内定位 WordDocument 流（如 Equation.1/EquationText）；大小写不敏感流名匹配 | P1 | L1 | ✅ docParser.test.ts |
| OLE-04 | 目录跨扇区 | 目录链跨 sector（如 dirBase→dirBase2 续链）时所有条目可见 | P1 | L1 | ✅ |
| OLE-05 | 流读取 | 使用 sectorToOffset(currentSector) 沿 FAT 链读取，非整扇区尾部截断正确 | P0 | L1 | ⚠️ |
| OLE-06 | 损坏容错 | FAT 环、越界 sector 号、截断文件：不抛未捕获异常，返回结构化错误 | P1 | L1 | ⚠️ |

## A2 FIB 变体（fibParser.ts）

| ID | 场景/变体 | 验收点 | P | L级 | 自动化 |
|---|---|---|---|---|---|
| FIB-01 | csw/cslw/cbRgFcLcb 链式偏移 | FibRgW→FibRgLw→cbRgFcLcb 偏移按 csw 链式计算，nFib=0x00C1/0101/010C 等 variant 均能取到 fcClx/lcbClx、fcPlcfBteChpx/Papx | P0 | L1 | ✅ fibParser.test.ts (38) |
| FIB-02 | cbRgFcLcb<16 | 视为无有效偏移 → 回退自动检测路径，不得越界读 | P0 | L1 | ✅ |
| FIB-03 | fcMin/fcMac 有效 | 直接按 FibBase fcMin/fcMac 提取文本，字符数=fcMac−fcMin（UTF-16 折半） | P0 | L1 | ✅ |
| FIB-04 | nFib 版本检测 | detectWordVersion 覆盖 6.0/95/97/2000/2002/2003/2007+ 全分支；未知 nFib 归入兜底档；属性面板显示 WORD_VERSION_LABELS 名称 | P2 | L2 | ✅ fibParser.test.ts |
| FIB-05 | fComplex 位 | byte12 bit0 读取正确；仅作为 suggestedComplex，不单独决定编码 | P1 | L1 | ✅ |

## A3 textutil 文件（macOS 兼容）

| ID | 场景/变体 | 验收点 | P | L级 | 自动化 |
|---|---|---|---|---|---|
| TXU-01 | isTextutilFib 识别 | byte10=0xBF + 最小化 FIB 特征命中；真实 Word 文件不误判。⚠实测注记：新版 macOS textutil 产物 flags16=0x0000（byte10=0x00, nFib=0xE011），检测对其永不命中（样本走正常路径成功，非缺陷）；签名时效待 sdet 核实历史来源 | P1 | L1 | ⚠️ 真实样本已入库 docs/samples-r1/textutil-*.doc |
| TXU-02 | 忽略 fComplex | textutil 文件忽略不可靠 fComplex，suggestedComplex=false | P0 | L1 | ⚠️ |
| TXU-03 | 编码倾向 | 评分阈值切换为 0.6，优先 UTF-16LE；中文/英文混合内容完整、无乱码、段落序号保持 | P0 | L1 | ⚠️ |
| TXU-04 | 端到端样本 | 用 macOS `textutil -convert doc` 实际生成中英文样本入库 docs/，端到端解析文本一致 | P1 | L1 | ❌ |

## A4 编码检测

| ID | 场景/变体 | 验收点 | P | L级 | 自动化 |
|---|---|---|---|---|---|
| ENC-01 | 0x0D 比例法 | 从 offset 2048 扫描；0x0D 后跟 0x00 比例 ≥30% → UTF-16LE，<30% → 8-bit | P0 | L1 | ✅ docParser.test.ts |
| ENC-02 | 扫描起点 | FIB 头部伪 0x0D（<2048）不影响判定 | P1 | L1 | ✅ |
| ENC-03 | 评分回退 | 双编码均无法二进制判定时走 scoreRawParagraphs；阈值 0.4（普通）/0.6（textutil） | P1 | L1 | ✅（3 例） |
| ENC-04 | **选中编码提取为空时的兜底** | 评分选中的解码结果过滤后 paragraphs=0 时，应回退尝试另一编码或给出明确错误，而非直接"文档内容为空" | P1（原判 P0，经 T1 裁定降级，见下注） | L1 | ❌ **开放项**：sdet 裁定当前行为符合设计（两路解码皆差时选相对优者、内容无效如实报空），T1 仅修测试夹具；产品侧跨编码兜底归 vue-dev-1 排期实施（sdet 配对补回归用例）。qa 2026-08-25 19:16 行为取证：旧夹具场景实测仍 success=false"文档内容为空" |
| ENC-05 | stripBinaryPrefix 8-bit | 高字节比例检测 + `\b[A-Z][a-z]+\b`/元音词定位正文起点；FIB 噪声不进入正文首段 | P1 | L1 | ⚠️ 已知残留 1 字符问题（Known Issues） |
| ENC-06 | stripBinaryPrefix CJK | UTF-16LE 噪声交替模式检测，定位首个连续 4+ 中文字符；噪声紧邻真实中文时最多残留 1 字符（记录已知限制） | P1 | L1 | ⚠️ |
| ENC-07 | 8-bit HIGH_BYTE_MAP | em/en dash、省略号、弯引号、™、€ 等 27 个 Windows-1252 排版符号正确映射 | P1 | L1 | ⚠️ |

## A5 表格（tableText.ts + formatParser.ts sprmT*）

| ID | 场景/变体 | 验收点 | P | L级 | 自动化 |
|---|---|---|---|---|---|
| TBL-01 | 行列识别 | 0x07 单元格终结符切分；行末 0x07 判定 isTableRowText/isWordTableRow | P0 | L1 | ✅ tableText.test.ts |
| TBL-02 | sprmTDefTable TC 结构 | TCGrpf 位域 + 4 Brc 边框解析；单元格级上/下/左/右边框渲染 | P1 | L1 | ✅ formatParser.test.ts |
| TBL-03 | 水平合并 | fHorzMerge → colspan，合并链中间单元格不重复渲染 | P0 | L1 | ✅ |
| TBL-04 | 垂直合并 | fVertMerge → rowspan，续接单元格不产生空行 | P0 | L1 | ✅ |
| TBL-05 | 合并组合 | 同一表格同时含横/纵合并 + 表头行（headerRowCount）→ 结构与视觉均正确 | P1 | L1 | ⚠️ |
| TBL-06 | 嵌套表格 | sprmPTableDepth>1 的行递归为父表最后单元格内子表；占位符不被 escapeHtml 二次转义 | P1 | L2 | ✅ renderNestedTableHtml |
| TBL-07 | 对齐/缩进 | sprmTJTable(0xD632) 左/居中/右；sprmTDxaTableIndent(0xD609) twips→margin 换算误差 ≤1px | P2 | L2 | ⚠️ |
| TBL-08 | Markdown 导出联动 | 含 colspan 表格导出 MD 时列数适配（getTableColCount），管道符转义 | P1 | L1 | ✅ markdownExport.test.ts |

## A6 列表（listParser.ts）

| ID | 场景/变体 | 验收点 | P | L级 | 自动化 |
|---|---|---|---|---|---|
| LST-01 | LST/LVLF/PlcfLfo | 三结构解析；getListFormat/getListFormatFromLfo 输出编号格式（decimal/lowerLetter/roman/bullet…） | P0 | L1 | ✅ listParser.test.ts |
| LST-02 | SPRM 提取 | sprmPIlvl/sprmPIlst/ilfo 正确关联段落→列表条目 | P0 | L1 | ✅ listDetection.test.ts |
| LST-03 | **编号续接** | computeListContinuity：同 listId 跨非列表段落后继续计数，渲染 `<ol start="N">`；N=前次计数+1 | P0 | L1 | ✅ |
| LST-04 | 独立计数器 | 不同 listId（ilst/ilfo）互不干扰，各自从 1 开始 | P0 | L1 | ✅ |
| LST-05 | 多级列表 | 仅 level-0 计入编号；level≥1 渲染为嵌套 ul 且缩进正确 | P1 | L1 | ✅ |
| LST-06 | 干扰段落续接 | 列表→普通段落→列表（同 listId）→编号连续；列表→不同 listId→重新从 1 | P1 | L1 | ✅ |

## A7 修订模式（revisionParser.ts + revisionRender.ts）

| ID | 场景/变体 | 验收点 | P | L级 | 自动化 |
|---|---|---|---|---|---|
| REV-01 | 作者表/时间戳 | SttbfRMark 作者名表、RMRK 结构、DTTM→时间戳（dttmToTimestamp 分钟精度） | P1 | L3 | ✅ revisionParser.test.ts (22) |
| REV-02 | SPRM 标记 | sprmCFRMark/sprmCFRMarkDel/sprmCRMark/sprmCRMarkDel 四类标记归类 insert/delete | P0 | L3 | ✅ |
| REV-03 | marks 渲染 | applyRevisionsToText marks → `<ins>`/`<del>` 标签包裹，原文保留可辨 | P0 | L3 | ✅ revisionRender.test.ts (29) |
| REV-04 | accepted | insert 文本保留、delete 文本移除；剩余文本与 Word"接受所有修订"结果一致 | P0 | L3 | ✅ |
| REV-05 | rejected | insert 移除、delete 保留；等价于"拒绝所有修订" | P0 | L3 | ✅ |
| REV-06 | 模式切换 UI | 修订面板三按钮实时重渲染，无残留 ins/del；escapeHtmlSimple 不破坏特殊字符 | P1 | L3 | ⚠️ UI 手工项 B-9 |

## A8 域解析（fieldParser.ts）

| ID | 场景/变体 | 验收点 | P | L级 | 自动化 |
|---|---|---|---|---|---|
| FLD-01 | PlcfFld 结构 | parsePlcfFld cp/ch/flt 序列正确；域分隔/终止符配对 | P0 | L1 | ✅ fieldParser.test.ts |
| FLD-02 | HYPERLINK | URL+显示文本提取，渲染 `<a target="_blank">`；相对链接不崩溃 | P0 | L1 | ✅ |
| FLD-03 | TOC flt=19 | parseTocInstruction 全开关：\o \t \f \p \h \n \z \u \l；parseTocResult 条目层级 | P1 | L3 | ✅ |
| FLD-04 | INDEX flt=14 | parseIndexResult 点引导/制表分隔，主项/子项/页码三元组 | P2 | L3 | ✅ |
| FLD-05 | 页码域 | PAGE/NUMPAGES/SECTION/SECTIONPAGES 关键字匹配；正文中 instruction+result 连接串被替换为域结果 | P1 | L2 | ✅ extractPageFields |
| FLD-06 | 交叉引用 | REF/NOTEREF 目标书签名 + 开关 \h\n\r\w\p\f\d；面板展示 | P2 | L3 | ✅ extractCrossReferences |
| FLD-07 | 文档元数据域 | AUTHOR/TITLE/DATE/REVNUM 等提取入 documentFields | P2 | L2 | ✅ extractDocumentFields |
| FLD-08 | 域结果替换回归 | 替换后不残留域括号碎片；嵌套域不越界替换 | P1 | L1 | ⚠️ |

## A9 样式与字体（styleParser.ts / fontParser.ts）

| ID | 场景/变体 | 验收点 | P | L级 | 自动化 |
|---|---|---|---|---|---|
| STY-01 | STSH/STD 解析 | grpprl(CHP/PAP) 提取；50+ 内置样式 istd→名称映射抽查（Normal/Heading1-3/Title/Caption…） | P0 | L2 | ✅ styleParser.test.ts |
| STY-02 | 样式继承 | basedOn 链逐级合并，子样式覆盖父样式字段；循环 basedOn 不死循环 | P0 | L2 | ✅ resolveStyleFormat |
| STY-03 | detectStyleSet | 内置 7 种样式集识别 + 自定义样式集推断（数量/标题存在性） | P2 | L3 | ✅ |
| FNT-01 | STTB Ffn | 字体表解析、sprmCFFont→字体名映射；超长字体名/非 ASCII 名不越界 | P1 | L2 | ✅ fontParser.test.ts |

## A10 图片（imageExtractor.ts + pictureParser.ts）

| ID | 场景/变体 | 验收点 | P | L级 | 自动化 |
|---|---|---|---|---|---|
| IMG-01 | Data 流魔数扫描 | PNG/JPEG/GIF/BMP 识别率；imageFormatMime 映射正确 | P1 | L2 | ✅ imageExtractor.test.ts |
| IMG-02 | PICF/FCPic | parsePicfAt 结构化输出 format/widthPx/heightPx/floating/cp；JPEG/PNG 尺寸解析 | P1 | L2 | ✅ pictureParser.test.ts |
| IMG-03 | 内联位置 | fcPic→cp 映射使图片落在锚定段落；说明文字含格式/尺寸；最大尺寸限制生效 | P1 | L2 | ⚠️ UI 手工项 B-10 |
| IMG-04 | 浮动图片 | Office Art 锚点定位；浮动标记 tooltip 含 twips/CP/SPID；暗黑模式可读 | P2 | L3 | ⚠️ |

## A11 形状/艺术字/公式/图表

| ID | 场景/变体 | 验收点 | P | L级 | 自动化 |
|---|---|---|---|---|---|
| SHP-01 | MS-ODRAW | 形状类型（矩形/椭圆/线条/文本框/图片/组合）、位置尺寸(twips)、锚点 CP、浮动状态 | P2 | L3 | ✅ shapeParser.test.ts |
| SHP-02 | 文本框锚定渲染 | renderTextboxAnchorHtml 按 anchorCp 落到 _cpStart~_cpEnd 段落；越界 CP 安全跳过 | P2 | L3 | ⚠️ |
| WAR-01 | WordArt | 目录名 ^WordArt\.\d+ 匹配；文本/效果/颜色提取；getEffectLabel 中文标签 | P2 | L3 | ✅ wordArtParser.test.ts (23) |
| EQN-01 | eqn→LaTeX | 希腊字母/分数/根号/上下标/三角/求和/积分转换抽查；非法 eqn 返回原文不崩溃 | P2 | L3 | ✅ equationParser.test.ts |
| CHT-01 | 图表识别 | MSGraph/Excel/SmartArt 类型判定（柱/条/折/饼、流程/循环/层次/矩阵/组织）；无图表文件 charts=[] | P2 | L3 | ✅ chartParser.test.ts |

## A12 页眉页脚与 story（headerFooterParser.ts）

| ID | 场景/变体 | 验收点 | P | L级 | 自动化 |
|---|---|---|---|---|---|
| HDF-01 | PlcfHdd | fcPlcfHdd/lcbPlcfHdd 位置表解析，titlePg 边界切分 | P1 | L2 | ✅ headerFooterParser.test.ts (32) |
| HDF-02 | 首页/奇偶拆分 | DOP fTitlePage/fFacingPages 组合四种：仅首页/奇偶/全部/默认 | P1 | L2 | ✅ getActivePartTypes |
| HDF-03 | 启发式回退 | PlcfHdd 不可用时 splitHeaderTextHeuristic 拆分合理；空 story 不展示空面板 | P2 | L2 | ✅ |
| HDF-04 | formatStoryText | 段落结构保留、前导缩进保留、连续空段压缩、软换行<br>、分页符 [分页]、表格 │ 分隔符 | P1 | L2 | ⚠️ |

## A13 书签/分节/DOP

| ID | 场景/变体 | 验收点 | P | L级 | 自动化 |
|---|---|---|---|---|---|
| BMK-01 | 书签定位 | PlcfBkf/Bkl+SttbfBkmk 名称与范围；大纲/书签跳转落点正确 | P2 | L3 | ✅ bookmarkParser.test.ts |
| SEC-01 | SEPX 属性 | 纸张宽高/边距/方向/装订线/起始页码换算（twips→pt）；横向纸页面尺寸翻转 | P1 | L2 | ✅ sectionParser.test.ts |
| SEC-02 | 分栏 | 栏数/栏距 → column-count/column-gap；section 切换强制 finalizePage 分页 | P1 | L3 | ⚠️ UI 手工项 B-11 |
| DOP-01 | 文档标志 | fFacingPages/fTitlePage/fRMW 读取；EMPTY_DOP 兜底 | P2 | L2 | ✅ dopParser.test.ts |

## A14 渲染辅助与其他

| ID | 场景/变体 | 验收点 | P | L级 | 自动化 |
|---|---|---|---|---|---|
| RND-01 | 制表位 | applyTabStops Canvas 测量宽度替换 \t；无制表位回退 CSS tab-size | P1 | L2 | ✅ textRender.test.ts |
| RND-02 | 特殊符号 UTF-16 | isValidPrintableChar 黑名单策略：emoji/生僻 CJK/数学符号保留，控制字符剔除 | P1 | L1 | ✅ |
| RND-03 | escapeHtml | <>&"' 转义；XSS 注入样本（<img onerror> 等）不执行 | P0 | SEC | ✅ |
| PRG-01 | 进度回调 | parseWithFormat(onProgress) 10 阶段顺序与百分比单调递增；worker 协议 {type:'progress'|'result'} 分流 | P1 | UX | ✅ parseProgress/parseWithWorker.test.ts |
| ERR-01 | 错误分类 | classifyError 六类（network/format/parse/corrupted/memory/unknown）关键字命中与 retryable 标记 | P1 | UX | ✅ errorClassifier.test.ts (27) |
| PERF-01 | 性能预算 | realDocs 全量 fixtures 解析成功（realDocs.test.ts）；1MB 级 doc 解析时间不高于基线 20%（对照 docs/doc-1mb.doc、ftd-1.35mb.doc） | P1 | PERF | ✅ parsePerformance.test.ts |

---

# Part B UI 回归清单

前置：`npm run dev`，样本用 `docs/doc-100kb.doc`（常规）、`unicode-form.doc`（表格+多节）、`file-sample_100kB.doc`。每轮回归全量执行；冒烟仅需 P0。

## B-1 上传（P0）

| # | 步骤 | 预期 |
|---|---|---|
| 1 | 点击选择 .doc 文件 | 进入预览，标题栏显示文件名 |
| 2 | 拖拽 .doc 到上传区 | 同上；拖拽悬停态文案切换（t('app.upload.area.title.drag')） |
| 3 | 选择 .dot | 可上传（isValidFile 白名单含 dot） |
| 4 | 选择 .docx/.txt/无扩展名 | 拒绝并提示格式不支持 |
| 5 | 输入 URL 加载 | 进度条阶段文案流转（读取→下载→解析→渲染），成功进入预览 |
| 6 | 加载损坏 .doc（改后缀的随机字节） | ErrorDisplay 分类图标+建议+重试按钮；技术细节可折叠展开 |
| 7 | 重试按钮 | retryLoad 按 lastSource 重新加载 |
| 8 | 「返回」按钮 | 回到上传页，再次上传同一文件正常 |

## B-2 分页（P0）

| # | 步骤 | 预期 |
|---|---|---|
| 1 | 打开 >3 页文档 | 按高度切分为 .page-content；页码 x/N 显示正确 |
| 2 | 上一页/下一页按钮 | 首页时「上一页」禁用；末页时「下一页」禁用 |
| 3 | PageUp/PageDown/Home/End | 对应首页/末页跳转；焦点在输入框时快捷键不劫持输入 |
| 4 | pageBreakBefore 段落 | 强制换页生效 |
| 5 | 横向纸张 section | 该节页面宽高翻转 |
| 6 | 虚拟滚动 | 快速滚动无白屏闪烁；离屏页占位高度≈真实高度（无明显跳动）；≤3 页文档不启用虚拟滚动 |
| 7 | 搜索/大纲跳转期间 | 虚拟滚动临时禁用，目标页可命中 |

## B-3 搜索（P0）

| # | 步骤 | 预期 |
|---|---|---|
| 1 | 工具栏搜索图标打开搜索栏 | 输入关键词回车，命中数统计正确，▲▼ 循环切换匹配 |
| 2 | 大小写敏感 Aa 勾选/取消 | 结果集随之变化并自动重新搜索 |
| 3 | 全词匹配 W | "cat" 不命中 "category"；标点相邻全词可命中 |
| 4 | 单节点多匹配高亮 | 同一文本节点多处命中全部高亮、无 IndexSizeError、无偏移错位（倒序 Range 回归点） |
| 5 | 清除高亮 | 关闭搜索栏后高亮还原为原始文本节点 |
| 6 | regex 特殊字符作关键词 | `a.*(` 等按字面匹配不抛异常 |
| 7 | 无结果 | 显示 0/无匹配提示，不高亮任何内容 |

## B-4 导出（P1）

| # | 步骤 | 预期 |
|---|---|---|
| 1 | 📝 导出 Markdown | 下载 .md；标题→#、粗斜删→**/* /~~、链接→[]()、图片→![]()、表格→MD 表格（含 colspan 适配）、嵌套列表缩进正确 |
| 2 | 纯文本回退路径（无 .page-content） | 回退根容器子节点导出，文件非空 |
| 3 | 📥 TXT / 🌐 HTML 导出 | 内容完整、编码 UTF-8 无乱码 |
| 4 | 📋 复制 | 剪贴板内容与预览文本一致 |
| 5 | 🖨️ 打印 | 打印预览分页合理，工具栏/侧栏不入打印 |
| 6 | 导出内容与预览一致性 | 抽查 unicode-form.doc：标题数、表格行列、列表项数三处一致 |

## B-5 i18n 切换（P1）

| # | 步骤 | 预期 |
|---|---|---|
| 1 | App.vue 语言按钮 zh-CN↔en | 上传页全部文案即时切换，无需刷新 |
| 2 | 进入预览后切换 | DocPreview 工具栏 title/aria-label、面板标题、加载阶段文案、错误分类文案全量切换；布局无溢出错位 |
| 3 | localStorage 持久化 | 刷新后语言保持上次选择 |
| 4 | 缺失键 | t() 回退不渲染 raw key 或空白（抽查新增键是否双字典同步——180+ 条目） |

## B-6 移动端（P1，DevTools 视口仿真 + 真机抽测）

| # | 断点 | 预期 |
|---|---|---|
| 1 | ≤900px | 工具栏折叠为水平滚动（隐藏滚动条但可滑）；侧边栏内嵌流式排列 |
| 2 | ≤640px | 面板全宽；stories-panel max-width:100vw / calc(100vw−48px)，无横向溢出 |
| 3 | ≤480px | 触控目标 ≥44px；分页控件可用 |
| 4 | 横竖屏切换 | 重算可视范围（resize 监听），占位高度刷新无错乱 |
| 5 | iOS Safari 抽测 | 上传、分页、搜索三项 P0 冒烟通过 |

## B-7 其他工具栏与面板（P2）

缩放 −/+/重置及上下限禁用态｜暗黑模式全面板对比度｜⌨️ 快捷键面板三种触发（按钮/?/Ctrl+/）与 Escape/遮罩关闭｜📊 统计面板六项数字与实际一致｜大纲面板跳转｜隐藏文字显隐切换｜Web 字体开关｜阅读模式｜CollapsiblePanel 展开/收起状态独立。

## B-8 加载体验（P2）

进度条 indeterminate/百分比两态｜progressStep 阶段文案随 10 阶段更新｜大文件（1MB）走 worker 主界面不卡顿。

## B-9~B-11 特性联动手工项

修订面板三模式切换后导出 MD 是否带走 ins/del 残留｜嵌入式图片 cp 定位与暗黑样式｜分栏文档分页归属正确（不同栏配置内容分属不同页）。

---

# 缺陷管理流程

- **登记**：qa 登记 team_task（编号 DEF-xxx），字段：标题/模块/复现步骤/预期 vs 实际/证据（报错、commit、fixture）/严重级/指派。
- **严重级**：S1 功能不可用或数据错误且无绕行；S2 主要功能受损有绕行；S3 一般问题；S4 体验/代码质量。
- **闭环标准**：修复提交 → `npm test` 全绿 + 相关用例复验通过 → qa 复验注销。修复涉及契约变更须同步 architect 上板。

## 当前登记缺陷

### DEF-001 · S4 · 测试代码 · 【已现场修复，待提交确认】
- 现象：`buildOleWithFields` 使用未定义变量 `withChart` → ReferenceError，"parseWithFormat field assembly" 用例失败。
- 根因：改造 fixture 时只改了调用点未同步函数签名（缺 `withChart = true` 参数）。
- 状态：2025-08-25 会话中已由开发修复并验证通过；**跟踪项：确认该改动随工作区一起提交**。

### DEF-002 · S2 · 解析器健壮性 + 测试质量 · 【开放，需指派】
- 现象：`scoring fallback can pick UTF-16 and return without format data` 失败，实际返回 `{success:false, error:"文档内容为空"}`。
- 复现：`npx vitest run tests/docParser.test.ts -t "scoring fallback"`。
- 产品侧分析：编码评分回退（src/utils/docParser.ts:2082-2086）在 suggestedComplex=false 分支选定某编码后，若 `filterParagraphsWithGenericLogic` 过滤结果为空，直接走到"文档内容为空"，**缺少"换另一种编码重试"的兜底**。真实影响面：FIB 无有效偏移 + fCompact/fComplex 位不可靠 + 正文无 0x0D 的文件（部分 Word 95/转换器产物）会解析失败。
- 测试侧问题：夹具 [2048,8192) 是纯 ASCII 填充（'A'+周期 NUL/空格），并不含真正 UTF-16 文本，用例名"can pick UTF-16"与夹具能力不符；且遗留 `console.log('DBG2 ...')` 调试语句。
- 建议：产品侧补跨编码兜底重试（enc-04）；sdet 重构夹具为真实 UTF-16LE 内容并移除调试日志。
- 指派建议：产品逻辑→解析器负责工程师生效修复；夹具清理→sdet。

---

# 风险与暂不覆盖项

1. textutil 真实产物无入库样本（TXU-04），当前仅靠合成夹具——建议补样本。
2. stripBinaryPrefix 噪声残留 1 字符为已知限制，v1 按已知问题跟踪，不设验收阻断。
3. 浏览器兼容矩阵 v1 仅 Chrome 全量 + Safari/Android 冒烟；Firefox 列入 v2。
4. 内存类缺陷（大文件 OOM）依赖 perf-dev 专项，本计划仅覆盖 PERF-01 时间预算。
