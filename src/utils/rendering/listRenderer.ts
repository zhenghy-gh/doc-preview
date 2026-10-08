/**
 * listRenderer —— 列表收集与嵌套渲染纯函数（T3-W2 · contract-split-r1 §1.2 Batch-B）
 *
 * 自 DocPreview.vue 原样迁出（符号名锚）：extractListItemText / ListItemNode /
 * renderNestedList；主循环列表组收集段整体抽为 renderListBlock。
 *
 * ⚠️ 契约红线（§1.2 W2 表 / R2）：\u0001 双层占位符消费顺序原样保留——
 * 第一层：宿主注入的 renderParagraph 回调内部自行消费（列表项组装期）；
 * 第二层：renderListBlock 对整棵列表 HTML 先图后表两次全局 replace。
 * 严禁顺手合并两层实现。
 *
 * 占位符消费以回调注入（consumePictureHtml/consumeChartHtml），闭包契约：
 *  - consumePictureHtml(): 返回 <img …> HTML；耗尽或无图时返回 null → 保留 '\u0001' 字面量（镜像原 phase-1 分支）
 *  - consumeChartHtml():  返回图表 HTML；耗尽时返回 null → 插入空串（镜像原 phase-2 分支）
 *  - 原实现的整段门卫（pictures/images 至少其一非空、charts 非空）由宿主折算为
 *    hasPictures/hasCharts 显式布尔传入，模块内保持相同短路结构。
 */
import { resolveFontSize } from './paragraphStyleRenderer'
import type { CharacterFormat, ParagraphFormat, RenderParagraph } from '../docFormat'

/**
 * 段落 HTML 渲染回调（宿主 renderParagraphHtml 注入）。
 * R-1（reviewer findings-r1 · P0）：收紧为 5 参——列表项刻意不吃全文超链接与修订
 * （原实现第 6 参传 []、第 7 参 undefined 的抑制语义）。宿主经 listVariant 闭包
 * 捕获空数组实现抑制；vestigial 的 unknown 透传形参已删除（原为类型级谎言）。
 */
export type ParagraphHtmlFn = (
  text: string,
  charFormat: CharacterFormat,
  paraFormat: ParagraphFormat,
  cpStart: number,
  cpEnd: number,
) => string

export function extractListItemText(text: string, listType: string): string {
  const trimmed = text.trimStart()
  // Ordered markers
  if (listType === 'ordered') {
    return trimmed
      .replace(/^\d+(?:\.\d+)+[\.\s\t]+/, '')            // 1.1 / 1.2.3
      .replace(/^\d+[\.\)][\s\t]+/, '')                   // 1. / 2)
      .replace(/^[\(\（\[]\d+[\)\）\]][\s\t]+/, '')        // (1) / （2） / [3]
      .replace(/^[a-zA-Z][\.\)][\s\t]+/, '')              // a. / B)
      .replace(/^[\(\（][a-zA-Z][\)\）][\s\t]+/, '')       // (a) / （B）
      .replace(/^(?:i{1,3}|iv|v|vi{0,3}|ix|x|I{1,3}|IV|V|VI{0,3}|IX|X)[\.\)][\s\t]+/, '') // i. / II.
      .replace(/^([一二三四五六七八九十百千零〇]{1,4}|[甲乙丙丁戊己庚辛壬癸]|[壹贰叁肆伍陆柒捌玖拾佰仟]{1,4})[\、\.\)][\s\t]*/, '') // 一、 / 甲.
      .replace(/^[\(\（]([一二三四五六七八九十]{1,4}|[甲乙丙丁戊己庚辛壬癸])[）\)][\s\t]+/, '') // （一）
      .replace(/^[\u2460-\u2473\u3251-\u325F\u32B1-\u32BF][\s\t]+/, '') // ① ②
  }
  // Unordered markers
  return trimmed
    .replace(/^[•\-\*][\s\t]+/, '')
    .replace(/^[○●▪▸►→◇◆▪▫◦‣⁃]\s*/, '')
}

interface ListItemNode {
  text: string
  level: number
  charFormat: CharacterFormat
  paraFormat: ParagraphFormat
  children: ListItemNode[]
}

/**
 * Render a (possibly nested) `<ol>` / `<ul>` from a flat list of items.
 *
 * Items are grouped by their `level` field: when a deeper item follows a
 * shallower one, it becomes a child of the previous item; when a shallower
 * item follows a deeper one, the stack pops back to the right parent.
 *
 * @param startAt - For ordered lists, the starting number (default 1). Used for list number continuation.
 */
