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

/** 单元格合并信息（来自 sprmTDefTable 的 rgtc[] 数组） */
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
}

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
}

/** 带格式的段落 */
export interface FormattedParagraph {
  text: string
  charFormat: CharacterFormat
  paraFormat: ParagraphFormat
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

/** 解析后的文档 */
export interface ParsedDocument {
  paragraphs: FormattedParagraph[]
  /** 非正文区域的 story 文本（页眉页脚/脚注/尾注等），无 story 数据时为 undefined。 */
  stories?: DocumentStories
  /** 提取出的嵌入式图片（data URL 数组），无图片时为 undefined。 */
  images?: string[]
  /** 提取出的超链接列表，无超链接时为 undefined。 */
  hyperlinks?: Array<{ cpStart: number; cpEnd: number; url: string; result: string }>
  /** 目录条目列表，无目录时为 undefined。 */
  toc?: Array<{ level: number; text: string; pageNumber?: string; cp?: number }>
  /** 文档级标志（来自 DOP），无 DOP 数据时为 undefined。 */
  docFlags?: DocumentFlags
  /** 文档属性（标题/作者等），无属性数据时为 undefined。 */
  properties?: {
    title?: string
    subject?: string
    author?: string
    keywords?: string
    comments?: string
    lastAuthor?: string
    pageCount?: number
    wordCount?: number
    charCount?: number
  }
}

/** 解析结果 */
export interface ParseResult {
  success: boolean
  document?: ParsedDocument
  text?: string
  error?: string
}

/** 解析器选项 */
export interface DocParserOptions {
  debug?: boolean
}

// 向后兼容的别名
/** @deprecated 使用 CharacterFormat 替代 */
export type CHP = CharacterFormat
/** @deprecated 使用 ParagraphFormat 替代 */
export type PAP = ParagraphFormat
