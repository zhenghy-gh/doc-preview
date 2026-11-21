// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { renderDocumentToPages, sanitizeUrl, type RenderInput } from '../src/utils/rendering/documentRenderer'
import type { RenderParagraph } from '../src/utils/docFormat'

const t = (key: string) => key
const fontResolver = () => ''

function baseInput(paragraphs: RenderParagraph[], hyperlinks: RenderInput['hyperlinks'] = [], revisions: RenderInput['revisions'] = []): RenderInput {
  return {
    paragraphs,
    hyperlinks,
    revisions,
    revisionMode: 'marks',
    shapes: [],
    pictures: [],
    images: [],
    charts: [],
    sections: [],
    pageHeightPt: 842,
    showHiddenText: false,
    fontResolver,
    t,
  }
}

describe('sanitizeUrl', () => {
  it('keeps safe schemes, relative URLs and anchors', () => {
    for (const url of [
      'https://example.com/a?b=1&c=2',
      'http://example.com',
      'mailto:a@b.com',
      'tel:+123',
      '#section-2',
      'docs/readme.html',
      '/absolute/path',
    ]) {
      expect(sanitizeUrl(url), url).toBe(url)
    }
  })

  it('rejects executable schemes, including obfuscated forms', () => {
    for (const url of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:MsgBox(1)',
      'file:///etc/passwd',
      'javascript&colon;alert(1)',
      'java&#x73;cript:alert(1)',
      'j&#97;vascript:alert(1)',
    ]) {
      expect(sanitizeUrl(url), url).toBe('#')
    }
  })

  it('degrades empty input to #', () => {
    expect(sanitizeUrl('')).toBe('#')
    expect(sanitizeUrl('   ')).toBe('#')
  })
})

describe('inline picture src escaping', () => {
  it('escapes quotes in image URLs so they cannot break out of the src attribute', () => {
    const malicious = 'data:image/png;base64,AA" onerror="alert(1)'
    const paragraphs: RenderParagraph[] = [{
      text: '\u0001',
      charFormat: {},
      paraFormat: {},
      _cpStart: 0,
      _cpEnd: 1,
    }]
    const html = renderDocumentToPages({
      ...baseInput(paragraphs),
      pictures: [{ format: 'png', dataUrl: malicious }],
    }).join('\n')
    expect(html).toContain('onerror=&quot;alert(1)')
    expect(html).not.toMatch(/<img[^>]+onerror="alert/)
  })
})

describe('renderDocumentToPages hyperlink safety', () => {
  it('never emits an executable href for a malicious HYPERLINK field', () => {
    const paragraphs: RenderParagraph[] = [{
      text: 'click here',
      charFormat: {},
      paraFormat: {},
      _cpStart: 0,
      _cpEnd: 10,
    }]
    const hyperlinks = [{
      cpStart: 0,
      cpEnd: 10,
      result: 'click here',
      url: 'javascript:alert(1)',
    }] as RenderInput['hyperlinks']
    const html = renderDocumentToPages(baseInput(paragraphs, hyperlinks)).join('\n')
    expect(html).toContain('<a href="#"')
    expect(html).not.toMatch(/href="(?:javascript|data|vbscript|file):/i)
    expect(html).toContain('click here')
  })

  // SEC-REGRESSION：有链接的段落里，链接文字之外的普通正文也必须转义。
  // 旧实现只 escape 链接文字、把 before/after 原样拼进「已可信 HTML」，
  // 导致 .doc 正文的 <img onerror> 穿过 hasHtml=true 进入 v-html（存储型 XSS）。
  it('escapes raw text around a hyperlink (no stored XSS via non-link span)', () => {
    const text = '<img src=x onerror=alert(1)>CLICK<script>alert(2)</script>'
    const paragraphs: RenderParagraph[] = [{ text, charFormat: {}, paraFormat: {}, _cpStart: 0, _cpEnd: text.length }]
    const hyperlinks = [{ cpStart: 29, cpEnd: 34, result: 'CLICK', url: 'https://example.com' }] as RenderInput['hyperlinks']
    const html = renderDocumentToPages(baseInput(paragraphs, hyperlinks)).join('\n')
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script>alert(2)</script>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('CLICK</a>')
  })

  it('escapes every plain-text gap when a paragraph has multiple hyperlinks', () => {
    const text = '<b>A</b>LINK1<i>X</i>LINK2<b>Z</b>'
    const paragraphs: RenderParagraph[] = [{ text, charFormat: {}, paraFormat: {}, _cpStart: 0, _cpEnd: text.length }]
    const hyperlinks = [
      { cpStart: 10, cpEnd: 15, result: 'LINK1', url: 'https://a.example' },
      { cpStart: 19, cpEnd: 24, result: 'LINK2', url: 'https://b.example' },
    ] as RenderInput['hyperlinks']
    const html = renderDocumentToPages(baseInput(paragraphs, hyperlinks)).join('\n')
    expect(html).not.toMatch(/<(?:b|i)>/)
    expect(html).toContain('&lt;b&gt;A&lt;/b&gt;')
    expect(html).toContain('&lt;i&gt;X&lt;/i&gt;')
    expect(html).toContain('>LINK1</a>')
    expect(html).toContain('>LINK2</a>')
  })
})

describe('renderDocumentToPages revision safety', () => {
  // SEC-REGRESSION：'marks' 模式生成 <ins>/<del> 后 hasHtml=true，
  // 非修订文本同样必须转义（与超链接路径同一类漏洞）。
  it('escapes raw text outside revision marks (no stored XSS)', () => {
    const text = '<img src=x onerror=alert(1)>REV'
    const paragraphs: RenderParagraph[] = [{ text, charFormat: {}, paraFormat: {}, _cpStart: 0, _cpEnd: text.length }]
    const revisions = [{ cpStart: 28, cpEnd: 31, type: 'insert' as const }] as RenderInput['revisions']
    const html = renderDocumentToPages(baseInput(paragraphs, [], revisions)).join('\n')
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('<ins class="rev-insert">REV</ins>')
  })

  it('escapes text both before and after a revision mark', () => {
    const text = '<script>A</script>REV<i>B</i>'
    const paragraphs: RenderParagraph[] = [{ text, charFormat: {}, paraFormat: {}, _cpStart: 0, _cpEnd: text.length }]
    const revisions = [{ cpStart: 18, cpEnd: 21, type: 'delete' as const }] as RenderInput['revisions']
    const html = renderDocumentToPages(baseInput(paragraphs, [], revisions)).join('\n')
    expect(html).not.toMatch(/<(?:script|i)>/)
    expect(html).toContain('&lt;script&gt;A&lt;/script&gt;')
    expect(html).toContain('&lt;i&gt;B&lt;/i&gt;')
    expect(html).toContain('<del class="rev-delete">REV</del>')
  })
})
