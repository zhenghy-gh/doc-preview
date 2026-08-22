/**
 * 纯文本 → HTML 渲染辅助（纯函数，无组件状态）。
 *
 * 从 DocPreview.vue 提取，便于单独测试与复用。
 * 依赖 DOM API（document.createElement / canvas），需在浏览器或 happy-dom 环境运行。
 */
import { splitTableCells, renderTableHtml } from './tableText'

let _escapeDiv: HTMLDivElement | null = null

/** HTML 特殊字符转义（结果可直接拼入 innerHTML） */
export function escapeHtml(text: string): string {
  if (!_escapeDiv) _escapeDiv = document.createElement('div')
  _escapeDiv.textContent = text
  return _escapeDiv.innerHTML
}

/**
 * 将制表符 (\t) 替换为基于制表位位置的空白间隔。
 *
 * 使用 Canvas 测量文本宽度，精确计算每个制表位需要跳转的距离。
 * 如果没有自定义制表位，使用默认 tab-size。
 *
 * @param text - 原始文本（可能包含 \t 字符）
 * @param tabs - 制表位位置数组（磅值）
 * @param fontSizePt - 字体大小（磅值）
 * @param fontFamily - 字体族
 * @param hasHtml - text 是否已含 HTML（已转义），决定是否再做 escapeHtml
 * @returns 处理后的 HTML 字符串（\t 被替换为 span 空白间隔）
 */
export function applyTabStops(
  text: string,
  tabs: number[] | undefined,
  fontSizePt: number,
  fontFamily: string,
  hasHtml: boolean = false,
): string {
  if (!text.includes('\t')) return hasHtml ? text : escapeHtml(text)

  const DEFAULT_TAB_INTERVAL_PT = 36 // 默认每 36pt (0.5 inch) 一个制表位

  if (!tabs || tabs.length === 0) {
    // 无自定义制表位：使用默认 tab-size 渲染
    const escaped = hasHtml ? text : escapeHtml(text)
    return `<span style="white-space: pre; tab-size: ${DEFAULT_TAB_INTERVAL_PT / fontSizePt};">${escaped}</span>`
  }

  // 有自定义制表位：精确计算每个 tab 的跳转宽度
  const sortedTabs = [...tabs].sort((a, b) => a - b)

  // 使用 Canvas 测量字符宽度（近似值）
  let canvas: HTMLCanvasElement | null = null
  let ctx: CanvasRenderingContext2D | null = null
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas')
    ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.font = `${fontSizePt}pt ${fontFamily}`
    }
  }

  const measureWidth = (s: string): number => {
    if (ctx) return ctx.measureText(s).width * (72 / 96) // px -> pt
    return s.length * fontSizePt * 0.55 // 回退估算
  }

  const parts: string[] = []
  const segments = text.split('\t')
  let currentPosPt = 0

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const segHtml = hasHtml ? seg : escapeHtml(seg)
    parts.push(segHtml)

    if (i < segments.length - 1) {
      const segWidth = measureWidth(seg)
      currentPosPt += segWidth

      // 找到下一个制表位位置
      let nextTab: number | undefined
      for (const tab of sortedTabs) {
        if (tab > currentPosPt + 0.5) {
          nextTab = tab
          break
        }
      }

      // 如果超出自定义制表位范围，使用默认间隔
      if (nextTab === undefined) {
        const lastTab = sortedTabs.length > 0 ? sortedTabs[sortedTabs.length - 1] : 0
        const intervals = Math.ceil((currentPosPt - lastTab) / DEFAULT_TAB_INTERVAL_PT)
        nextTab = lastTab + intervals * DEFAULT_TAB_INTERVAL_PT
        if (nextTab <= currentPosPt + 0.5) {
          nextTab += DEFAULT_TAB_INTERVAL_PT
        }
      }

      const gapPt = Math.max(2, nextTab - currentPosPt)
      parts.push(`<span style="display: inline-block; width: ${gapPt}pt;"></span>`)
      currentPosPt = nextTab
    }
  }

  return parts.join('')
}

/**
 * Web 字体族解析回调：返回 "GoogleFont, " 前缀或空串。
 * 由 DocPreview.vue 注入（依赖 props.useWebFont），默认禁用。
 */
export type WebFontFamilyResolver = (fontName?: string) => string

/**
 * 纯文本降级渲染：按启发式推断标题/正文/表格并生成 HTML。
 *
 * - 短中文段落（<20 字且中文占比 >50%）→ 居中加粗 h1
 * - 连续两行以上可拆分为单元格的段落 → 表格
 * - 其余 → 两端对齐正文段落
 *
 * @param text - 解析器提取的纯文本（\n 分段）
 * @param webFontFamily - Web 字体前缀解析（可选）
 */
export function formatTextWithInferredFormat(
  text: string,
  webFontFamily: WebFontFamilyResolver = () => '',
): string {
  const paragraphs = text.split(/\n+/).filter(p => p.trim())
  if (paragraphs.length === 0) return `<p style="font-family:${webFontFamily('宋体')}'宋体',serif;font-size:1.0rem">${escapeHtml(text)}</p>`

  let html = ''
  let i = 0
  while (i < paragraphs.length) {
    const rowBlock: string[][] = []
    let j = i
    while (j < paragraphs.length) {
      const cells = splitTableCells(paragraphs[j].trim())
      if (!cells) break
      rowBlock.push(cells)
      j++
    }

    if (rowBlock.length >= 2) {
      html += renderTableHtml(rowBlock)
      i = j
      continue
    }

    const t = paragraphs[i].trim()
    if (!t) {
      i++
      continue
    }

    const chineseRatio = (t.match(/[\u4e00-\u9fff]/g) || []).length / t.length
    if (t.length < 20 && chineseRatio > 0.5) {
      html += `<h1 style="font-family:${webFontFamily('宋体')}'宋体',serif;font-size:1.375rem;font-weight:bold;text-align:center">${escapeHtml(t)}</h1>`
    } else {
      html += `<p style="font-family:${webFontFamily('宋体')}'宋体','SimSun',serif;font-size:1.0rem;text-align:justify">${escapeHtml(t)}</p>`
    }
    i++
  }
  return html
}
