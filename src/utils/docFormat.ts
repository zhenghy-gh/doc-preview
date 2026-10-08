/**
 * 跨模块共享类型单一事实源（contract-split-r1 §〇）。
 * 此处仅做 type-only 引用，运行时零依赖，不产生模块环。
 */
import type { DocumentProperties } from './propertyParser'
import type { StyleDefinition } from './styleParser'

/** 字符级样式 */
export interface CharStyle {
  fontName?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  superscript?: boolean
  subscript?: boolean
  color?: string
  highlight?: string
  smallCaps?: boolean
  allCaps?: boolean
  outline?: boolean
  shadow?: boolean
  /** 字符间距（磅） */
  letterSpacing?: number
  /** 隐藏文字 */
  hidden?: boolean
}

/** 字符样式段（带范围的样式应用） */
export interface CharStyleSegment {
  start: number
  end: number
  style: CharStyle
}

/** 字符格式（包含整体样式和细粒度样式段） */
export interface CharacterFormat {
  fontName?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  superscript?: boolean
  subscript?: boolean
  color?: string
  highlight?: string
  /** 小型大写字母 */
  smallCaps?: boolean
  /** 全部大写字母 */
  allCaps?: boolean
  /** 字符边框 */
  outline?: boolean
  /** 字符阴影 */
  shadow?: boolean
  /** 字符间距（磅） */
  letterSpacing?: number
  /** 隐藏文字（来自 sprmCFVanish） */
  hidden?: boolean
  /** 细粒度字符样式段（每个字符位置的样式） */
  styles?: CharStyleSegment[]
}

/** 边框记录结构（Brc） */
export interface ParagraphBorder {
  /** 颜色索引（1-16，映射到 Word 颜色调色板） */
  colorIndex?: number
  /** 线宽（1/8 磅），实际磅数 = dptLineWidth / 8 */
  lineWidth?: number
  /** 边框类型：0=无, 1=单实线, 2=细点线, 3=虚线, 4=细双线, 5=双线, 6=粗线, 7=点划线 */
  borderType?: number
}

/** 段落边框（四个边） */
export interface ParagraphBorders {
  top?: ParagraphBorder
  left?: ParagraphBorder
  bottom?: ParagraphBorder
  right?: ParagraphBorder
}

/** 段落格式 */
export interface ParagraphFormat {
  alignment?: 'left' | 'center' | 'right' | 'justify'
  indent?: number
  firstLineIndent?: number
  /** 右缩进（磅） */
  rightIndent?: number
  lineSpacing?: number
  spaceBefore?: number
  spaceAfter?: number
  /** 列表类型：ordered（编号）或 unordered（符号） */
  listType?: 'ordered' | 'unordered'
  /** 列表样式：decimal / lower-alpha / lower-greek / cjk-ideographic / disc / circle / square 等 */
  listStyle?: string
  /** 列表层级（0 起算，按前导缩进推断）。同一连续块内 listLevel 不同的项会被渲染为嵌套列表。 */
  listLevel?: number
  /** 列表唯一标识符（ilst 或 ilfo 派生），用于跨非列表段落的编号续接；启发层可用字符串哨兵（如 'structural-list'）。 */
  listId?: number | string
  /** 大纲级别（0-8，来自 sprmPOutlineLvl） */
  outlineLevel?: number
  /** 段落背景色（来自 sprmPShd） */
  backgroundColor?: string
  /** 制表位位置列表（磅值，来自 sprmPDxaTab / sprmPChgTabs） */
  tabs?: number[]
  /** 段落边框（来自 sprmPBrcTop/Left/Bottom/Right） */
  borders?: ParagraphBorders
  /** 表格信息（来自 TAP SPRM，仅当段落属于表格行时存在） */
  table?: TableInfo
  /** 段前分页（该段落前有分页符，来自段落文本中的 \f 字符） */
  pageBreakBefore?: boolean
  /** 标题级别（1-9，来自 PAPX outlineLevel 或样式名推断） */
  headingLevel?: number
  /** 段落样式名称（来自 PAPX istd 解析的样式表） */
  styleName?: string
  /** 是否由真实 CHP/PAP 格式表恢复（而非启发式推断） */
  paraFormatFromReal?: boolean
}

