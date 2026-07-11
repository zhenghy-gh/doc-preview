import type { TableInfo, TableCellInfo } from './docFormat'

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

  if (text.includes(CELL_MARK)) {
    const cells = text
      .replace(/\u00a0/g, ' ')
      .split(CELL_MARK)
      .map(cell => cell.trim())
    if (cells.length > 0 && cells[cells.length - 1] === '') {
      cells.pop()
    }
    const nonEmpty = cells.filter(cell => cell.length > 0)
    if (nonEmpty.length < 2) return null
    return cells
  }

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

export function isWordTableRow(text: string): boolean {
  if (!text) return false
  const cells = text.split(CELL_MARK).map(c => c.trim())
  return cells.filter(c => c.length > 0).length >= 1 && text.includes(CELL_MARK)
}

export function renderTableHtml(rows: string[][], rowsTableInfo?: TableInfo[]): string {
  if (!rows || rows.length === 0) return ''

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const hasCellInfo = rowsTableInfo && rowsTableInfo.length > 0 &&
    rowsTableInfo.some(t => t && t.cells && t.cells.length > 0)

  const tableBorders = rowsTableInfo?.find(t => t && t.borders)?.borders
  const tableJustification = rowsTableInfo?.find(t => t && t.justification)?.justification
  const tableIndent = rowsTableInfo?.find(t => t && t.indentTwips !== undefined)?.indentTwips
  const tableStyle = buildTableBorderStyle(tableBorders, tableJustification, tableIndent)

  if (!hasCellInfo) {
    const escapedRows = rows.map(row => {
      const cells = []
      for (let i = 0; i < columnCount; i++) {
        cells.push(`<td>${escapeHtml(row[i] || '')}</td>`)
      }
      return `<tr>${cells.join('')}</tr>`
    })
    return `<table${tableStyle ? ` style="${tableStyle}"` : ''}><tbody>${escapedRows.join('')}</tbody></table>`
  }

  const htmlRows: string[] = []
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    const info = rowsTableInfo?.[r]
    const cellsHtml: string[] = []
    for (let c = 0; c < columnCount; c++) {
      const cellInfo = info?.cells?.[c]
      const vMerge = cellInfo?.verticalMerge
      const hMerge = cellInfo?.horizontalMerge

      if (vMerge === 'continue' || hMerge === 'continue') {
        continue
      }

      let rowspan = 1
      if (vMerge === 'restart') {
        for (let rr = r + 1; rr < rows.length; rr++) {
          const belowInfo = rowsTableInfo?.[rr]?.cells?.[c]
          if (belowInfo?.verticalMerge === 'continue') {
            rowspan++
          } else {
            break
          }
        }
      }

      let colspan = 1
      if (hMerge === 'restart') {
        for (let cc = c + 1; cc < columnCount; cc++) {
          const rightInfo = info?.cells?.[cc]
          if (rightInfo?.horizontalMerge === 'continue') {
            colspan++
          } else {
            break
          }
        }
      }

      const text = row[c] || ''
      const rowspanAttr = rowspan > 1 ? ` rowspan="${rowspan}"` : ''
      const colspanAttr = colspan > 1 ? ` colspan="${colspan}"` : ''
      const cellStyle = buildCellStyle(cellInfo)
      const styleAttr = cellStyle ? ` style="${cellStyle}"` : ''
      cellsHtml.push(`<td${rowspanAttr}${colspanAttr}${styleAttr}>${escapeHtml(text)}</td>`)
    }
    htmlRows.push(`<tr>${cellsHtml.join('')}</tr>`)
  }

  return `<table${tableStyle ? ` style="${tableStyle}"` : ''}><tbody>${htmlRows.join('')}</tbody></table>`
}

function buildCellStyle(cellInfo?: TableCellInfo): string {
  if (!cellInfo) return ''
  const parts: string[] = []

  if (cellInfo.borders) {
    const top = borderToCss(cellInfo.borders.top)
    const left = borderToCss(cellInfo.borders.left)
    const bottom = borderToCss(cellInfo.borders.bottom)
    const right = borderToCss(cellInfo.borders.right)
    if (top) parts.push(`border-top:${top}`)
    if (left) parts.push(`border-left:${left}`)
    if (bottom) parts.push(`border-bottom:${bottom}`)
    if (right) parts.push(`border-right:${right}`)
  }

  if (cellInfo.widthTwips && cellInfo.widthTwips > 0) {
    const widthPx = Math.round(cellInfo.widthTwips / 15)
    parts.push(`width:${widthPx}px`)
  }

  return parts.join(';')
}

function buildTableBorderStyle(
  borders?: TableInfo['borders'],
  justification?: 'left' | 'center' | 'right',
  indentTwips?: number,
): string {
  const parts: string[] = []

  if (borders) {
    const top = borderToCss(borders.top)
    const bottom = borderToCss(borders.bottom)
    const left = borderToCss(borders.left)
    const right = borderToCss(borders.right)
    const insideH = borderToCss(borders.insideH)
    const insideV = borderToCss(borders.insideV)

    if (insideH || insideV) {
      parts.push('border-collapse:collapse')
    }

    if (top) parts.push(`border-top:${top}`)
    if (bottom) parts.push(`border-bottom:${bottom}`)
    if (left) parts.push(`border-left:${left}`)
    if (right) parts.push(`border-right:${right}`)
  }

  // Table alignment via margin: auto for center, margin-left for indent.
  if (justification === 'center') {
    parts.push('margin-left:auto', 'margin-right:auto')
  } else if (justification === 'right') {
    parts.push('margin-left:auto', 'margin-right:0')
  } else if (indentTwips && indentTwips > 0) {
    const indentPx = Math.round(indentTwips / 15)
    parts.push(`margin-left:${indentPx}px`)
  }

  return parts.join(';')
}

function borderToCss(border?: { colorIndex?: number; lineWidth?: number; borderType?: number }): string {
  if (!border) return ''
  if (border.borderType === 0) return ''
  const widthPt = (border.lineWidth ?? 4) / 8
  const widthPx = Math.max(1, Math.round(widthPt * 4 / 3))
  const style = borderTypeToCss(border.borderType)
  const color = colorIndexToCss(border.colorIndex)
  return `${widthPx}px ${style} ${color}`
}

function borderTypeToCss(type?: number): string {
  switch (type) {
    case 1: return 'solid'
    case 2: return 'dotted'
    case 3: return 'dashed'
    case 4: return 'double'
    case 5: return 'double'
    case 6: return 'solid'
    case 7: return 'dash-dot'
    default: return 'solid'
  }
}

function colorIndexToCss(idx?: number): string {
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
