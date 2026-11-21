/**
 * documentRenderer —— 渲染总编排（T3-W3 · contract-split-r1 §1.2 Batch-C）
 *
 * 自 DocPreview.vue 原样迁出（符号名锚）：formatFormattedTextToHtml 主循环整体 +
 * renderParagraphHtml。组件侧仅留薄包装 applyFormattedPages。
 *
 * ⚠️ 行为等价红线：
 *  - 高度估算魔数群与分页断点语义由 pageBuilder 承接，数值逐一原样；
 *  - \u0001 占位符消费顺序原样保留：正文段内先图后表；列表分支为双层消费
 *    （第一层=renderParagraph 回调组装期，第二层=renderListBlock 先图后表两次 replace）；
 *  - globalChartIdx/globalPicIdx 收编为本模块内部状态，每次调用开头清零
 *    （保持原语义，解除跨文档污染隐患），不导出。
 *
 * 纯度边界（契约 §1.3）：禁 import vue/.vue、不触 DOM/window；
 * 一切外部状态经 RenderInput 显式入参（refs 解包由宿主薄包装完成）。
 */
import { applyRevisionsToText } from '../revisionRender'
import type { RevisionMode } from '../revisionRender'
import { escapeHtml } from '../textRender'
import { collectTableBlock, renderNestedTableHtml } from '../tableText'
import { renderChartHtml } from './chartRenderer'
import { renderInlinePictureHtml, renderTextboxAnchorHtml } from './inlineAssetRenderer'
import { renderListBlock } from './listRenderer'
import { formatTextWithCharacterStyles, formatTextWithDefaultStyles } from './paragraphStyleRenderer'
import { createPageBuilder } from './pageBuilder'
import type {
  CharacterFormat,
  ChartInfo,
  ParagraphFormat,
  RenderParagraph,
  RevisionMark,
  SectionInfo,
  ShapeInfo,
  Translator,
  FontResolver,
} from '../docFormat'

/** 超链接范围的结构视图（组件私有 HyperlinkRange 的最小面，共享类型收编后统一） */
export interface HyperlinkView {
  cpStart: number
  cpEnd: number
  url: string
  result: string
}

/** 图片源结构视图（结构化图片或纯 data URL 字符串，镜像原 PicSource 用法面） */
export interface PictureSource {
  format: string
  dataUrl: string
  widthPx?: number
  heightPx?: number
  floating?: boolean
  cp?: number
}

/** 渲染总编排入参（contract-split-r1 §1.2 W3 表 RenderInput） */
export interface RenderInput {
  paragraphs: RenderParagraph[]
  hyperlinks?: HyperlinkView[]
  revisions?: RevisionMark[]
  revisionMode: RevisionMode
  shapes: ShapeInfo[]
  pictures: PictureSource[]
  images: string[]
  charts: ChartInfo[]
  sections: SectionInfo[]
  pageHeightPt: number
  showHiddenText: boolean
  fontResolver: FontResolver
  t: Translator
}

// 占位符消费计数器：renderer 内部状态（每次 renderDocumentToPages 开头清零）
let chartIdx = 0
let picIdx = 0

/**
 * 超链接 URL 白名单净化。
 *
 * `.doc` 文件里的 HYPERLINK 域 instruction 完全来自外部，可能是 `javascript:`、
 * `data:`、`vbscript:` 等可执行 scheme。直接写进 `href` 会造成存储型 XSS。
 * 只放行 http/https/mailto/tel 与内部 `#anchor` / 相对路径；
 * 其余 scheme 降级为 `#`（链接文字仍可见，但不可执行）。
 */
export function sanitizeUrl(url: string): string {
  const raw = (url || '').trim()
  if (!raw) return '#'
  if (raw.startsWith('#')) return raw
  // 浏览器会忽略 scheme 中的空白/控制字符；先归一化再判定。
  // 同时处理 HTML 实体形式的冒号（`&colon;` / `&#58;` / `&#x3a;`）——
  // escapeHtml 会把 `&` 变成 `&amp;`，但浏览器解码后实体仍可能被还原为冒号。
  const normalized = raw
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&colon;/gi, ':')
    .replace(/[\u0000-\u0020]+/g, '')
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(normalized)
  if (!match) return raw // 相对路径：无 scheme，安全
  const scheme = match[1].toLowerCase()
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel' ? raw : '#'
}

