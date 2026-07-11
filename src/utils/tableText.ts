import type { TableInfo } from './docFormat'

/**
 * Cell delimiter used by Word 97-2003 binary format (.doc) inside table
 * rows: the BEL character (0x07) terminates each cell, and the row ends
 * with `0x07 0x0D` (cell mark + paragraph mark). We surface it as `\u0007`
 * in extracted text so table rows can be detected without parsing the
 * full PAP/TAP structures.
 */
const CELL_MARK = '\u0007'

/**
 * Split a paragraph into table cells.
 *
 * Two modes are supported, in priority order:
 *   1. Word table rows: text contains `\u0007` (cell mark). Each `\u0007`
 *      terminates a cell; the trailing mark before the row's end is also
 *      a cell mark. At least 2 cells are required.
 *   2. Tab-separated rows: text contains `\t`. Multiple consecutive tabs
 *      are treated as a single separator. At least 2 non-empty cells are
 *      required.
 *
 * Returns `null` if the text is not a table row.
 */
export function splitTableCells(text: string): string[] | null {
  if (!text) return null

  // Mode 1: Word table cell marks (0x07).
  if (text.includes(CELL_MARK)) {
    const cells = text
      .replace(/\u00a0/g, ' ')
      .split(CELL_MARK)
      .map(cell => cell.trim())
    // A trailing empty cell from the final row mark is expected; drop it
    // only when it's the last element and empty.
    if (cells.length > 0 && cells[cells.length - 1] === '') {
      cells.pop()
    }
    const nonEmpty = cells.filter(cell => cell.length > 0)
    if (nonEmpty.length < 2) return null
    return cells
  }

  // Mode 2: tab-separated (legacy fallback).
  if (!text.includes('\t')) return null
  const cells = text
    .replace(/\u00a0/g, ' ')
    .split(/\t+/)
    .map(cell => cell.trim())
  const nonEmpty = cells.filter(cell => cell.length > 0)
  if (nonEmpty.length < 2) return null
  return cells
}

export function isTableRowText(text: string): boolean {
  return splitTableCells(text) !== null
}

/**
 * Detect a Word table row by the presence of the cell mark (0x07).
 * This is more reliable than tab detection because Word inserts 0x07
 * unambiguously for real table cells.
 */
export function isWordTableRow(text: string): boolean {
  if (!text) return false
  // A real Word table row has at least one cell mark; require at least
  // one non-empty cell so stray BELs don't trigger false positives.
  const cells = text.split(CELL_MARK).map(c => c.trim())
  return cells.filter(c => c.length > 0).length >= 1 && text.includes(CELL_MARK)
}

export function renderTableHtml(rows: string[][], rowsTableInfo?: TableInfo[]): string {
  if (!rows || rows.length === 0) return ''

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const hasMergeInfo = rowsTableInfo && rowsTableInfo.length > 0 &&
    rowsTableInfo.some(t => t && t.cells && t.cells.length > 0)

  // Use the first row's borders (table-level) for the <table> element styling.
  const tableBorders = rowsTableInfo?.find(t => t && t.borders)?.borders
  const tableStyle = buildTableBorderStyle(tableBorders)

  if (!hasMergeInfo) {
    // Original simple rendering path (no vertical merge info available).
    const escapedRows = rows.map(row => {
      const cells = []
      for (let i = 0; i < columnCount; i++) {
        cells.push(`<td>${escapeHtml(row[i] || '')}</td>`)
      }
      return `<tr>${cells.join('')}</tr>`
    })
    return `<table${tableStyle ? ` style="${tableStyle}"` : ''}><tbody>${escapedRows.join('')}</tbody></table>`
  }

  // Enhanced rendering path: account for verticalMerge to emit rowspan.
  // Build a column-major scan: for each row, decide if a cell is:
  //   - 'skip'    : merged into a cell above (continue)
  //   - 'restart' : start of a merged range; compute rowspan by scanning down
  //   - 'none'    : normal standalone cell
  const htmlRows: string[] = []
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    const info = rowsTableInfo?.[r]
    const cellsHtml: string[] = []
    for (let c = 0; c < columnCount; c++) {
      const cellInfo = info?.cells?.[c]
      const merge = cellInfo?.verticalMerge

      if (merge === 'continue') {
        // This cell is covered by a rowspan from above; emit nothing.
        continue
      }

      let rowspan = 1
      if (merge === 'restart') {
        // Count how many rows below have 'continue' for this column.
        for (let rr = r + 1; rr < rows.length; rr++) {
          const belowInfo = rowsTableInfo?.[rr]?.cells?.[c]
          if (belowInfo?.verticalMerge === 'continue') {
            rowspan++
          } else {
            break
          }
        }
      }

      const text = row[c] || ''
      const rowspanAttr = rowspan > 1 ? ` rowspan="${rowspan}"` : ''
      cellsHtml.push(`<td${rowspanAttr}>${escapeHtml(text)}</td>`)
    }
    htmlRows.push(`<tr>${cellsHtml.join('')}</tr>`)
  }

  return `<table${tableStyle ? ` style="${tableStyle}"` : ''}><tbody>${htmlRows.join('')}</tbody></table>`
}

