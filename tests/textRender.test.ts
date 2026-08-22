// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { escapeHtml, applyTabStops, formatTextWithInferredFormat } from '../src/utils/textRender'

describe('escapeHtml', () => {
  it('escapes the five special characters', () => {
    // happy-dom 的 innerHTML 转义 & < > 但不转义引号
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href="x"&gt;&amp;\'&lt;/a&gt;')
  })

  it('keeps plain text unchanged', () => {
    expect(escapeHtml('普通 text 123')).toBe('普通 text 123')
  })
})

describe('applyTabStops', () => {
  // happy-dom 的 canvas 2d context 为 null，宽度走估算分支：len * fontSize * 0.55

  it('returns escaped text when no tab is present', () => {
    expect(applyTabStops('a<b>', undefined, 12, '宋体')).toBe('a&lt;b&gt;')
  })

  it('returns raw text as-is when hasHtml and no tab', () => {
    expect(applyTabStops('<b>x</b>', undefined, 12, '宋体', true)).toBe('<b>x</b>')
  })

  it('renders a tab-size span without custom tab stops', () => {
    const html = applyTabStops('a\tb', undefined, 12, '宋体')
    expect(html).toBe('<span style="white-space: pre; tab-size: 3;">a\tb</span>')
  })

  it('renders a tab-size span with an empty tabs array too', () => {
    const html = applyTabStops('a\tb', [], 18, '宋体')
    expect(html).toContain('tab-size: 2;')
  })

  it('jumps to the next custom tab stop', () => {
    // "a" 宽 1*10*0.55=5.5pt → 下一制表位 50pt → gap 44.5pt
    const html = applyTabStops('a\tb', [50], 10, '宋体')
    expect(html).toBe('a<span style="display: inline-block; width: 44.5pt;"></span>b')
  })

  it('sorts tab stops before walking', () => {
    const html = applyTabStops('a\tb', [200, 50], 10, '宋体')
    expect(html).toBe('a<span style="display: inline-block; width: 44.5pt;"></span>b')
  })

  it('skips tab stops already passed and extends past the last one by default intervals', () => {
    // "aaaaaaaa" 宽 8*10*0.55=44pt，唯一制表位 30 已过 → 30+ceil(14/36)*36=66 → gap 22pt
    const html = applyTabStops('aaaaaaaa\tb', [30], 10, '宋体')
    expect(html).toBe('aaaaaaaa<span style="display: inline-block; width: 22pt;"></span>b')
  })

  it('handles consecutive tabs by advancing one stop each', () => {
    // "a"=5.5pt → 50pt；空段=0 → 100pt
    const html = applyTabStops('a\t\tb', [50, 100], 10, '宋体')
    expect(html).toBe(
      'a<span style="display: inline-block; width: 44.5pt;"></span>' +
      '<span style="display: inline-block; width: 50pt;"></span>b',
    )
  })

  it('keeps HTML segments unescaped when hasHtml is set', () => {
    const html = applyTabStops('<i>a</i>\t<i>b</i>', [50], 10, '宋体', true)
    // 段 "<i>a</i>" 共 8 字符 → 8*10*0.55=44pt → gap 6pt
    expect(html).toBe('<i>a</i><span style="display: inline-block; width: 6pt;"></span><i>b</i>')
  })
})

describe('formatTextWithInferredFormat', () => {
  it('wraps whitespace-only input in a single paragraph', () => {
    const html = formatTextWithInferredFormat('')
    expect(html).toBe(`<p style="font-family:'宋体',serif;font-size:1.0rem"></p>`)
  })

  it('renders short CJK lines as centered bold headings', () => {
    const html = formatTextWithInferredFormat('文档标题')
    expect(html).toContain('<h1 ')
    expect(html).toContain('text-align:center')
    expect(html).toContain('文档标题')
  })

  it('renders long CJK text as justified paragraphs', () => {
    const html = formatTextWithInferredFormat('这是一段足够长的中文正文内容，用来触发正文段落渲染而不是标题渲染。')
    expect(html).toContain('<p ')
    expect(html).toContain('text-align:justify')
  })

  it('renders English text as paragraphs', () => {
    const html = formatTextWithInferredFormat('This is a plain English paragraph.')
    expect(html).toContain('<p ')
    expect(html).toContain('This is a plain English paragraph.')
  })

  it('groups consecutive tab-separated lines into a table', () => {
    const html = formatTextWithInferredFormat('a\tb\nc\td')
    expect(html).toContain('<table')
    expect(html).toContain('>a</td>')
    expect(html).toContain('>d</td>')
  })

  it('does not treat a single tab line as a table', () => {
    const html = formatTextWithInferredFormat('only\tline')
    expect(html).not.toContain('<table')
  })

  it('escapes HTML in content', () => {
    const html = formatTextWithInferredFormat('This <b>bold</b> marker should be escaped.')
    expect(html).toContain('&lt;b&gt;')
  })

  it('injects the web font prefix via the resolver', () => {
    const html = formatTextWithInferredFormat('标题', () => 'Noto Serif SC, ')
    expect(html).toContain("font-family:Noto Serif SC, '宋体',serif")
  })

  it('mixes headings, tables and paragraphs in one document', () => {
    const html = formatTextWithInferredFormat('总标题\na\tb\nc\td\n这是一段足够长的正文段落内容用于测试混合渲染。')
    expect(html).toContain('<h1 ')
    expect(html).toContain('<table')
    expect(html).toContain('<p ')
  })
})
