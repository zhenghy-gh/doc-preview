// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { renderDocumentToPages, sanitizeUrl, type RenderInput } from '../src/utils/rendering/documentRenderer'
import type { RenderParagraph } from '../src/utils/docFormat'

const t = (key: string) => key
const fontResolver = () => ''

function baseInput(paragraphs: RenderParagraph[], hyperlinks: RenderInput['hyperlinks'] = []): RenderInput {
  return {
    paragraphs,
    hyperlinks,
    revisions: [],
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
})
