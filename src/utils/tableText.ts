import type { TableInfo, TableCellInfo, TableBorders, TableJustification, ParagraphFormat, RenderParagraph, TableBlockResult } from './docFormat'

/**
 * Cell delimiter used by Word 97-2003 binary format (.doc) inside table
 * rows: the BEL character (0x07) terminates each cell, and the row ends
 * with `0x07 0x0D` (cell mark + paragraph mark). We surface it as `\u0007`
 * in extracted text so table rows can be detected without parsing the
 * full PAP/TAP structures.
 */
const CELL_MARK = '\u0007'

/** Count non-empty cells without allocating a filtered intermediate array. */
function countNonEmptyCells(cells: string[]): number {
  let count = 0
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]
    if (cell && cell.length > 0) count++
  }
  return count
}

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
    const cells: string[] = []
    let nonEmptyCount = 0
    for (const rawCell of text.replace(/\u00a0/g, ' ').split(CELL_MARK)) {
      const cell = rawCell.trim()
      cells.push(cell)
      if (cell.length > 0) nonEmptyCount++
    }
    if (!keepTrailingEmpty && cells.length > 0 && cells[cells.length - 1] === '') {
      cells.pop()
    }
    if (nonEmptyCount < 2) return null
    return cells
  }

  if (!text.includes('\t')) return null
  const cells: string[] = []
  let nonEmptyCount = 0
  for (const rawCell of text.replace(/\u00a0/g, ' ').split(/\t+/)) {
    const cell = rawCell.trim()
    cells.push(cell)
    if (cell.length > 0) nonEmptyCount++
  }
  if (nonEmptyCount < 2) return null
  return cells
}

export function isTableRowText(text: string): boolean {
  return splitTableCells(text) !== null
}

export function isWordTableRow(text: string): boolean {
  if (!text || !text.includes(CELL_MARK)) return false
  for (const cell of text.split(CELL_MARK)) {
    if (cell.trim().length > 0) return true
  }
  return false
}