/** 表格边框样式（Brc 简化结构） */
export interface TableBorderStyle {
  /** 颜色索引（1-16，映射到 Word 颜色调色板） */
  colorIndex?: number
  /** 线宽（1/8 磅） */
  lineWidth?: number
  /** 边框类型：0=无, 1=单实线, 2=细点线, 3=虚线, 4=细双线, 5=双线, 6=粗线, 7=点划线 */
  borderType?: number
}

/** 表格边框（来自 sprmTTableBorders 0xD612） */
export interface TableBorders {
  top?: TableBorderStyle
  left?: TableBorderStyle
  bottom?: TableBorderStyle
  right?: TableBorderStyle
  /** 内部水平边框 */
  insideH?: TableBorderStyle
  /** 内部垂直边框 */
  insideV?: TableBorderStyle
}

/** 单元格边框（来自 sprmTDefTable 的 TC 结构） */
export interface TableCellBorders {
  top?: TableBorderStyle
  left?: TableBorderStyle
  bottom?: TableBorderStyle
  right?: TableBorderStyle
}

/** 单元格信息（来自 sprmTDefTable 的 rgtc[] 数组） */
export interface TableCellInfo {
  /** 列索引（0-based） */
  column: number
  /**
   * 垂直合并状态（来自 TC.fVertMerge）：
   * - 'none'    : 不合并
   * - 'restart' : 合并起始单元格（rowspan 起点）
   * - 'continue': 合并延续单元格（被上方单元格 rowspan 覆盖）
   */
  verticalMerge: 'none' | 'restart' | 'continue'
  /**
   * 水平合并状态（来自 TC.fHorzMerge）：
   * - 'none'    : 不合并
   * - 'restart' : 合并起始单元格（colspan 起点）
   * - 'continue': 合并延续单元格（被左侧单元格 colspan 覆盖）
   */
  horizontalMerge?: 'none' | 'restart' | 'continue'
  /** 单元格边框（来自 TC 的 BrcTop/BrcLeft/BrcBottom/BrcRight） */
  borders?: TableCellBorders
  /** 单元格宽度（twips，来自 rgdxaCenter 差值） */
  widthTwips?: number
}

/** 表格对齐方式（来自 sprmTJTable 0xD632） */
export type TableJustification = 'left' | 'center' | 'right'

/** 表格行信息（来自 TAP — Table Properties） */
export interface TableInfo {
  /** 段落是否在表格中（sprmPFInTable 0x240C） */
  inTable: boolean
  /** 表格嵌套深度（sprmPTableDepth 0x4410，1=顶层表格） */
  depth?: number
  /** 该行的单元格信息数组（来自 sprmTDefTable 的 rgtc[]） */
  cells?: TableCellInfo[]
  /** 该行的表格边框（来自 sprmTTableBorders） */
  borders?: TableBorders
  /** 表格对齐方式（来自 sprmTJTable 0xD632） */
  justification?: TableJustification
  /** 表格缩进（来自 sprmTDxaTableIndent 0xD609，twips） */
  indentTwips?: number
}

/** 带格式的段落 */
export interface FormattedParagraph {
  text: string
  charFormat: CharacterFormat
  paraFormat: ParagraphFormat
}

/**
 * 页眉页脚子范围类型（来自 PlcfHdd 解析）。
 * 对应 MS-DOC 规范中 ccpHdd story 的固定子范围顺序。
 */
