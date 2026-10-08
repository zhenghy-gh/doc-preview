/**
 * paragraphStyleRenderer —— 段落样式渲染纯函数（T3-W2 · contract-split-r1 §1.2 Batch-B）
 *
 * 自 DocPreview.vue 原样迁出（符号名锚）：FONT_SIZE_MAP / resolveFontSize /
 * getTextAlignment / BORDER_COLOR_MAP / BORDER_TYPE_MAP / getBorderStyle / getBorderCss /
 * CharStyleOptions / formatTextWithCharacterStyles / formatTextWithDefaultStyles。
 *
 * 参数化（契约 W2 表）：外部状态经显式入参注入——
 *  - showHiddenText: boolean 布尔快照（替代组件 ref 闭包读取）；
 *  - fontResolver: FontResolver Web 字体族解析器（替代组件内 getWebFontFamily 闭包）。
 * 纯度边界（契约 §1.3）：禁 import vue/.vue、不触 DOM/window；
 * 同一输入必须字节同输出。依赖链仅 textRender（escapeHtml/applyTabStops，DOM 实现由调用环境保证）。
 */
import { escapeHtml, applyTabStops } from '../textRender'
import type { CharacterFormat, ParagraphFormat, CharStyleSegment, FontResolver, ParagraphBorder, ParagraphBorders } from '../docFormat'
import { WORD_COLOR_PALETTE } from '../wordPalette'

/** formatTextWithCharacterStyles 的选项（原组件接口 + showHiddenText/fontResolver 注入字段） */
export interface CharStyleOptions {
  isCentered: boolean
  isRightAligned: boolean
  charFormat: CharacterFormat
  paraFormat: ParagraphFormat
  /** 隐藏文字显示开关（布尔快照注入） */
  showHiddenText: boolean
  /** Web 字体族解析器（宿主注入，如组件 getWebFontFamily） */
  fontResolver: FontResolver
}

/** formatTextWithDefaultStyles 的选项（原内联参数类型 + showHiddenText/fontResolver 注入字段） */
export interface DefaultStyleOptions {
  isCentered: boolean
  isRightAligned: boolean
  /** 隐藏文字显示开关（布尔快照注入） */
  showHiddenText: boolean
  /** Web 字体族解析器（宿主注入） */
  fontResolver: FontResolver
}

export const FONT_SIZE_MAP: Record<number, string> = {
  36: '2.25rem', 22: '1.375rem', 32: '2.0rem',
  16: '1.0rem', 14: '0.875rem', 12: '0.75rem',
}

export function resolveFontSize(size: number | undefined, fallback: string): string {
  if (!size) return fallback
  return FONT_SIZE_MAP[size] || `${size / 16}rem`
}

export function getTextAlignment(paraFormat: ParagraphFormat, _charFormat: CharacterFormat): string {
  if (paraFormat.alignment) return paraFormat.alignment
  return 'justify'
}

/**
 * 表格边框色索引 → CSS 颜色。
 * 与 formatParser 的段落底纹（SHD_COLOR_MAP）、tableText 的单元格底色
 * （colorIndexToCss）共用同一张 Word 16 色索引表，见 wordPalette.ts。
 */
export const BORDER_COLOR_MAP: Record<number, string> = WORD_COLOR_PALETTE

export const BORDER_TYPE_MAP: Record<number, string> = {
  0: 'none',
  1: 'solid',
  2: 'dotted',
  3: 'dashed',
  4: 'double',
  5: 'double',
  6: 'solid',
  7: 'dashed',
}

export function getBorderStyle(border: ParagraphBorder | null | undefined): string {
  if (!border || border.borderType === 0) return ''
  const width = border.lineWidth ? `${border.lineWidth / 8}pt` : '1pt'
  const style = BORDER_TYPE_MAP[border.borderType ?? -1] || 'solid'
  const color = border.colorIndex ? (BORDER_COLOR_MAP[border.colorIndex] || '#000000') : '#000000'
  return `${width} ${style} ${color}`
}

export function getBorderCss(borders: ParagraphBorders | null | undefined): { top: string; left: string; bottom: string; right: string } {
  return {
    top: borders?.top ? getBorderStyle(borders.top) : '',
    left: borders?.left ? getBorderStyle(borders.left) : '',
    bottom: borders?.bottom ? getBorderStyle(borders.bottom) : '',
    right: borders?.right ? getBorderStyle(borders.right) : '',
  }
}

