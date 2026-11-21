/**
 * Story 文本渲染辅助（从 DocPreview.vue#formatStoryText 抽离，Phase 1 收尾）。
 *
 * 把页眉页脚/脚注/尾注/批注/文本框的纯文本转成安全的 HTML 片段：
 * 保留段落结构、前导空格（缩进），压缩连续空段，并把软换行/分页/表格单元格标记
 * 渲染成可见占位符。所有文本先 escapeHtml，避免 story 内容注入标记。
 */
import { escapeHtml } from './textRender'

const TRAILING_WS_RE = /\s+$/
const SOFT_BR_RE = /\u000b/g
const PAGE_BR_RE = /\u000c/g
const CELL_MARK_RE = /\u0007/g
const PAGE_BR_HTML = '<span style="display:inline-block;padding:0 4px;color:#999;font-size:0.85em">[分页]</span>'
const CELL_MARK_HTML = '<span style="display:inline-block;padding:0 4px;color:#999;font-size:0.85em">│</span>'

export function formatStoryText(text: string): string {
  const lines = text.split('\n')
  const htmlParts: string[] = []
  let prevEmpty = false
  for (const raw of lines) {
    const line = raw.replace(TRAILING_WS_RE, '')
    if (line.length === 0) {
      if (!prevEmpty && htmlParts.length > 0) {
        htmlParts.push('<p style="margin:0 0 6px 0">&nbsp;</p>')
      }
      prevEmpty = true
      continue
    }
    prevEmpty = false
    const escaped = escapeHtml(line)
      .replace(SOFT_BR_RE, '<br>')
      .replace(PAGE_BR_RE, PAGE_BR_HTML)
      .replace(CELL_MARK_RE, CELL_MARK_HTML)
    htmlParts.push(`<p style="margin:0 0 6px 0">${escaped}</p>`)
  }
  return htmlParts.join('')
}
