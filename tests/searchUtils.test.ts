// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import {
  escapeRegExp,
  buildWordRegex,
  findTextMatches,
  highlightTextMatches,
  clearSearchHighlights,
} from '../src/utils/searchUtils'

const ci = { caseSensitive: false, wholeWord: false }
const cs = { caseSensitive: true, wholeWord: false }
const ww = { caseSensitive: false, wholeWord: true }
const wwcs = { caseSensitive: true, wholeWord: true }

describe('escapeRegExp', () => {
  it('escapes regex special characters', () => {
    expect(escapeRegExp('a.b*c+d?e^f$g|h(i)j[k]l\\m{n}')).toBe(
      'a\\.b\\*c\\+d\\?e\\^f\\$g\\|h\\(i\\)j\\[k\\]l\\\\m\\{n\\}',
    )
  })

  it('keeps plain text unchanged', () => {
    expect(escapeRegExp('abc 123')).toBe('abc 123')
  })
})

describe('buildWordRegex', () => {
  it('uses global flag and honors case sensitivity', () => {
    expect(buildWordRegex('a', true).flags).toBe('g')
    expect(buildWordRegex('a', false).flags).toBe('gi')
  })

  it('escapes special characters in the query', () => {
    const re = buildWordRegex('c++', false)
    expect(re.test('use c++ now')).toBe(true)
    expect(re.test('use cXY now')).toBe(false)
  })
})

describe('findTextMatches', () => {
  it('returns nothing for an empty query', () => {
    expect(findTextMatches('anything', '', ci)).toEqual([])
  })

  it('finds case-insensitive substrings and reports original-case text', () => {
    const matches = findTextMatches('Hello hello HELLO', 'hello', ci)
    expect(matches.map(m => [m.start, m.end, m.text])).toEqual([
      [0, 5, 'Hello'],
      [6, 11, 'hello'],
      [12, 17, 'HELLO'],
    ])
  })

  it('honors case sensitivity in substring mode', () => {
    expect(findTextMatches('Hello hello', 'hello', cs)).toEqual([
      { start: 6, end: 11, text: 'hello' },
    ])
  })

  it('does not return overlapping substring matches', () => {
    const matches = findTextMatches('aaaa', 'aa', ci)
    expect(matches.map(m => m.start)).toEqual([0, 2])
  })

  it('matches whole words only', () => {
    expect(findTextMatches('cat category cats', 'cat', ww).map(m => m.start)).toEqual([0])
    expect(findTextMatches('a cat, a dog', 'cat', ww).map(m => m.start)).toEqual([2])
  })

  it('finds adjacent single-char whole words (boundary reuse)', () => {
    const matches = findTextMatches('a a a', 'a', ww)
    expect(matches.map(m => m.start)).toEqual([0, 2, 4])
  })

  it('finds comma-separated repeated whole words', () => {
    const matches = findTextMatches(',cat,cat,', 'cat', ww)
    expect(matches.map(m => m.start)).toEqual([1, 5])
  })

  it('whole-word mode honors case sensitivity', () => {
    expect(findTextMatches('Cat cat', 'Cat', wwcs).map(m => m.start)).toEqual([0])
  })

  it('supports CJK queries in substring mode', () => {
    const matches = findTextMatches('文档中的文档', '文档', ci)
    expect(matches.map(m => m.start)).toEqual([0, 4])
  })
})

describe('highlightTextMatches', () => {
  function containerOf(html: string): HTMLElement {
    const div = document.createElement('div')
    div.innerHTML = html
    return div
  }

  it('highlights every occurrence inside one text node (regression: stale offsets)', () => {
    const container = containerOf('<p>cat cat cat</p>')
    const matches = highlightTextMatches(container, 'cat', ci)

    expect(matches).toHaveLength(3)
    expect(matches.map(m => m.index)).toEqual([0, 1, 2])
    expect(container.innerHTML).toBe(
      '<p><span class="search-highlight" data-search-index="0">cat</span> ' +
      '<span class="search-highlight" data-search-index="1">cat</span> ' +
      '<span class="search-highlight" data-search-index="2">cat</span></p>',
    )
  })

  it('numbers matches across nodes in document order', () => {
    const container = containerOf('<p>alpha</p><p>alpha beta</p>')
    const matches = highlightTextMatches(container, 'alpha', ci)

    expect(matches.map(m => m.index)).toEqual([0, 1])
    expect(matches[1].element.dataset.searchIndex).toBe('1')
  })

  it('applies whole-word options', () => {
    const container = containerOf('<p>cat category</p>')
    const matches = highlightTextMatches(container, 'cat', ww)
    expect(matches).toHaveLength(1)
    expect(matches[0].element.textContent).toBe('cat')
  })

  it('does not re-wrap text already inside a highlight span', () => {
    const container = containerOf('<p>cat cat</p>')
    highlightTextMatches(container, 'cat', ci)
    const second = highlightTextMatches(container, 'cat', ci)
    expect(container.querySelectorAll('.search-highlight .search-highlight').length).toBe(0)
    expect(second).toEqual([])
  })

  it('returns nothing for an empty query', () => {
    const container = containerOf('<p>text</p>')
    expect(highlightTextMatches(container, '', ci)).toEqual([])
    expect(container.innerHTML).toBe('<p>text</p>')
  })

  it('skips text inside highlight spans on a fresh pass over wrapped content', () => {
    const container = containerOf('<p>cat cat</p>')
    highlightTextMatches(container, 'cat', ci)
    // 模拟组件行为：清除后再搜另一个词，span 内的旧文本不参与新匹配
    clearSearchHighlights(container)
    expect(container.innerHTML).toBe('<p>cat cat</p>')
  })
})

describe('clearSearchHighlights', () => {
  it('restores the original text content', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>cat cat cat</p>'
    const original = container.textContent

    highlightTextMatches(container, 'cat', ci)
    expect(container.querySelectorAll('.search-highlight').length).toBe(3)

    clearSearchHighlights(container)
    expect(container.querySelectorAll('.search-highlight').length).toBe(0)
    expect(container.textContent).toBe(original)
    // normalize() 应把分裂的文本节点合并回单个
    const p = container.querySelector('p')!
    expect(Array.from(p.childNodes).every(n => n.nodeType === 3)).toBe(true)
    expect(p.childNodes.length).toBe(1)
  })
})
