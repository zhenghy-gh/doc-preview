import { describe, it, expect } from 'vitest'
import { isTableRowText, isWordTableRow, renderTableHtml, renderNestedTableHtml, splitTableCells } from '../src/utils/tableText'

describe('tableText', () => {
  it('should split tab-delimited rows into cells', () => {
    expect(splitTableCells('A\tB\tC')).toEqual(['A', 'B', 'C'])
  })

  it('should reject rows with fewer than two non-empty cells', () => {
    expect(splitTableCells('OnlyOneCell')).toBeNull()
    expect(splitTableCells('A\t')).toBeNull()
  })

  it('should detect table-like rows', () => {
    expect(isTableRowText('Name\tAge')).toBe(true)
    expect(isTableRowText('Plain text')).toBe(false)
  })

  it('should render table html with escaped cells', () => {
    const html = renderTableHtml([
      ['Name', 'Age'],
      ['<Bob>', '42'],
    ])
    expect(html).toContain('<table')
    expect(html).toContain('</table>')
    expect(html).toContain('&lt;Bob&gt;')
    expect(html).toContain('Name')
    expect(html).toContain('Age')
  })

  describe('Word table cell marks (0x07)', () => {
    it('should split a Word table row by cell marks', () => {
      // "Name\u0007Age\u0007" — two cells terminated by 0x07
      expect(splitTableCells('Name\u0007Age\u0007')).toEqual(['Name', 'Age'])
    })

    it('should split a row with three cells', () => {
      expect(splitTableCells('A\u0007B\u0007C\u0007')).toEqual(['A', 'B', 'C'])
    })

    it('should detect Word table rows via isWordTableRow', () => {
      expect(isWordTableRow('Name\u0007Age\u0007')).toBe(true)
      expect(isWordTableRow('Plain text')).toBe(false)
    })

    it('should prefer cell marks over tabs when both are present', () => {
      // When 0x07 is present, tabs inside a cell should be preserved as
      // literal characters, not treated as separators.
      const cells = splitTableCells('A\tB\u0007C\u0007')
      expect(cells).toEqual(['A\tB', 'C'])
    })

    it('should reject a single-cell row with only one cell mark', () => {
      // Only one cell, no second cell mark — not a real table row.
      expect(splitTableCells('OnlyCell\u0007')).toBeNull()
    })

    it('should preserve empty cells in the middle of a row', () => {
      // "A\u0007\u0007C\u0007" — middle cell is empty
      expect(splitTableCells('A\u0007\u0007C\u0007')).toEqual(['A', '', 'C'])
    })

    it('should handle CJK cell content', () => {
      expect(splitTableCells('姓名\u0007年龄\u0007城市\u0007')).toEqual(['姓名', '年龄', '城市'])
      expect(isTableRowText('姓名\u0007年龄\u0007城市\u0007')).toBe(true)
    })
  })

  describe('Nested tables (renderNestedTableHtml)', () => {
    it('should fall back to flat rendering when no depth info', () => {
      const html = renderNestedTableHtml([
        ['A', 'B'],
        ['C', 'D'],
      ])
      expect(html).toContain('<table')
      expect(html).toContain('</table>')
      expect(html).toContain('<td')
      expect(html).toContain('A')
      expect(html).toContain('D')
    })

    it('should fall back to flat rendering when all depths are the same', () => {
      const html = renderNestedTableHtml(
        [
          ['A', 'B'],
          ['C', 'D'],
        ],
        undefined,
        [1, 1],
      )
      expect(html).toContain('<table')
      expect(html).toContain('A')
    })

    it('should render nested table inside parent cell when depth increases', () => {
      // Parent row depth=1, child row depth=2
      const html = renderNestedTableHtml(
        [
          ['Parent'],
          ['Child1', 'Child2'],
        ],
        undefined,
        [1, 2],
      )
      // Should contain two <table> elements (parent + nested)
      const tableCount = (html.match(/<table/g) || []).length
      expect(tableCount).toBe(2)
      // Parent cell should contain child table
      expect(html).toContain('Parent')
      expect(html).toContain('Child1')
      expect(html).toContain('Child2')
    })

    it('should handle three levels of nesting', () => {
      const html = renderNestedTableHtml(
        [
          ['L1'],
          ['L2'],
          ['L3'],
        ],
        undefined,
        [1, 2, 3],
      )
      const tableCount = (html.match(/<table/g) || []).length
      expect(tableCount).toBe(3)
    })

    it('should return empty string for empty rows', () => {
      expect(renderNestedTableHtml([], undefined, [])).toBe('')
    })
  })
})
