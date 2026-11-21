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
  // 图片 data URL 只允许位图格式：解析器自身只会产出 png/jpeg/gif/bmp。
  // 旧实现用 `[a-z0-9.+-]+` 放行了 `image/svg+xml`，而 SVG 可携带脚本/事件处理器，
  // 某些 Markdown 渲染器会把 data URL 内联成可执行的 SVG ⇒ 收紧为栅格白名单。
  if (allowDataImage && /^data:image\/(?:png|jpe?g|gif|bmp|webp)(?:;[^,]*)?,/i.test(url)) return true
  // scheme 白名单与 documentRenderer.sanitizeUrl 保持一致（含 tel:）；
  // 无 scheme 的相对路径/锚点照旧放行。
  return !/^[a-z][a-z0-9+.-]*:/i.test(url) || /^(?:https?|mailto|tel):/i.test(url)
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
  const innerParts: string[] = []
  for (const child of el.childNodes) innerParts.push(convertInlineToMd(child))
  const inner = innerParts.join('')

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

export function getTableColCount(table: HTMLTableElement): number {
  let maxCols = 0
  for (const row of table.rows) {
    let cols = 0
    for (const cell of row.cells) {
      cols += parseInt(cell.getAttribute('colspan') || '1')
    }
    maxCols = Math.max(maxCols, cols)
  }
  return Math.max(maxCols, 1)
}

interface MarkdownTableRow {
  cellTexts: string[]
  isHeader: boolean
}

function collectMarkdownTableRows(table: HTMLTableElement): {
  rows: MarkdownTableRow[]
  colCount: number
} {
  let maxCols = 0
  const rows: MarkdownTableRow[] = []

  for (const row of table.rows) {
    let cols = 0
    const cellTexts: string[] = []
    let isHeader = false

    for (const cell of row.cells) {
      if (cell.tagName.toLowerCase() === 'th') isHeader = true
      const colspan = parseInt(cell.getAttribute('colspan') || '1')
      cols += colspan
      const cellTextParts: string[] = []
      for (const child of cell.childNodes) cellTextParts.push(convertInlineToMd(child))
      const cellText = cellTextParts.join('').trim()

      for (let s = 0; s < colspan; s++) {
        cellTexts.push(s === 0 ? cellText : '')
      }
    }

    maxCols = Math.max(maxCols, cols)
    rows.push({ cellTexts, isHeader })
  }

  return { rows, colCount: Math.max(maxCols, 1) }
}

export function convertTableToMd(table: HTMLTableElement): string {
  if (table.rows.length === 0) return ''

  const { rows, colCount } = collectMarkdownTableRows(table)
  const lines: string[] = []
  let hasHeaderSep = false

  for (const row of rows) {
    while (row.cellTexts.length < colCount) {
      row.cellTexts.push('')
    }

    lines.push(`| ${row.cellTexts.join(' | ')} |`)

    if (row.isHeader && !hasHeaderSep) {
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

  for (let i = 0; i < list.children.length; i++) {
    const li = list.children[i] as HTMLLIElement
    if (li.tagName.toLowerCase() !== 'li') continue

    const bullet = isOrdered ? `${i + 1}.` : '-'
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
      const innerParts: string[] = []
      for (const child of el.childNodes) {
        const converted = convertBlockToMd(child)
        if (converted) innerParts.push(converted)
      }
      return innerParts.join('\n').split('\n').map(l => `> ${l}`).join('\n')
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
        const innerParts: string[] = []
        for (const child of el.childNodes) {
          const converted = convertBlockToMd(child)
          if (converted) innerParts.push(converted)
        }
        return innerParts.join('\n\n')
      }
      const innerParts: string[] = []
      for (const child of el.childNodes) {
        const converted = convertBlockToMd(child)
        if (converted) innerParts.push(converted)
      }
      return innerParts.join('\n')
    }
    default: {
      const innerParts: string[] = []
      for (const child of el.childNodes) innerParts.push(convertInlineToMd(child))
      return innerParts.join('')
    }
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
  const appendChildren = (parent: ParentNode) => {
    for (const child of parent.childNodes) {
      const md = convertBlockToMd(child)
      if (md) parts.push(md)
    }
  }

  if (pageContents.length > 0) {
    pageContents.forEach(appendChildren)
  } else {
    appendChildren(container)
  }

  return parts.join('\n\n')
}
