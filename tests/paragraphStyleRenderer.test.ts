// T3-W2 · paragraphStyleRenderer 单测（contract-split-r1 §1.2 Batch-B / §3.2 可单测标准）
// 依赖链含 textRender#escapeHtml/applyTabStops（DOM 实现）→ 需 happy-dom 环境。
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import {
  FONT_SIZE_MAP,
  resolveFontSize,
  getTextAlignment,
  getBorderStyle,
  getBorderCss,
  formatTextWithDefaultStyles,
  formatTextWithCharacterStyles,
} from '../src/utils/rendering/paragraphStyleRenderer'
import type { CharacterFormat, ParagraphFormat, CharStyleSegment, FontResolver } from '../src/utils/docFormat'

/** 桩字体解析器：镜像组件 getWebFontFamily 的返回形态（'' 或 'Name, ' 前缀） */
const fontResolver: FontResolver = (fontName) => `WEB(${fontName ?? 'default'}), `

const baseChar: CharacterFormat = {}
const basePara: ParagraphFormat = {}

describe('resolveFontSize', () => {
  it('maps known half-point sizes via FONT_SIZE_MAP', () => {
    expect(FONT_SIZE_MAP[36]).toBe('2.25rem')
    expect(resolveFontSize(36, '1rem')).toBe('2.25rem')
    expect(resolveFontSize(12, '1rem')).toBe('0.75rem')
  })

  it('converts unknown sizes as size/16 rem', () => {
    expect(resolveFontSize(20, '1rem')).toBe('1.25rem')
    expect(resolveFontSize(24, '1rem')).toBe('1.5rem')
  })

  it('returns the fallback for falsy sizes', () => {
    expect(resolveFontSize(undefined, '1.0rem')).toBe('1.0rem')
    expect(resolveFontSize(0, 'fallback')).toBe('fallback')
  })
})

describe('getTextAlignment', () => {
  it('passes through explicit alignment and defaults to justify', () => {
    expect(getTextAlignment({ alignment: 'center' }, {})).toBe('center')
    expect(getTextAlignment({ alignment: 'right' }, {})).toBe('right')
    expect(getTextAlignment({}, {})).toBe('justify')
  })
})

describe('getBorderStyle / getBorderCss', () => {
  it('returns empty for null or borderType=0', () => {
    expect(getBorderStyle(null)).toBe('')
    expect(getBorderStyle({ borderType: 0 })).toBe('')
  })

  it('composes width/style/color with maps and fallbacks', () => {
    expect(getBorderStyle({ borderType: 1 })).toBe('1pt solid #000000')
    expect(getBorderStyle({ borderType: 3, lineWidth: 8, colorIndex: 2 })).toBe('1pt dashed #0000FF')
    expect(getBorderStyle({ borderType: 99, colorIndex: 42 })).toBe('1pt solid #000000')
  })

  it('collects four sides via getBorderCss', () => {
    const css = getBorderCss({
      top: { borderType: 1 },
      bottom: { borderType: 2, lineWidth: 12 },
    })
    expect(css.top).toBe('1pt solid #000000')
    expect(css.bottom).toBe('1.5pt dotted #000000')
    expect(css.left).toBe('')
    expect(css.right).toBe('')
    expect(getBorderCss(undefined)).toEqual({ top: '', left: '', bottom: '', right: '' })
  })
})

