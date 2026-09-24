// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import {
  escapeMdText,
  convertInlineToMd,
  getTableColCount,
  convertTableToMd,
  convertListToMd,
  convertBlockToMd,
  htmlToMarkdown,
} from '../src/utils/markdownExport'

function el(html: string): HTMLElement {
  const container = document.createElement('div')
  container.innerHTML = html.trim()
  return container.firstElementChild as HTMLElement
}

describe('escapeMdText', () => {
  it('escapes markdown special characters', () => {
    expect(escapeMdText('a*b_c`d[e]f')).toBe('a\\*b\\_c\\`d\\[e\\]f')
  })

  it('leaves plain text untouched', () => {
    expect(escapeMdText('普通文本 123')).toBe('普通文本 123')
  })
})

describe('convertInlineToMd', () => {
  it('escapes text nodes', () => {
    const node = document.createTextNode('a_b')
    expect(convertInlineToMd(node)).toBe('a\\_b')
  })

  it('returns empty for non-element non-text nodes', () => {
    const comment = document.createComment('x')
    expect(convertInlineToMd(comment)).toBe('')
  })

  it('maps emphasis tags', () => {
    expect(convertInlineToMd(el('<strong>bold</strong>'))).toBe('**bold**')
    expect(convertInlineToMd(el('<b>bold</b>'))).toBe('**bold**')
    expect(convertInlineToMd(el('<em>it</em>'))).toBe('*it*')
    expect(convertInlineToMd(el('<i>it</i>'))).toBe('*it*')
    expect(convertInlineToMd(el('<s>del</s>'))).toBe('~~del~~')
    expect(convertInlineToMd(el('<del>del</del>'))).toBe('~~del~~')
    expect(convertInlineToMd(el('<strike>del</strike>'))).toBe('~~del~~')
  })

  it('drops underline, keeps inner text', () => {
    expect(convertInlineToMd(el('<u>kept</u>'))).toBe('kept')
  })

  it('wraps code, sub, sup; converts br', () => {
    expect(convertInlineToMd(el('<code>x</code>'))).toBe('`x`')
    expect(convertInlineToMd(el('<sub>2</sub>'))).toBe('<sub>2</sub>')
    expect(convertInlineToMd(el('<sup>2</sup>'))).toBe('<sup>2</sup>')
    expect(convertInlineToMd(el('<br>'))).toBe('\n')
  })

  it('converts links and images', () => {
    expect(convertInlineToMd(el('<a href="https://x.com">go</a>'))).toBe('[go](https://x.com)')
    expect(convertInlineToMd(el('<a>no-href</a>'))).toBe('[no-href]()')
    expect(convertInlineToMd(el('<img src="a.png" alt="pic">'))).toBe('![pic](a.png)')
  })

  it('filters unsafe destinations and escapes markdown delimiters', () => {
    expect(convertInlineToMd(el('<a href="javascript:alert(1)">run</a>'))).toBe('run')
    expect(convertInlineToMd(el('<img src="data:text/html,alert(1)" alt="bad">'))).toBe('')
    expect(convertInlineToMd(el('<img src="data:image/svg+xml,<svg/onload=alert(1)>" alt="svg">'))).toBe('')
    expect(convertInlineToMd(el('<a href="https://x/a)b">safe</a>'))).toBe('[safe](https://x/a\\)b)')
    expect(convertInlineToMd(el('<a href="/docs/a\\b">relative</a>'))).toBe('[relative](/docs/a\\\\b)')
    expect(convertInlineToMd(el('<img alt="pic">'))).toBe('')
    expect(convertInlineToMd(el('<mark>marked</mark>'))).toBe('marked')
  })


  it('unwraps span/font containers', () => {
    expect(convertInlineToMd(el('<span><font>s</font></span>'))).toBe('s')
  })

  it('handles nested inline markup', () => {
    expect(convertInlineToMd(el('<strong>a<em>b</em></strong>'))).toBe('**a*b***')
  })
})

describe('getTableColCount', () => {
  it('returns 1 for an empty table', () => {
    expect(getTableColCount(el('<table></table>') as HTMLTableElement)).toBe(1)
  })

  it('sums colspan attributes per row and takes the max', () => {
    const table = el(`<table>
      <tr><td>a</td><td colspan="2">b</td></tr>
      <tr><td>a</td><td>b</td><td>c</td><td>d</td></tr>
    </table>`) as HTMLTableElement
    expect(getTableColCount(table)).toBe(4)
  })
  it('normalizes invalid colspan values to one column', () => {
    const table = el(`<table>
      <tr><td colspan="0">zero</td><td colspan="-2">negative</td><td colspan="nope">text</td></tr>
    </table>`) as HTMLTableElement
    expect(getTableColCount(table)).toBe(3)
    expect(convertTableToMd(table)).toContain('| zero | negative | text |')
  })
})

