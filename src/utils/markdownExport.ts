/**
 * HTML → Markdown 导出转换（纯函数，无组件状态）。
 *
 * 从 DocPreview.vue 提取，便于单独测试与复用。
 * 依赖 DOM API（document.createElement / Node 常量），需在浏览器或 happy-dom 环境运行。
 */

export function escapeMdText(text: string): string {
  return text
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

function isSafeUrl(value: string, allowDataImage: boolean = false): boolean {
  const url = value.trim()
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return false
  if (allowDataImage && /^data:image\/(?:avif|bmp|gif|jpe?g|png|webp)(?:;[^,]*)?,/i.test(url)) return true
  return !/^[a-z][a-z0-9+.-]*:/i.test(url) || /^(?:https?|mailto):/i.test(url)
}

function escapeMdDestination(value: string): string {
  return value.replace(/([\\()\r\n])/g, '\\$1')
}

export function convertInlineToMd(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeMdText(node.textContent || '')
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as HTMLElement
  const tag = el.tagName.toLowerCase()
  const inner = Array.from(el.childNodes).map(n => convertInlineToMd(n)).join('')

  switch (tag) {
    case 'strong': case 'b': return `**${inner}**`
    case 'em': case 'i': return `*${inner}*`
    case 's': case 'del': case 'strike': return `~~${inner}~~`
    case 'u': return inner
    case 'code': return `\`${inner}\``
    case 'a': {
      const href = el.getAttribute('href') || ''
      if (!href) return `[${inner}]()`
      return isSafeUrl(href) ? `[${inner}](${escapeMdDestination(href)})` : inner
    }
    case 'img': {
      const src = el.getAttribute('src') || ''
      const alt = el.getAttribute('alt') || ''
      return isSafeUrl(src, true) ? `![${escapeMdText(alt)}](${escapeMdDestination(src)})` : inner
    }
    case 'sub': return `<sub>${inner}</sub>`
    case 'sup': return `<sup>${inner}</sup>`
    case 'br': return '\n'
    case 'span': case 'font': return inner
    default: return inner
  }
}

function getCellColspan(cell: HTMLTableCellElement): number {
  const value = Number.parseInt(cell.getAttribute('colspan') || '1', 10)
  return Number.isFinite(value) && value > 0 ? value : 1
}

export function getTableColCount(table: HTMLTableElement): number {
  let maxCols = 0
  for (const row of table.rows) {
    let cols = 0
    for (const cell of row.cells) {
      cols += getCellColspan(cell)
    }
    maxCols = Math.max(maxCols, cols)
  }
  return Math.max(maxCols, 1)
}

export function convertTableToMd(table: HTMLTableElement): string {
  const rows = table.rows
  if (rows.length === 0) return ''

  const colCount = getTableColCount(table)
  const lines: string[] = []
  const isHeaderRow = (row: HTMLTableRowElement) => {
    for (const cell of row.cells) {
      if (cell.tagName.toLowerCase() === 'th') return true
    }
    return false
  }
  let hasHeaderSep = false

  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].cells
    const cellTexts: string[] = []
    const isHeader = isHeaderRow(rows[r])

    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c]
      const colspan = getCellColspan(cell)
      const cellText = Array.from(cell.childNodes).map(n => convertInlineToMd(n)).join('').trim()

      for (let s = 0; s < colspan; s++) {
        cellTexts.push(s === 0 ? cellText : '')
      }
    }

    while (cellTexts.length < colCount) {
      cellTexts.push('')
    }

    lines.push(`| ${cellTexts.join(' | ')} |`)

    if (isHeader && !hasHeaderSep) {
      const sepCols = Array(colCount).fill('---')
      lines.push(`| ${sepCols.join(' | ')} |`)
      hasHeaderSep = true
    }
  }

  if (!hasHeaderSep && colCount > 0) {
    const sepCols = Array(colCount).fill('---')
    lines.splice(1, 0, `| ${sepCols.join(' | ')} |`)
  }

  return lines.join('\n')
}

