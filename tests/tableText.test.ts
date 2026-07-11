import { describe, it, expect } from 'vitest'
import { isTableRowText, isWordTableRow, renderTableHtml, splitTableCells } from '../src/utils/tableText'

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
    expect(html).toContain('<table>')
    expect(html).toContain('&lt;Bob&gt;')
    expect(html).toContain('<td>Age</td>')
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
})
