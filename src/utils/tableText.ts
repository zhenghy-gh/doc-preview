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
export function splitTableCells(text: string, keepTrailingEmpty: boolean = false): string[] | null {
  if (!text) return null

  if (text.includes(CELL_MARK)) {
    const cells = text
      .replace(/\u00a0/g, ' ')
      .split(CELL_MARK)
      .map(cell => cell.trim())
    if (!keepTrailingEmpty && cells.length > 0 && cells[cells.length - 1] === '') {
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

export function renderTableHtml(rows: string[][], rowsTableInfo?: TableInfo[], headerRowCount: number = 0): string {
  if (!rows || rows.length === 0) return ''

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const hasCellInfo = rowsTableInfo && rowsTableInfo.length > 0 &&
    rowsTableInfo.some(t => t && t.cells && t.cells.length > 0)
  const hasTableBorders = rowsTableInfo?.some(t => t && t.borders)
  const useDefaultBorders = !hasTableBorders

  const tableBorders = rowsTableInfo?.find(t => t && t.borders)?.borders
  const tableJustification = rowsTableInfo?.find(t => t && t.justification)?.justification
  const tableIndent = rowsTableInfo?.find(t => t && t.indentTwips !== undefined)?.indentTwips
  const tableStyle = buildTableBorderStyle(tableBorders, tableJustification, tableIndent, useDefaultBorders)

  const renderRow = (row: string[], info: TableInfo | undefined, isHeader: boolean, r: number) => {
    const cellsHtml: string[] = []
    const nonEmptyCount = !hasCellInfo && isHeader ? row.filter(cell => cell && cell.length > 0).length : 0
    const singleNonEmptyHeader = !hasCellInfo && isHeader && nonEmptyCount === 1

    for (let c = 0; c < columnCount; c++) {
      const cellInfo = info?.cells?.[c]
      const vMerge = cellInfo?.verticalMerge
      const hMerge = cellInfo?.horizontalMerge

      if (hasCellInfo && (vMerge === 'continue' || hMerge === 'continue')) {
        continue
      }

      if (singleNonEmptyHeader && (!row[c] || row[c].length === 0)) {
        continue
      }

      let rowspan = 1
      if (hasCellInfo && vMerge === 'restart') {
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
      if (hasCellInfo && hMerge === 'restart') {
        for (let cc = c + 1; cc < columnCount; cc++) {
          const rightInfo = info?.cells?.[cc]
          if (rightInfo?.horizontalMerge === 'continue') {
            colspan++
          } else {
            break
          }
        }
      }

      if (!hasCellInfo && isHeader) {
        if (singleNonEmptyHeader && row[c] && row[c].length > 0) {
          colspan = columnCount
        } else if (nonEmptyCount < columnCount) {
          let nextNonEmpty = -1
          for (let cc = c + 1; cc < columnCount; cc++) {
            if (row[cc] && row[cc].length > 0) {
              nextNonEmpty = cc
              break
            }
          }
          if (nextNonEmpty === -1 && row[c] && row[c].length > 0) {
            colspan = columnCount - c
          }
        }
      }

      const text = row[c] || ''
      const rowspanAttr = rowspan > 1 ? ` rowspan="${rowspan}"` : ''
      const colspanAttr = colspan > 1 ? ` colspan="${colspan}"` : ''
      const cellStyle = buildCellStyle(cellInfo, useDefaultBorders, isHeader)
      const styleAttr = cellStyle ? ` style="${cellStyle}"` : ''
      const tag = isHeader ? 'th' : 'td'
      cellsHtml.push(`<${tag}${rowspanAttr}${colspanAttr}${styleAttr}>${escapeHtml(text)}</${tag}>`)
    }
    return `<tr>${cellsHtml.join('')}</tr>`
  }

  let headerHtml = ''
  let bodyRows = rows
  if (headerRowCount > 0 && headerRowCount < rows.length) {
    const headerRows = rows.slice(0, headerRowCount)
    bodyRows = rows.slice(headerRowCount)
    const headerRowsHtml = headerRows.map((row, r) => renderRow(row, rowsTableInfo?.[r], true, r)).join('')
    headerHtml = `<thead>${headerRowsHtml}</thead>`
  }

  const bodyHtml = bodyRows.map((row, r) => {
    const actualRowIndex = headerRowCount > 0 ? headerRowCount + r : r
    return renderRow(row, rowsTableInfo?.[actualRowIndex], false, actualRowIndex)
  }).join('')

  return `<table${tableStyle ? ` style="${tableStyle}"` : ''}>${headerHtml}<tbody>${bodyHtml}</tbody></table>`
}

/**
 * 渲染嵌套表格。
 *
 * 当表格行具有不同的 depth（sprmPTableDepth）时，更深的行作为
 * 父表格最后一个单元格内的嵌套表格渲染。
 *
 * @param rows - 每行的单元格文本数组
 * @param rowsTableInfo - 每行的表格属性信息
 * @param rowsDepth - 每行的表格深度（1=顶层）
 * @returns 嵌套表格 HTML
 */
export function renderNestedTableHtml(
  rows: string[][],
  rowsTableInfo?: TableInfo[],
  rowsDepth?: number[],
  headerRowCount: number = 0,
): string {
  if (!rows || rows.length === 0) return ''

  if (!rowsDepth || rowsDepth.length === 0) {
    return renderTableHtml(rows, rowsTableInfo, headerRowCount)
  }

  const allSameDepth = rowsDepth.every(d => d === rowsDepth[0])
  if (allSameDepth) {
    return renderTableHtml(rows, rowsTableInfo, headerRowCount)
  }

  return renderNestedTableRecursive(rows, rowsTableInfo, rowsDepth, 0, rows.length, 1, headerRowCount)
}

/**
 * 递归渲染嵌套表格。
 *
 * 从 [start, end) 范围内提取深度为 currentDepth 的连续行作为一个表格，
 * 当遇到更深的行时递归为子表格，嵌入到父表格最后一个单元格中。
 *
 * 使用占位符避免 renderTableHtml 的 escapeHtml 转义子表格 HTML 标签。
 */
function renderNestedTableRecursive(
  rows: string[][],
  rowsTableInfo: TableInfo[] | undefined,
  rowsDepth: number[],
  start: number,
  end: number,
  currentDepth: number,
  headerRowCount: number = 0,
): string {
  const tableRows: string[][] = []
  const tableInfos: TableInfo[] = []
  const placeholders: Map<string, string> = new Map()
  let i = start

  while (i < end) {
    const depth = rowsDepth[i]

    if (depth === currentDepth) {
      tableRows.push([...rows[i]])
      tableInfos.push(rowsTableInfo?.[i] ?? { inTable: true })
      i++
    } else if (depth > currentDepth) {
      const childStart = i
      while (i < end && rowsDepth[i] >= depth) {
        i++
      }
      const childEnd = i
      const childHtml = renderNestedTableRecursive(rows, rowsTableInfo, rowsDepth, childStart, childEnd, depth)

      if (tableRows.length > 0 && childHtml) {
        const lastRowIdx = tableRows.length - 1
        const lastCellIdx = tableRows[lastRowIdx].length - 1
        if (lastCellIdx >= 0) {
          const placeholder = `\x00NESTED_${placeholders.size}\x00`
          placeholders.set(placeholder, childHtml)
          tableRows[lastRowIdx][lastCellIdx] += `\n${placeholder}`
        }
      }
    } else {
      break
    }
  }

  if (tableRows.length === 0) return ''

  let html = renderTableHtml(tableRows, tableInfos, currentDepth === 1 ? headerRowCount : 0)

  for (const [ph, childHtml] of placeholders) {
    html = html.split(ph).join(childHtml)
  }

  return html
}

function buildCellStyle(cellInfo?: TableCellInfo, useDefaultBorders?: boolean, isHeader?: boolean): string {
  const parts: string[] = []

  if (cellInfo?.borders) {
    const top = borderToCss(cellInfo.borders.top)
    const left = borderToCss(cellInfo.borders.left)
    const bottom = borderToCss(cellInfo.borders.bottom)
    const right = borderToCss(cellInfo.borders.right)
    if (top) parts.push(`border-top:${top}`)
    if (left) parts.push(`border-left:${left}`)
    if (bottom) parts.push(`border-bottom:${bottom}`)
    if (right) parts.push(`border-right:${right}`)
  } else if (useDefaultBorders) {
    parts.push('border:1px solid #000000')
  }

  if (cellInfo?.widthTwips && cellInfo.widthTwips > 0) {
    const widthPx = Math.round(cellInfo.widthTwips / 15)
    parts.push(`width:${widthPx}px`)
  }

  if (isHeader) {
    parts.push('font-weight:bold')
    parts.push('text-align:center')
    parts.push('background-color:#f2f2f2')
  }

  if (useDefaultBorders || cellInfo?.borders) {
    parts.push('padding:4px 8px')
  }

  return parts.join(';')
}

function buildTableBorderStyle(
  borders?: TableInfo['borders'],
  justification?: 'left' | 'center' | 'right',
  indentTwips?: number,
  useDefaultBorders?: boolean,
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
  } else if (useDefaultBorders) {
    parts.push('border-collapse:collapse')
    parts.push('border:1px solid #000000')
  }

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