export type HeaderFooterPartType =
  | 'titleHeader'    // 首页页眉
  | 'titleFooter'    // 首页页脚
  | 'oddHeader'      // 奇数页页眉
  | 'oddFooter'      // 奇数页页脚
  | 'evenHeader'     // 偶数页页眉
  | 'evenFooter'     // 偶数页页脚

/**
 * 页眉页脚中的图片信息。
 * 
 * 页眉页脚中的图片与正文图片结构相同，但属于特定的页眉页脚子范围。
 */
export interface HeaderFooterImage {
  /** 图片格式 */
  format: string
  /** data URL（可直接用于 <img src>） */
  dataUrl: string
  /** 宽度（像素），未知时为 undefined */
  widthPx?: number
  /** 高度（像素），未知时为 undefined */
  heightPx?: number
  /** 是否为浮动图片 */
  floating?: boolean
}

/**
 * 页眉页脚子范围内容（包含文本和图片）。
 */
export interface HeaderFooterPartContent {
  /** 文本内容 */
  text: string
  /** 该子范围中的图片列表 */
  images?: HeaderFooterImage[]
}

/**
 * 文档中非正文区域的文本内容（story 分流结果）。
 *
 * Word 将所有 story 存储为一个连续字符流，按 FibRgLw 的 rgCcp 边界拆分。
 * 各字段为原始文本（可能为空字符串），UI 层决定是否展示。
 */
export interface DocumentStories {
  /** 页眉/页脚（ccpHdd）。 */
  headers?: string
  /** 页眉页脚拆分结果（首页/奇偶页页眉页脚）。仅当 DOP 标志位启用且拆分成功时存在。 */
  headerParts?: Partial<Record<HeaderFooterPartType, string>>
  /** 页眉页脚带图片的拆分结果（包含文本和图片信息）。仅当拆分成功且有图片时存在。 */
  headerPartsWithImages?: Partial<Record<HeaderFooterPartType, HeaderFooterPartContent>>
  /** 脚注（ccpFtn）。 */
  footnotes?: string
  /** 尾注（ccpEdn）。 */
  endnotes?: string
  /** 批注（ccpAtn）。 */
  comments?: string
  /** 文本框（ccpTxbx + ccpHdrTxbx）。 */
  textboxes?: string
}

/** 文档级标志（来自 DOP — Document Properties） */
export interface DocumentFlags {
  /** 奇偶页不同（fFacingPages） */
  facingPages?: boolean
  /** 首页有独立标题/页眉页脚（fTitlePage） */
  titlePage?: boolean
  /** 主文档有页眉（fPMHMain） */
  pmhMain?: boolean
  /** 修订模式开启（fRMW — Record Modifications） */
  trackChanges?: boolean
  /** 脚注每页/每节重新编号（fFtnRestart） */
  ftnRestart?: boolean
  /** 脚注在节末（fFtnEnd） */
  ftnEnd?: boolean
  /** 脚注在文档末尾（fFtnAtEnd） */
  ftnAtEnd?: boolean
}

/**
 * 修订类型（来自 sprmCFRMark / sprmCFRMarkDel 的组合判断）：
 * - 'insert' : 修订插入（fRMark=1, fRMarkDel=0）— 新增的文字
 * - 'delete' : 修订删除（fRMarkDel=1）— 标记为删除的文字
 * - 'format' : 格式修订（fRMark=1 且无文本变化）
 */
export type RevisionType = 'insert' | 'delete' | 'format'

/**
 * 单条修订标记记录。
 *
 * 对应文本流中一个被修订的字符范围 [cpStart, cpEnd)，附带修订元数据
 * （作者、时间、类型）。元数据来自 sprmCRMark (0x0830) 的 RMRK 结构，
 * 作者名通过 ibstRMark 索引到 SttbfRMark 作者表查找。
 */