export function renderNestedList(
  listTag: 'ol' | 'ul',
  listStyle: string,
  items: Array<{ text: string; level: number; charFormat: CharacterFormat; paraFormat: ParagraphFormat }>,
  renderParagraph: ParagraphHtmlFn,
  _startLevel: number = 0,
  startAt: number = 1,
): string {
  if (items.length === 0) return ''

  // Build a tree from the flat list using a stack.
  const root: ListItemNode = {
    text: '', level: -1,
    charFormat: {} as CharacterFormat,
    paraFormat: {} as ParagraphFormat,
    children: [],
  }
  const stack: ListItemNode[] = [root]

  for (const it of items) {
    while (stack.length > 1 && stack[stack.length - 1].level >= it.level) {
      stack.pop()
    }
    const parent = stack[stack.length - 1]
    const node: ListItemNode = {
      text: it.text,
      level: it.level,
      charFormat: it.charFormat,
      paraFormat: it.paraFormat,
      children: [],
    }
    parent.children.push(node)
    stack.push(node)
  }

  // Render the tree recursively.
  const render = (node: ListItemNode, isRoot: boolean = false): string => {
    if (node.children.length === 0) return ''
    const renderedItems = node.children.map(child => {
      const content = renderParagraph(child.text, child.charFormat, child.paraFormat, 0, child.text.length)
        .replace(/^<p[^>]*>/, '').replace(/<\/p>$/, '')
      const subList = render(child, false)
      // Apply paragraph-level font-size to li so items without char-styles
      // still get the correct font size (otherwise the <p> tag was stripped).
      const fontSize = resolveFontSize(child.charFormat.fontSize, '1.0rem')
      return `<li style="font-size:${fontSize}">${content}${subList}</li>`
    })
    const startAttr = isRoot && listTag === 'ol' && startAt > 1 ? ` start="${startAt}"` : ''
    return `<${listTag}${startAttr} style="list-style:${listStyle};padding-left:2em">${renderedItems.join('')}</${listTag}>`
  }
  return render(root, true)
}

/** renderListBlock 入参（主循环列表组收集段的显式化） */
export interface ListBlockParams {
  paragraphs: RenderParagraph[]
  startIndex: number
  listType: 'ordered' | 'unordered'
  /** 跨非列表段落的编号续接计数器（宿主持有，键=listId） */
  listCounters: Map<number, number>
  /** 条目高度估算（W3 PageBuilder 注入 estimateParaHeight） */
  estimateItemHeight: (text: string, charFormat: CharacterFormat) => number
  /** 段落渲染回调（第一层 \u0001 消费发生在其内部） */
  renderParagraph: ParagraphHtmlFn
  /** 存在可消费图片（pictures.length>0 || images.length>0，与原门卫表达式一致） */
  hasPictures: boolean
  /** 存在可消费图表（charts.length>0） */
  hasCharts: boolean
  consumePictureHtml: () => string | null
  consumeChartHtml: () => string | null
}

export interface ListBlockResult {
  html: string
  nextIndex: number
  estimatedHeight: number
}

/**
 * 渲染一个完整列表组（自 startIndex 起连续同型 listType 的段落集合）。
 * 函数体逐段对应 formatFormattedTextToHtml 主循环列表分支，含双层 \u0001 消费结构。
 */
export function renderListBlock(params: ListBlockParams): ListBlockResult {
  const {
    paragraphs, startIndex, listType, listCounters,
    estimateItemHeight, renderParagraph, hasPictures, hasCharts,
    consumePictureHtml, consumeChartHtml,
  } = params

  const firstPara = paragraphs[startIndex]
  const firstFormat = firstPara?.paraFormat as (ParagraphFormat & { listStyle?: string; listLevel?: number; listId?: number }) | undefined
  const listStyle = firstFormat?.listStyle || (listType === 'ordered' ? 'decimal' : 'disc')
  const startLevel = firstFormat?.listLevel ?? 0
  const listId = firstFormat?.listId

  const items: Array<{ text: string; level: number; charFormat: CharacterFormat; paraFormat: ParagraphFormat }> = []
  let levelZeroCount = 0
  let totalEstimatedHeight = 0
  let i = startIndex
  while (i < paragraphs.length) {
    const item = paragraphs[i]
    const itemFormat = item.paraFormat as ParagraphFormat & { listType?: string; listId?: number }
    if (itemFormat.listType !== listType) break
    const itemText = extractListItemText(item.text, listType)
    if (!itemText.trim()) { i++; continue }
    const level = itemFormat.listLevel ?? 0
    items.push({
      text: itemText,
      level,
      charFormat: item.charFormat || ({} as CharacterFormat),
      paraFormat: itemFormat,
    })
    if (level === 0) levelZeroCount++
    totalEstimatedHeight += estimateItemHeight(itemText, item.charFormat || {} as CharacterFormat)
    i++
  }

  let startAt = 1
  if (listType === 'ordered' && listId !== undefined && listId !== null) {
    const prevCount = listCounters.get(listId) || 0
    startAt = prevCount + 1
    listCounters.set(listId, prevCount + levelZeroCount)
  }

  const listTag = listType === 'ordered' ? 'ol' : 'ul'
  // 第一层消费：发生在 renderParagraph（列表项组装）内部
  let html = renderNestedList(listTag, listStyle, items, renderParagraph, startLevel, startAt)

  // 第二层消费：先图后表，两次全局 replace（顺序与短路结构逐字对应原主循环分支）
  if (html.includes('\u0001')) {
    if (hasPictures) {
      html = html.replace(/\u0001/g, () => consumePictureHtml() ?? '\u0001')
    }
    if (html.includes('\u0001') && hasCharts) {
      html = html.replace(/\u0001/g, () => consumeChartHtml() ?? '')
    }
  }

  return { html, nextIndex: i, estimatedHeight: totalEstimatedHeight }
}
