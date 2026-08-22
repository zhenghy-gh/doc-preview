/**
 * 文档内搜索：匹配枚举与高亮包装（纯 DOM 逻辑，无组件状态）。
 *
 * 从 DocPreview.vue 提取，便于单独测试与复用。
 */

export interface SearchOptions {
  /** 区分大小写 */
  caseSensitive: boolean
  /** 全词匹配 */
  wholeWord: boolean
}

/** 文本节点内的匹配区间（基于原始字符串的偏移） */
export interface TextMatch {
  start: number
  end: number
  /** 实际命中的原文（保留原始大小写） */
  text: string
}

/** 高亮包装后的结果，index 按文档顺序编号 */
export interface SearchHighlight {
  index: number
  text: string
  element: HTMLElement
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 构建全词匹配正则：词边界用消费组（^|[^\w]）实现，兼容不支持 lookbehind 的浏览器 */
export function buildWordRegex(query: string, caseSensitive: boolean): RegExp {
  return new RegExp(`(^|[^\\w])(${escapeRegExp(query)})($|[^\\w])`, caseSensitive ? 'g' : 'gi')
}

/**
 * 枚举一段文本中的全部匹配（纯函数，不触碰 DOM）。
 *
 * - 全词模式：`(^|[^\w])(query)($|[^\w])` 正则匹配。每次命中后把 lastIndex
 *   回拨到词尾（即尾边界字符处），使该边界字符可作为下一次匹配的首边界，
 *   从而找到紧邻的连续全词（如 "a a" 中的两个 "a"）。
 * - 子串模式：indexOf 顺序扫描，不返回重叠匹配。
 */
export function findTextMatches(text: string, rawQuery: string, options: SearchOptions): TextMatch[] {
  if (!rawQuery) return []
  const { caseSensitive, wholeWord } = options
  const matches: TextMatch[] = []

  if (wholeWord) {
    const wordRegex = buildWordRegex(rawQuery, caseSensitive)
    let m: RegExpExecArray | null
    while ((m = wordRegex.exec(text)) !== null) {
      const start = m.index + m[1].length
      matches.push({ start, end: start + m[2].length, text: m[2] })
      // 回拨到词尾，让尾边界字符可复用为下一匹配的首边界；m[2] 非空保证整体前进
      wordRegex.lastIndex = start + m[2].length
      if (m[0].length === 0) wordRegex.lastIndex++
    }
    return matches
  }

  const query = caseSensitive ? rawQuery : rawQuery.toLowerCase()
  const lower = caseSensitive ? text : text.toLowerCase()
  let pos = 0
  while ((pos = lower.indexOf(query, pos)) !== -1) {
    matches.push({ start: pos, end: pos + query.length, text: text.substring(pos, pos + query.length) })
    pos += query.length
  }
  return matches
}

/** 按文档序递归收集容器内的全部文本节点，跳过已有高亮 span 内部（不依赖 TreeWalker，环境兼容性更好） */
function collectTextNodes(root: Node): Text[] {
  const result: Text[] = []
  const visit = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        result.push(child as Text)
      } else if (
        child.nodeType === Node.ELEMENT_NODE &&
        !(child as Element).classList.contains('search-highlight')
      ) {
        visit(child)
      }
    }
  }
  visit(root)
  return result
}

/**
 * 在容器内高亮全部匹配：收集文本节点 → findTextMatches 枚举 → 包装为
 * `<span class="search-highlight">`。
 *
 * 关键点：同一文本节点内的匹配**从后往前**应用 Range 替换，先替换区间大的
 * 偏移不受后续改动影响；若顺序应用，deleteContents 会改变节点长度导致
 * 后续偏移失效（错误高亮甚至 IndexSizeError）。
 */
export function highlightTextMatches(
  container: Node,
  query: string,
  options: SearchOptions,
): SearchHighlight[] {
  const results: SearchHighlight[] = []
  const textNodes = collectTextNodes(container)
  let index = 0

  for (const node of textNodes) {
    const text = node.textContent || ''
    const matches = findTextMatches(text, query, options)
    if (matches.length === 0) continue

    const spans: HTMLElement[] = []
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i]
      const span = document.createElement('span')
      span.className = 'search-highlight'
      span.textContent = text.substring(match.start, match.end)
      span.dataset.searchIndex = String(index + i)

      const range = document.createRange()
      range.setStart(node, match.start)
      range.setEnd(node, match.end)
      range.deleteContents()
      range.insertNode(span)
      spans.push(span)
    }

    spans.reverse() // 倒序创建后恢复文档顺序
    for (let i = 0; i < matches.length; i++) {
      results.push({ index: index + i, text: matches[i].text, element: spans[i] })
    }
    index += matches.length
  }

  return results
}

/** 清除容器内全部搜索高亮，还原为纯文本节点 */
export function clearSearchHighlights(container: Node): void {
  ;(container as Element).querySelectorAll('.search-highlight').forEach(el => {
    const parent = el.parentNode
    if (parent) {
      const text = document.createTextNode(el.textContent || '')
      parent.replaceChild(text, el)
      parent.normalize()
    }
  })
}