export interface RevisionMark {
  /** 修订范围起始 CP（character position，全局） */
  cpStart: number
  /** 修订范围结束 CP（exclusive） */
  cpEnd: number
  /** 修订类型 */
  type: RevisionType
  /** 作者索引（到 SttbfRMark），无 RMRK 时为 undefined */
  authorIndex?: number
  /** 作者名（已通过 SttbfRMark 解析），未解析作者表时为 undefined */
  author?: string
  /** 修订时间戳（DTTM 转换后的 Unix 毫秒），无 RMRK 时为 undefined */
  timestamp?: number
}

/** 解析后的文档 */
export interface ParsedDocument {
  paragraphs: FormattedParagraph[]
  /** 非正文区域的 story 文本（页眉页脚/脚注/尾注等），无 story 数据时为 undefined。 */
  stories?: DocumentStories
  /** 提取出的嵌入式图片（data URL 数组），无图片时为 undefined。 */
  images?: string[]
  /** 提取出的图片（结构化信息），包括格式、尺寸、浮动状态等。无图片时为 undefined。 */
  pictures?: Array<{
    /** 图片格式 */
    format: string
    /** data URL（可直接用于 <img src>） */
    dataUrl: string
    /** 宽度（像素），未知时为 undefined */
    widthPx?: number
    /** 高度（像素），未知时为 undefined */
    heightPx?: number
    /** 是否为浮动图片（有形状锚点），未判断时为 undefined */
    floating?: boolean
    /** 在文档文本中的字符位置（cp），内联图片时有值 */
    cp?: number
  }>
  /** 提取出的超链接列表，无超链接时为 undefined。 */
  hyperlinks?: Array<{ cpStart: number; cpEnd: number; url: string; result: string }>
  /** 目录条目列表，无目录时为 undefined。 */
  toc?: Array<{ level: number; text: string; pageNumber?: string; cp?: number }>
  /** 索引条目列表（来自 INDEX 域），无索引时为 undefined。 */
  index?: Array<{ mainTerm: string; subTerm?: string; pageNumber?: string; cp?: number }>
  /** 文档级标志（来自 DOP），无 DOP 数据时为 undefined。 */
  docFlags?: DocumentFlags
  /** 创建文档的 Word 版本（基于 nFib 检测），未检测到时为 undefined。 */
  wordVersion?: string
  /** 修订标记列表（来自 sprmCRMark/sprmCFRMark/sprmCFRMarkDel），无修订时为 undefined。 */
  revisions?: RevisionMark[]
  /** 文档域（来自 PlcfFld 的 AUTHOR/TITLE/DATE 等域），无域数据时为 undefined。 */
  documentFields?: {
    author?: string
    title?: string
    subject?: string
    keywords?: string
    comments?: string
    lastSavedBy?: string
    createDate?: string
    lastSavedDate?: string
    printDate?: string
    date?: string
    time?: string
    revisionNumber?: string
  }
  /** 文档属性（标题/作者等，来自 SummaryInformation 流），无属性数据时为 undefined。 */
  properties?: DocumentProperties
  /**
   * 样式表定义（来自 STSH 解析）。
   * 仅当走 tryParseFormatsFromTableStream 回退路径（非标准 FIB 文件）时附带；
   * 主 CLX 路径的样式已内联进各段落格式，此字段仅供调试/展示。
   */
  styles?: StyleDefinition[]
  /** 书签列表（来自 PlcfBkf/PlcfBkl/SttbfBkmk），无书签时为 undefined。 */
  bookmarks?: BookmarkRange[]
  /** 节列表（来自 PlcfSed/SEPX），包含页面布局与分节信息，无节数据时为 undefined。 */
  sections?: SectionInfo[]
  /** 页码域列表（来自 PlcfFld 的 PAGE/NUMPAGES/SECTION/SECTIONPAGES），无页码域时为 undefined。 */
  pageFields?: PageFieldRange[]
  /** 交叉引用列表（来自 PlcfFld 的 REF/NOTEREF 域），无交叉引用时为 undefined。 */
  crossReferences?: CrossReferenceRange[]
  /** 形状列表（来自 Office Art Drawing Container），包含浮动图片锚点定位信息，无形状时为 undefined。 */
  shapes?: ShapeInfo[]
  /** 公式列表（来自 Equation Editor OLE 对象），无公式时为 undefined。 */
  equations?: EquationInfo[]
  /** 图表列表（来自 MSGraph/Excel/SmartArt OLE 对象），无图表时为 undefined。 */
  charts?: ChartInfo[]
  /** WordArt 列表（来自 Office Art Drawing WordArt 对象），无艺术字时为 undefined。 */
  wordArts?: WordArtInfo[]
  /** 样式集信息（来自 STSH 扩展数据或样式名推断），无样式集数据时为 undefined。 */
  styleSet?: { name: string; isCustom?: boolean }
}

