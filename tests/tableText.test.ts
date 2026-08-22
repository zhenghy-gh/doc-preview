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

  describe('splitTableCells edge cases', () => {
    it('should keep the trailing empty cell when keepTrailingEmpty is set', () => {
      expect(splitTableCells('A\u0007B\u0007', true)).toEqual(['A', 'B', ''])
    })

    it('should normalize non-breaking spaces to plain spaces', () => {
      expect(splitTableCells('A\u00a0B\u0007C\u0007')).toEqual(['A B', 'C'])
    })

    it('should treat consecutive tabs as a single separator', () => {
      expect(splitTableCells('A\t\tB')).toEqual(['A', 'B'])
    })

    it('should return null for falsy input', () => {
      expect(splitTableCells('')).toBeNull()
      expect(splitTableCells(null as unknown as string)).toBeNull()
    })

    it('should reject tab rows with only one non-empty cell', () => {
      expect(splitTableCells('\tA\t')).toBeNull()
    })
  })

  describe('renderTableHtml formatting options', () => {
    it('should render header rows inside <thead>', () => {
      const html = renderTableHtml(
        [
          ['Name', 'Age'],
          ['Alice', '30'],
          ['Bob', '25'],
        ],
        undefined,
        1,
      )
      expect(html).toContain('<thead>')
      expect(html).toContain('</thead>')
      expect(html).toContain('<tbody>')
      expect(html).toContain('<th')
      // Body rows use td: 2 rows × 2 cols = 4
      const tdCount = (html.match(/<td/g) || []).length
      expect(tdCount).toBe(4)
      // Header styling
      expect(html).toContain('font-weight:bold')
      expect(html).toContain('text-align:center')
    })

    it('should render a single non-empty header cell spanning all columns', () => {
      const html = renderTableHtml(
        [
          ['Title', ''],
          ['A', 'B'],
        ],
        undefined,
        1,
      )
      expect(html).toContain('colspan="2"')
    })

    it('should render all rows as body when headerRowCount is 0', () => {
      const html = renderTableHtml([['A', 'B'], ['C', 'D']])
      expect(html).not.toContain('<thead>')
      expect(html).toContain('<tbody>')
    })

    it('should not split thead when headerRowCount >= rows.length', () => {
      const html = renderTableHtml([['A', 'B']], undefined, 2)
      expect(html).not.toContain('<thead>')
      expect(html).toContain('<tbody>')
    })

    it('should apply table borders and collapse when inside borders exist', () => {
      const rowsInfo: any[] = [{
        inTable: true,
        borders: {
          top: { borderType: 1, lineWidth: 8, colorIndex: 1 },
          bottom: { borderType: 2, lineWidth: 8, colorIndex: 6 },
          left: { borderType: 3, lineWidth: 8, colorIndex: 7 },
          right: { borderType: 4, lineWidth: 8, colorIndex: 8 },
          insideH: { borderType: 1, lineWidth: 4, colorIndex: 1 },
          insideV: { borderType: 1, lineWidth: 4, colorIndex: 1 },
        },
      }]
      const html = renderTableHtml([['A', 'B'], ['C', 'D']], rowsInfo)
      expect(html).toContain('border-collapse:collapse')
      expect(html).toContain('border-top:')
      expect(html).toContain('border-bottom:')
      expect(html).toContain('border-left:')
      expect(html).toContain('border-right:')
    })

    it('should use default borders when no table info is provided', () => {
      const html = renderTableHtml([['A', 'B']])
      expect(html).toContain('border-collapse:collapse')
      expect(html).toContain('border:1px solid #000000')
      expect(html).toContain('padding:4px 8px')
    })

    it('should center a justified table', () => {
      const rowsInfo: any[] = [{ inTable: true, justification: 'center' }]
      const html = renderTableHtml([['A', 'B']], rowsInfo)
      expect(html).toContain('margin-left:auto')
      expect(html).toContain('margin-right:auto')
    })

    it('should right-align a table (indent is not applied when justified right)', () => {
      const rowsInfo: any[] = [{ inTable: true, justification: 'right', indentTwips: 150 }]
      const html = renderTableHtml([['A', 'B']], rowsInfo)
      expect(html).toContain('margin-left:auto')
      expect(html).toContain('margin-right:0')
      // justification wins over indentTwips
      expect(html).not.toContain('margin-left:10px')
    })

    it('should apply indent twips when not justified', () => {
      const rowsInfo: any[] = [{ inTable: true, indentTwips: 150 }]
      const html = renderTableHtml([['A', 'B']], rowsInfo)
      // 150 twips / 15 = 10px
      expect(html).toContain('margin-left:10px')
    })

    it('should apply cell borders and width', () => {
      const rowsInfo: any[] = [{
        inTable: true,
        cells: [
          {
            borders: {
              top: { borderType: 1, lineWidth: 4, colorIndex: 1 },
            },
            widthTwips: 300,
          },
        ],
      }]
      const html = renderTableHtml([['A', 'B']], rowsInfo)
      expect(html).toContain('border-top:1px solid #000000')
      expect(html).toContain('width:20px')
    })
  })

  describe('merge cells (rowspan/colspan)', () => {
    it('should compute rowspan for vertical merge restart', () => {
      const rowsInfo: any[] = [
        { inTable: true, cells: [{ verticalMerge: 'restart' }, {}] },
        { inTable: true, cells: [{ verticalMerge: 'continue' }, {}] },
        { inTable: true, cells: [{ verticalMerge: 'restart' }, {}] },
      ]
      const html = renderTableHtml([['A', 'x'], ['B', 'y'], ['C', 'z']], rowsInfo)
      expect(html).toContain('rowspan="2"')
      // Row 1: A (rowspan 2) + x; Row 2: B skipped, y rendered; Row 3: C + z → 5 td
      const tdCount = (html.match(/<td/g) || []).length
      expect(tdCount).toBe(5)
    })

    it('should compute colspan for horizontal merge restart', () => {
      const rowsInfo: any[] = [
        {
          inTable: true,
          cells: [{ horizontalMerge: 'restart' }, { horizontalMerge: 'continue' }, { horizontalMerge: 'continue' }],
        },
      ]
      const html = renderTableHtml([['A', 'B', 'C']], rowsInfo)
      expect(html).toContain('colspan="3"')
      const tdCount = (html.match(/<td/g) || []).length
      expect(tdCount).toBe(1)
    })

    it('should stop rowspan count at a non-continue cell', () => {
      const rowsInfo: any[] = [
        { inTable: true, cells: [{ verticalMerge: 'restart' }, {}] },
        { inTable: true, cells: [{ verticalMerge: 'restart' }, {}] },
      ]
      const html = renderTableHtml([['A', 'x'], ['B', 'y']], rowsInfo)
      expect(html).not.toContain('rowspan="2"')
    })
  })

  describe('escapeHtml coverage', () => {
    it('should escape quotes and apostrophes', () => {
      const html = renderTableHtml([['say "hi" & \'bye\' <tag>']])
      expect(html).toContain('&quot;hi&quot;')
      expect(html).toContain('&#39;bye&#39;')
      expect(html).toContain('&amp;')
    })
  })
})