/**
 * Build an inline CSS style string for the <table> element from TableBorders.
 *
 * We map Word border styles to CSS in a deliberately simple way:
 *   - Table-level top/bottom/left/right → outer border
 *   - insideH / insideV → border-collapse + td border
 *
 * For simplicity we apply the most prominent border to the table itself
 * and let cells inherit via `border-collapse: collapse`.
 */
function buildTableBorderStyle(borders?: TableInfo['borders']): string {
  if (!borders) return ''
  const parts: string[] = []
  const top = borderToCss(borders.top)
  const bottom = borderToCss(borders.bottom)
  const left = borderToCss(borders.left)
  const right = borderToCss(borders.right)
  const insideH = borderToCss(borders.insideH)
  const insideV = borderToCss(borders.insideV)

  // If we have any inside borders, use border-collapse so cells share borders.
  if (insideH || insideV) {
    parts.push('border-collapse:collapse')
  }

  // Outer borders on the <table>.
  const outerParts: string[] = []
  if (top) outerParts.push(`border-top:${top}`)
  if (bottom) outerParts.push(`border-bottom:${bottom}`)
  if (left) outerParts.push(`border-left:${left}`)
  if (right) outerParts.push(`border-right:${right}`)
  // Apply inner borders to td via the table style (CSS doesn't cascade to td
  // border directly, so we emit a minimal style that the renderer can keep).
  // We keep this simple: emit outer borders on the table; inside borders are
  // applied per-cell by buildCellStyle when available.
  parts.push(...outerParts)
  return parts.join(';')
}

/**
 * Convert a Word Brc border style to a CSS border shorthand string.
 * Returns empty string for "no border".
 */
function borderToCss(border?: { colorIndex?: number; lineWidth?: number; borderType?: number }): string {
  if (!border) return ''
  // borderType 0 = no border
  if (border.borderType === 0) return ''
  const widthPt = (border.lineWidth ?? 4) / 8 // 1/8 pt → pt
  const widthPx = Math.max(1, Math.round(widthPt * 4 / 3)) // pt → px (approx)
  const style = borderTypeToCss(border.borderType)
  const color = colorIndexToCss(border.colorIndex)
  return `${widthPx}px ${style} ${color}`
}

function borderTypeToCss(type?: number): string {
  switch (type) {
    case 1: return 'solid'      // single
    case 2: return 'dotted'     // dotted
    case 3: return 'dashed'     // dashed
    case 4: return 'double'     // thin double
    case 5: return 'double'     // double
    case 6: return 'solid'      // thick (rendered as solid, wider)
    case 7: return 'dash-dot'   // dot-dash
    default: return 'solid'
  }
}

function colorIndexToCss(idx?: number): string {
  // Same mapping as formatParser's SHD_COLOR_MAP (Word 16-color palette).
  switch (idx) {
    case 1: return '#000000'
    case 2: return '#0000FF'
    case 3: return '#00FFFF'
    case 4: return '#00FF00'
    case 5: return '#FF00FF'
    case 6: return '#FF0000'
    case 7: return '#FFFF00'
    case 8: return '#FFFFFF'
    case 9: return '#000080'
    case 10: return '#008080'
    case 11: return '#008000'
    case 12: return '#800080'
    case 13: return '#800000'
    case 14: return '#808000'
    case 15: return '#808080'
    case 16: return '#C0C0C0'
    default: return '#000000'
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