/**
 * 书签范围记录。
 *
 * 对应文档中一个命名的字符范围 [cpStart, cpEnd)，书签名称来自 SttbfBkmk 字符串表，
 * 位置来自 PlcfBkf（起始）和 PlcfBkl（结束）。
 */
export interface BookmarkRange {
  /** 书签名称 */
  name: string
  /** 书签起始 CP（character position，全局） */
  cpStart: number
  /** 书签结束 CP（exclusive） */
  cpEnd: number
}

/**
 * 节中断类型（来自 sprmSBkc）。
 * - 'nextPage'    : 下一页开始（分节符 = 分页符）
 * - 'oddPage'     : 奇数页开始
 * - 'evenPage'    : 偶数页开始
 * - 'continuous'  : 连续（同页分节）
 */
export type SectionBreakType = 'nextPage' | 'oddPage' | 'evenPage' | 'continuous'

/**
 * 页面方向（来自 sprmSBOrientation）。
 */
export type PageOrientation = 'portrait' | 'landscape'

/**
 * 单个节的页面布局与属性（来自 SEPX — Section Properties）。
 *
 * 通过 PlcfSed 定位每个节的 SEPX 偏移，解析 grpprl 中的 Section SPRM
 * 恢复页面大小、页边距、方向、分栏等属性。未指定时为 undefined，UI 使用默认值。
 */
export interface SectionInfo {
  /** 节起始 CP（character position，全局） */
  cpStart: number
  /** 节结束 CP（exclusive） */
  cpEnd: number
  /** 节索引（0-based） */
  index: number
  /** 节中断类型（来自 sprmSBkc） */
  breakType?: SectionBreakType
  /** 页面方向（来自 sprmSBOrientation） */
  orientation?: PageOrientation
  /** 页面宽度（磅，来自 sprmSXaPage，原始为 twips） */
  pageWidthPt?: number
  /** 页面高度（磅，来自 sprmSYaPage，原始为 twips） */
  pageHeightPt?: number
  /** 左页边距（磅，来自 sprmSDxaLeft） */
  marginLeftPt?: number
  /** 右页边距（磅，来自 sprmSDxaRight） */
  marginRightPt?: number
  /** 上页边距（磅，来自 sprmSDyaTop） */
  marginTopPt?: number
  /** 下页边距（磅，来自 sprmSDyaBottom） */
  marginBottomPt?: number
  /** 装订线宽度（磅，来自 sprmSDxaGutter） */
  gutterPt?: number
  /** 分栏数（来自 sprmSCcolumns，默认 1） */
  columnCount?: number
  /** 栏间距（磅，来自 sprmSDxaColumns） */
  columnSpacingPt?: number
  /** 起始页码（来自 sprmSPgnStart，无指定时为 undefined，表示续接上一节） */
  pageStart?: number
}

/**
 * 页码域类型（来自 PlcfFld 的 instruction 文本匹配）。
 * - 'page'         : PAGE 域，当前页码
 * - 'numPages'     : NUMPAGES 域，总页数
 * - 'section'      : SECTION 域，当前节编号
 * - 'sectionPages' : SECTIONPAGES 域，当前节页数
 */