export const formatTextWithCharacterStyles = (
  text: string, charStyles: CharStyleSegment[], options: CharStyleOptions, hasHtml: boolean = false
): string => {
  const { isCentered, charFormat, paraFormat } = options
  const isRightAligned = paraFormat.alignment === 'right'
  const fontSize = resolveFontSize(charFormat.fontSize, '1.0rem')
  const textAlign = isCentered ? 'center' : isRightAligned ? 'right' : 'justify'
  const fontWeight = charFormat.bold ? 'bold' : 'normal'

  let totalLength = 0
  for (const s of charStyles) totalLength += (s.end - s.start)
  if (totalLength < text.length * 0.8) {
    return formatTextWithDefaultStyles(text, charFormat, paraFormat, { isCentered, isRightAligned, showHiddenText: options.showHiddenText, fontResolver: options.fontResolver }, hasHtml)
  }

  let htmlContent = ''
  let lastEnd = 0
  for (const style of charStyles) {
    if (style.start > lastEnd) {
      const gap = text.substring(lastEnd, style.start)
      if (gap) htmlContent += hasHtml ? gap : escapeHtml(gap)
    }
    const segment = text.substring(style.start, style.end)
    if (!segment) continue

    const css: string[] = []
    css.push(`font-family: ${options.fontResolver(style.style.fontName)}'${style.style.fontName || '宋体'}', serif`)
    css.push(`font-size: ${fontSize}`)
    css.push(`font-weight: ${fontWeight}`)
    if (style.style.italic) css.push('font-style: italic')

    const textDecs: string[] = []
    if (style.style.underline) textDecs.push('underline')
    if (style.style.strikethrough) textDecs.push('line-through')
    if (textDecs.length > 0) css.push(`text-decoration: ${textDecs.join(' ')}`)

    if (style.style.color) css.push(`color: ${style.style.color}`)
    if (style.style.highlight) css.push(`background-color: ${style.style.highlight}`)
    if (style.style.superscript) css.push('vertical-align: super; font-size: 0.7em')
    if (style.style.subscript) css.push('vertical-align: sub; font-size: 0.7em')
    if (style.style.smallCaps) css.push('font-variant: small-caps')
    if (style.style.allCaps) css.push('text-transform: uppercase')
    if (style.style.outline) css.push('text-shadow: 1px 0 0 currentColor, -1px 0 0 currentColor, 0 1px 0 currentColor, 0 -1px 0 currentColor')
    if (style.style.shadow) css.push('text-shadow: 2px 2px 2px rgba(0,0,0,0.5)')
    if (style.style.letterSpacing !== undefined && style.style.letterSpacing !== 0) {
      css.push(`letter-spacing: ${style.style.letterSpacing}pt`)
    }
    if (style.style.hidden) {
      if (options.showHiddenText) {
        css.push('border-bottom: 1px dotted #888; color: #888;')
      } else {
        css.push('display: none;')
      }
    }

    htmlContent += `<span style="${css.join('; ')}">${hasHtml ? segment : escapeHtml(segment)}</span>`
    lastEnd = style.end
  }
  if (lastEnd < text.length) {
    const rem = text.substring(lastEnd)
    if (rem) htmlContent += hasHtml ? rem : escapeHtml(rem)
  }

  const pCss: string[] = []
  pCss.push(`font-size:${fontSize}`)
  pCss.push(`text-align:${textAlign}`)
  if (paraFormat.lineSpacing) pCss.push(`line-height: ${paraFormat.lineSpacing}`)
  if (paraFormat.spaceBefore) pCss.push(`margin-top: ${paraFormat.spaceBefore}pt`)
  if (paraFormat.spaceAfter) pCss.push(`margin-bottom: ${paraFormat.spaceAfter}pt`)
  if (paraFormat.indent) pCss.push(`margin-left: ${paraFormat.indent}pt`)
  if (paraFormat.rightIndent) pCss.push(`margin-right: ${paraFormat.rightIndent}pt`)
  if (paraFormat.firstLineIndent) pCss.push(`text-indent: ${paraFormat.firstLineIndent}pt`)
  if (paraFormat.backgroundColor) pCss.push(`background-color: ${paraFormat.backgroundColor}`)
  if (paraFormat.borders) {
    const borderCss = getBorderCss(paraFormat.borders)
    if (borderCss.top) pCss.push(`border-top: ${borderCss.top}`)
    if (borderCss.left) pCss.push(`border-left: ${borderCss.left}`)
    if (borderCss.bottom) pCss.push(`border-bottom: ${borderCss.bottom}`)
    if (borderCss.right) pCss.push(`border-right: ${borderCss.right}`)
    pCss.push('padding: 4px')
  }

  const headingLevel = paraFormat?.headingLevel
  const hasTabs = text.includes('\t')
  const finalContent = hasTabs && (!paraFormat.tabs || paraFormat.tabs.length === 0)
    ? `<span style="white-space: pre; tab-size: 3;">${htmlContent}</span>`
    : htmlContent

  const hasPageBreak = paraFormat.pageBreakBefore
  const pageBreakHtml = hasPageBreak
    ? '<div style="page-break-before: always; break-before: page; border-top: 2px dashed var(--border); margin: 24px 0 16px 0; position: relative;"><span style="position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: var(--bg); padding: 0 8px; font-size: 12px; color: var(--muted);">— 分页 —</span></div>'
    : ''

  if (headingLevel && headingLevel >= 1 && headingLevel <= 6) {
    return `${pageBreakHtml}<h${headingLevel} style="${pCss.join('; ')}">${finalContent}</h${headingLevel}>`
  }
  return `${pageBreakHtml}<p style="${pCss.join('; ')}">${finalContent}</p>`
}