export function convertListToMd(list: HTMLElement, indent: number = 0): string[] {
  const isOrdered = list.tagName.toLowerCase() === 'ol'
  const prefix = '  '.repeat(indent)
  const lines: string[] = []
  const startValue = isOrdered ? Number.parseInt(list.getAttribute('start') || '1', 10) : 1
  const start = Number.isFinite(startValue) && startValue > 0 ? startValue : 1

  let itemIndex = 0
  for (const child of Array.from(list.children)) {
    const li = child as HTMLLIElement
    if (li.tagName.toLowerCase() !== 'li') continue

    const bullet = isOrdered ? `${start + itemIndex}.` : '-'
    itemIndex++
    let itemText = ''
    const nestedLists: string[] = []

    for (const child of li.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childTag = (child as HTMLElement).tagName.toLowerCase()
        if (childTag === 'ul' || childTag === 'ol') {
          nestedLists.push(...convertListToMd(child as HTMLElement, indent + 1))
          continue
        }
        if (childTag === 'p') {
          itemText += convertInlineToMd(child)
          continue
        }
      }
      itemText += convertInlineToMd(child)
    }

    lines.push(`${prefix}${bullet} ${itemText.trim()}`)
    lines.push(...nestedLists)
  }

  return lines
}

export function convertBlockToMd(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || ''
    return text.trim() ? text : ''
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as HTMLElement
  const tag = el.tagName.toLowerCase()

  switch (tag) {
    case 'h1': return `# ${convertInlineToMd(el)}`
    case 'h2': return `## ${convertInlineToMd(el)}`
    case 'h3': return `### ${convertInlineToMd(el)}`
    case 'h4': return `#### ${convertInlineToMd(el)}`
    case 'h5': return `##### ${convertInlineToMd(el)}`
    case 'h6': return `###### ${convertInlineToMd(el)}`
    case 'p': {
      const text = convertInlineToMd(el)
      return text || ''
    }
    case 'ul': case 'ol': return convertListToMd(el).join('\n')
    case 'table': return convertTableToMd(el as HTMLTableElement)
    case 'blockquote': {
      const inner = Array.from(el.childNodes).map(n => convertBlockToMd(n)).filter(Boolean).join('\n')
      return inner.split('\n').map(l => `> ${l}`).join('\n')
    }
    case 'pre': {
      const code = el.querySelector('code')
      const lang = code?.getAttribute('class')?.replace(/^language-/, '') || ''
      const codeText = code ? code.textContent || '' : el.textContent || ''
      return '```' + lang + '\n' + codeText.replace(/\n$/, '') + '\n```'
    }
    case 'hr': return '---'
    case 'br': return ''
    case 'div': {
      if (el.classList.contains('page-content')) {
        return Array.from(el.childNodes).map(n => convertBlockToMd(n)).filter(Boolean).join('\n\n')
      }
      return Array.from(el.childNodes).map(n => convertBlockToMd(n)).filter(Boolean).join('\n')
    }
    default: return Array.from(el.childNodes).map(n => convertInlineToMd(n)).join('')
  }
}

/**
 * 将预览 HTML 整体转换为 Markdown 文本。
 *
 * 优先遍历 `.page-content` 分页容器（富格式路径）；
 * 若不存在分页容器（纯文本回退路径），回退到根容器的直接子节点，
 * 避免导出空文件。
 */
export function htmlToMarkdown(html: string): string {
  const container = document.createElement('div')
  container.innerHTML = html

  const parts: string[] = []
  const pageContents = container.querySelectorAll('.page-content')
  const roots: ChildNode[] = []

  if (pageContents.length > 0) {
    pageContents.forEach(pc => roots.push(...Array.from(pc.childNodes)))
  } else {
    roots.push(...Array.from(container.childNodes))
  }

  for (const child of roots) {
    const md = convertBlockToMd(child)
    if (md) parts.push(md)
  }

  return parts.join('\n\n')
}