export type PageFieldType = 'page' | 'numPages' | 'section' | 'sectionPages'

/**
 * 单个页码域记录。
 *
 * 对应文档中一个 PAGE/NUMPAGES/SECTION/SECTIONPAGES 域的范围 [cpStart, cpEnd)。
 * 域的 result 是 Word 上次更新域时计算的值，用于在预览中显示页码。
 */
export interface PageFieldRange {
  /** 域起始 CP（包含 0x13 字符位置） */
  cpStart: number
  /** 域结束 CP（exclusive，包含 0x15 字符位置） */
  cpEnd: number
  /** 域类型 */
  type: PageFieldType
  /** 域指令文本（如 "PAGE"、"NUMPAGES \* MERGEFORMAT"） */
  instruction: string
  /** 域结果文本（如 "1"、"5"），即 Word 上次计算的页码值 */
  result: string
}

export type ShapeType =
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'freeform'
  | 'textbox'
  | 'picture'
  | 'group'
  | 'unknown'

export type ShapeAnchorType =
  | 'char'
  | 'paragraph'
  | 'page'
  | 'margin'
  | 'unknown'

export interface ShapeInfo {
  spid: number
  type: ShapeType
  name?: string
  x?: number
  y?: number
  width?: number
  height?: number
  anchorType: ShapeAnchorType
  anchorCp?: number
  hasPicture?: boolean
  fcPic?: number
  pictureFormat?: string
  floating?: boolean
  groupId?: number
}

/**
 * 公式信息（来自 Equation Editor OLE 对象）。
 *
 * Word 97-2003 中的公式通过 Equation Editor 作为 OLE 对象嵌入，
 * 在目录表中表现为名称模式 "Equation.N" 的存储对象。
 * 每个公式包含 EquationText 流存储公式的文本表示（类似 LaTeX），
 * 以及 EquationNative 流存储二进制表示。
 */
export interface EquationInfo {
  /** 公式编号（从 1 开始递增） */
  id: number
  /** 原始公式文本（来自 EquationText 流） */
  eqnText: string
  /** 转换后的 LaTeX 表示（用于渲染） */
  latex: string
  /** 公式在文档中的字符位置（可选） */
  cp?: number
  /** 是否有对应的图片表示 */
  hasPicture?: boolean
  /** 公式格式（如 'OMML'、'Equation3' 等） */
  format?: string
}

/**
 * 图表类型（通过 OLE 对象名称识别）。
 * - 'msgraph'     : MSGraph 图表对象
 * - 'excel'       : Excel 图表/表格对象
 * - 'smartart'    : SmartArt 图形对象
 * - 'oleobject'   : 通用 OLE 对象
 * - 'chart'       : 其他图表类型
 * - 'unknown'     : 未知类型
 */
export type ChartType = 'msgraph' | 'excel' | 'smartart' | 'oleobject' | 'chart' | 'unknown'

/**
 * 图表子类型。
 * 图表类型：column/bar/line/pie/area/scatter/doughnut/radar/surface/bubble/stock/cone/cylinder/pyramid
 * SmartArt 类型：orgchart/process/cycle/hierarchy/matrix/relationship/list/picture
 */
export type ChartSubtype = 
  | 'column' | 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'doughnut'
  | 'radar' | 'surface' | 'bubble' | 'stock' | 'cone' | 'cylinder' | 'pyramid'
  | 'orgchart' | 'process' | 'cycle' | 'hierarchy' | 'matrix' | 'relationship' | 'list'
  | 'picture' | 'chart' | 'unknown'

/**
 * 图表信息（来自 MSGraph/Excel/SmartArt OLE 对象）。
 *
 * Word 97-2003 中的图表和 SmartArt 通过 OLE 对象嵌入，
 * 在目录表中表现为名称模式如 "MSGraph.Chart.N"、"Excel.Sheet.N"、"Object.N" 等。
 */