/**
 * 将段落序列渲染为分页 HTML 数组（每页一个 .page-content div）。
 * 函数体逐段对应原 DocPreview.vue#formatFormattedTextToHtml。
 */
export function renderDocumentToPages(input: RenderInput): string[] {
  const { paragraphs, revisions } = input
  if (!paragraphs || paragraphs.length === 0) return ['<p>文档内容为空</p>']
  // Reset internal counters for this document rendering pass
  chartIdx = 0
  picIdx = 0

  const t = input.t
  // 入口归一化：|| [] 守卫对齐既有形态（L251/L258），防御未经组件薄包装直绑的调用方。
  // 对契约内合法输入（数组）零行为变更。
  const picturesIn = input.pictures || []
  const imagesIn = input.images || []
  const chartsIn = input.charts || []
  const allPics: PictureSource[] = picturesIn.length > 0 ? picturesIn : imagesIn.map(url => ({
    format: 'jpeg', dataUrl: url, widthPx: undefined, heightPx: undefined,
  }))

  /**
   * 段落渲染（原 renderParagraphHtml 整体迁入；refs 读取改为 input/state 闭包）。
   */
  // 核心实现：链接/修订列表由调用方显式传入——正文段传全文列表，
  // 列表项经 listVariant 传空数组（R-1 抑制语义，见下）。
  const renderParagraphHtmlCore = (
    text: string,
    charFormat: CharacterFormat,
    paraFormat: ParagraphFormat,
    paraCpStart: number,
    paraCpEnd: number,
    revisionList?: RevisionMark[],
    placements?: LinkPlacement[],
  ): string => {
    const textAlign = getTextAlignment(paraFormat)
    const isCentered = textAlign === 'center'
    const isRightAligned = textAlign === 'right'
    const hasCharStyles = charFormat.styles && charFormat.styles.length > 0

    // Apply revision marks (insert / delete) on plain text, producing <ins>/<del>
    // HTML with author + time tooltip. Sort descending by cpStart so earlier
    // insertions don't shift later offsets.
    //
    // revisionMode controls how each revision is rendered:
    //   'marks'    — <ins>/<del> tags with tooltip (default)
    //   'accepted' — insert: keep text; delete: drop text
    //   'rejected' — insert: drop text; delete: keep text
    const revisionResult = applyRevisionsToText(
      text, paraCpStart, paraCpEnd, revisionList || [], input.revisionMode
    )
    const workingText = revisionResult.text
    const hasRevisionHtml = revisionResult.hasRevisionHtml

    // Apply hyperlinks via FIELD-CP-GOV text-anchor placements (see map above).
    // Skip when revision HTML is present to avoid breaking <ins>/<del> tags
    // (revisions and hyperlinks rarely overlap; when they do, revisions win).
    // SEC-HYPERLINK-TEXT：本分支生成的 HTML 会让 hasHtml=true ⇒ 下游不再 escape。
    // 因此链接文本之外的普通文本必须在此时逐段转义，否则 .doc 正文里的
    // `<img src=x onerror=...>` 会随 `<a>` 一起进入 v-html（存储型 XSS）。
    // placements 已按 from 降序排列：从尾部向前拼接，每个普通文本段只转义一次。
    // 对不重叠的链接，除「普通文本被正确转义」外与原实现逐字节等价。
    let textWithLinks = workingText
    let hasHyperlinkHtml = false
    if (placements && placements.length > 0 && !hasRevisionHtml) {
      let out = ''
      let cursor = textWithLinks.length
      for (const pl of placements) {
        if (pl.from >= pl.to || pl.from >= cursor) continue
        out = escapeHtml(textWithLinks.substring(pl.to, cursor)) + out
        const linkText = textWithLinks.substring(pl.from, pl.to)
        out = `<a href="${escapeHtml(sanitizeUrl(pl.url))}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:underline;">${escapeHtml(linkText)}</a>` + out
        cursor = pl.from
        hasHyperlinkHtml = true
      }
      if (hasHyperlinkHtml) {
        out = escapeHtml(textWithLinks.substring(0, cursor)) + out
        textWithLinks = out
      }
    }

    let hasHtml = hasRevisionHtml || hasHyperlinkHtml

    // Replace picture placeholder characters (\u0001) with inline image or chart HTML.
    // Chart placeholders take precedence over generic images so that chart OLE objects
    // are not accidentally rendered as unrelated embedded pictures.
    // Uses the renderer-internal counters to ensure each chart/image
    // is consumed only once across all paragraphs.
    const hasPicPlaceholder = textWithLinks.includes('\u0001')
    if (hasPicPlaceholder) {
      // Phase 1: Replace placeholders with images first.
      // Images take priority over charts for \u0001 placeholders because charts
      // are also inserted via the justFinishedList logic (after a list group, before
      // the next long body paragraph). If charts consumed \u0001 placeholders first,
      // they would appear inside the list (e.g., between list items) instead of
      // after the entire list.
      if (picturesIn.length > 0 || imagesIn.length > 0) {
        let replaced = 0
        textWithLinks = textWithLinks.replace(/\u0001/g, () => {
          if (picIdx < allPics.length) {
            replaced++
            const pic = allPics[picIdx++]
            const src = typeof pic === 'string' ? pic : pic.dataUrl
            const style = 'max-width:100%;height:auto;margin:8px 0;'
            return `<img src="${src}" alt="Embedded image" style="${style}" loading="lazy" />`
          }
          return '\u0001'
        })
        // DEF-005 方案A（captain v39/v40 · vue-dev-4 INV 推荐项）：实际替换发生即置
        // hasHtml=true，防止 <img> 被最终回退分支用原始 text 整体丢弃。
        if (replaced > 0) hasHtml = true
      }
      // Phase 2: Replace any remaining placeholders with charts.
      if (textWithLinks.includes('\u0001') && chartsIn.length > 0) {
        textWithLinks = textWithLinks.replace(/\u0001/g, () => {
          if (chartIdx < chartsIn.length) {
            const chart = chartsIn[chartIdx++]
            hasHtml = true
            return renderChartHtml(chart, chartIdx, t)
          }
          return ''
        })
        hasHtml = true
      }
    }

    // 软换行 (\v = Shift+Enter) 转换为 <br>（在所有基于偏移的处理完成后）
    const hasSoftBreak = text.includes('\v')
    const applySoftBreaks = (html: string): string => {
      if (!hasSoftBreak) return html
      // 注意：软换行在原始文本中是 \v，在 HTML 输出中也需要替换
      // 但由于 escapeHtml 不会转义 \v 为特殊字符，直接替换即可
      return html.replace(/\v/g, '<br>')
    }

    if (hasCharStyles) {
      return applySoftBreaks(formatTextWithCharacterStyles(textWithLinks, charFormat.styles!, {
        isCentered,
        isRightAligned,
        charFormat: { ...charFormat },
        paraFormat: { ...paraFormat },
        showHiddenText: input.showHiddenText,
        fontResolver: input.fontResolver,
      }, hasHtml))
    }

    if (hasHtml) {
      return applySoftBreaks(formatTextWithDefaultStyles(textWithLinks, charFormat, paraFormat, {
        isCentered,
        isRightAligned,
        showHiddenText: input.showHiddenText,
        fontResolver: input.fontResolver,
      }, true))
    }

    return applySoftBreaks(formatTextWithDefaultStyles(text, charFormat, paraFormat, {
      isCentered,
      isRightAligned,
      showHiddenText: input.showHiddenText,
      fontResolver: input.fontResolver,
    }))
  }

  // 正文段变体：消费全文超链接/修订列表（原组件直调语义）+ 该段的链接放置
  const renderParagraphHtml = (
    text: string,
    charFormat: CharacterFormat,
    paraFormat: ParagraphFormat,
    paraCpStart: number,
    paraCpEnd: number,
    paraIndex?: number,
  ): string => renderParagraphHtmlCore(text, charFormat, paraFormat, paraCpStart, paraCpEnd, revisions, paraIndex !== undefined ? placementsByPara.get(paraIndex) : undefined)

  // R-1 列表项变体：捕获空数组，恢复「列表项刻意不吃全文链接与修订」的抑制语义
  const renderParagraphHtmlInList = (
    text: string,
    charFormat: CharacterFormat,
    paraFormat: ParagraphFormat,
    paraCpStart: number,
    paraCpEnd: number,
  ): string => renderParagraphHtmlCore(text, charFormat, paraFormat, paraCpStart, paraCpEnd, undefined, undefined)

  /** 对齐推导（原 getTextAlignment，charFormat 参数从未参与推导，随迁移去除形参） */
  function getTextAlignment(paraFormat: ParagraphFormat): string {
    if (paraFormat.alignment) return paraFormat.alignment
    return 'justify'
  }

  // Build a sorted list of textbox shapes with anchor CP for inline markers.
  // These shapes are rendered as floating markers at their anchor paragraph
  // to indicate where the textbox is positioned in the document.
  const textBoxShapes = (input.shapes || [])
    .filter(s => s.type === 'textbox' && s.anchorCp !== undefined && s.anchorCp > 0)
    .slice()
    .sort((a, b) => (a.anchorCp! - b.anchorCp!))

  // Build a sorted list of inline pictures (those with a known CP position)
  // for rendering at the corresponding paragraph in the document body.
  const inlinePictures = (input.pictures || [])
    .filter(p => p.cp !== undefined && p.cp >= 0 && !p.floating)
    .slice()
    .sort((a, b) => (a.cp! - b.cp!))

  const lowerBoundCp = <T,>(items: T[], cpOf: (item: T) => number, target: number): number => {
    let low = 0
    let high = items.length
    while (low < high) {
      const mid = low + Math.floor((high - low) / 2)
      if (cpOf(items[mid]) < target) low = mid + 1
      else high = mid
    }
    return low
  }

  const upperBoundCp = <T,>(items: T[], cpOf: (item: T) => number, target: number): number => {
    let low = 0
    let high = items.length
    while (low < high) {
      const mid = low + Math.floor((high - low) / 2)
      if (cpOf(items[mid]) <= target) low = mid + 1
      else high = mid
    }
    return low
  }

  const cpRange = <T,>(items: T[], cpOf: (item: T) => number, start: number, endInclusive: number): [number, number] => [
    lowerBoundCp(items, cpOf, start),
    upperBoundCp(items, cpOf, endInclusive),
  ]

  interface CpRangeCursor {
    startIndex: number
    endIndex: number
    previousStart: number
    previousEnd: number
    monotonic: boolean
  }

  const createCpRangeCursor = (): CpRangeCursor => ({
    startIndex: 0,
    endIndex: 0,
    previousStart: Number.NEGATIVE_INFINITY,
    previousEnd: Number.NEGATIVE_INFINITY,
    monotonic: true,
  })

  const nextCpRange = <T,>(
    items: T[],
    cpOf: (item: T) => number,
    start: number,
    endInclusive: number,
    cursor: CpRangeCursor,
  ): [number, number] => {
    if (cursor.monotonic && (start < cursor.previousStart || endInclusive < cursor.previousEnd)) {
      cursor.monotonic = false
    }
    if (!cursor.monotonic) {
      return cpRange(items, cpOf, start, endInclusive)
    }

    while (cursor.startIndex < items.length && cpOf(items[cursor.startIndex]) < start) {
      cursor.startIndex++
    }
    while (cursor.endIndex < items.length && cpOf(items[cursor.endIndex]) <= endInclusive) {
      cursor.endIndex++
    }
    cursor.previousStart = start
    cursor.previousEnd = endInclusive
    return [cursor.startIndex, cursor.endIndex]
  }

  // ═══ FIELD-CP-GOV 渲染侧修复：链接放置改为「结果文本锚定」═══
  // 调查结论（2026-08-26，详见 docs/changelog/FIELD-CP-GOV-parser-spec.md）：
  // fieldParser 产出的 FieldRange.cpStart/cpEnd 为原始流轴（含域字符与指令），
  // 而段落 _cpStart/text 为剥离变换系——两轴不可比，原 CP 窗口过滤恒空（<a> 不可达根因之一）。
  // 故放置不再依赖 CP 算术：按文档序为每个携带 url 的链接在其 result 文本首次出现的
  // 非列表段落中锚定；result 因解析侧 F2（extractAllFields result 切片轴错位）无匹配时
  // 维持无链接，待 vue-dev-1 parser 修复落地后自然生效。列表项抑制语义（R-1）不变：
  // 列表段不参与锚定扫描。
  interface LinkPlacement { url: string; from: number; to: number }
  const placementsByPara = new Map<number, LinkPlacement[]>()
  if (input.hyperlinks && input.hyperlinks.length > 0) {
    // Cache the first eligible paragraph position for each result text. Duplicate
    // field results still produce one placement per link, but do not rescan the
    // paragraph list for every duplicate link.
    const firstPlacementByResult = new Map<string, { paragraphIndex: number; offset: number } | null>()
    for (const link of input.hyperlinks) {
      if (!link.url || !link.result) continue

      if (!firstPlacementByResult.has(link.result)) {
        let firstPlacement: { paragraphIndex: number; offset: number } | null = null
        for (let pi = 0; pi < paragraphs.length; pi++) {
          if (paragraphs[pi].paraFormat?.listType) continue // 列表项抑制（R-1）
          const at = (paragraphs[pi].text || '').indexOf(link.result)
          if (at >= 0) {
            firstPlacement = { paragraphIndex: pi, offset: at }
            break
          }
        }
        firstPlacementByResult.set(link.result, firstPlacement)
      }

      const firstPlacement = firstPlacementByResult.get(link.result)
      if (firstPlacement) {
        const list = placementsByPara.get(firstPlacement.paragraphIndex) ?? []
        list.push({
          url: link.url,
          from: firstPlacement.offset,
          to: firstPlacement.offset + link.result.length,
        })
        placementsByPara.set(firstPlacement.paragraphIndex, list)
      }
    }
    // Each paragraph's placements are applied from right to left so earlier offsets remain stable.
    for (const list of placementsByPara.values()) {
      list.sort((a, b) => b.from - a.from)
    }
  }

  const builder = createPageBuilder({ pageHeightPt: input.pageHeightPt, sections: input.sections })
  const { result, finalizePage, addToPage, estimateParaHeight, applySectionForCp } = builder
  const textBoxRangeCursor = createCpRangeCursor()
  const inlinePictureRangeCursor = createCpRangeCursor()

  let i = 0
  const listCounters = new Map<number, number>()
  // Track whether we just finished rendering a list group.
  // In the original .doc, floating charts often occupy empty paragraphs
  // right after a list group. When the parser encounters the first long
  // body paragraph after a list, we insert any unconsumed charts there.
  let justFinishedList = false

  while (i < paragraphs.length) {
    const para = paragraphs[i]
    const text = para.text
    // Render empty paragraphs as blank lines (matching the original document's
    // spacing). Previously these were skipped, causing lost vertical spacing
    // between sections (e.g., after title, subtitle, section headings).
    if (!text || !text.trim()) {
      addToPage('<p style="margin:0;padding:0;height:0.6em;">&nbsp;</p>', 8)
      i++
      continue
    }

    const visibleLen = text.replace(/\u0001/g, '').length
    const isList = !!para.paraFormat?.listType

    // When the previous block was a list and the current paragraph is a
    // long body paragraph (>= 100 chars), render any unconsumed charts
    // here — this is where the chart's empty placeholder paragraphs were
    // in the original document (between the list and the next body text).
    if (justFinishedList && visibleLen >= 100 && !isList && chartIdx < chartsIn.length) {
      const chart = chartsIn[chartIdx++]
      addToPage(renderChartHtml(chart, chartIdx, t), 200)
    }
    // Reset the flag only for non-list paragraphs that have actual content.
    // Pure image/placeholder paragraphs (visibleLen === 0) should not reset
    // the flag, as they are part of the post-list visual block and charts
    // should still be inserted before the next real body paragraph.
    if (!isList && visibleLen > 0) justFinishedList = false

    // Track which section this paragraph belongs to and update column settings.
    // When the column count changes (section switch), finalize the current page
    // so that content with different column layouts stays in separate pages.
    const paraCp = para._cpStart || 0
    applySectionForCp(paraCp)

    const paraFormat = para.paraFormat
    const listType = paraFormat?.listType
    const tableBlock = collectTableBlock(paragraphs, i)

    if (tableBlock) {
      const html = renderNestedTableHtml(tableBlock.rows, tableBlock.rowsTableInfo, tableBlock.rowsDepth, tableBlock.headerRowCount)
      const estimatedHeight = 100
      addToPage(html, estimatedHeight)
      i = tableBlock.nextIndex
      continue
    }

    if (listType === 'ordered' || listType === 'unordered') {
      // 列表组收集+编号续接+\u0001 双层消费：整体委托 listRenderer.renderListBlock，
      // 消费闭包逐字镜像原内联实现（含门卫折算与 img 标记串）。
      const block = renderListBlock({
        paragraphs,
        startIndex: i,
        listType,
        listCounters,
        estimateItemHeight: estimateParaHeight,
        renderParagraph: renderParagraphHtmlInList,
        hasPictures: picturesIn.length > 0 || imagesIn.length > 0,
        hasCharts: chartsIn.length > 0,
        consumePictureHtml: () => {
          if (picIdx < allPics.length) {
            const pic = allPics[picIdx++]
            const src = typeof pic === 'string' ? pic : pic.dataUrl
            const style = 'max-width:100%;height:auto;margin:8px 0;'
            return `<img src="${src}" alt="Embedded image" style="${style}" loading="lazy" />`
          }
          return null
        },
        consumeChartHtml: () => {
          if (chartIdx < chartsIn.length) {
            return renderChartHtml(chartsIn[chartIdx++], chartIdx, t)
          }
          return null
        },
      })

      addToPage(block.html, block.estimatedHeight)
      i = block.nextIndex
      // Mark that we just finished rendering a list group, so that the
      // next long body paragraph can trigger chart insertion (charts
      // often follow a list in the original document).
      justFinishedList = true
    } else {
      const charFormat = para.charFormat || {} as CharacterFormat
      const paraCpStart = para._cpStart || 0
      const paraCpEnd = paraCpStart + (text?.length || 0)
      const html = renderParagraphHtml(text, charFormat, paraFormat, paraCpStart, paraCpEnd, i)
      const estimatedHeight = estimateParaHeight(text, charFormat)
      if (paraFormat.pageBreakBefore) {
        finalizePage()
      }
      addToPage(html, estimatedHeight)

      // Render textbox floating markers anchored to this paragraph.
      // Each textbox shape whose anchorCp falls within [paraCpStart, paraCpEnd]
      // gets a floating marker displayed after the paragraph.
      if (textBoxShapes.length > 0) {
        const [start, end] = nextCpRange(textBoxShapes, shape => shape.anchorCp!, paraCpStart, paraCpEnd + 1, textBoxRangeCursor)
        for (let assetIndex = start; assetIndex < end; assetIndex++) {
          addToPage(renderTextboxAnchorHtml(textBoxShapes[assetIndex], t), 24)
        }
      }

      // Render inline pictures anchored to this paragraph.
      // Each picture whose cp falls within [paraCpStart, paraCpEnd]
      // gets rendered as an inline image within the paragraph.
      if (inlinePictures.length > 0) {
        const [start, end] = nextCpRange(inlinePictures, pic => pic.cp!, paraCpStart, paraCpEnd + 1, inlinePictureRangeCursor)
        for (let assetIndex = start; assetIndex < end; assetIndex++) {
          const pic = inlinePictures[assetIndex]
          const picHtml = renderInlinePictureHtml(pic, t)
          const picHeight = pic.heightPx ? Math.min(pic.heightPx, 400) : 200
          addToPage(picHtml, picHeight + 16)
        }
      }
      i++
    }
  }

  // Render any remaining charts that weren't consumed by \u0001 placeholders.
  // This happens when the chart's OLE placeholder was stripped during text
  // extraction (e.g., HYPERLINK field cleanup removed the \u0001 marker).
  // Appending to the end keeps the chart visible after the body text.
  const usedChartCount = chartIdx
  for (let ci = usedChartCount; ci < chartsIn.length; ci++) {
    const chart = chartsIn[ci]
    const chartHtml = renderChartHtml(chart, ci + 1, t)
    addToPage(chartHtml, 200)
  }

  // Render any remaining pictures that weren't consumed by \u0001 placeholders.
  // This handles floating images or images without a character position anchor.
  // || 守卫已收编至入口归一化（picturesIn/imagesIn/chartsIn），此处沿用
  const usedPicCount = picIdx
  for (let pi = usedPicCount; pi < allPics.length; pi++) {
    const pic = allPics[pi]
    // Skip pictures that were already rendered inline (they have a valid cp)
    if (typeof pic !== 'string' && pic.cp !== undefined && pic.cp >= 0) continue
    const src = typeof pic === 'string' ? pic : pic.dataUrl
    const style = 'max-width:100%;height:auto;margin:8px 0;'
    const imgHtml = `<img src="${src}" alt="Embedded image" style="${style}" loading="lazy" />`
    addToPage(imgHtml, 200)
  }

  finalizePage()

  return result
}