describe('tableText uncovered branches', () => {
  it('stops colspan scan when the right neighbor is not a merge continue', () => {
    const rowsInfo = [
      { inTable: true, cells: [
        { horizontalMerge: 'restart' },
        { horizontalMerge: 'start' },
        undefined,
      ] },
    ]
    const html = renderTableHtml([['A', 'B', 'C']], rowsInfo as any)
    expect(html).toContain('<td')
    expect(html).not.toContain('colspan')
  })

  it('extends a header cell to the row end when later columns are empty', () => {
    const html = renderTableHtml([['A', 'B', ''], ['X', 'Y', 'Z']], undefined, 1)
    expect(html).toContain('<thead>')
    // Last non-empty header cell gets colspan to fill the row
    expect(html).toMatch(/<th colspan="2"[^>]*>B<\/th>/)
  })

  it('breaks out of the nested loop when a shallower depth appears', () => {
    const html = renderNestedTableHtml([['A'], ['B'], ['C']], undefined, [1, 1, 0])
    expect(html).toContain('<table')
    expect(html).toContain('B')
  })
})

describe('tableText border rendering branches', () => {
  const border = (type: number, width: number | undefined, color: number) =>
    ({ colorIndex: color, lineWidth: width, borderType: type })

  it('renders an empty table for empty rows', () => {
    expect(renderTableHtml([])).toBe('')
  })

  it('rejects isWordTableRow for empty text', () => {
    expect(isWordTableRow('')).toBe(false)
  })

  it('emits a thead section when headerRowCount splits the rows', () => {
    const html = renderTableHtml([['H1', 'H2'], ['a', 'b']], undefined, 1)
    expect(html).toContain('<thead>')
    expect(html).toContain('<th')
    expect(html).toContain('<tbody>')
  })

  it('spans a single non-empty header cell across all columns', () => {
    const html = renderTableHtml([['', 'Title', ''], ['a', 'b', 'c']], undefined, 1)
    expect(html).toContain('<th colspan="3"')
  })

  it('renders all four cell border sides in order', () => {
    const info = {
      inTable: true,
      cells: [{
        column: 0, verticalMerge: 'none' as const,
        borders: {
          top: border(1, 8, 1), left: border(2, 8, 2),
          bottom: border(3, 8, 3), right: border(4, 8, 4),
        },
      }],
    }
    const html = renderTableHtml([['x']], [info])
    expect(html).toContain('border-top:1px solid #000000')
    expect(html).toContain('border-left:1px dotted #0000FF')
    expect(html).toContain('border-bottom:1px dashed #00FFFF')
    expect(html).toContain('border-right:1px double #00FF00')
  })

  it('skips borderType 0 sides and defaults lineWidth to 4 twips (1px)', () => {
    const info = {
      inTable: true,
      cells: [{
        column: 0, verticalMerge: 'none' as const,
        borders: {
          top: border(0, 8, 1),
          bottom: { colorIndex: 1, lineWidth: undefined, borderType: 1 },
        },
      }],
    }
    const html = renderTableHtml([['x']], [info])
    expect(html).not.toContain('border-top')
    expect(html).toContain('border-bottom:1px solid #000000')
  })

  it('maps borderType 5/6/7 and unknown to double/solid/dash-dot/solid', () => {
    const mk = (t: number) => [{
      column: 0, verticalMerge: 'none' as const,
      borders: { top: border(t, 8, 1) },
    }]
    const single = (cells: any) => renderTableHtml([['x']], [{ inTable: true, cells }])
    expect(single(mk(5))).toContain('border-top:1px double')
    expect(single(mk(6))).toContain('border-top:1px solid')
    expect(single(mk(7))).toContain('border-top:1px dash-dot')
    expect(single(mk(99))).toContain('border-top:1px solid')
  })

  it('maps the full ico color palette and defaults to black', () => {
    const palette: Record<number, string> = {
      1: '#000000', 2: '#0000FF', 3: '#00FFFF', 4: '#00FF00', 5: '#FF00FF',
      6: '#FF0000', 7: '#FFFF00', 8: '#FFFFFF', 9: '#000080', 10: '#008080',
      11: '#008000', 12: '#800080', 13: '#800000', 14: '#808000', 15: '#808080',
      16: '#C0C0C0',
    }
    for (const [ico, css] of Object.entries(palette)) {
      const cells = [{ column: 0, verticalMerge: 'none' as const, borders: { top: border(1, 8, Number(ico)) } }]
      const html = renderTableHtml([['x']], [{ inTable: true, cells }])
      expect(html).toContain(`border-top:1px solid ${css}`)
    }
    const cells = [{ column: 0, verticalMerge: 'none' as const, borders: { top: border(1, 8, 99) } }]
    expect(renderTableHtml([['x']], [{ inTable: true, cells }])).toContain('border-top:1px solid #000000')
  })

  it('adds border-collapse when inside borders are defined', () => {
    const info = {
      inTable: true,
      borders: { insideH: border(1, 8, 1), insideV: border(1, 8, 1) },
    }
    const html = renderTableHtml([['a', 'b'], ['c', 'd']], [info, info])
    expect(html).toContain('border-collapse:collapse')
    expect(html).toMatch(/<table style="/)
  })

  it('falls back to a default TableInfo for rows missing one in nested rendering', () => {
    const html = renderNestedTableHtml(
      [['outer'], ['inner']],
      undefined,
      [1, 2],
    )
    expect(html).toContain('<table')
    expect(html).toContain('outer')
    expect(html).toContain('inner')
  })

  it('returns empty when every nested row is deeper than the top depth', () => {
    expect(renderNestedTableHtml([['a'], ['b']], undefined, [2, 3])).toBe('')
  })
})