export interface ChartInfo {
  /** 图表编号（从 1 开始递增） */
  id: number
  /** 图表名称（来自 OLE 目录条目） */
  name: string
  /** 图表类型 */
  type: ChartType
  /** 图表子类型 */
  subtype: ChartSubtype
  /** 是否有对应的图片表示 */
  hasPicture?: boolean
  /** 是否有数据流 */
  hasData?: boolean
  /** 数据流大小（字节） */
  dataSize?: number
  /** 图片流大小（字节） */
  pictureSize?: number
  /** OLE 对象类型 */
  objectType?: number
  /** 图表格式（如 'MSGraph.Chart.8'） */
  format?: string
  /** 图表预览图 data URL（从 OLE Picture 流提取），无预览图时为 undefined */
  dataUrl?: string
}

/**
 * WordArt 效果类型。
 * - 'gradient'     : 渐变填充
 * - 'shadow'       : 阴影效果
 * - 'emboss'       : 浮雕效果
 * - 'bevel'        : 斜角效果
 * - 'outline'      : 轮廓效果
 * - 'fill'         : 纯色填充
 * - '3d'           : 3D 效果
 * - 'rotate'       : 旋转效果
 * - 'flip'         : 翻转效果
 * - 'stretch'      : 拉伸效果
 * - 'unknown'      : 未知效果
 */
export type WordArtEffect = 
  | 'gradient' | 'shadow' | 'emboss' | 'bevel' | 'outline'
  | 'fill' | '3d' | 'rotate' | 'flip' | 'stretch'
  | 'unknown'

/**
 * WordArt 信息（来自 Office Art WordArt 对象）。
 *
 * Word 97-2003 中的艺术字通过 Office Art Drawing 对象存储，
 * 包含渐变填充、阴影、旋转等特殊文本效果。
 */
export interface WordArtInfo {
  /** WordArt 编号（从 1 开始递增） */
  id: number
  /** WordArt 名称（来自 OLE 目录条目） */
  name: string
  /** 艺术字文本内容 */
  text?: string
  /** 应用的效果列表 */
  effects: WordArtEffect[]
  /** 旋转角度（度） */
  rotation?: number
  /** 是否水平翻转 */
  flipHorizontal?: boolean
  /** 是否垂直翻转 */
  flipVertical?: boolean
  /** 使用的颜色列表（十六进制） */
  colors?: string[]
  /** 字体名称 */
  fontName?: string
  /** 字体大小（磅） */
  fontSize?: number
  /** 是否有对应的图片表示 */
  hasPicture?: boolean
  /** 宽度（twips） */
  width?: number
  /** 高度（twips） */
  height?: number
  /** 字符位置 */
  cp?: number
}

/** 交叉引用类型（通过 instruction 关键字识别）。

 * Word 中 REF 域没有专门的 flt 值，通过 instruction 文本中的关键字区分：
 * - 'ref'      : REF 域，引用书签内容、图表编号、表格编号等
 * - 'noteref'  : NOTEREF 域，专门引用脚注或尾注标记
 */
export type CrossReferenceType = 'ref' | 'noteref'

/**
 * 单个交叉引用域记录。
 *
 * 对应文档中一个 REF/NOTEREF 域的范围 [cpStart, cpEnd)。
 * 域的 targetBookmarkName 指向被引用的书签名称（如 `_Ref12345`、`FootnoteRef`），
 * 域的 result 是 Word 上次更新域时计算的引用文本。
 */
export interface CrossReferenceRange {
  /** 域起始 CP（包含 0x13 字符位置） */
  cpStart: number
  /** 域结束 CP（exclusive，包含 0x15 字符位置） */
  cpEnd: number
  /** 域类型 */
  type: CrossReferenceType
  /** 域指令文本（如 "REF _Ref12345 \h"、"NOTEREF FootnoteRef"） */
  instruction: string
  /** 被引用的书签名称（instruction 中的第一个参数） */
  targetBookmarkName: string
  /** 域结果文本（如 "图 1"、"表 2"、页码等） */
  result: string
  /** 域开关标志集合（从 instruction 解析，如 \h 表示超链接） */
  switches: string[]
}

