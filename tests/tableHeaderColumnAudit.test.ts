// @vitest-environment happy-dom
/**
 * 表格表头列数契约（Phase 3 / 任务 A 渲染正确性审查）。
 *
 * `renderTableHtml` 在没有 TableInfo 的表头行上用启发式把「末个非空单元格」
 * 以 colspan 延伸到行尾。该延伸覆盖的列不得再被单独渲染成 <th>，否则表头
 * 实际列数会超过表格列数（colspan 列数错位），浏览器会把后续正文列整体右移。
 */
import { describe, it, expect } from 'vitest'
import { collectTableBlock, renderTableHtml } from '../src/utils/tableText'
import type { RenderParagraph } from '../src/utils/docFormat'

/** 表头行所有 <th> 的 colspan 之和（无 colspan 按 1 列计）。 */
function theadColumnSpan(html: string): number {
  const thead = /<thead>([\s\S]*?)<\/thead>/.exec(html)?.[1] ?? ''
  let span = 0
  for (const match of thead.matchAll(/<th\b[^>]*>/g)) {
    const cm = /\bcolspan="(\d+)"/.exec(match[0])
    span += cm ? Number(cm[1]) : 1
  }
  return span
}

const rp = (text: string): RenderParagraph => ({ text, charFormat: {}, paraFormat: {} })

describe('renderTableHtml header colspan column-count contract', () => {
  it('does not double-count empty cells after the colspan-extended header cell', () => {
    // ['A','','B',''] → B 以 colspan=2 覆盖第 3、4 列；第 4 列不得再有独立 <th>。
    const html = renderTableHtml([['A', '', 'B', ''], ['W', 'X', 'Y', 'Z']], undefined, 1)
    expect(theadColumnSpan(html)).toBe(4)
  })

  it('keeps a 2-nonempty sparse header within the column count', () => {
    // ['A','B','',''] → B 以 colspan=3 覆盖第 2–4 列；其后不得再有空 <th>。
    const html = renderTableHtml([['A', 'B', '', ''], ['W', 'X', 'Y', 'Z']], undefined, 1)
    expect(theadColumnSpan(html)).toBe(4)
  })

  it('keeps full and single-title headers within the column count (guard)', () => {
    expect(theadColumnSpan(renderTableHtml([['A', 'B', 'C'], ['a', 'b', 'c']], undefined, 1))).toBe(3)
    expect(theadColumnSpan(renderTableHtml([['Title', '', ''], ['a', 'b', 'c']], undefined, 1))).toBe(3)
  })

  it('emits exactly one thead and refuses empty / non-row blocks (guard)', () => {
    const html = renderTableHtml([['A', 'B'], ['a', 'b'], ['c', 'd']], undefined, 1)
    expect((html.match(/<thead>/g) || []).length).toBe(1)
    expect((html.match(/<\/thead>/g) || []).length).toBe(1)
    expect(collectTableBlock([rp('plain text')], 0)).toBeNull()
    expect(collectTableBlock([], 0)).toBeNull()
    expect(renderTableHtml([])).toBe('')
  })
})