export function renderTableHtml(rows: string[][], rowsTableInfo?: TableInfo[], headerRowCount: number = 0): string {
  if (!rows || rows.length === 0) return ''

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0)

  // Collect everything the table-level style needs in a single pass over
  // rowsTableInfo. The previous implementation walked the array five times
  // (two `some` + three `find`); the five selections are independent, so we
  // keep first-match-wins semantics per field but scan the array only once.
  let hasCellInfo = false
  let hasTableBorders = false
  let tableBorders: TableBorders | undefined
  let tableJustification: TableJustification | undefined
  let tableIndent: number | undefined
  if (rowsTableInfo && rowsTableInfo.length > 0) {
    for (let i = 0; i < rowsTableInfo.length; i++) {
      const info = rowsTableInfo[i]
      if (!info) continue
      if (!hasCellInfo && info.cells && info.cells.length > 0) hasCellInfo = true
      if (!hasTableBorders && info.borders) {
        hasTableBorders = true
        tableBorders = info.borders
      }
      if (tableJustification === undefined && info.justification) tableJustification = info.justification
      if (tableIndent === undefined && info.indentTwips !== undefined) tableIndent = info.indentTwips
      if (hasCellInfo && hasTableBorders && tableJustification !== undefined && tableIndent !== undefined) break
    }
  }
  const useDefaultBorders = !hasTableBorders
  const tableStyle = buildTableBorderStyle(tableBorders, tableJustification, tableIndent, useDefaultBorders)

  const renderRow = (row: string[], info: TableInfo | undefined, isHeader: boolean, r: number) => {
    const cellsHtml: string[] = []
    const nonEmptyCount = !hasCellInfo && isHeader ? countNonEmptyCells(row) : 0
    const singleNonEmptyHeader = !hasCellInfo && isHeader && nonEmptyCount === 1
    let lastNonEmptyHeaderCell = -1
    if (!hasCellInfo && isHeader && nonEmptyCount < columnCount) {
      for (let c = columnCount - 1; c >= 0; c--) {
        if (row[c] && row[c].length > 0) {
          lastNonEmptyHeaderCell = c
          break
        }
      }
    }

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
        } else if (nonEmptyCount < columnCount && c === lastNonEmptyHeaderCell) {
          colspan = columnCount - c
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

  const html = renderTableHtml(tableRows, tableInfos, currentDepth === 1 ? headerRowCount : 0)

  return html.replace(/\x00NESTED_\d+\x00/g, placeholder => placeholders.get(placeholder) ?? placeholder)
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

/**
 * 从 paragraphs[startIndex] 起连续收集表格行，直到首个非表格段落。
 *
 * 自 DocPreview.vue 原样迁出（contract-split-r1 §1.2 W1 · T3-W1b），
 * 逻辑与行内注释逐字保留；纯函数，不触 DOM / 响应式状态（§1.3 纯度边界）。
 *
 * - Word 行内多行合并段：文本含 2+ 连续 \u0007 视为单段落内多个行边界，
 *   按 /\u0007{2,}/ 切分为多行并按最大列数补齐空串；
 * - 普通行：交由 splitTableCells 解析（\u0007 或 \t 分隔），解析失败即停止收集；
 * - 行属性缺失时以 { inTable: true } 占位，保证 rowsTableInfo / rowsDepth 与 rows 下标对齐；
 * - 表头启发式：首行仅 1 个非空单元格且少于列数 → headerRowCount=1；
 *   或首行部分非空（≥2）且第二行填满全部列 → headerRowCount=1。
 */
export function collectTableBlock(paragraphs: RenderParagraph[], startIndex: number): TableBlockResult | null {
  const rows: string[][] = []
  const rowsTableInfo: TableInfo[] = []
  const rowsDepth: number[] = []
  let hasTableInfo = false
  let i = startIndex

  while (i < paragraphs.length) {
    const para = paragraphs[i]
    const text = para.text.trim()
    // Check if this paragraph contains multiple table rows merged together.
    // In Word binary format, multiple consecutive cell marks (2+)
    // with empty content between them indicates a row boundary within a single paragraph.
    // Common patterns: \u0007\u0007\u0007 (3+) or \u0007\u0007 (2) as row separators.
    if (text.includes('\u0007\u0007')) {
      const rawRows = text.split(/\u0007{2,}/)
      const parsedRows: string[][] = []
      for (const rowText of rawRows) {
        const trimmed = rowText.trim()
        if (trimmed.length === 0) continue
        const cells = trimmed
          .replace(/\u00a0/g, ' ')
          .split('\u0007')
          .map(cell => cell.trim())
        if (cells.length > 0 && cells[cells.length - 1] === '') {
          cells.pop()
        }
        const nonEmptyCount = countNonEmptyCells(cells)
        if (nonEmptyCount >= 1) {
          parsedRows.push(cells)
        }
      }
      if (parsedRows.length < 1) {
        i++
        continue
      }
      const columnCount = parsedRows.reduce((max, row) => Math.max(max, row.length), 0)
      const paddedRows = parsedRows.map(row => {
        while (row.length < columnCount) row.push('')
        return row
      })
      for (const cells of paddedRows) {
        rows.push(cells)
        const tableInfo = (para.paraFormat as ParagraphFormat).table
        const depth = tableInfo?.depth ?? 1
        rowsDepth.push(depth)
        if (tableInfo) {
          hasTableInfo = true
          rowsTableInfo.push(tableInfo)
        } else {
          rowsTableInfo.push({ inTable: true })
        }
      }
      i++
      continue
    }
    const cells = splitTableCells(text)
    if (!cells) break
    rows.push(cells)
    const tableInfo = (para.paraFormat as ParagraphFormat).table
    const depth = tableInfo?.depth ?? 1
    rowsDepth.push(depth)
    if (tableInfo) {
      hasTableInfo = true
      rowsTableInfo.push(tableInfo)
    } else {
      // Push a placeholder so indices align with rows[].
      rowsTableInfo.push({ inTable: true })
    }
    i++
  }

  if (rows.length < 1) return null

  let headerRowCount = 0
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0)
  if (rows.length >= 2 && columnCount >= 2) {
    const firstRow = rows[0]
    const firstRowNonEmpty = countNonEmptyCells(firstRow)
    if (firstRowNonEmpty === 1 && firstRowNonEmpty < columnCount) {
      headerRowCount = 1
    } else if (firstRowNonEmpty > 0 && firstRowNonEmpty < columnCount) {
      const secondRowNonEmpty = countNonEmptyCells(rows[1])
      if (secondRowNonEmpty === columnCount) {
        headerRowCount = 1
      }
    }
  }

  return { rows, rowsTableInfo: hasTableInfo ? rowsTableInfo : undefined, rowsDepth, headerRowCount, nextIndex: i }
}