describe('formatTextWithDefaultStyles', () => {
  const opts = { isCentered: false, isRightAligned: false, showHiddenText: false, fontResolver }

  it('wraps plain text in a styled <p> with resolved font-family', () => {
    const html = formatTextWithDefaultStyles('正文', { bold: true, fontName: '黑体' }, basePara, opts)
    expect(html.startsWith('<p style="')).toBe(true)
    expect(html).toContain('font-family: WEB(黑体), ')
    expect(html).toContain('font-weight: bold')
    expect(html.endsWith('>正文</p>')).toBe(true)
  })

  it('escapes HTML-special text when hasHtml is false', () => {
    const html = formatTextWithDefaultStyles('<b>x</b>', baseChar, basePara, opts)
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })

  it('keeps raw markup when hasHtml is true', () => {
    const html = formatTextWithDefaultStyles('<b>x</b>', baseChar, basePara, opts, true)
    expect(html).toContain('<b>x</b>')
  })

  it('honors headingLevel and pageBreakBefore markers', () => {
    const html = formatTextWithDefaultStyles('标题', baseChar, { ...basePara, headingLevel: 2, pageBreakBefore: true }, opts)
    expect(html).toContain('page-break-before: always')
    expect(html).toContain('<h2 style=')
    expect(html.endsWith('</h2>')).toBe(true)
  })

  it('toggles hidden text via the injected boolean snapshot', () => {
    const charFormat = { ...baseChar, hidden: true }
    const hiddenOff = formatTextWithDefaultStyles('密', charFormat, basePara, { ...opts, showHiddenText: false })
    expect(hiddenOff).toContain('display: none')
    const hiddenOn = formatTextWithDefaultStyles('密', charFormat, basePara, { ...opts, showHiddenText: true })
    expect(hiddenOn).toContain('border-bottom: 1px dotted')
    expect(hiddenOn).not.toContain('display: none')
  })

  it('renders the full character-format branch matrix', () => {
    const charFormat: CharacterFormat = {
      italic: true, underline: true, strikethrough: true,
      color: '#123456', highlight: '#fedcba',
      superscript: true, subscript: true,
      smallCaps: true, allCaps: true, outline: true, shadow: true,
      letterSpacing: 1.5,
    }
    const html = formatTextWithDefaultStyles('x', charFormat, basePara, opts)
    expect(html).toContain('font-style: italic')
    expect(html).toContain('text-decoration: underline line-through')
    expect(html).toContain('color: #123456')
    expect(html).toContain('background-color: #fedcba')
    expect(html).toContain('vertical-align: super')
    expect(html).toContain('vertical-align: sub')
    expect(html).toContain('font-variant: small-caps')
    expect(html).toContain('text-transform: uppercase')
    expect(html).toContain('text-shadow: 1px 0 0 currentColor')
    expect(html).toContain('text-shadow: 2px 2px 2px')
    expect(html).toContain('letter-spacing: 1.5pt')
    // letterSpacing === 0 不应产生声明（0/undefined 双守卫）
    expect(formatTextWithDefaultStyles('x', { letterSpacing: 0 }, basePara, opts)).not.toContain('letter-spacing')
  })

  it('renders the full paragraph-format box-model branches', () => {
    const paraFormat: ParagraphFormat = {
      lineSpacing: 1.5, spaceBefore: 6, spaceAfter: 12,
      indent: 24, rightIndent: 18, firstLineIndent: 12,
      backgroundColor: '#EEEEEE',
      borders: { top: { borderType: 1 }, right: { borderType: 4, lineWidth: 16 } },
    }
    const html = formatTextWithDefaultStyles('x', baseChar, paraFormat, opts)
    expect(html).toContain('line-height: 1.5')
    expect(html).toContain('margin-top: 6pt')
    expect(html).toContain('margin-bottom: 12pt')
    expect(html).toContain('margin-left: 24pt')
    expect(html).toContain('margin-right: 18pt')
    expect(html).toContain('text-indent: 12pt')
    expect(html).toContain('background-color: #EEEEEE')
    expect(html).toContain('border-top: 1pt solid #000000')
    expect(html).toContain('border-right: 2pt double #000000')
    expect(html).not.toContain('border-bottom:')
  })
})