describe('convertTableToMd', () => {
  it('returns empty string for a table without rows', () => {
    expect(convertTableToMd(el('<table></table>') as HTMLTableElement)).toBe('')
  })

  it('emits separator right after a th header row', () => {
    const table = el(`<table>
      <tr><th>H1</th><th>H2</th></tr>
      <tr><td>a</td><td>b</td></tr>
    </table>`) as HTMLTableElement
    expect(convertTableToMd(table)).toBe(
      [
        '| H1 | H2 |',
        '| --- | --- |',
        '| a | b |',
      ].join('\n'),
    )
  })

  it('inserts a separator after the first row when no th exists', () => {
    const table = el(`<table>
      <tr><td>a</td><td>b</td></tr>
      <tr><td>c</td><td>d</td></tr>
    </table>`) as HTMLTableElement
    expect(convertTableToMd(table)).toBe(
      [
        '| a | b |',
        '| --- | --- |',
        '| c | d |',
      ].join('\n'),
    )
  })

  it('expands colspan cells and pads short rows to the widest row', () => {
    const table = el(`<table>
      <tr><th>H1</th><th>H2</th><th>H3</th></tr>
      <tr><td colspan="2">wide</td></tr>
    </table>`) as HTMLTableElement
    expect(convertTableToMd(table)).toBe(
      [
        '| H1 | H2 | H3 |',
        '| --- | --- | --- |',
        '| wide |  |  |',
      ].join('\n'),
    )
  })
})

describe('convertListToMd', () => {
  it('renders unordered items with dashes', () => {
    const list = el('<ul><li>a</li><li>b</li></ul>')
    expect(convertListToMd(list)).toEqual(['- a', '- b'])
  })

  it('numbers ordered items sequentially', () => {
    const list = el('<ol><li>a</li><li>b</li></ol>')
    expect(convertListToMd(list)).toEqual(['1. a', '2. b'])
  })

  it('preserves a valid ordered-list start value and normalizes invalid values', () => {
    expect(convertListToMd(el('<ol start="4"><li>a</li><li>b</li></ol>'))).toEqual(['4. a', '5. b'])
    expect(convertListToMd(el('<ol start="0"><li>a</li></ol>'))).toEqual(['1. a'])
  })
  it('skips non-li children', () => {
    const list = el('<ul><li>a</li><p>stray</p></ul>')
    expect(convertListToMd(list)).toEqual(['- a'])
  })

  it('indents nested lists and unwraps p in li', () => {
    const list = el(`<ul>
      <li><p>top</p>
        <ul><li>inner</li></ul>
      </li>
    </ul>`)
    expect(convertListToMd(list)).toEqual(['- top', '  - inner'])
  })
})

describe('convertBlockToMd', () => {
  it('maps headings h1-h6', () => {
    expect(convertBlockToMd(el('<h1>A</h1>'))).toBe('# A')
    expect(convertBlockToMd(el('<h2>A</h2>'))).toBe('## A')
    expect(convertBlockToMd(el('<h3>A</h3>'))).toBe('### A')
    expect(convertBlockToMd(el('<h4>A</h4>'))).toBe('#### A')
    expect(convertBlockToMd(el('<h5>A</h5>'))).toBe('##### A')
    expect(convertBlockToMd(el('<h6>A</h6>'))).toBe('###### A')
  })

  it('keeps paragraph text and drops empty ones', () => {
    expect(convertBlockToMd(el('<p>hi</p>'))).toBe('hi')
    expect(convertBlockToMd(el('<p></p>'))).toBe('')
  })

  it('prefixes blockquote lines with >', () => {
    const node = el('<blockquote><p>a</p><p>b</p></blockquote>')
    expect(convertBlockToMd(node)).toBe('> a\n> b')
  })

  it('renders pre>code with the language class', () => {
    expect(convertBlockToMd(el('<pre><code class="language-ts">let x\n</code></pre>'))).toBe(
      '```ts\nlet x\n```',
    )
  })

  it('renders pre without code from raw text', () => {
    expect(convertBlockToMd(el('<pre>raw\n</pre>'))).toBe('```\nraw\n```')
  })

  it('renders hr and skips br', () => {
    expect(convertBlockToMd(el('<hr>'))).toBe('---')
    expect(convertBlockToMd(el('<br>'))).toBe('')
  })

  it('joins page-content children with blank lines, plain div with single newlines', () => {
    const page = el('<div class="page-content"><p>a</p><p>b</p></div>')
    expect(convertBlockToMd(page)).toBe('a\n\nb')
    const plain = el('<div><p>a</p><p>b</p></div>')
    expect(convertBlockToMd(plain)).toBe('a\nb')
  })

  it('keeps non-empty text nodes and drops whitespace-only ones', () => {
    const container = document.createElement('div')
    container.append(document.createTextNode('keep me'))
    expect(convertBlockToMd(container.childNodes[0])).toBe('keep me')
    expect(convertBlockToMd(document.createTextNode('   '))).toBe('')
  })

  it('returns empty for non-element non-text nodes', () => {
    expect(convertBlockToMd(document.createComment('x'))).toBe('')
  })

  it('falls back to inline conversion for unknown block tags', () => {
    expect(convertBlockToMd(el('<section><strong>s</strong></section>'))).toBe('**s**')
  })
})

describe('htmlToMarkdown', () => {
  it('walks every .page-content container and joins blocks with blank lines', () => {
    const html = [
      `<div class="page-content"><h1>Title</h1><p>First</p></div>`,
      `<div class="page-content"><p>Second</p></div>`,
    ].join('\n')
    expect(htmlToMarkdown(html)).toBe('# Title\n\nFirst\n\nSecond')
  })

  it('falls back to root children when no .page-content exists (plain-text path)', () => {
    const html = '<p>a</p><table><tr><th>H</th></tr><tr><td>1</td></tr></table>'
    expect(htmlToMarkdown(html)).toBe('a\n\n| H |\n| --- |\n| 1 |')
  })

  it('returns empty string for empty input', () => {
    expect(htmlToMarkdown('')).toBe('')
  })
})