/** 解析结果 */
export interface ParseResult {
  success: boolean
  document?: ParsedDocument
  text?: string
  error?: string
  /**
   * 结构化错误码（ERR-CODE）。
   *
   * 中文错误文案无法稳定参与关键字分类（classifyError 漏判落 unknown 的根治方案 b）：
   * 解析器在失败出口处附带机器可读代码，classifyError 按 code 优先判定，
   * 关键字匹配仅作为无 code 时的兼容回退。
   */
  errorCode?: ParseErrorCode
}

/**
 * 解析失败的结构化错误码。
 * 与 classifyError 的类别映射保持一对一；新增值须同步 errorClassifier.ts 的 PARSE_ERROR_CATEGORY。
 */
export type ParseErrorCode =
  | 'OLE_FORMAT'
  | 'NO_WORDDOCUMENT_STREAM'
  | 'EMPTY_DOCUMENT'
  | 'PARSE_FAILED'
  | 'FILE_READ_FAILED'

/** 解析器选项 */
export interface DocParserOptions {
  debug?: boolean
}

// 向后兼容的别名
/** @deprecated 使用 CharacterFormat 替代 */
export type CHP = CharacterFormat
/** @deprecated 使用 ParagraphFormat 替代 */
export type PAP = ParagraphFormat

// ═══ T3 渲染管线抽离共享类型（contract-split-r1 v1.0 §1.2「共享类型先行」，architect 2026-08-25）═══

/** 渲染层消费的段落视图（提升自 DocPreview.vue 本地 ParaWithList/FormattedParagraphOutput） */
export interface RenderParagraph extends FormattedParagraph {
  listId?: number
  listLevel?: number
  listType?: string
  listStyle?: string
  tableDepth?: number
  headingLevel?: number
  /** 段落在文档字符流中的起始 CP（解析器内部字段） */
  _cpStart?: number
  _cpEnd?: number
}

/**
 * 解析器内部段落对象（启发层/过滤层消费）：
 * 在 RenderParagraph 基础上补充解析期临时标记字段。
 */
export interface ParserParagraph extends RenderParagraph {
  /** 段落文本内嵌有图片占位符 0x01（解析器内部标记） */
  __hasEmbeddedPic?: boolean
  /** 段落/字符格式来自真实格式表（而非启发式推断）的解析期标记 */
  paraFormatFromReal?: boolean
  charFormatFromReal?: boolean
}

/** Web 字体族解析器（由宿主注入，替代对组件内 getWebFontFamily 的闭包依赖） */
export interface FontResolver {
  (fontName?: string): string
}

/** i18n 翻译函数（由宿主注入，替代对 utils/locale 单例的模块级依赖） */
export type Translator = (key: string) => string

/**
 * collectTableBlock 的返回形状（contract-split-r1 §1.2 W1 · T3-W1b）。
 * 字段可选性与 DocPreview.vue 原内联返回类型逐字段一致。
 */
export interface TableBlockResult {
  /** 收集到的表格行（每行为单元格文本数组，多行合并段内已按最大列数补齐空串） */
  rows: string[][]
  /** 与 rows 按下标对齐的行级表格属性；仅当至少一行携带真实 TableInfo 时提供，否则 undefined */
  rowsTableInfo?: TableInfo[]
  /** 与 rows 按下标对齐的嵌套深度（sprmPTableDepth，1=顶层；无信息时默认 1） */
  rowsDepth?: number[]
  /** 启发式识别的表头行数（当前为 0 或 1） */
  headerRowCount: number
  /** 收集结束后的下一个段落索引（指向第一个未消费的段落） */
  nextIndex: number
}