describe('formatTextWithCharacterStyles', () => {
  const makeOpts = (over: Partial<{ showHiddenText: boolean }> = {}) => ({
    isCentered: false,
    isRightAligned: false,
    charFormat: { fontSize: 16 } as CharacterFormat,
    paraFormat: basePara,
    showHiddenText: false,
    fontResolver,
    ...over,
  })

  it('renders per-segment spans when coverage >= 80%', () => {
    const styles: CharStyleSegment[] = [
      { start: 0, end: 4, style: { underline: true, color: '#FF0000', fontName: '楷体' } },
    ]
    const html = formatTextWithCharacterStyles('abcd', styles, makeOpts())
    // 无间隙、全覆盖 → 单段 span；p 标签包裹
    expect(html).toContain('<span style="font-family: WEB(楷体), ')
    expect(html).toContain('text-decoration: underline')
    expect(html).toContain('color: #FF0000')
    expect(html.endsWith('</p>')).toBe(true)
  })

  it('falls back to default styles when coverage < 80%', () => {
    const styles: CharStyleSegment[] = [
      { start: 0, end: 1, style: { italic: true } },
    ]
    const merged = formatTextWithCharacterStyles('abcdef', styles, makeOpts())
    const direct = formatTextWithDefaultStyles('abcdef', makeOpts().charFormat, basePara, {
      isCentered: false, isRightAligned: false,
      showHiddenText: makeOpts().showHiddenText, fontResolver,
    })
    expect(merged).toBe(direct)
  })

  it('applies vertical-align / caps / letter-spacing hooks to segments', () => {
    const styles: CharStyleSegment[] = [
      { start: 0, end: 2, style: { superscript: true } },
      { start: 2, end: 4, style: { subscript: true, smallCaps: true, allCaps: true, letterSpacing: 2 } },
    ]
    const html = formatTextWithCharacterStyles('abcd', styles, makeOpts())
    expect(html).toContain('vertical-align: super')
    expect(html).toContain('vertical-align: sub')
    expect(html).toContain('font-variant: small-caps')
    expect(html).toContain('text-transform: uppercase')
    expect(html).toContain('letter-spacing: 2pt')
  })

  it('escapes inter-segment gaps unless hasHtml', () => {
    // 文本长 7、覆盖 [0,6) → 85.7% ≥ 80% 进入 span 路径；'< ' 位于段内被转义，尾字符 'g' 为间隙
    const styles: CharStyleSegment[] = [{ start: 0, end: 6, style: {} }]
    const plain = formatTextWithCharacterStyles('abcd<fg', styles, makeOpts())
    expect(plain).toContain('&lt;')
    const raw = formatTextWithCharacterStyles('abcd<fg', styles, makeOpts(), true)
    expect(raw).toContain('<f')
    expect(raw).not.toContain('&lt;')
  })

  it('keeps raw revision/link markup when hasHtml is true (hasHtml propagation)', () => {
    const styles: CharStyleSegment[] = [{ start: 0, end: 6, style: {} }]
    const html = formatTextWithCharacterStyles('<ins>修订</ins>', styles, makeOpts(), true)
    expect(html).toContain('<ins>修订</ins>')
    expect(html).not.toContain('&lt;ins&gt;')
  })

  it('applies segment-level italic/strike/highlight/outline/shadow/hidden branches', () => {
    const styles: CharStyleSegment[] = [
      { start: 0, end: 2, style: { italic: true, strikethrough: true, highlight: '#0F0' } },
      { start: 2, end: 4, style: { outline: true, shadow: true } },
      { start: 4, end: 6, style: { hidden: true } },
    ]
    const off = formatTextWithCharacterStyles('abcdef', styles, makeOpts())
    expect(off).toContain('font-style: italic')
    expect(off).toContain('text-decoration: line-through')
    expect(off).toContain('background-color: #0F0')
    expect(off).toContain('text-shadow: 1px 0 0 currentColor')
    expect(off).toContain('text-shadow: 2px 2px 2px')
    expect(off).toContain('display: none')
    const on = formatTextWithCharacterStyles('abcdef', styles, makeOpts({ showHiddenText: true }))
    expect(on).toContain('border-bottom: 1px dotted')
  })

  it('composes paragraph-level css, tabs fallback and heading/page-break on the span path', () => {
    const styles: CharStyleSegment[] = [{ start: 0, end: 5, style: {} }]
    const paraFormat: ParagraphFormat = {
      lineSpacing: 2, spaceBefore: 4, spaceAfter: 8,
      indent: 10, rightIndent: 5, firstLineIndent: 20,
      backgroundColor: '#111',
      borders: { left: { borderType: 2, lineWidth: 8 }, bottom: { borderType: 0 } },
      headingLevel: 3, pageBreakBefore: true,
    }
    // 含 \t 且无自定义 tabs → CSS tab-size 回退包装
    const html = formatTextWithCharacterStyles('a\tbcd', styles, { ...makeOpts(), paraFormat })
    expect(html).toContain('line-height: 2')
    expect(html).toContain('margin-top: 4pt')
    expect(html).toContain('margin-bottom: 8pt')
    expect(html).toContain('margin-left: 10pt')
    expect(html).toContain('margin-right: 5pt')
    expect(html).toContain('text-indent: 20pt')
    expect(html).toContain('background-color: #111')
    expect(html).toContain('border-left: 1pt dotted #000000')
    expect(html).toContain('padding: 4px')
    expect(html).toContain('<h3 style=')
    expect(html).toContain('page-break-before: always')
    expect(html).toContain('tab-size: 3')
    // 有自定义 tabs 时不套 CSS 回退（走 applyTabStops 度量路径由 textRender 测试覆盖）
    const withTabs = formatTextWithCharacterStyles('a\tbcd', styles, {
      ...makeOpts(), paraFormat: { ...paraFormat, tabs: [{ position: 420, alignment: 'left' } as never] },
    })
    expect(withTabs).not.toContain('tab-size: 3')
  })
})