export const formatTextWithDefaultStyles = (
  text: string, charFormat: CharacterFormat, paraFormat: ParagraphFormat,
  options: DefaultStyleOptions, hasHtml: boolean = false
): string => {
  const { isCentered, isRightAligned } = options
  const css: string[] = []
  css.push(`font-family: ${options.fontResolver(charFormat.fontName)}'${charFormat.fontName || '宋体'}', 'SimSun', serif`)
  css.push(`font-size: ${resolveFontSize(charFormat.fontSize, '1.0rem')}`)
  if (charFormat.bold) css.push('font-weight: bold')
  if (charFormat.italic) css.push('font-style: italic')

  const textDecorations: string[] = []
  if (charFormat.underline) textDecorations.push('underline')
  if (charFormat.strikethrough) textDecorations.push('line-through')
  if (textDecorations.length > 0) css.push(`text-decoration: ${textDecorations.join(' ')}`)

  if (charFormat.color) css.push(`color: ${charFormat.color}`)
  if (charFormat.highlight) css.push(`background-color: ${charFormat.highlight}`)
  if (charFormat.superscript) css.push('vertical-align: super; font-size: 0.7em')
  if (charFormat.subscript) css.push('vertical-align: sub; font-size: 0.7em')
  if (charFormat.smallCaps) css.push('font-variant: small-caps')
  if (charFormat.allCaps) css.push('text-transform: uppercase')
  if (charFormat.outline) css.push('text-shadow: 1px 0 0 currentColor, -1px 0 0 currentColor, 0 1px 0 currentColor, 0 -1px 0 currentColor')
  if (charFormat.shadow) css.push('text-shadow: 2px 2px 2px rgba(0,0,0,0.5)')
  if (charFormat.letterSpacing !== undefined && charFormat.letterSpacing !== 0) {
    css.push(`letter-spacing: ${charFormat.letterSpacing}pt`)
  }
  if (charFormat.hidden) {
    if (options.showHiddenText) {
      css.push('border-bottom: 1px dotted #888; color: #888;')
    } else {
      css.push('display: none;')
    }
  }

  css.push(`text-align: ${isCentered ? 'center' : isRightAligned ? 'right' : 'justify'}`)

  if (paraFormat.lineSpacing) css.push(`line-height: ${paraFormat.lineSpacing}`)
  if (paraFormat.spaceBefore) css.push(`margin-top: ${paraFormat.spaceBefore}pt`)
  if (paraFormat.spaceAfter) css.push(`margin-bottom: ${paraFormat.spaceAfter}pt`)
  if (paraFormat.indent) css.push(`margin-left: ${paraFormat.indent}pt`)
  if (paraFormat.rightIndent) css.push(`margin-right: ${paraFormat.rightIndent}pt`)
  if (paraFormat.firstLineIndent) css.push(`text-indent: ${paraFormat.firstLineIndent}pt`)
  if (paraFormat.backgroundColor) css.push(`background-color: ${paraFormat.backgroundColor}`)
  if (paraFormat.borders) {
    const borderCss = getBorderCss(paraFormat.borders)
    if (borderCss.top) css.push(`border-top: ${borderCss.top}`)
    if (borderCss.left) css.push(`border-left: ${borderCss.left}`)
    if (borderCss.bottom) css.push(`border-bottom: ${borderCss.bottom}`)
    if (borderCss.right) css.push(`border-right: ${borderCss.right}`)
    css.push('padding: 4px')
  }

  const hasPageBreak = paraFormat.pageBreakBefore

  const headingLevel = paraFormat?.headingLevel
  const hasTabs = text.includes('\t')
  const finalText = hasTabs
    ? applyTabStops(text, paraFormat.tabs, charFormat.fontSize || 12, charFormat.fontName || '宋体', hasHtml)
    : (hasHtml ? text : escapeHtml(text))

  const pageBreakHtml = hasPageBreak
    ? '<div style="page-break-before: always; break-before: page; border-top: 2px dashed var(--border); margin: 24px 0 16px 0; position: relative;"><span style="position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: var(--bg); padding: 0 8px; font-size: 12px; color: var(--muted);">— 分页 —</span></div>'
    : ''

  if (headingLevel && headingLevel >= 1 && headingLevel <= 6) {
    return `${pageBreakHtml}<h${headingLevel} style="${css.join('; ')}">${finalText}</h${headingLevel}>`
  }
  return `${pageBreakHtml}<p style="${css.join('; ')}">${finalText}</p>`
}

// 纯文本推断渲染与制表位/转义辅助提取至 utils/textRender.ts
