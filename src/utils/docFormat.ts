/** 字符级样式 */
export interface CharStyle {
  fontName?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  highlight?: string
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
  color?: string
  /** 细粒度字符样式段（每个字符位置的样式） */
  styles?: CharStyleSegment[]
}

/** 段落格式 */
export interface ParagraphFormat {
  alignment?: 'left' | 'center' | 'right' | 'justify'
  indent?: number
  lineSpacing?: number
  spaceBefore?: number
  spaceAfter?: number
  /** 列表类型：ordered（编号）或 unordered（符号） */
  listType?: 'ordered' | 'unordered'
  /** 列表样式：decimal / lower-alpha / disc 等 */
  listStyle?: string
}

/** 带格式的段落 */
export interface FormattedParagraph {
  text: string
  charFormat: CharacterFormat
  paraFormat: ParagraphFormat
}

/** 解析后的文档 */
export interface ParsedDocument {
  paragraphs: FormattedParagraph[]
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
