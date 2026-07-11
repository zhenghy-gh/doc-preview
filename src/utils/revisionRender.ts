/**
 * 修订痕迹渲染工具：将修订标记应用到段落文本，生成对应的 HTML 输出。
 *
 * 该模块从 DocPreview.vue 的渲染逻辑中提取，作为纯函数便于单元测试。
 *
 * 三种渲染模式：
 * - 'marks'    — 生成 <ins>/<del> 标签（带作者+时间 tooltip）
 * - 'accepted' — 接受全部修订：insert 保留文本，delete 移除文本
 * - 'rejected' — 拒绝全部修订：insert 移除文本，delete 保留文本
 *
 * format 修订（格式修订）不涉及文本增删，三种模式下均保持原文本不变。
 */

import type { RevisionMark } from './docFormat'

export type RevisionMode = 'marks' | 'accepted' | 'rejected'

/** 应用修订后的文本结果 */
export interface AppliedRevisionResult {
  /** 处理后的文本（可能包含 HTML 标签） */
  text: string
  /** 是否生成了 <ins>/<del> HTML 标签（仅 'marks' 模式下可能为 true） */
  hasRevisionHtml: boolean
}

/**
 * 转义 HTML 特殊字符（< > & " '）。
 *
 * 纯函数实现，不依赖 DOM，便于在 Node 环境下测试。
 */
export function escapeHtmlSimple(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 将 DTTM 时间戳（Unix 毫秒）格式化为 'YYYY-MM-DD HH:mm' 字符串。
 * 无时间戳时返回空字符串。
 */
export function formatRevisionTime(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 将修订标记应用到段落文本。
 *
 * 处理流程：
 * 1. 过滤出与本段落范围 [paraCpStart, paraCpEnd) 相交且类型为 insert/delete 的修订
 * 2. 按 cpStart 降序排序，使后续替换不会影响前面修订的偏移量
 * 3. 根据 mode 决定每条修订的渲染方式：
 *    - 'marks'    : 生成 <ins>/<del> 标签
 *    - 'accepted' : insert 保留文本，delete 移除文本
 *    - 'rejected' : insert 移除文本，delete 保留文本
 *
 * @param text - 段落原始文本
 * @param paraCpStart - 段落在全局字符流中的起始 CP
 * @param paraCpEnd - 段落在全局字符流中的结束 CP（exclusive）
 * @param revisions - 全局修订标记列表
 * @param mode - 渲染模式
 * @returns 处理后的文本和是否包含 HTML 标签的标志
 */
export function applyRevisionsToText(
  text: string,
  paraCpStart: number,
  paraCpEnd: number,
  revisions: RevisionMark[],
  mode: RevisionMode
): AppliedRevisionResult {
  if (!revisions || revisions.length === 0) {
    return { text, hasRevisionHtml: false }
  }

  const paraRevisions = revisions.filter(r =>
    r.cpEnd > paraCpStart && r.cpStart < paraCpEnd &&
    (r.type === 'insert' || r.type === 'delete')
  )
  if (paraRevisions.length === 0) {
    return { text, hasRevisionHtml: false }
  }

  let workingText = text
  let hasRevisionHtml = false

  // 降序处理：先处理靠后的修订，避免前面的替换影响后面修订的偏移量
  paraRevisions.sort((a, b) => b.cpStart - a.cpStart)

  for (const rev of paraRevisions) {
    const revStartInPara = Math.max(0, rev.cpStart - paraCpStart)
    const revEndInPara = Math.min(text.length, rev.cpEnd - paraCpStart)
    if (revStartInPara >= revEndInPara) continue

    const before = workingText.substring(0, revStartInPara)
    const revText = workingText.substring(revStartInPara, revEndInPara)
    const after = workingText.substring(revEndInPara)

    if (mode === 'accepted') {
      // 接受修订：insert 保留文本，delete 移除文本
      workingText = rev.type === 'insert'
        ? `${before}${escapeHtmlSimple(revText)}${after}`
        : `${before}${after}`
      continue
    }
    if (mode === 'rejected') {
      // 拒绝修订：insert 移除文本，delete 保留文本
      workingText = rev.type === 'insert'
        ? `${before}${after}`
        : `${before}${escapeHtmlSimple(revText)}${after}`
      continue
    }

    // 'marks' 模式：生成 <ins>/<del> 标签
    const author = rev.author || (rev.authorIndex !== undefined ? `作者#${rev.authorIndex}` : '')
    const time = formatRevisionTime(rev.timestamp)
    const tipParts: string[] = []
    if (author) tipParts.push(author)
    if (time) tipParts.push(time)
    const tipAttr = tipParts.length > 0 ? ` title="${escapeHtmlSimple(tipParts.join(' · '))}"` : ''
    const tag = rev.type === 'insert' ? 'ins' : 'del'
    const cls = rev.type === 'insert' ? 'rev-insert' : 'rev-delete'
    workingText = `${before}<${tag} class="${cls}"${tipAttr}>${escapeHtmlSimple(revText)}</${tag}>${after}`
    hasRevisionHtml = true
  }

  return { text: workingText, hasRevisionHtml }
}
