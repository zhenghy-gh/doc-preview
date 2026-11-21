<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, onErrorCaptured, nextTick } from 'vue'
import { parseDocFileWithFormat, parseDocFileFromBuffer } from '../utils/docParser'
import type { ParseProgressStage } from '../utils/docParser'
import { parseWithWorker } from '../utils/parseWithWorker'
import { renderDocumentToPages } from '../utils/rendering/documentRenderer'
import { PT_TO_PX } from '../utils/rendering/pageBuilder'
import type { CharacterFormat, ParagraphFormat, RevisionMark, RevisionType, BookmarkRange, SectionInfo, PageFieldRange, CrossReferenceRange, ShapeInfo, EquationInfo, ChartInfo, WordArtInfo, RenderParagraph } from '../utils/docFormat'
import type { DocumentFields } from '../utils/fieldParser'
import { formatRevisionTime, type RevisionMode } from '../utils/revisionRender'
import { htmlToMarkdown } from '../utils/markdownExport'
import { highlightTextMatches, clearSearchHighlights } from '../utils/searchUtils'
import { escapeHtml, formatTextWithInferredFormat } from '../utils/textRender'
import { WORD_VERSION_LABELS, type WordVersion } from '../utils/fibParser'
import { t, currentLocale } from '../utils/locale'
import { useDarkMode } from '../composables/useDarkMode'
import ShortcutsPanel from './ShortcutsPanel.vue'
import LoadingOverlay from './LoadingOverlay.vue'
import ErrorDisplay from './ErrorDisplay.vue'
import CollapsiblePanel from './CollapsiblePanel.vue'
import BookmarksPanel from './BookmarksPanel.vue'
import TocIndexPanel from './TocIndexPanel.vue'

/**
 * DocPreview —— .doc 解析结果的渲染宿主组件。
 *
 * 数据流：props.source（File | URL）→ parseDocFileWithFormat / parseWithWorker
 *   （>1MB 走 Worker，阶段进度经 ParseProgressStage 回写）→ ParserOutput
 *   → applyFormattedPages → renderDocumentToPages 产出分页 HTML 数组 pages
 *   → 虚拟滚动窗口（visibleStart/End）按需挂载 .page-host；未渲染页由
 *     pageHeights 缓存（布局像素，data-page-idx 绝对页码键）撑起等高占位。
 *
 * 子系统分区（与文内 // ---- 区块横幅一一对应）：分页导航 · 大纲 · Web Font ·
 * story 文本 · 加载与错误边界 · 渲染接线 · 虚拟滚动（PERF-T1 语义基线见
 * measureVisiblePageHeights/updateVisibleRange 注释）· 缩放（FIX-VUEW：CSS
 * zoom 真实回流）· 搜索高亮（searchUtils 委托）· 打印与三格式导出 · 剪贴板 ·
 * 键盘快捷键 · 侧栏面板群（CollapsiblePanel）。
 * i18n 经 utils/locale 单例 t() 消费；统一入口后续收敛 useI18n()（ShortcutsPanel
 * 已先行）。本文档性注释由 DOC-POLISH 维护：只述现状契约，不含行号（易漂移）。
 */

const WORKER_THRESHOLD = 1024 * 1024 // 1MB — files larger than this use Web Worker
const isWorkerSupported = typeof Worker !== 'undefined'
const isUsingWorker = ref(false)

// ---- Types ----

interface PictureInfo {
  format: string
  dataUrl: string
  widthPx?: number
  heightPx?: number
  floating?: boolean
  cp?: number
}

interface ParserOutput {
  success: boolean
  document?: { paragraphs: FormattedParagraphOutput[]; stories?: DocumentStories; images?: string[]; pictures?: PictureInfo[]; hyperlinks?: HyperlinkRange[]; toc?: TocEntry[]; index?: IndexEntry[]; properties?: DocumentProperties; docFlags?: DocumentFlags; wordVersion?: string; revisions?: RevisionMark[]; documentFields?: DocumentFields; bookmarks?: BookmarkRange[]; sections?: SectionInfo[]; pageFields?: PageFieldRange[]; crossReferences?: CrossReferenceRange[]; shapes?: ShapeInfo[]; equations?: EquationInfo[]; charts?: ChartInfo[]; wordArts?: WordArtInfo[]; styleSet?: { name: string; isCustom?: boolean } }
  text?: string
  error?: string
}

interface HyperlinkRange {
  cpStart: number
  cpEnd: number
  url: string
  result: string
}

interface TocEntry {
  level: number
  text: string
  pageNumber?: string
  cp?: number
}

interface IndexEntry {
  mainTerm: string
  subTerm?: string
  pageNumber?: string
  cp?: number
}

interface DocumentFlags {
  facingPages?: boolean
  titlePage?: boolean
  pmhMain?: boolean
  trackChanges?: boolean
  ftnRestart?: boolean
  ftnEnd?: boolean
  ftnAtEnd?: boolean
}

interface DocumentProperties {
  title?: string
  subject?: string
  author?: string
  keywords?: string
  comments?: string
  lastAuthor?: string
  pageCount?: number
  wordCount?: number
  charCount?: number
  template?: string
  appName?: string
  revisionNumber?: string
  editTime?: number
  createdTime?: number
  lastSavedTime?: number
  category?: string
  company?: string
  manager?: string
  lineCount?: number
  paragraphCount?: number
  byteCount?: number
  charCountWithSpaces?: number
}

interface DocumentStories {
  headers?: string
  headerParts?: Partial<Record<string, string>>
  headerPartsWithImages?: Partial<Record<string, { text: string; images?: Array<{ format: string; dataUrl: string; widthPx?: number; heightPx?: number; floating?: boolean }> }>>
  footnotes?: string
  endnotes?: string
  comments?: string
  textboxes?: string
}

interface StorySection {
  key: keyof DocumentStories | string
  label: string
  text: string
  images?: Array<{ dataUrl: string; widthPx?: number; heightPx?: number; format?: string }>
}

interface FormattedParagraphOutput {
  text: string
  charFormat: CharacterFormat
  paraFormat: ParagraphFormat
  /** 段落在文档字符流中的起始 CP（解析器内部字段，用于超链接/图片/形状定位）。 */
  _cpStart?: number
}

interface OutlineItem {
  text: string
  level: number
  index: number
}

interface SearchMatch {
  index: number
  text: string
  element: HTMLElement
}

// ---- Props & Emits ----

const props = defineProps<{
  source: File | string | null
  useWebFont?: boolean
}>()

const emit = defineEmits<{
  error: [message: string]
  loaded: []
  loading: [isLoading: boolean]
}>()

// ---- State ----

const fileName = ref('')
const htmlContent = ref('')
const plainText = ref('')
const loading = ref(true)
const error = ref('')
const loadingTime = ref(0)
const loadingTimer = ref<ReturnType<typeof setInterval> | null>(null)
const fileSize = ref('')
const progressStep = ref('')
const progressPercent = ref<number>(-1)

// 上次加载的源（用于错误重试）
const lastSource = ref<{ type: 'file'; file: File } | { type: 'url'; url: string } | null>(null)

/** 将解析阶段映射为本地化的进度提示文字 */
function getProgressStepText(stage: ParseProgressStage): string {
  switch (stage) {
    case 'verifying':
      return t('loading.progress.reading')
    case 'parsing_fib':
    case 'parsing_clx':
    case 'parsing_formats':
    case 'parsing_fields':
    case 'parsing_shapes':
      return t('loading.progress.parsing')
    case 'building_paragraphs':
    case 'extracting_properties':
    case 'extracting_images':
    case 'finalizing':
      return t('loading.progress.rendering')
    default:
      return t('loading.text')
  }
}

// --- Virtual scroll (page-level) ---
// pages: 每页的 HTML 字符串数组（与 .page-content 一一对应）
// virtualScrollEnabled: 是否启用虚拟滚动（搜索/打印时临时关闭）
// visibleStart/visibleEnd: 当前可视页面索引范围（含缓冲区）
// pageHeights: 已渲染页面的真实高度缓存（px），用于占位高度计算
const pages = ref<string[]>([])
const virtualScrollEnabled = ref(true)
const visibleStart = ref(0)
const visibleEnd = ref(0)
const pageHeights = ref<Record<number, number>>({})
let scrollTicking = false
const VIRTUAL_BUFFER = 1 // 上下各缓冲的页面数

// 缓存最近的解析结果，用于切换隐藏文字/修订显示等需要重新渲染的场景
const lastParseResult = ref<{
  paragraphs: ParaWithList[]
  hyperlinks?: HyperlinkRange[]
  revisions?: RevisionMark[]
} | null>(null)

// --- Outline / TOC ---
const outline = ref<OutlineItem[]>([])
const showOutline = ref(false)
const previewRef = ref<HTMLElement | null>(null)

// --- Shortcuts panel ---
const showShortcuts = ref(false)

// --- Zoom ---
const zoomLevel = ref(100)
const MIN_ZOOM = 50
const MAX_ZOOM = 200
const ZOOM_STEP = 10

// --- Dark mode ---
// W1-C: 暗黑模式单一数据源 —— 状态/class 挂载/localStorage 持久化收敛到
// composables/useDarkMode.ts（与 App.vue 共享同一 ref），本组件只消费。
const { darkMode, toggleDarkMode } = useDarkMode()

// --- Pagination ---
const currentPage = ref(1)
const totalPages = ref(1)
const pageHeight = ref(842)
const PAGE_HEIGHT_A4 = 842

/**
 * 同步分页基准高度 pageHeight（pt）：优先取第一节 pageHeightPt，否则回落 A4(842pt)。占位估算与页面定位共用。
 */
function updatePageHeight() {
  if (sections.value.length > 0) {
    const firstSection = sections.value[0]
    if (firstSection.pageHeightPt) {
      pageHeight.value = firstSection.pageHeightPt
      return
    }
  }
  pageHeight.value = PAGE_HEIGHT_A4
}

/**
 * 跳转到指定页（1-based）：越界为 no-op；更新 currentPage 并平滑滚动到该页。
 */
function goToPage(page: number) {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  scrollToPage(page)
}

/**
 * 上一页（已在首页时 no-op）。
 */
function goToPrevPage() {
  if (currentPage.value > 1) {
    goToPage(currentPage.value - 1)
  }
}

/**
 * 下一页（已在末页时 no-op）。
 */
function goToNextPage() {
  if (currentPage.value < totalPages.value) {
    goToPage(currentPage.value + 1)
  }
}

/**
 * 平滑滚动到指定页：虚拟滚动下目标页可能未渲染，先扩窗确保其进入可视范围再滚动；真实页缺失时回退滚动对应占位 div。
 */
function scrollToPage(page: number) {
  // 虚拟滚动下，目标页面可能未渲染。先扩大可视范围确保目标页可见，再滚动。
  const idx = page - 1
  if (virtualScrollEnabled.value && pages.value.length > VIRTUAL_BUFFER * 2 + 1) {
    if (idx < visibleStart.value || idx > visibleEnd.value) {
      visibleStart.value = Math.max(0, idx - VIRTUAL_BUFFER)
      visibleEnd.value = Math.min(pages.value.length - 1, idx + VIRTUAL_BUFFER)
    }
  }
  nextTick(() => {
    const container = previewRef.value?.querySelector('.document-content')
    if (!container) return
    const pageElements = container.querySelectorAll('.page-content')
    const target = pageElements[idx]
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      // 回退：滚动到占位 div；无滚动 API 时保持兼容（如 SSR/测试环境）。
      const placeholders = container.querySelectorAll('.page-placeholder')
      const ph = placeholders[idx]
      if (ph && typeof ph.scrollIntoView === 'function') {
        ph.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  })
}

/**
 * 以 pages 数组长度刷新 totalPages（不依赖 DOM 中实际渲染的 .page-content 数量），并钳制越界的 currentPage。
 */
function updateTotalPages() {
  // 虚拟滚动下用 pages 数组长度，避免依赖 DOM 中实际渲染的 .page-content 数量
  nextTick(() => {
    totalPages.value = pages.value.length || 1
    if (currentPage.value > totalPages.value) {
      currentPage.value = totalPages.value
    }
  })
}

// --- Search ---
const showSearch = ref(false)
const searchQuery = ref('')
const searchResults = ref<SearchMatch[]>([])
const currentSearchIndex = ref(-1)
const searchInputRef = ref<HTMLInputElement | null>(null)
const searchToggleRef = ref<HTMLButtonElement | null>(null)
const originalHtml = ref('') // saved before search highlighting
const searchCaseSensitive = ref(false)
const searchWholeWord = ref(false)

// --- Document stats ---
const wordCount = ref(0)
const charCount = ref(0)
const paragraphCount = ref(0)
const chineseCharCount = ref(0)
const isRichFormat = ref(false)

// --- Stories (headers / footnotes / endnotes / comments / textboxes) ---
const stories = ref<DocumentStories | null>(null)
const showStories = ref(false)
// STORY_LABELS removed, use t('story.' + key) instead

// --- Embedded images extracted from the Data stream ---
const images = ref<string[]>([])
const pictures = ref<PictureInfo[]>([])
// const showImages = ref(false)

// --- Hyperlinks extracted from PlcfFld ---
const hyperlinks = ref<HyperlinkRange[]>([])

// --- Table of Contents ---
const toc = ref<TocEntry[]>([])
const showToc = ref(false)

// --- Index ---
const index = ref<IndexEntry[]>([])
const showIndex = ref(false)

// --- Revision marks (track changes: insert / delete) ---
const revisions = ref<RevisionMark[]>([])
const showRevisions = ref(false)
/**
 * 修订显示模式：
 * - 'marks'    : 显示修订标记（<ins>/<del>，默认）
 * - 'accepted' : 接受全部修订（insert 保留文本，delete 移除文本）
 * - 'rejected' : 拒绝全部修订（insert 移除文本，delete 保留文本）
 */
const revisionMode = ref<RevisionMode>('marks')

// --- Bookmarks ---
const bookmarks = ref<BookmarkRange[]>([])
const showBookmarks = ref(false)

// --- Sections (page layout) ---
const sections = ref<SectionInfo[]>([])
const showSections = ref(false)

// --- Page fields (PAGE / NUMPAGES / SECTION / SECTIONPAGES) ---
const pageFields = ref<PageFieldRange[]>([])
const showPageFields = ref(false)

// PAGE_FIELD_TYPE_LABEL removed, use t('pageFields.type.' + type) instead

// --- Cross-references (REF / NOTEREF) ---
const crossReferences = ref<CrossReferenceRange[]>([])
const showCrossReferences = ref(false)

// CROSS_REF_TYPE_LABEL removed, use t('crossRefs.type.' + type) instead

// CROSS_REF_SWITCH_LABEL removed, use t('crossRefs.switch.' + key) instead

// --- Shapes (Office Art Drawing Container) ---
const shapes = ref<ShapeInfo[]>([])
const showShapes = ref(false)

// --- Equations (Equation Editor OLE objects) ---
const equations = ref<EquationInfo[]>([])
const showEquations = ref(false)

// --- Charts (MSGraph/Excel/SmartArt OLE objects) ---
const charts = ref<ChartInfo[]>([])
// const showCharts = ref(false)

// --- WordArt (Office Art Drawing WordArt objects) ---
const wordArts = ref<WordArtInfo[]>([])
const showWordArts = ref(false)

// --- Style Set ---
const styleSet = ref<{ name: string; isCustom?: boolean } | null>(null)

// SHAPE_TYPE_LABEL removed, use t('shapes.type.' + type) instead

// SHAPE_ANCHOR_LABEL removed, use t('shapes.anchor.' + type) instead

// BREAK_TYPE_LABEL removed, use t('sections.break.' + type) instead

// CHART_TYPE_LABEL removed, use t('charts.type.' + type) instead

// CHART_SUBTYPE_LABEL removed, use t('charts.subtype.' + type) instead

function getWordArtEffectLabel(effect: string): string {
  return t('wordart.effect.' + effect) || t('wordart.effect.unknown')
}

/**
 * 尺寸格式化：pt → “x.x磅 (y.yy cm)”；undefined/≤0 返回空串。单位文案暂未 i18n（审计 A5 备忘项）。
 */
function formatSizePt(pt: number | undefined): string {
  if (pt === undefined || pt <= 0) return ''
  // 磅 → 厘米：1 磅 = 0.0353 cm
  const cm = (pt * 0.0353).toFixed(2)
  return t('sections.sizePt', { pt: pt.toFixed(1), cm })
}

// --- Hidden text ---
const showHiddenText = ref(false)

const revisionItems = computed<Array<{ type: RevisionType; label: string; author: string; time: string; count: number }>>(() => {
  if (!revisions.value.length) return []
  // Group by (type + author + timestamp) to collapse consecutive marks from the same author.
  const groups = new Map<string, { type: RevisionType; author: string; time: string; count: number }>()
  for (const r of revisions.value) {
    const author = r.author || (r.authorIndex !== undefined ? t('revision.author.prefix', { i: r.authorIndex }) : t('revisions.author.unknown'))
    const time = formatRevisionTime(r.timestamp)
    const key = `${r.type}|${author}|${time}`
    const existing = groups.get(key)
    if (existing) {
      existing.count++
    } else {
      groups.set(key, {
        type: r.type,
        author,
        time,
        count: 1,
      })
    }
  }
  const typeLabel: Record<RevisionType, string> = {
    insert: t('revisions.type.insert'),
    delete: t('revisions.type.delete'),
    format: t('revisions.type.format'),
  }
  return Array.from(groups.values()).map(g => ({ ...g, label: typeLabel[g.type] }))
})

// --- Web Font ---
const webFontLoaded = ref(false)

const FONT_ALIASES: Record<string, string[]> = {
  '宋体': ['Noto+Serif+SC', 'SimSun'],
  '仿宋': ['Noto+Serif+SC', 'FangSong'],
  '仿宋_GB2312': ['Noto+Serif+SC', 'FangSong_GB2312'],
  '黑体': ['Noto+Sans+SC', 'SimHei'],
  '楷体': ['Noto+Serif+SC', 'KaiTi'],
  '隶书': ['Noto+Serif+SC', 'LiSu'],
  '幼圆': ['Noto+Sans+SC', 'YouYuan'],
  'Times New Roman': ['Noto+Serif', 'Times+New+Roman'],
  'Arial': ['Noto+Sans', 'Arial'],
  'Verdana': ['Noto+Sans', 'Verdana'],
  'Georgia': ['Noto+Serif', 'Georgia'],
  'Microsoft YaHei': ['Noto+Sans+SC', 'Microsoft+YaHei'],
  '微软雅黑': ['Noto+Sans+SC', 'Microsoft+YaHei'],
  '华文中宋': ['Noto+Serif+SC', 'STZhongsong'],
  '华文仿宋': ['Noto+Serif+SC', 'STFangsong'],
  '华文黑体': ['Noto+Sans+SC', 'STHeiti'],
  '华文楷体': ['Noto+Serif+SC', 'STKaiti'],
  '新宋体': ['Noto+Serif+SC', 'NSimSun'],
}

/**
 * 按需加载 Google Fonts Web Font：注入 stylesheet，成功后应用字体覆盖样式；失败仅 console.warn 并回落系统字体。webFontLoaded 门闩保证幂等。
 */
function loadWebFonts() {
  if (!props.useWebFont || webFontLoaded.value) return

  const families = 'Noto+Serif+SC|Noto+Sans+SC|Noto+Serif|Noto+Sans'
  const link = document.createElement('link')
  link.href = `https://fonts.googleapis.com/css2?family=${families}&display=swap`
  link.rel = 'stylesheet'
  link.onload = () => {
    webFontLoaded.value = true
    injectWebFontOverrides()
  }
  link.onerror = () => {
    console.warn('Web Font loading failed, falling back to system fonts')
  }
  document.head.appendChild(link)
}

/**
 * 字体名 → Web Font CSS 前缀（“Google Font, ” 含尾逗号供调用方直接拼接）；未启用或无别名映射时返回空串。
 */
function getWebFontFamily(fontName?: string): string {
  if (!props.useWebFont) return ''

  const alias = fontName ? FONT_ALIASES[fontName] : undefined
  if (alias) {
    const googleFont = alias[0].replace('+', ' ')
    return `${googleFont}, `
  }
  return ''
}

/**
 * 注入/更新全局 <style id=doc-preview-webfont-overrides>，把 .document-content 各级元素 font-family 覆盖为 Noto 系列回退链（!important）。
 */
function injectWebFontOverrides() {
  if (!props.useWebFont) return

  const styleId = 'doc-preview-webfont-overrides'
  let style = document.getElementById(styleId) as HTMLStyleElement
  if (!style) {
    style = document.createElement('style')
    style.id = styleId
    document.head.appendChild(style)
  }

  style.textContent = `
    .document-content h1 {
      font-family: 'Noto Serif SC', '华文中宋', 'SimHei', serif !important;
    }
    .document-content h2 {
      font-family: 'Noto Serif SC', '华文中宋', 'SimHei', serif !important;
    }
    .document-content h3 {
      font-family: 'Noto Serif SC', serif !important;
    }
    .document-content p {
      font-family: 'Noto Serif SC', '宋体', 'SimSun', serif !important;
    }
    .document-content li {
      font-family: 'Noto Serif SC', '宋体', 'SimSun', serif !important;
    }
    .document-content th,
    .document-content td {
      font-family: 'Noto Serif SC', '宋体', 'SimSun', serif !important;
    }
    .document-content blockquote {
      font-family: 'Noto Serif SC', '宋体', serif !important;
    }
  `
}

// --- Document properties ---
const docProperties = ref<DocumentProperties | null>(null)
const showProperties = ref(false)

// --- Document fields (from PlcfFld) ---
const docFields = ref<DocumentFields | null>(null)

// --- Document flags (from DOP) ---
const docFlags = ref<DocumentFlags | null>(null)
const showDocFlags = ref(false)
const wordVersion = ref<string | null>(null)

const wordVersionLabel = computed(() => {
  if (!wordVersion.value) return ''
  return WORD_VERSION_LABELS[wordVersion.value as WordVersion] || wordVersion.value
})

const docFlagItems = computed<Array<{ label: string; description: string }>>(() => {
  if (!docFlags.value) return []
  const items: Array<{ label: string; description: string }> = []
  if (docFlags.value.facingPages) {
    items.push({ label: t('flags.facingPages'), description: t('flags.facingPages.desc') })
  }
  if (docFlags.value.titlePage) {
    items.push({ label: t('flags.titlePage'), description: t('flags.titlePage.desc') })
  }
  if (docFlags.value.pmhMain) {
    items.push({ label: t('flags.pmhMain'), description: t('flags.pmhMain.desc') })
  }
  if (docFlags.value.trackChanges) {
    items.push({ label: t('flags.trackChanges'), description: t('flags.trackChanges.desc') })
  }
  if (docFlags.value.ftnRestart) {
    items.push({ label: t('flags.ftnRestart'), description: t('flags.ftnRestart.desc') })
  }
  if (docFlags.value.ftnEnd) {
    items.push({ label: t('flags.ftnEnd'), description: t('flags.ftnEnd.desc') })
  }
  if (docFlags.value.ftnAtEnd) {
    items.push({ label: t('flags.ftnAtEnd'), description: t('flags.ftnAtEnd.desc') })
  }
  return items
})

// HEADER_PART_LABELS removed, use t('story.headerParts.' + key) instead

const storySections = computed<StorySection[]>(() => {
  if (!stories.value) return []
  const out: StorySection[] = []

  // 如果有 headerPartsWithImages，优先使用（包含图片信息）
  if (stories.value.headerPartsWithImages) {
    const parts = stories.value.headerPartsWithImages
    const partKeys = Object.keys(parts)
    for (const key of partKeys) {
      const content = parts[key]
      if (content && (content.text.trim() || content.images && content.images.length > 0)) {
        out.push({
          key: `headerParts_${key}`,
          label: t('story.headerParts.' + key) || key,
          text: content.text.trim(),
          images: content.images?.map((img: { dataUrl: string; widthPx?: number; heightPx?: number; format: string }) => ({
            dataUrl: img.dataUrl,
            widthPx: img.widthPx,
            heightPx: img.heightPx,
            format: img.format,
          })),
        })
      }
    }
  } else if (stories.value.headerParts) {
    // 如果只有 headerParts（无图片），按子范围类型展示页眉页脚
    const parts = stories.value.headerParts
    const partKeys = Object.keys(parts)
    for (const key of partKeys) {
      const text = parts[key]
      if (text && text.trim()) {
        out.push({
          key: `headerParts_${key}`,
          label: t('story.headerParts.' + key) || key,
          text: text.trim(),
        })
      }
    }
  } else if (stories.value.headers && stories.value.headers.trim()) {
    // 没有 headerParts 时回退到合并的 headers 文本
    out.push({ key: 'headers', label: t('story.headerFallback'), text: stories.value.headers.trim() })
  }

  // 其他 story（footnotes/endnotes/comments/textboxes）
  const otherKeys: Array<keyof DocumentStories> = ['footnotes', 'endnotes', 'comments', 'textboxes']
  for (const key of otherKeys) {
    const text = stories.value[key] as string | undefined
    if (text && text.trim()) {
      out.push({ key, label: t('story.' + key), text: text.trim() })
    }
  }
  return out
})

/**
 * 非正文 story 文本 → HTML：保留段首缩进、压缩连续空段；软换行(\v)→<br>、分页符(\f)与单元格标记(\u0007)→提示 span。特殊字符在 escapeHtml 之前以占位替换，避免被转义破坏结构。
 */
// 每行都会用到的正则：提到行循环之外（setup 作用域），避免为每一行重新
// 构造——原先在循环体内 `new RegExp(...)`，每次都会重新编译模式。
// 全局标志仅配合 `String.replace` 使用，后者会重置并忽略 lastIndex，
// 因此跨行共享同一个正则实例是安全的。
const STORY_TRAILING_WS_RE = /\s+$/
const STORY_SOFT_BR_RE = /\u000b/g
const STORY_PAGE_BR_RE = /\u000c/g
const STORY_CELL_MARK_RE = /\u0007/g
const STORY_PAGE_BR_HTML = '<span style="display:inline-block;padding:0 4px;color:#999;font-size:0.85em">[分页]</span>'
const STORY_CELL_MARK_HTML = '<span style="display:inline-block;padding:0 4px;color:#999;font-size:0.85em">│</span>'

function formatStoryText(text: string): string {
  // Split by single newline to preserve paragraph structure.
  // Empty paragraphs become spacing, but consecutive empties are collapsed.
  const lines = text.split('\n')
  const htmlParts: string[] = []
  let prevEmpty = false
  for (const raw of lines) {
    // Trim trailing whitespace only; keep leading spaces (indentation).
    const line = raw.replace(STORY_TRAILING_WS_RE, '')
    if (line.length === 0) {
      if (!prevEmpty && htmlParts.length > 0) {
        htmlParts.push('<p style="margin:0 0 6px 0">&nbsp;</p>')
      }
      prevEmpty = true
      continue
    }
    prevEmpty = false
    // Handle in-paragraph special chars BEFORE escaping:
    //   \v (soft break / Shift+Enter) → <br> placeholder
    //   \f (form feed / page break) → page-break marker placeholder
    //   \u0007 (table cell mark) → cell separator placeholder
    // Use placeholders to avoid interference with escapeHtml.
    const escaped = escapeHtml(line)
      .replace(STORY_SOFT_BR_RE, '<br>')
      .replace(STORY_PAGE_BR_RE, STORY_PAGE_BR_HTML)
      .replace(STORY_CELL_MARK_RE, STORY_CELL_MARK_HTML)
    htmlParts.push(`<p style="margin:0 0 6px 0">${escaped}</p>`)
  }
  return htmlParts.join('')
}

// ---- Helpers ----

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 启动解析秒表：loadingTime 归零后每秒 +1。
 */
function startLoadingTimer() {
  // 快速切换文件/URL 时，先清理上一轮秒表，避免多个定时器叠加。
  stopLoadingTimer()
  loadingTime.value = 0
  loadingTimer.value = setInterval(() => loadingTime.value++, 1000)
}

/**
 * 停止并清理解析秒表定时器。
 */
function stopLoadingTimer() {
  if (loadingTimer.value) {
    clearInterval(loadingTimer.value)
    loadingTimer.value = null
  }
}

// ---- Error boundary ----

onErrorCaptured((err) => {
  const msg = err instanceof Error ? err.message : t('error.parse.unknown')
  error.value = t('error.render', { msg })
  emit('error', msg)
  return false
})

// ---- Load document ----

const loadFromFile = async (file: File) => {
  fileName.value = file.name
  fileSize.value = formatFileSize(file.size)
  loading.value = true
  emit('loading', true)
  error.value = ''
  isUsingWorker.value = false
  progressPercent.value = -1
  progressStep.value = ''
  lastSource.value = { type: 'file', file }
  startLoadingTimer()

  try {
    // Use Web Worker for large files to keep UI responsive
    const useWorker = isWorkerSupported && file.size > WORKER_THRESHOLD
    isUsingWorker.value = useWorker

    const onProgress = (stage: ParseProgressStage, percent: number) => {
      progressStep.value = getProgressStepText(stage)
      progressPercent.value = percent
    }

    let result
    if (useWorker) {
      progressStep.value = t('loading.progress.reading')
      const buffer = await file.arrayBuffer()
      result = await parseWithWorker(buffer, undefined, onProgress)
    } else {
      result = await parseDocFileWithFormat(file)
    }

    if (!result.success) {
      error.value = result.error || t('error.parse.fail')
      loading.value = false
      emit('loading', false)
      return
    }
    progressStep.value = t('loading.progress.rendering')
    progressPercent.value = 100
    renderResult(result)
    emit('loaded')
  } catch (err) {
    console.error('Error parsing DOC file:', err)
    error.value = err instanceof Error ? err.message : t('error.parse.unknown')
  } finally {
    loading.value = false
    emit('loading', false)
    stopLoadingTimer()
  }
}

// ---- W2-1: URL 加载超时与取消（A1+A4）----

/**
 * URL 加载超时阈值：覆盖「发起请求 → 收到响应头」阶段。
 * 60s 依据：正常静态文件服务握手+响应头在数秒内完成，60s 已留足弱网冗余；
 * 超时通常意味着服务端挂起或网络不可达。收到响应头后立即解除计时，
 * 正文传输时长不设硬上限（大文件慢链路下载属合法场景；
 * 正文级进度/限流/卡顿检测归第二波 A3）。
 */
const URL_LOAD_TIMEOUT_MS = 60_000

/** 在途 URL 加载的控制器；null 表示当前无 URL 加载。仅 loadFromUrl 写入。 */
let urlLoadController: AbortController | null = null

/**
 * 取消在途 URL 加载。reason 会成为 signal.reason 并作为 fetch 的 rejection 值，
 * 供 catch 区分「主动取消」（换源/重试/重置/卸载，静默处理）与「超时」（提示用户）。
 */
function abortUrlLoad(reason?: unknown) {
  const controller = urlLoadController
  if (!controller) return
  urlLoadController = null
  controller.abort(reason)
}

/** 该控制器是否仍是当前在途请求：用于丢弃被替换请求的迟到结果并避免其收尾动作污染新加载的 UI 状态。 */
function isCurrentUrlLoad(controller: AbortController): boolean {
  return urlLoadController === controller
}

/** 判定 abort 原因是否为超时（兼容部分引擎忽略自定义 reason、回退通用 AbortError 的行为，见 loadFromUrl 内 timedOut 标记）。 */
function isTimeoutAbortReason(reason: unknown): boolean {
  return reason instanceof Error && reason.name === 'TimeoutError'
}

/**
 * 从 URL 加载并解析文档的主路径：fetch 下载（HTTP 非 2xx 抛错）→ 按 WORKER_THRESHOLD 分派 Worker/主线程解析 → renderResult。进度经 onProgress 回写 loading.progress.* 与百分比；错误写入 error；finally 统一收尾 loading 态与秒表。
 * W2-1：带 AbortController —— ①60s 响应头超时；②换源/watch/resetFile(经 watch→null)/retryLoad/卸载四时机取消；③catch 区分主动取消（静默）与超时（友好提示）。
 */
const loadFromUrl = async (url: string) => {
  // A1+A4：新加载发起前先取消在途请求（防挂起残留 + 防过期响应竞态覆盖新结果）
  abortUrlLoad('superseded')
  const controller = new AbortController()
  urlLoadController = controller

  fileName.value = url.split('/').pop() || url
  fileSize.value = ''
  loading.value = true
  emit('loading', true)
  error.value = ''
  progressPercent.value = -1
  progressStep.value = ''
  lastSource.value = { type: 'url', url }
  startLoadingTimer()

  // 超时标记独立于 signal.reason：部分引擎 abort(reason) 后 fetch 仍以通用
  // AbortError 拒绝（丢失自定义原因），用本地标志保证超时提示不丢。
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException(`加载超时（${URL_LOAD_TIMEOUT_MS / 1000} 秒无响应）`, 'TimeoutError'))
  }, URL_LOAD_TIMEOUT_MS)

  try {
    progressStep.value = t('loading.progress.downloading')
    let response: Response
    try {
      response = await fetch(url, { signal: controller.signal })
    } finally {
      // 收到响应头（或请求已失败）即解除超时计时：正文传输不计入本轮超时
      clearTimeout(timeoutId)
    }
    if (!isCurrentUrlLoad(controller)) return // 已被更新的加载取代

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)

    const buffer = await response.arrayBuffer()
    if (!isCurrentUrlLoad(controller)) return // 下载期间被取代：丢弃

    fileSize.value = formatFileSize(buffer.byteLength)

    // Use Worker for large files
    const useWorker = isWorkerSupported && buffer.byteLength > WORKER_THRESHOLD
    isUsingWorker.value = useWorker
    progressStep.value = t('loading.progress.parsing')

    const onProgress = (stage: ParseProgressStage, percent: number) => {
      progressStep.value = getProgressStepText(stage)
      progressPercent.value = percent
    }

    const result = useWorker
      ? await parseWithWorker(buffer, undefined, onProgress)
      : parseDocFileFromBuffer(buffer, fileName.value)

    if (!isCurrentUrlLoad(controller)) return // 解析期间被取代：丢弃结果不渲染

    if (!result.success) {
      error.value = result.error || t('error.parse.fail')
      loading.value = false
      emit('loading', false)
      return
    }
    renderResult(result)
    emit('loaded')
  } catch (err) {
    // W2-1/③：先看是否为本请求的取消/超时，再看是否已被更新的加载取代
    if (controller.signal.aborted) {
      if ((timedOut || isTimeoutAbortReason(controller.signal.reason)) && isCurrentUrlLoad(controller)) {
        console.warn(`URL 加载超时: ${url}`)
        // 文案含『加载超时』关键字 → errorClassifier network 类（可重试）
        error.value = '加载超时：服务器长时间无响应，请检查地址是否可访问或稍后重试'
      }
      // 其余 abort（superseded/source-changed/retry/reset/unmounted）：静默，
      // UI 状态归属新的加载或组件已销毁，不得回写
      return
    }
    if (!isCurrentUrlLoad(controller)) return // 陈旧错误不得覆盖新加载的状态
    console.error('Error loading from URL:', err)
    error.value = err instanceof Error ? err.message : t('error.parse.unknown')
  } finally {
    clearTimeout(timeoutId) // 兜底（fetch 抛错路径的内层 finally 已清；此处防漏）
    if (isCurrentUrlLoad(controller)) {
      // 仅当前请求有权收尾；被取代/已取消的请求不得触碰新加载的 UI 状态
      urlLoadController = null
      loading.value = false
      emit('loading', false)
      stopLoadingTimer()
    }
  }
}

/** 重试上次加载 */
const retryLoad = () => {
  if (!lastSource.value) return
  // W2-1/A1：重试前显式取消在途请求（loadFromUrl 入口亦会自取消，此处双保险并覆盖 file 分支）
  abortUrlLoad('retry')
  if (lastSource.value.type === 'file') {
    loadFromFile(lastSource.value.file)
  } else {
    loadFromUrl(lastSource.value.url)
  }
}

// ---- Stats calculation ----

function computeStats(text: string) {
  const trimmed = text.trim()
  charCount.value = trimmed.length
  chineseCharCount.value = (trimmed.match(/[\u4e00-\u9fff]/g) || []).length

  // Word count: Chinese chars + English words
  const englishWords = (trimmed.match(/[A-Za-z]{2,}/g) || []).length
  wordCount.value = chineseCharCount.value + englishWords

  paragraphCount.value = trimmed.split(/\n\n+/).filter(p => p.trim().length > 0).length
}

// ---- Outline extraction ----

function buildOutline(paragraphs: FormattedParagraphOutput[]) {
  const items: OutlineItem[] = []
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]
    const text = para.text?.trim()
    if (!text || text.length < 2) continue

    // Skip list items and short fragments
    if (para.paraFormat?.listType) continue
    if (text.length > 80) continue

    const charFormat = para.charFormat || {} as CharacterFormat
    const isBold = charFormat.bold
    const fontSize = charFormat.fontSize || 16
    const align = para.paraFormat?.alignment

    // Determine heading level from format heuristics
    let level = 0
    const realHeadingLevel = para.paraFormat?.headingLevel
    if (realHeadingLevel && realHeadingLevel >= 1 && realHeadingLevel <= 9) {
      level = realHeadingLevel
    } else {
      if (fontSize >= 32) level = 1
      else if (fontSize >= 22) level = 2
      else if (fontSize >= 18 && isBold) level = 2
      else if (isBold && text.length <= 40 && fontSize >= 16) level = 3
      else if (align === 'center' && text.length <= 30) level = 3
    }

    if (level > 0) {
      items.push({ text, level, index: i })
    }
  }

  // Only show outline if we found 2+ headings
  outline.value = items.length >= 2 ? items : []
}

// ---- Render ----

const renderResult = (result: ParserOutput) => {
  if (result.document && result.document.paragraphs) {
    isRichFormat.value = true
    const rawText = result.document.paragraphs.map(p => p.text).join('\n\n')
    plainText.value = rawText
    computeStats(rawText)
    buildOutline(result.document.paragraphs)
    hyperlinks.value = result.document.hyperlinks || []
    toc.value = result.document.toc || []
    index.value = result.document.index || []
    docProperties.value = result.document.properties || null
    docFlags.value = result.document.docFlags || null
    wordVersion.value = result.document.wordVersion || null
    docFields.value = result.document.documentFields || null
    revisions.value = result.document.revisions || []
    showRevisions.value = false
    revisionMode.value = 'marks'
    bookmarks.value = result.document.bookmarks || []
    showBookmarks.value = false
    sections.value = result.document.sections || []
    showSections.value = false
    pageFields.value = result.document.pageFields || []
    showPageFields.value = false
    crossReferences.value = result.document.crossReferences || []
    shapes.value = result.document.shapes || []
    equations.value = result.document.equations || []
    charts.value = result.document.charts || []
    wordArts.value = result.document.wordArts || []
    styleSet.value = result.document.styleSet || null
    showCrossReferences.value = false
    // 缓存解析结果用于后续重新渲染（如切换隐藏文字显示）
    lastParseResult.value = {
      paragraphs: result.document.paragraphs as ParaWithList[],
      hyperlinks: result.document.hyperlinks,
      revisions: result.document.revisions,
    }
    // Set images & pictures BEFORE applyFormattedPages so that renderParagraphHtml
    // can access them when replacing \u0001 placeholders with <img> tags.
    images.value = result.document.images || []
    pictures.value = result.document.pictures || []
    applyFormattedPages(result.document.paragraphs, hyperlinks.value, revisions.value)
    stories.value = result.document.stories || null
    showStories.value = false
    // showImages.value = false
    currentPage.value = 1
    updatePageHeight()
    updateTotalPages()
    loadWebFonts()
  } else if (result.text) {
    isRichFormat.value = false
    plainText.value = result.text
    computeStats(result.text)
    hyperlinks.value = []
    docProperties.value = null
    docFlags.value = null
    wordVersion.value = null
    revisions.value = []
    revisionMode.value = 'marks'
    bookmarks.value = []
    sections.value = []
    pageFields.value = []
    crossReferences.value = []
    shapes.value = []
    equations.value = []
    charts.value = []
    wordArts.value = []
    const inferredHtml = formatTextWithInferredFormat(result.text, getWebFontFamily)
    pages.value = [inferredHtml]
    htmlContent.value = inferredHtml
    pageHeights.value = {}
    visibleStart.value = 0
    visibleEnd.value = 0
    stories.value = null
    showStories.value = false
    images.value = []
    pictures.value = []
    // showImages.value = false
    loadWebFonts()
  } else {
    error.value = t('error.emptyDoc')
  }
}

interface ParaWithList {
  text: string
  charFormat: CharacterFormat
  paraFormat: ParagraphFormat & { listType?: string; listStyle?: string; listLevel?: number }
  /** 段落在文档字符流中的起始 CP（解析器内部字段）。 */
  _cpStart?: number
}

/**
 * 应用格式化页面数组到状态：同步更新 pages（虚拟滚动用）和 htmlContent（打印/复制用），
 * 并重置虚拟滚动状态（高度缓存、可视范围）。
 */
function applyFormattedPages(paragraphs: ParaWithList[], hyperlinks?: HyperlinkRange[], revisions?: RevisionMark[]) {
  const pageArr = renderDocumentToPages({
    paragraphs: paragraphs as RenderParagraph[],
    hyperlinks,
    revisions,
    revisionMode: revisionMode.value,
    shapes: shapes.value || [],
    pictures: pictures.value || [],
    images: images.value || [],
    charts: charts.value || [],
    sections: sections.value || [],
    pageHeightPt: pageHeight.value,
    showHiddenText: showHiddenText.value,
    fontResolver: getWebFontFamily,
    t,
  })
  pages.value = pageArr
  htmlContent.value = pageArr.join('\n')
  // 重置虚拟滚动状态
  pageHeights.value = {}
  visibleStart.value = 0
  visibleEnd.value = Math.min(pageArr.length, VIRTUAL_BUFFER * 2 + 1)
  // DOM 更新后测量并刷新可视范围
  nextTick(() => {
    measureVisiblePageHeights()
    updateVisibleRange()
  })
}

/** 估算页面占位高度（px）：优先使用缓存的真实高度，否则用 pageHeight 估算 */
function getPagePlaceholderHeight(idx: number): number {
  const cached = pageHeights.value[idx]
  if (cached && cached > 0) return cached
  // 默认按 A4 页面高度估算（与 documentRenderer/pageBuilder 的 PT_TO_PX 同源）
  return Math.max(400, pageHeight.value * PT_TO_PX)
}

/** 判断页面索引是否在当前可视范围内（应渲染真实内容） */
function isPageVisible(idx: number): boolean {
  if (!virtualScrollEnabled.value) return true
  if (pages.value.length <= VIRTUAL_BUFFER * 2 + 1) return true
  return idx >= visibleStart.value && idx <= visibleEnd.value
}

/** 测量已渲染页面的真实高度并缓存。
 *  PERF-T1：以 data-page-idx 绝对页码为缓存键（旧实现用 NodeList 序号当页码，
 *  visibleStart>0 后系统性错位污染 pageHeights）；并对 FIX-VUEW 的 CSS zoom
 *  做归一化——getBoundingClientRect 返回的是缩放后视觉像素，除以 zoom 因子
 *  还原为布局像素后再入库，占位 div 与真实页面共用同一单位系。返回是否有变更。 */
function measureVisiblePageHeights(): boolean {
  const container = previewRef.value?.querySelector('.document-content')
  if (!container) return false
  const zoomFactor = zoomLevel.value / 100
  const safeZoom = zoomFactor > 0 ? zoomFactor : 1
  const hosts = container.querySelectorAll<HTMLElement>('.page-host[data-page-idx]')
  let changed = false
  let next: Record<number, number> | null = null
  hosts.forEach((host) => {
    const idx = Number(host.dataset.pageIdx)
    if (!Number.isInteger(idx) || idx < 0) return
    // .page-host 为 display:contents 无布局盒，实际盒子是其内部的 .page-content
    const el = (host.querySelector('.page-content') as HTMLElement | null) ?? host
    const rect = el.getBoundingClientRect()
    const height = rect.height / safeZoom
    if (height > 0 && Math.abs((pageHeights.value[idx] ?? -1) - height) > 0.5) {
      if (!next) next = { ...pageHeights.value }
      next[idx] = height
      changed = true
    }
  })
  if (changed && next) pageHeights.value = next
  return changed
}

/** 根据滚动位置计算当前可视页面索引范围（含缓冲区） */
function updateVisibleRange() {
  if (!virtualScrollEnabled.value) return
  const container = previewRef.value?.querySelector('.document-content') as HTMLElement | null
  if (!container) return
  const total = pages.value.length
  if (total === 0) return
  // 小文档不启用虚拟滚动
  if (total <= VIRTUAL_BUFFER * 2 + 1) {
    visibleStart.value = 0
    visibleEnd.value = total - 1
    return
  }
  // 使用容器相对于视口的位置计算可视范围。
  // PERF-T1：容器处于 .paper-page 的 CSS zoom 内，getBoundingClientRect 返回
  // 视觉像素；pageHeights 缓存的是布局像素（已除 zoom），故把视口度量也换算回
  // 布局像素，保证累计高度与视口窗口同一单位系（>100% 缩放下不漂移）。
  const containerRect = container.getBoundingClientRect()
  const zoomFactor = zoomLevel.value / 100
  const safeZoom = zoomFactor > 0 ? zoomFactor : 1
  const viewportTop = -containerRect.top / safeZoom
  const viewportHeight = window.innerHeight / safeZoom
  // 累加各页面高度，定位当前可视的页面索引
  let accumulated = 0
  let start = 0
  let end = total - 1
  for (let i = 0; i < total; i++) {
    const h = getPagePlaceholderHeight(i)
    const pageBottom = accumulated + h
    // PERF-T1 收口：用 <= 而非 < —— 页底恰好落在视口顶（pageBottom === viewportTop）
    // 时该页可见面积为零，应判为已滚出视口；严格小于会把这条零高度缝算作"可见"，
    // 使 start 系统性偏小一页（perfT1 用例三的不变量断言即钉此处）。
    if (pageBottom <= viewportTop) {
      start = i + 1
    }
    if (accumulated > viewportTop + viewportHeight) {
      end = i - 1
      break
    }
    accumulated = pageBottom
  }
  start = Math.max(0, start - VIRTUAL_BUFFER)
  end = Math.min(total - 1, end + VIRTUAL_BUFFER)
  if (start !== visibleStart.value || end !== visibleEnd.value) {
    visibleStart.value = start
    visibleEnd.value = end
  }
}

/** 滚动事件处理器（throttle 用 requestAnimationFrame）。
 *  PERF-T1：rAF 回调里只做可视范围计算；高度测量改由 visibleStart/visibleEnd
 *  的 watcher 在 DOM 更新后（nextTick）执行——旧实现在同一 rAF 内同步测量，
 *  读到的是窗口变更前的旧 DOM，且 NodeList 序号错位会污染缓存。 */
function handleVirtualScroll() {
  if (scrollTicking) return
  scrollTicking = true
  requestAnimationFrame(() => {
    updateVisibleRange()
    scrollTicking = false
  })
}

// 窗口变化 → DOM 重渲染完成后测量新渲染页面的真实高度；测量若引起累计高度
// 变化则再校准一次可视范围。changed 门闩保证收敛，不会形成死循环。
watch([visibleStart, visibleEnd], () => {
  nextTick(() => {
    if (measureVisiblePageHeights()) updateVisibleRange()
  })
})

// FIX-VUEW 的 zoom 是真实回流：>100% 时文字重新折行、页面布局像素高度改变，
// 缩放变化后需在回流完成的新布局上重新测量并校准可视范围。
// PERF-T1 收口：缓存存的是布局像素，zoom 改变布局语义——旧 zoom 下测得的
// 条目全部失效（尤其未渲染页的占位估算），必须整体清空后在回流完成的新
// 布局上重测当前窗口；残留旧值会让占位高度与新布局混用两套单位系。
watch(zoomLevel, () => {
  pageHeights.value = {}
  nextTick(() => {
    measureVisiblePageHeights()
    updateVisibleRange()
  })
})
// ---- Zoom ----

function zoomIn() {
  zoomLevel.value = Math.min(MAX_ZOOM, zoomLevel.value + ZOOM_STEP)
}

/**
 * 缩小一档（MIN_ZOOM 下限钳制）。
 */
function zoomOut() {
  zoomLevel.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomLevel.value - ZOOM_STEP))
}

/**
 * 缩放复位 100%。
 */
function zoomReset() {
  zoomLevel.value = 100
}

const zoomLabel = computed(() => `${zoomLevel.value}%`)

/** DOC-POLISH①：面板标题计数括号按语言取形——zh 全角（n）、en 半角 (n)。 */
function panelTitle(key: string, n: number): string {
  const base = t(key)
  return currentLocale.value === 'en' ? `${base} (${n})` : `${base}（${n}）`
}

// ---- Search ----

function toggleSearch() {
  showSearch.value = !showSearch.value
  if (showSearch.value) {
    searchQuery.value = ''
    searchResults.value = []
    currentSearchIndex.value = -1
    // Save original HTML before any highlighting
    originalHtml.value = htmlContent.value
    // 搜索需要遍历所有页面 DOM，临时禁用虚拟滚动确保全部页面已渲染
    virtualScrollEnabled.value = false
    nextTick(() => searchInputRef.value?.focus())
  } else {
    // Restore original HTML when closing search
    clearHighlights()
    if (originalHtml.value) {
      htmlContent.value = originalHtml.value
      originalHtml.value = ''
    }
    // 关闭搜索后恢复虚拟滚动
    virtualScrollEnabled.value = true
    nextTick(() => {
      measureVisiblePageHeights()
      updateVisibleRange()
      searchToggleRef.value?.focus()
    })
  }
}

/**
 * 切换隐藏文字显示态，并基于 lastParseResult 全量重渲染以使样式变化生效。
 */
function toggleHiddenText() {
  showHiddenText.value = !showHiddenText.value
  // 重新渲染 HTML 以应用隐藏文字样式变化
  if (lastParseResult.value) {
    applyFormattedPages(
      lastParseResult.value.paragraphs,
      lastParseResult.value.hyperlinks,
      lastParseResult.value.revisions
    )
  }
}

/**
 * 切换修订显示模式并重新渲染文档。
 *
 * - 'marks'    : 显示修订标记（<ins>/<del>）
 * - 'accepted' : 接受全部修订 — insert 保留为普通文本，delete 文本被移除
 * - 'rejected' : 拒绝全部修订 — insert 文本被移除，delete 保留为普通文本
 *
 * format 修订（格式修订）不涉及文本增删，三种模式下均保持原文本不变。
 */
function setRevisionMode(mode: RevisionMode) {
  revisionMode.value = mode
  if (lastParseResult.value) {
    applyFormattedPages(
      lastParseResult.value.paragraphs,
      lastParseResult.value.hyperlinks,
      lastParseResult.value.revisions
    )
  }
}

// 匹配枚举与高亮包装提取至 utils/searchUtils.ts。
// 旧实现按正序对同一文本节点边替换边用旧偏移继续匹配，单个节点内
// 出现多次关键词时会错位高亮并抛 IndexSizeError；新实现倒序应用替换。
function performSearch() {
  const rawQuery = searchQuery.value.trim()
  if (!rawQuery) {
    clearHighlights()
    searchResults.value = []
    currentSearchIndex.value = -1
    return
  }

  clearHighlights()
  searchResults.value = []
  currentSearchIndex.value = -1

  const container = previewRef.value?.querySelector('.document-content')
  if (!container) return

  const matches = highlightTextMatches(container, rawQuery, {
    caseSensitive: searchCaseSensitive.value,
    wholeWord: searchWholeWord.value,
  })

  searchResults.value = matches
  if (matches.length > 0) {
    currentSearchIndex.value = 0
    scrollToMatch(0)
  }
}

/**
 * 移除预览区内全部搜索高亮包装（委托 searchUtils.clearSearchHighlights）。
 */
function clearHighlights() {
  if (previewRef.value) clearSearchHighlights(previewRef.value)
}

/**
 * 高亮第 idx 个匹配（加 search-highlight-current）并平滑滚动居中；其余匹配清除 current 态；idx 越界静默忽略。
 */
function scrollToMatch(idx: number) {
  const matches = previewRef.value?.querySelectorAll('.search-highlight') as NodeListOf<HTMLElement>
  if (idx >= 0 && idx < matches.length) {
    matches.forEach((el, i) => {
      el.classList.toggle('search-highlight-current', i === idx)
    })
    const current = matches[idx]
    if (current && typeof current.scrollIntoView === 'function') {
      current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }
}

/**
 * 下一个匹配（模长环形轮转）。
 */
function nextMatch() {
  if (searchResults.value.length === 0) return
  currentSearchIndex.value = (currentSearchIndex.value + 1) % searchResults.value.length
  scrollToMatch(currentSearchIndex.value)
}

/**
 * 上一个匹配（模长环形轮转）。
 */
function prevMatch() {
  if (searchResults.value.length === 0) return
  currentSearchIndex.value = (currentSearchIndex.value - 1 + searchResults.value.length) % searchResults.value.length
  scrollToMatch(currentSearchIndex.value)
}

const searchStatusLabel = computed(() => {
  if (searchResults.value.length === 0) return t('search.no.results')
  return `${currentSearchIndex.value + 1} / ${searchResults.value.length}`
})

// ---- Print ----

function printDocument() {
  if (!htmlContent.value) return
  
  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    alert(t('print.popupBlocked'))
    return
  }
  
  const printContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fileName.value || 'DOC Preview')}</title>
  <style>
    @page {
      size: A4;
      margin: 25mm 20mm 25mm 20mm;
      @top-center {
        content: "${escapeHtml(fileName.value || 'DOC Preview')}";
        font-size: 10pt;
        color: #666;
      }
      @bottom-center {
        content: "${t('print.p1')}" counter(page) "${t('print.p2')}" counter(pages) "${t('print.p3')}";
        font-size: 10pt;
        color: #666;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.8;
      color: #333;
      margin: 0;
      padding: 0;
    }
    .document-content {
      font-size: 11pt;
    }
    h1 { font-size: 18pt; font-weight: 600; margin-top: 0; margin-bottom: 12pt; }
    h2 { font-size: 16pt; font-weight: 600; margin-top: 24pt; margin-bottom: 10pt; }
    h3 { font-size: 14pt; font-weight: 600; margin-top: 20pt; margin-bottom: 8pt; }
    h4, h5, h6 { font-size: 12pt; font-weight: 600; margin-top: 16pt; margin-bottom: 6pt; }
    p { margin-bottom: 12pt; }
    ul, ol { margin-left: 20pt; margin-bottom: 12pt; }
    li { margin-bottom: 4pt; }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 12pt;
      font-size: 10pt;
    }
    td, th {
      border: 1px solid #ccc;
      padding: 6pt 8pt;
      vertical-align: top;
    }
    th {
      background-color: #f5f5f5;
      font-weight: 600;
    }
    a {
      color: #667eea;
      text-decoration: underline;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    .page-break {
      page-break-before: always;
    }
    .search-highlight {
      background-color: #ffeb3b;
    }
    @media screen {
      body {
        padding: 40px;
        max-width: 800px;
        margin: 0 auto;
        background: #f5f5f5;
      }
      .document-content {
        background: white;
        padding: 60px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.12);
      }
    }
  </style>
</head>
<body>
  <div class="document-content">
    ${htmlContent.value}
  </div>
</body>
</html>`
  
  // 注册监听后再写入文档，避免部分浏览器在 document.close() 后立即触发
  // load，导致监听器错过而无法自动打开打印对话框。
  printWindow.addEventListener('load', () => {
    setTimeout(() => {
      printWindow.print()
      printWindow.close()
    }, 500)
  }, { once: true })
  printWindow.document.write(printContent)
  printWindow.document.close()
}

// ---- Download ----

// ---- Outline navigation ----

function scrollToOutline(item: OutlineItem) {
  showOutline.value = false
  // 虚拟滚动下目标段落可能未渲染，临时禁用虚拟滚动确保全部页面可查询
  const wasVirtualEnabled = virtualScrollEnabled.value
  if (wasVirtualEnabled) {
    virtualScrollEnabled.value = false
  }
  nextTick(() => {
    const container = previewRef.value?.querySelector('.document-content')
    if (!container) {
      if (wasVirtualEnabled) virtualScrollEnabled.value = true
      return
    }
    const paragraphs = container.querySelectorAll('p, h1, h2, h3, h4')
    const target = paragraphs[item.index]
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'start', behavior: 'smooth' })
      target.classList.add('outline-highlight')
      setTimeout(() => target.classList.remove('outline-highlight'), 2000)
    }
    // 滚动动画完成后恢复虚拟滚动
    if (wasVirtualEnabled) {
      setTimeout(() => {
        virtualScrollEnabled.value = true
        nextTick(() => {
          measureVisiblePageHeights()
          updateVisibleRange()
        })
      }, 600)
    }
  })
}

/**
 * 复制纯文本到剪贴板，三级降级：① Clipboard API 富文本写入 ② 隐藏 textarea + execCommand("copy") ③ 同法纯文本兜底；任一成功后按 data-action="copy-text" 定位工具栏按钮显示 ✓ 反馈 2s（FIX-VUEW 后不再依赖中文 title 选择器）。
 */
async function copyText() {
  if (!plainText.value) return
  
  const tryRichCopy = async () => {
    if (!htmlContent.value) return false
    if (typeof ClipboardItem === 'undefined' || typeof navigator.clipboard?.write !== 'function') {
      return false
    }

    try {
      const blob = new Blob([htmlContent.value], { type: 'text/html' })
      const item = new ClipboardItem({ 'text/html': blob })
      await navigator.clipboard.write([item])
      return true
    } catch {
      return false
    }
  }
  
  const tryExecCommandCopy = () => {
    const container = previewRef.value?.querySelector('.document-content')
    if (!container) return false
    
    try {
      const range = document.createRange()
      range.selectNodeContents(container)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      
      const successful = document.execCommand('copy')
      
      selection?.removeAllRanges()
      return successful
    } catch {
      return false
    }
  }
  
  const tryPlainCopy = async () => {
    try {
      await navigator.clipboard.writeText(plainText.value)
      return true
    } catch {
      const ta = document.createElement('textarea')
      ta.value = plainText.value
      ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const successful = document.execCommand('copy')
      document.body.removeChild(ta)
      return successful
    }
  }
  
  const showCopySuccess = () => {
    // FIX-VUEW：原选择器 .toolbar-btn[title*="复制"] 依赖中文 title 文本，
    // i18n 化或切 EN（title 变 "Copy text to clipboard"）后即失效。
    // 改为语言无关的 data-action 属性定位（见模板 📋 按钮）。
    const btn = document.querySelector('.toolbar-btn[data-action="copy-text"]')
    if (btn) {
      const originalText = btn.innerHTML
      btn.innerHTML = '✓'
      setTimeout(() => {
        btn.innerHTML = originalText
      }, 2000)
    }
  }
  
  if (await tryRichCopy()) {
    showCopySuccess()
    return
  }
  
  if (tryExecCommandCopy()) {
    showCopySuccess()
    return
  }
  
  if (await tryPlainCopy()) {
    showCopySuccess()
    return
  }
}

/**
 * 导出纯文本 .txt：Blob + 临时 <a download> 触发下载；文件名取去 .doc/.dot 扩展的文档名，空内容静默跳过。
 */
function downloadText() {
  if (!plainText.value) return
  const name = fileName.value.replace(/\.(doc|dot)$/i, '') || 'document'
  const blob = new Blob([plainText.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 导出可独立打开的 .html：预览 HTML 内联进完整样式模板（title 取文档名转义）。
 */
function downloadHtml() {
  if (!htmlContent.value) return
  const name = fileName.value.replace(/\.(doc|dot)$/i, '') || 'document'
  
  const htmlTemplate = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fileName.value || 'DOC Preview')}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      line-height: 1.8;
      color: #333;
      background: #f5f5f5;
    }
    .document-content {
      background: white;
      padding: 60px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.12);
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 24px;
      margin-bottom: 12px;
      font-weight: 600;
    }
    p {
      margin-bottom: 16px;
    }
    ul, ol {
      margin-left: 24px;
      margin-bottom: 16px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 16px;
    }
    td, th {
      border: 1px solid #ddd;
      padding: 8px 12px;
    }
    tr:nth-child(even) {
      background-color: #f9f9f9;
    }
    a {
      color: #667eea;
      text-decoration: underline;
    }
    .search-highlight {
      background-color: #ffeb3b;
    }
    .search-highlight-current {
      background-color: #f44336;
      color: white;
    }
    @media print {
      body {
        background: white;
        padding: 0;
        max-width: none;
      }
      .document-content {
        box-shadow: none;
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <div class="document-content">
    ${htmlContent.value}
  </div>
</body>
</html>`
  
  const blob = new Blob([htmlTemplate], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.html`
  a.click()
  URL.revokeObjectURL(url)
}

// ---- Download Markdown ----
// 转换逻辑提取至 utils/markdownExport.ts

/**
 * 导出 .md：htmlToMarkdown 纯函数将当前预览 HTML 转 Markdown 后下载。
 */
function downloadMarkdown() {
  if (!htmlContent.value) return

  const mdContent = htmlToMarkdown(htmlContent.value)
  const name = fileName.value.replace(/\.(doc|dot)$/i, '') || 'document'

  const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.md`
  a.click()
  URL.revokeObjectURL(url)
}

// ---- Keyboard shortcuts ----

function toggleShortcuts() {
  showShortcuts.value = !showShortcuts.value
}

/**
 * 全局键盘快捷键分发（document 级监听，onUnmounted 时解绑）：
 *  - Ctrl/⌘+F 搜索 · Ctrl/⌘+P 打印 · Esc 先关搜索再关快捷键面板
 *  - Ctrl/⌘+=/-/0 缩放 · F3|Ctrl+G / Shift+F3|Ctrl+Shift+G 匹配导航（搜索开启时生效）
 *  - PageUp/PageDown/Home/End 翻页 · ? 或 Ctrl+/ 开关快捷键面板
 *  - 输入框聚焦时跳过翻页类与 ?/Ctrl+/（守卫位于这些分支之前），避免干扰文本编辑。
 */
function handleKeydown(e: KeyboardEvent) {
  const isCtrl = e.ctrlKey || e.metaKey

  if (isCtrl && e.key === 'f') {
    e.preventDefault()
    if (!showSearch.value) toggleSearch()
    else searchInputRef.value?.focus()
    return
  }

  if (isCtrl && e.key === 'p') {
    e.preventDefault()
    printDocument()
    return
  }

  if (e.key === 'Escape') {
    if (showSearch.value) {
      toggleSearch()
      return
    }
    if (showShortcuts.value) {
      showShortcuts.value = false
      return
    }
  }

  if (e.key === '=' || e.key === '+') {
    if (isCtrl) { e.preventDefault(); zoomIn() }
    return
  }

  if (e.key === '-') {
    if (isCtrl) { e.preventDefault(); zoomOut() }
    return
  }

  if (e.key === '0' && isCtrl) {
    e.preventDefault()
    zoomReset()
    return
  }

  // Shift+F3 or Ctrl+Shift+G for prev match (check before the unmodified form).
  if ((e.key === 'F3' && e.shiftKey) || (isCtrl && e.shiftKey && e.key === 'g')) {
    if (showSearch.value) { e.preventDefault(); prevMatch() }
    return
  }

  // F3 or Ctrl+G for next match
  if (e.key === 'F3' || (isCtrl && e.key === 'g')) {
    if (showSearch.value) { e.preventDefault(); nextMatch() }
    return
  }

  // PageUp/PageDown for pagination navigation (skip when focus is in input)
  const target = e.target as HTMLElement
  const isInputFocused = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  if (isInputFocused) return

  // DOC-POLISH④：翻页类按键仅在焦点位于本组件预览区时接管。
  // 焦点落在侧栏/上传页等组件外时放行浏览器原生行为（滚动到顶/底、原生翻页），
  // 不再全局劫持——修复"焦点在任意非输入处按 Home/End 页面不滚"的可达性回退。
  const inPreview = !!previewRef.value && target instanceof Node && previewRef.value.contains(target)

  if (e.key === 'PageUp') {
    if (!inPreview) return
    e.preventDefault()
    goToPrevPage()
    return
  }

  if (e.key === 'PageDown') {
    if (!inPreview) return
    e.preventDefault()
    goToNextPage()
    return
  }

  // Home/End for first/last page (Ctrl or standalone)
  if (e.key === 'Home') {
    if (!inPreview) return
    e.preventDefault()
    goToPage(1)
    return
  }

  if (e.key === 'End') {
    if (!inPreview) return
    e.preventDefault()
    goToPage(totalPages.value)
    return
  }

  // ? or Ctrl+/ to toggle shortcuts panel. Keep text fields untouched so typing
  // punctuation or slash commands does not unexpectedly open the panel.
  if (e.key === '?' || (isCtrl && e.key === '/')) {
    if (isInputFocused) return
    e.preventDefault()
    toggleShortcuts()
    return
  }
}

// ---- Watchers ----

watch(() => props.source, (newSource) => {
  // W2-1/A1：源变更即取消在途 URL 加载。newSource 为 null 时（App.vue resetFile
  // 将 previewSource 置空）同样触发本 watcher —— 由此覆盖「重置返回首页」时机，
  // 防止已离开的加载在后台完成并回写状态。
  abortUrlLoad('source-changed')
  if (newSource) {
    if (typeof newSource === 'string') loadFromUrl(newSource)
    else loadFromFile(newSource)
  }
})

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('scroll', handleVirtualScroll, { passive: true })
  window.addEventListener('resize', handleVirtualScroll, { passive: true })
  if (props.source) {
    if (typeof props.source === 'string') loadFromUrl(props.source)
    else loadFromFile(props.source)
  }
})

onUnmounted(() => {
  // W2-1/A1：卸载时取消在途 URL 加载，防止销毁后的迟到结果回写组件状态
  abortUrlLoad('unmounted')
  // 文件解析也可能尚未结束；无论来源如何都要清理加载秒表，避免卸载后定时器继续运行。
  stopLoadingTimer()
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('scroll', handleVirtualScroll)
  window.removeEventListener('resize', handleVirtualScroll)
})

// ---- Expose for parent components ----

function reload() {
  if (props.source) {
    if (typeof props.source === 'string') loadFromUrl(props.source)
    else loadFromFile(props.source)
  }
}

/**
 * 供父组件经 defineExpose 只读获取当前纯文本内容。
 */
function getPlainText(): string {
  return plainText.value
}

/**
 * skip-link 目标动作：滚动到正文起点并把焦点移至正文容器。
 * 正文尚未渲染时回退到预览根容器，避免焦点丢失。
 */
function focusContent() {
  const content = previewRef.value?.querySelector('.document-content') as HTMLElement | null
  if (content && typeof content.scrollIntoView === 'function') {
    content.scrollIntoView({ block: 'start' })
  }
  if (content) {
    content.focus()
  } else {
    previewRef.value?.focus()
  }
}

defineExpose({ reload, getPlainText, focusContent })
</script>

<template>
  <div class="doc-preview" :style="{ '--zoom': zoomLevel / 100 }" tabindex="-1">
    <a class="skip-link" href="#doc-content" @click.prevent="focusContent">{{ t('app.skip.content') }}</a>
    <!-- Loading -->
    <LoadingOverlay
      v-if="loading"
      :file-name="fileName"
      :file-size="fileSize"
      :loading-time="loadingTime"
      :is-using-worker="isUsingWorker"
      :progress-step="progressStep"
      :progress-percent="progressPercent"
    />

    <!-- Error -->
    <ErrorDisplay v-else-if="error" :error="error" @retry="retryLoad" />

    <!-- Preview -->
    <div v-else ref="previewRef" class="preview-wrapper" tabindex="-1">
      <!-- Toolbar -->
      <div class="toolbar" role="toolbar" :aria-label="t('toolbar.label')">
        <div class="toolbar-left">
          <!-- Zoom -->
          <button type="button" class="toolbar-btn" @click="zoomOut" :disabled="zoomLevel <= MIN_ZOOM" :title="t('toolbar.zoom.out')" :aria-label="t('toolbar.zoom.out')">−</button>
          <button type="button" class="toolbar-btn zoom-label" @click="zoomReset" :title="t('toolbar.zoom.reset')" :aria-label="t('toolbar.zoom.reset.aria')">{{ zoomLabel }}</button>
          <button type="button" class="toolbar-btn" @click="zoomIn" :disabled="zoomLevel >= MAX_ZOOM" :title="t('toolbar.zoom.in')" :aria-label="t('toolbar.zoom.in')">+</button>

          <span class="toolbar-sep" aria-hidden="true"></span>

          <!-- Search -->
          <button ref="searchToggleRef" type="button" class="toolbar-btn" @click="toggleSearch" :class="{ active: showSearch }" :title="t('toolbar.search')" :aria-label="t('toolbar.search')" :aria-expanded="showSearch" aria-controls="doc-search-bar">
            🔍
          </button>

          <span class="toolbar-sep" aria-hidden="true"></span>

          <!-- Print -->
          <button type="button" class="toolbar-btn" @click="printDocument" :title="t('toolbar.print')" :aria-label="t('toolbar.print')">🖨️</button>

          <!-- Download text -->
          <button type="button" class="toolbar-btn" @click="downloadText" :title="t('toolbar.download.txt')" :aria-label="t('toolbar.download.txt')">📥</button>

          <!-- Download HTML -->
          <button type="button" class="toolbar-btn" @click="downloadHtml" :title="t('toolbar.download.html')" :aria-label="t('toolbar.download.html')">🌐</button>

          <!-- Download Markdown -->
          <button type="button" class="toolbar-btn" @click="downloadMarkdown" :title="t('toolbar.download.md')" :aria-label="t('toolbar.download.md')">📝</button>

          <!-- Copy text -->
          <button type="button" class="toolbar-btn" data-action="copy-text" @click="copyText" :title="t('toolbar.copy')" :aria-label="t('toolbar.copy')">📋</button>

          <span class="toolbar-sep" aria-hidden="true"></span>

          <!-- Outline TOC -->
          <button
            type="button"
            class="toolbar-btn"
            :class="{ active: showOutline }"
            :disabled="outline.length === 0"
            @click="showOutline = !showOutline"
            :title="t('toolbar.outline')"
            :aria-label="t('toolbar.outline')"
            :aria-expanded="showOutline"
            aria-controls="doc-outline-sidebar"
          >📑</button>

          <!-- Hidden text toggle -->
          <button
            type="button"
            class="toolbar-btn"
            :class="{ active: showHiddenText }"
            @click="toggleHiddenText"
            :title="showHiddenText ? t('toolbar.hidden.show') : t('toolbar.hidden.hide')"
            :aria-label="t('toolbar.hidden.toggle')"
            :aria-pressed="showHiddenText"
          >👁️</button>
        </div>

        <div class="toolbar-right">
          <span class="doc-stats" v-if="wordCount > 0">
            {{ wordCount }} {{ t('stats.words') }} · {{ paragraphCount }} {{ t('stats.paragraphs') }} · {{ charCount }} {{ t('stats.chars') }}
          </span>

          <span class="toolbar-sep" aria-hidden="true"></span>

          <!-- Dark mode toggle -->
          <button
            type="button"
            class="toolbar-btn"
            :class="{ active: darkMode }"
            @click="toggleDarkMode"
            :title="darkMode ? t('app.theme.light') : t('app.theme.dark')"
            :aria-label="t('toolbar.theme')"
            :aria-pressed="darkMode"
          >
            {{ darkMode ? '☀️' : '🌙' }}
          </button>

          <!-- Shortcuts -->
          <button
            type="button"
            class="toolbar-btn"
            :class="{ active: showShortcuts }"
            @click="toggleShortcuts"
            :title="t('toolbar.shortcuts') + ' (?)'"
            :aria-label="t('toolbar.shortcuts')"
            :aria-expanded="showShortcuts"
            aria-controls="doc-shortcuts-panel"
          >⌨️</button>

          <span class="toolbar-sep" aria-hidden="true"></span>

          <!-- Pagination controls -->
          <div class="pagination-controls" role="group" :aria-label="t('pagination.label')">
            <button
              type="button"
              class="pagination-btn"
              @click="goToPrevPage"
              :disabled="currentPage <= 1"
              :title="t('pagination.prev')"
              :aria-label="t('pagination.prev')"
            >◀</button>
            <span
              class="pagination-info"
              role="status"
              aria-live="polite"
              :aria-label="t('pagination.page', { current: currentPage, total: totalPages })"
            >
              {{ currentPage }} / {{ totalPages }}
            </span>
            <button
              type="button"
              class="pagination-btn"
              @click="goToNextPage"
              :disabled="currentPage >= totalPages"
              :title="t('pagination.next')"
              :aria-label="t('pagination.next')"
            >▶</button>
          </div>
        </div>
      </div>

      <!-- Search bar -->
      <div
        v-if="showSearch"
        id="doc-search-bar"
        class="search-bar"
        role="search"
        :aria-label="t('toolbar.search')"
      >
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="search"
          class="search-input"
          autocomplete="off"
          enterkeyhint="search"
          :placeholder="t('search.placeholder')"
          :aria-label="t('search.placeholder')"
          aria-describedby="doc-search-status"
          @input="performSearch"
          @keyup.enter="nextMatch"
        />
        <label class="search-option" :title="t('search.case')">
          <input type="checkbox" v-model="searchCaseSensitive" :aria-label="t('search.case')" @change="performSearch" />
          <span aria-hidden="true">Aa</span>
        </label>
        <label class="search-option" :title="t('search.word')">
          <input type="checkbox" v-model="searchWholeWord" :aria-label="t('search.word')" @change="performSearch" />
          <span aria-hidden="true">W</span>
        </label>
        <span id="doc-search-status" class="search-status" role="status" aria-live="polite">{{ searchStatusLabel }}</span>
        <button type="button" class="toolbar-btn" @click="prevMatch" :disabled="searchResults.length === 0" :title="t('search.prevMatch')" :aria-label="t('search.prevMatch')">▲</button>
        <button type="button" class="toolbar-btn" @click="nextMatch" :disabled="searchResults.length === 0" :title="t('search.nextMatch')" :aria-label="t('search.nextMatch')">▼</button>
        <button type="button" class="toolbar-btn" @click="toggleSearch" :title="t('search.close')" :aria-label="t('search.close')">✕</button>
      </div>

      <!-- Document info -->
      <div class="doc-info">
        <span class="doc-name">{{ fileName }}</span>
        <span class="doc-status" role="status" aria-live="polite">{{ t('doc.status.ok') }}</span>
      </div>

      <!-- Document outline sidebar -->
      <div
        v-if="showOutline && outline.length > 0"
        id="doc-outline-sidebar"
        class="outline-sidebar"
        role="navigation"
        :aria-label="t('outline.header')"
      >
        <div class="outline-header">{{ t('outline.header') }}</div>
        <div class="outline-list">
          <div
            v-for="item in outline"
            :key="item.index"
            class="outline-item"
            :class="'outline-level-' + item.level"
            role="button"
            tabindex="0"
            :aria-label="item.text"
            @click="scrollToOutline(item)"
            @keydown.enter.prevent="scrollToOutline(item)"
            @keydown.space.prevent="scrollToOutline(item)"
          >{{ item.text }}</div>
        </div>
      </div>

      <!-- Document content (paper-like) -->
      <div class="paper-page">
        <div id="doc-content" class="document-content" tabindex="-1">
          <template v-for="(pageHtml, idx) in pages" :key="idx">
            <div
              v-if="isPageVisible(idx)"
              class="page-host"
              :data-page-idx="idx"
              v-html="pageHtml"
            ></div>
            <div
              v-else
              class="page-placeholder"
              :data-page-idx="idx"
              :style="{ height: getPagePlaceholderHeight(idx) + 'px' }"
            ></div>
          </template>
        </div>
      </div>

      <!-- Stories panel (headers / footnotes / endnotes / comments / textboxes) -->
      <CollapsiblePanel
        v-if="storySections.length > 0"
        v-model="showStories"
        :title="panelTitle('story.title', storySections.length)"
        :summary="storySections.map((s: StorySection) => s.label).join(' · ')"
        panel-class="stories-panel"
      >
        <div
          v-for="section in storySections"
          :key="section.key"
          class="story-section"
          :class="'story-' + section.key"
        >
          <div class="story-section-title">{{ section.label }}</div>
          <div class="story-section-text" v-html="formatStoryText(section.text)"></div>
          <div v-if="section.images && section.images.length > 0" class="story-section-images">
            <div
              v-for="(img, idx) in section.images"
              :key="idx"
              class="story-image-item"
            >
              <img
                :src="img.dataUrl"
                :alt="t('images.alt', { n: idx + 1 })"
                :style="{
                  maxWidth: '100%',
                  height: 'auto',
                  maxHeight: '200px',
                }"
                loading="lazy"
                decoding="async"
                class="story-image"
              />
              <span class="story-image-caption">{{ img.format?.toUpperCase() || t('story.image.caption', { fmt: '' }) }}</span>
            </div>
          </div>
        </div>
      </CollapsiblePanel>

      <!-- Document properties (title / author / keywords etc.) -->
      <CollapsiblePanel
        v-if="docProperties"
        v-model="showProperties"
        :title="t('props.title')"
        :summary="docProperties.title || docProperties.author || t('props.title')"
        panel-class="properties-panel"
      >
        <div v-if="docProperties.title" class="property-item">
          <span class="property-label">{{ t('props.field.title') }}:</span>
          <span class="property-value">{{ docProperties.title }}</span>
        </div>
        <div v-if="docProperties.subject" class="property-item">
          <span class="property-label">{{ t('props.field.subject') }}:</span>
          <span class="property-value">{{ docProperties.subject }}</span>
        </div>
        <div v-if="docProperties.author" class="property-item">
          <span class="property-label">{{ t('props.field.author') }}:</span>
          <span class="property-value">{{ docProperties.author }}</span>
        </div>
        <div v-if="docProperties.lastAuthor" class="property-item">
          <span class="property-label">{{ t('props.field.lastAuthor') }}:</span>
          <span class="property-value">{{ docProperties.lastAuthor }}</span>
        </div>
        <div v-if="docProperties.keywords" class="property-item">
          <span class="property-label">{{ t('props.field.keywords') }}:</span>
          <span class="property-value">{{ docProperties.keywords }}</span>
        </div>
        <div v-if="docProperties.comments" class="property-item">
          <span class="property-label">{{ t('props.field.comments') }}:</span>
          <span class="property-value">{{ docProperties.comments }}</span>
        </div>
        <div v-if="docProperties.pageCount" class="property-item">
          <span class="property-label">{{ t('props.pages') }}:</span>
          <span class="property-value">{{ docProperties.pageCount }}</span>
        </div>
        <div v-if="docProperties.wordCount" class="property-item">
          <span class="property-label">{{ t('props.words') }}:</span>
          <span class="property-value">{{ docProperties.wordCount }}</span>
        </div>
        <div v-if="docProperties.charCount" class="property-item">
          <span class="property-label">{{ t('props.chars') }}:</span>
          <span class="property-value">{{ docProperties.charCount }}</span>
        </div>
        <div v-if="docProperties.category" class="property-item">
          <span class="property-label">{{ t('props.category') }}:</span>
          <span class="property-value">{{ docProperties.category }}</span>
        </div>
        <div v-if="docProperties.company" class="property-item">
          <span class="property-label">{{ t('props.company') }}:</span>
          <span class="property-value">{{ docProperties.company }}</span>
        </div>
        <div v-if="docProperties.manager" class="property-item">
          <span class="property-label">{{ t('props.manager') }}:</span>
          <span class="property-value">{{ docProperties.manager }}</span>
        </div>
        <div v-if="docProperties.template" class="property-item">
          <span class="property-label">{{ t('props.template') }}:</span>
          <span class="property-value">{{ docProperties.template }}</span>
        </div>
        <div v-if="styleSet" class="property-item">
          <span class="property-label">{{ t('props.styleSet') }}:</span>
          <span class="property-value">{{ styleSet.name }}{{ styleSet.isCustom ? t('props.styleSet.custom') : '' }}</span>
        </div>
        <div v-if="docProperties.appName" class="property-item">
          <span class="property-label">{{ t('props.appName') }}:</span>
          <span class="property-value">{{ docProperties.appName }}</span>
        </div>
        <div v-if="wordVersionLabel" class="property-item">
          <span class="property-label">{{ t('props.wordVersion') }}:</span>
          <span class="property-value">{{ wordVersionLabel }}</span>
        </div>
        <div v-if="docProperties.revisionNumber" class="property-item">
          <span class="property-label">{{ t('props.revisionNumber') }}:</span>
          <span class="property-value">{{ docProperties.revisionNumber }}</span>
        </div>
        <div v-if="docProperties.lineCount" class="property-item">
          <span class="property-label">{{ t('props.lines') }}:</span>
          <span class="property-value">{{ docProperties.lineCount }}</span>
        </div>
        <div v-if="docProperties.paragraphCount" class="property-item">
          <span class="property-label">{{ t('props.paragraphs') }}:</span>
          <span class="property-value">{{ docProperties.paragraphCount }}</span>
        </div>
        <div v-if="docProperties.charCountWithSpaces" class="property-item">
          <span class="property-label">{{ t('props.charsWithSpaces') }}:</span>
          <span class="property-value">{{ docProperties.charCountWithSpaces }}</span>
        </div>
      </CollapsiblePanel>

      <!-- Document fields (from PlcfFld - AUTHOR/TITLE/DATE etc.) -->
      <CollapsiblePanel
        v-if="docFields"
        v-model="showProperties"
        :title="t('props.docFields')"
        :summary="docFields.title || docFields.author || t('props.docFields')"
        panel-class="properties-panel"
      >
        <div v-if="docFields.title" class="property-item">
          <span class="property-label">{{ t('props.field.title') }}:</span>
          <span class="property-value">{{ docFields.title }}</span>
        </div>
        <div v-if="docFields.author" class="property-item">
          <span class="property-label">{{ t('props.field.author') }}:</span>
          <span class="property-value">{{ docFields.author }}</span>
        </div>
        <div v-if="docFields.subject" class="property-item">
          <span class="property-label">{{ t('props.field.subject') }}:</span>
          <span class="property-value">{{ docFields.subject }}</span>
        </div>
        <div v-if="docFields.keywords" class="property-item">
          <span class="property-label">{{ t('props.field.keywords') }}:</span>
          <span class="property-value">{{ docFields.keywords }}</span>
        </div>
        <div v-if="docFields.comments" class="property-item">
          <span class="property-label">{{ t('props.field.comments') }}:</span>
          <span class="property-value">{{ docFields.comments }}</span>
        </div>
        <div v-if="docFields.lastSavedBy" class="property-item">
          <span class="property-label">{{ t('props.field.lastSavedBy') }}:</span>
          <span class="property-value">{{ docFields.lastSavedBy }}</span>
        </div>
        <div v-if="docFields.createDate" class="property-item">
          <span class="property-label">{{ t('props.field.created') }}:</span>
          <span class="property-value">{{ docFields.createDate }}</span>
        </div>
        <div v-if="docFields.lastSavedDate" class="property-item">
          <span class="property-label">{{ t('props.field.lastSaved') }}:</span>
          <span class="property-value">{{ docFields.lastSavedDate }}</span>
        </div>
        <div v-if="docFields.printDate" class="property-item">
          <span class="property-label">{{ t('props.field.printed') }}:</span>
          <span class="property-value">{{ docFields.printDate }}</span>
        </div>
        <div v-if="docFields.date" class="property-item">
          <span class="property-label">{{ t('props.field.date') }}:</span>
          <span class="property-value">{{ docFields.date }}</span>
        </div>
        <div v-if="docFields.time" class="property-item">
          <span class="property-label">{{ t('props.field.time') }}:</span>
          <span class="property-value">{{ docFields.time }}</span>
        </div>
        <div v-if="docFields.revisionNumber" class="property-item">
          <span class="property-label">{{ t('props.field.revision') }}:</span>
          <span class="property-value">{{ docFields.revisionNumber }}</span>
        </div>
      </CollapsiblePanel>

      <!-- Document flags from DOP (facing pages / title page / track changes etc.) -->
      <CollapsiblePanel
        v-if="docFlagItems.length > 0"
        v-model="showDocFlags"
        :title="t('flags.title')"
        :summary="t('flags.items', { n: docFlagItems.length })"
        panel-class="doc-flags-panel"
      >
        <div class="doc-flags-content">
          <div
            v-for="(item, index) in docFlagItems"
            :key="index"
            class="flag-item"
          >
            <span class="flag-badge">{{ item.label }}</span>
            <span class="flag-description">{{ item.description }}</span>
          </div>
        </div>
      </CollapsiblePanel>

      <!-- Table of Contents / Index -->
      <TocIndexPanel
        v-if="toc.length > 0 || index.length > 0"
        v-model:toc-open="showToc"
        v-model:index-open="showIndex"
        :toc-title="panelTitle('toc.title', toc.length)"
        :index-title="panelTitle('index.title', index.length)"
        :toc="toc"
        :index="index"
      />

      <!-- Revision marks (track changes: insert / delete) -->
      <CollapsiblePanel
        v-if="revisions.length > 0"
        v-model="showRevisions"
        :title="panelTitle('revisions.title', revisions.length)"
        :summary="t('revisions.count', { n: revisionItems.length })"
        panel-class="revisions-panel"
      >
        <div class="revision-mode-toolbar" role="group" :aria-label="t('revisions.title')">
          <button
            type="button"
            class="revision-mode-btn"
            :class="{ active: revisionMode === 'marks' }"
            :aria-pressed="revisionMode === 'marks'"
            @click="setRevisionMode('marks')"
            :title="t('revisions.marks')"
          >{{ t('revisions.marks') }}</button>
          <button
            type="button"
            class="revision-mode-btn"
            :class="{ active: revisionMode === 'accepted' }"
            :aria-pressed="revisionMode === 'accepted'"
            @click="setRevisionMode('accepted')"
            :title="t('revisions.accept')"
          >{{ t('revisions.accept') }}</button>
          <button
            type="button"
            class="revision-mode-btn"
            :class="{ active: revisionMode === 'rejected' }"
            :aria-pressed="revisionMode === 'rejected'"
            @click="setRevisionMode('rejected')"
            :title="t('revisions.reject')"
          >{{ t('revisions.reject') }}</button>
        </div>
        <div
          v-for="(item, idx) in revisionItems"
          :key="idx"
          class="revision-item"
          :class="'revision-type-' + item.type"
        >
          <span class="revision-badge">{{ item.label }}</span>
          <span class="revision-author">{{ item.author }}</span>
          <span v-if="item.time" class="revision-time">{{ item.time }}</span>
          <span class="revision-count">{{ t('revisions.count', { n: item.count }) }}</span>
        </div>
      </CollapsiblePanel>

      <!-- Bookmarks (named ranges from PlcfBkf/PlcfBkl/SttbfBkmk) -->
      <BookmarksPanel
        v-if="bookmarks.length > 0"
        v-model="showBookmarks"
        :title="panelTitle('bookmarks.title', bookmarks.length)"
        :summary="t('bookmarks.summary')"
        :bookmarks="bookmarks"
      />

      <!-- Sections (page layout from PlcfSed/SEPX) -->
      <CollapsiblePanel
        v-if="sections.length > 0"
        v-model="showSections"
        :title="panelTitle('sections.title', sections.length)"
        :summary="t('sections.summary')"
        panel-class="sections-panel"
      >
        <div class="sections-content">
          <div
            v-for="(sec, idx) in sections"
            :key="idx"
            class="section-item"
          >
            <div class="section-header">
              <span class="section-index">{{ t('sections.index', { n: sec.index }) }}</span>
              <span v-if="sec.breakType" class="section-break">
                {{ t('sections.break.' + sec.breakType) || sec.breakType }}
              </span>
              <span v-if="sec.orientation" class="section-orientation">
                {{ sec.orientation === 'landscape' ? t('sections.orientation.landscape') : t('sections.orientation.portrait') }}
              </span>
            </div>
            <div class="section-grid">
              <div v-if="sec.pageWidthPt && sec.pageHeightPt" class="section-field">
                <span class="section-field-label">{{ t('sections.pageSize') }}</span>
                <span class="section-field-value">
                  {{ formatSizePt(sec.pageWidthPt) }} × {{ formatSizePt(sec.pageHeightPt) }}
                </span>
              </div>
              <div v-if="sec.marginLeftPt" class="section-field">
                <span class="section-field-label">{{ t('sections.marginLeft') }}</span>
                <span class="section-field-value">{{ formatSizePt(sec.marginLeftPt) }}</span>
              </div>
              <div v-if="sec.marginRightPt" class="section-field">
                <span class="section-field-label">{{ t('sections.marginRight') }}</span>
                <span class="section-field-value">{{ formatSizePt(sec.marginRightPt) }}</span>
              </div>
              <div v-if="sec.marginTopPt" class="section-field">
                <span class="section-field-label">{{ t('sections.marginTop') }}</span>
                <span class="section-field-value">{{ formatSizePt(sec.marginTopPt) }}</span>
              </div>
              <div v-if="sec.marginBottomPt" class="section-field">
                <span class="section-field-label">{{ t('sections.marginBottom') }}</span>
                <span class="section-field-value">{{ formatSizePt(sec.marginBottomPt) }}</span>
              </div>
              <div v-if="sec.gutterPt" class="section-field">
                <span class="section-field-label">{{ t('sections.gutter') }}</span>
                <span class="section-field-value">{{ formatSizePt(sec.gutterPt) }}</span>
              </div>
              <div v-if="sec.columnCount && sec.columnCount > 1" class="section-field">
                <span class="section-field-label">{{ t('sections.columns') }}</span>
                <span class="section-field-value">
                  {{ sec.columnCount }} {{ t('sections.columns') }}
                  <span v-if="sec.columnSpacingPt">{{ t('sections.columns.gap', { pt: formatSizePt(sec.columnSpacingPt) }) }}</span>
                </span>
              </div>
              <div v-if="sec.pageStart !== undefined" class="section-field">
                <span class="section-field-label">{{ t('sections.startPageNum') }}</span>
                <span class="section-field-value">{{ sec.pageStart }}</span>
              </div>
            </div>
          </div>
        </div>
      </CollapsiblePanel>

      <!-- Page fields (PAGE / NUMPAGES / SECTION / SECTIONPAGES) -->
      <CollapsiblePanel
        v-if="pageFields.length > 0"
        v-model="showPageFields"
        :title="panelTitle('pageFields.title', pageFields.length)"
        summary="PAGE / NUMPAGES"
        panel-class="page-fields-panel"
      >
        <div class="page-fields-content">
          <div
            v-for="(pf, idx) in pageFields"
            :key="idx"
            class="page-field-item"
          >
            <div class="page-field-header">
              <span class="page-field-type">
                {{ t('pageFields.type.' + pf.type) || pf.type }}
              </span>
              <span v-if="pf.result" class="page-field-result">{{ t('pageFields.value', { v: pf.result }) }}</span>
            </div>
            <div class="page-field-instruction">{{ t('pageFields.instruction', { inst: pf.instruction }) }}</div>
            <div class="page-field-cp">CP: {{ pf.cpStart }} – {{ pf.cpEnd }}</div>
          </div>
        </div>
      </CollapsiblePanel>

      <!-- Cross-references (REF / NOTEREF) -->
      <CollapsiblePanel
        v-if="crossReferences.length > 0"
        v-model="showCrossReferences"
        :title="panelTitle('crossRefs.title', crossReferences.length)"
        summary="REF / NOTEREF"
        panel-class="cross-refs-panel"
      >
        <div class="cross-refs-content">
          <div
            v-for="(cr, idx) in crossReferences"
            :key="idx"
            class="cross-ref-item"
          >
            <div class="cross-ref-header">
              <span class="cross-ref-type">
                {{ t('crossRefs.type.' + cr.type) || cr.type }}
              </span>
              <span v-if="cr.result" class="cross-ref-result">{{ t('crossRefs.show', { v: cr.result }) }}</span>
            </div>
            <div class="cross-ref-target">
              {{ t('crossRefs.target') }}: <code>{{ cr.targetBookmarkName }}</code>
            </div>
            <div class="cross-ref-instruction">{{ t('crossRefs.instruction', { inst: cr.instruction }) }}</div>
            <div v-if="cr.switches.length > 0" class="cross-ref-switches">
              {{ t('crossRefs.switches') }}:
              <span
                v-for="sw in cr.switches"
                :key="sw"
                class="cross-ref-switch"
                :title="t('crossRefs.switch.' + sw.replace('\\\\', ''))"
              >{{ sw }}{{ t('crossRefs.switch.' + sw.replace('\\\\', '')) ? ` (${t('crossRefs.switch.' + sw.replace('\\\\', ''))})` : '' }}</span>
            </div>
            <div class="cross-ref-cp">CP: {{ cr.cpStart }} – {{ cr.cpEnd }}</div>
          </div>
        </div>
      </CollapsiblePanel>

      <!-- Shapes (Office Art Drawing Container - floating images with anchors) -->
      <CollapsiblePanel
        v-if="shapes.length > 0"
        v-model="showShapes"
        :title="panelTitle('shapes.title', shapes.length)"
        :summary="t('shapes.summary')"
        panel-class="shapes-panel"
      >
        <div class="shapes-content">
          <div
            v-for="(shape, idx) in shapes"
            :key="idx"
            class="shape-item"
          >
            <div class="shape-header">
              <span class="shape-type">{{ t('shapes.type.' + shape.type) || shape.type }}</span>
              <span v-if="shape.floating" class="shape-floating">{{ t('shapes.floating') }}</span>
              <span v-if="shape.hasPicture" class="shape-picture">{{ t('shapes.hasPicture') }}</span>
            </div>
            <div class="shape-spid">{{ t('shapes.spid', { id: shape.spid }) }}</div>
            <div v-if="shape.x !== undefined && shape.y !== undefined" class="shape-position">
              {{ t('shapes.position', { x: shape.x, y: shape.y }) }}
            </div>
            <div v-if="shape.width !== undefined && shape.height !== undefined" class="shape-size">
              {{ t('shapes.size', { w: shape.width, h: shape.height }) }}
            </div>
            <div class="shape-anchor">
              {{ t('shapes.anchorType', { type: t('shapes.anchor.' + shape.anchorType) || shape.anchorType, cp: shape.anchorCp !== undefined ? shape.anchorCp : '' }) }}
            </div>
            <div v-if="shape.fcPic !== undefined" class="shape-fcpic">
              {{ t('shapes.fcPic', { fc: shape.fcPic }) }}
            </div>
            <div v-if="shape.name" class="shape-name">{{ t('shapes.name', { name: shape.name }) }}</div>
            <div v-if="shape.groupId !== undefined" class="shape-group">
              {{ t('shapes.groupId', { id: shape.groupId }) }}
            </div>
          </div>
        </div>
      </CollapsiblePanel>

      <!-- Equations (Equation Editor OLE objects) -->
      <CollapsiblePanel
        v-if="equations.length > 0"
        v-model="showEquations"
        :title="panelTitle('equations.title', equations.length)"
        :summary="t('equations.summary')"
        panel-class="equations-panel"
      >
        <div class="equations-content">
          <div
            v-for="(eq, idx) in equations"
            :key="idx"
            class="equation-item"
          >
            <div class="equation-header">
              <span class="equation-id">{{ t('equations.id', { id: eq.id }) }}</span>
              <span v-if="eq.hasPicture" class="equation-has-picture">{{ t('equations.hasPicture') }}</span>
            </div>
            <div v-if="eq.latex" class="equation-latex">
              <span class="equation-label">{{ t('equations.latex') }}</span>
              <span class="equation-code">{{ eq.latex }}</span>
            </div>
            <div v-if="eq.eqnText" class="equation-eqntext">
              <span class="equation-label">{{ t('equations.original') }}</span>
              <span class="equation-code">{{ eq.eqnText }}</span>
            </div>
          </div>
        </div>
      </CollapsiblePanel>

      <!-- Charts (MSGraph/Excel/SmartArt OLE objects) -->
      <!--
      <CollapsiblePanel
        v-if="charts.length > 0"
        v-model="showCharts"
        :title="panelTitle('charts.title', charts.length)"
        :summary="t('charts.summary')"
        panel-class="charts-panel"
      >
        <div class="charts-content">
          <div
            v-for="(chart, idx) in charts"
            :key="idx"
            class="chart-item"
          >
            <div class="chart-header">
              <span class="chart-id">{{ t('charts.id', { id: chart.id }) }}</span>
              <span class="chart-type">{{ getChartTypeLabel(chart.type) }}</span>
              <span v-if="chart.hasPicture" class="chart-has-picture">{{ t('charts.hasPicture') }}</span>
              <span v-if="chart.hasData" class="chart-has-data">{{ t('charts.hasData') }}</span>
            </div>
            <div class="chart-name">
              <span class="chart-label">{{ t('charts.label.name') }}</span>
              <span class="chart-value">{{ chart.name }}</span>
            </div>
            <div v-if="chart.subtype && chart.subtype !== 'unknown'" class="chart-subtype">
              <span class="chart-label">{{ t('charts.label.subtype') }}</span>
              <span class="chart-value">{{ getChartSubtypeLabel(chart.subtype) }}</span>
            </div>
            <div v-if="chart.dataSize" class="chart-datasize">
              <span class="chart-label">{{ t('charts.label.dataSize') }}</span>
              <span class="chart-value">{{ formatFileSize(chart.dataSize) }}</span>
            </div>
          </div>
        </div>
      </CollapsiblePanel>
      -->

      <!-- WordArt (Office Art Drawing WordArt objects) -->
      <CollapsiblePanel
        v-if="wordArts.length > 0"
        v-model="showWordArts"
        :title="panelTitle('wordart.title', wordArts.length)"
        :summary="t('wordart.summary')"
        panel-class="wordart-panel"
      >
        <div class="wordart-content">
          <div
            v-for="(wa, idx) in wordArts"
            :key="idx"
            class="wordart-item"
          >
            <div class="wordart-header">
              <span class="wordart-id">{{ t('wordart.id', { id: wa.id }) }}</span>
              <span v-for="(effect, eIdx) in wa.effects" :key="eIdx" class="wordart-effect">
                {{ getWordArtEffectLabel(effect) }}
              </span>
            </div>
            <div v-if="wa.text" class="wordart-text">
              <span class="wordart-label">{{ t('wordart.text') }}</span>
              <span class="wordart-value">{{ wa.text }}</span>
            </div>
            <div class="wordart-name">
              <span class="wordart-label">{{ t('wordart.name') }}</span>
              <span class="wordart-value">{{ wa.name }}</span>
            </div>
            <div v-if="wa.colors && wa.colors.length > 0" class="wordart-colors">
              <span class="wordart-label">{{ t('wordart.colors') }}</span>
              <div class="wordart-color-list">
                <span
                  v-for="(color, cIdx) in wa.colors"
                  :key="cIdx"
                  class="wordart-color"
                  :style="{ backgroundColor: color }"
                  :title="color"
                ></span>
              </div>
            </div>
          </div>
        </div>
      </CollapsiblePanel>

      <!-- Embedded images extracted from the Data stream -->
      <!--
      <CollapsiblePanel
        v-if="pictures.length > 0 || images.length > 0"
        v-model="showImages"
        :title="panelTitle('images.title', pictures.length > 0 ? pictures.length : images.length)"
        :summary="t('images.summary')"
        panel-class="images-panel"
      >
        <div class="images-content">
          <template v-if="pictures.length > 0">
            <div
              v-for="(pic, idx) in pictures"
              :key="idx"
              class="image-item"
            >
              <img :src="pic.dataUrl" :alt="t('images.alt', { n: idx + 1 })" loading="lazy" />
              <div class="image-meta">
                <span class="image-format">{{ pic.format.toUpperCase() }}</span>
                <template v-if="pic.widthPx && pic.heightPx">
                  <span class="image-size">{{ pic.widthPx }} × {{ pic.heightPx }}</span>
                </template>
                <span v-if="pic.floating" class="image-floating">{{ t('images.floating') }}</span>
              </div>
            </div>
          </template>
          <template v-else>
            <div
              v-for="(src, idx) in images"
              :key="idx"
              class="image-item"
            >
              <img :src="src" :alt="t('images.alt', { n: idx + 1 })" loading="lazy" />
            </div>
          </template>
        </div>
      </CollapsiblePanel>
      -->

      <!-- Document statistics -->

      <!-- Keyboard shortcuts panel -->
      <ShortcutsPanel v-model="showShortcuts" />
    </div>
  </div>
</template>

<style scoped>
/* ==================== Base ==================== */
.doc-preview {
  background: var(--bg-primary);
  border-radius: 0 0 16px 16px;
  box-shadow: var(--shadow);
  min-height: 500px;
  outline: none;
  padding-bottom: 32px;
}

.skip-link {
  position: absolute;
  top: -40px;
  left: 8px;
  background: var(--accent);
  color: white;
  padding: 6px 12px;
  border-radius: 4px;
  z-index: 100;
  text-decoration: none;
  font-size: 0.85rem;
  transition: top 0.2s;
}

.skip-link:focus {
  top: 8px;
}

/* ==================== Loading ==================== */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 100px 20px;
  background: var(--bg-secondary);
  border-radius: 0 0 16px 16px;
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 4px solid var(--border-color);
  border-top: 4px solid var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading-container p {
  color: var(--text-secondary);
  font-size: 1.1rem;
}

.loading-step {
  margin-top: 4px;
  font-size: 0.95rem;
  min-height: 1.4em;
}

.progress-track {
  width: 280px;
  max-width: 80%;
  height: 6px;
  background: var(--border-color);
  border-radius: 4px;
  margin: 16px auto 8px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--accent), var(--accent-light));
  transition: width 0.3s ease;
}

.progress-bar.indeterminate {
  width: 35%;
  animation: progressIndeterminate 1.5s ease-in-out infinite;
  background: linear-gradient(
    90deg,
    var(--accent) 0%,
    var(--accent-light) 50%,
    var(--accent) 100%
  );
  background-size: 200% 100%;
  animation: progressIndeterminate 1.5s ease-in-out infinite,
             progressShimmer 2s linear infinite;
}

@keyframes progressIndeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(380px); }
}

@keyframes progressShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.loading-filename {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-top: 8px;
}

.loading-meta {
  color: var(--text-muted);
  font-size: 0.8rem;
  margin-top: 4px;
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}

.worker-badge {
  background: var(--accent-light);
  color: var(--accent);
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
  font-size: 0.75rem;
}

/* ==================== Error ==================== */
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 100px 20px;
  background: var(--bg-secondary);
  border-radius: 0 0 16px 16px;
}

.error-icon {
  font-size: 4rem;
  margin-bottom: 20px;
}

.error-message {
  color: var(--error-text);
  font-size: 1.1rem;
  text-align: center;
  white-space: pre-line;
  max-width: 480px;
  line-height: 1.6;
}

/* Enhanced error display */
.enhanced-error {
  flex-direction: row;
  gap: 16px;
  text-align: left;
  align-items: flex-start;
  max-width: 720px;
  margin: 0 auto;
}

.enhanced-error .error-icon {
  font-size: 2.5rem;
  margin-bottom: 0;
  flex-shrink: 0;
}

.enhanced-error .error-body {
  flex: 1;
  min-width: 0;
}

.enhanced-error .error-title {
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--error-text);
  margin-bottom: 8px;
}

.enhanced-error .error-detail {
  color: var(--text-primary);
  font-size: 0.95rem;
  line-height: 1.5;
  margin-bottom: 12px;
  white-space: pre-line;
}

.enhanced-error .error-suggestions {
  margin: 0 0 12px 0;
  padding-left: 20px;
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.6;
}

.enhanced-error .error-suggestions li {
  margin-bottom: 4px;
}

.enhanced-error .error-actions {
  margin-bottom: 8px;
}

.enhanced-error .error-retry-btn {
  background: var(--accent, #3b82f6);
  color: #fff;
  border: none;
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: opacity 0.2s;
}

.enhanced-error .error-retry-btn:hover {
  opacity: 0.85;
}

.enhanced-error .error-raw {
  margin-top: 8px;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.enhanced-error .error-raw summary {
  cursor: pointer;
  user-select: none;
  padding: 4px 0;
}

.enhanced-error .error-raw pre {
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-radius: 4px;
  overflow-x: auto;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 0.8rem;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
}

/* Progress percent text */
.progress-percent {
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin: 4px 0 8px;
  font-variant-numeric: tabular-nums;
}

/* ==================== Toolbar ==================== */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: var(--toolbar-bg);
  border-bottom: 1px solid var(--toolbar-border);
  gap: 8px;
  flex-wrap: wrap;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-right {
  display: flex;
  align-items: center;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.toolbar-btn:hover:not(:disabled) {
  background: var(--bg-tertiary);
  border-color: var(--border-color);
}

.toolbar-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.toolbar-btn.active {
  background: var(--accent-light);
  color: var(--accent);
  border-color: var(--accent);
}

.zoom-label {
  font-variant-numeric: tabular-nums;
  min-width: 44px;
  font-weight: 600;
  cursor: pointer !important;
}

.toolbar-sep {
  width: 1px;
  height: 20px;
  background: var(--border-color);
  margin: 0 4px;
}

.doc-stats {
  font-size: 0.78rem;
  color: var(--text-muted);
  white-space: nowrap;
}

/* ==================== Pagination ==================== */
.pagination-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pagination-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}

.pagination-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.pagination-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pagination-info {
  font-size: 0.85rem;
  color: var(--text-muted);
  min-width: 60px;
  text-align: center;
}

.page-content {
  break-after: page;
  margin-bottom: 24px;
}

.page-content[style*="column-count"] {
  column-fill: auto;
  overflow: hidden;
}

.page-content[style*="column-count"] > * {
  break-inside: avoid;
}

/* v-html 容器：使用 display:contents 让 .page-content 直接作为 .document-content 子元素参与布局 */
.page-host {
  display: contents;
}

/* 虚拟滚动占位：非可视页面用此 div 保持滚动条高度正确 */
.page-placeholder {
  width: 100%;
  background: transparent;
}

/* ==================== Table styles ==================== */
.page-content table {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 12pt;
  font-size: 10pt;
}

.page-content th,
.page-content td {
  border: 1px solid #ccc;
  padding: 4px 8px;
  text-align: left;
  vertical-align: top;
}

.page-content th {
  background: #f5f5f5;
  font-weight: 600;
}

:root.dark .page-content th {
  background: #2a2a2a;
}

@media print {
  .page-content {
    break-after: page;
    margin-bottom: 0;
  }
}

/* ==================== Search bar ==================== */
.search-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--search-bar-bg);
  border-bottom: 1px solid var(--border-color);
}

.search-input {
  flex: 1;
  max-width: 300px;
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 0.85rem;
  outline: none;
  background: var(--bg-secondary);
  color: var(--text-primary);
  transition: border-color 0.15s;
}

.search-input:focus {
  border-color: var(--accent);
}

.search-status {
  font-size: 0.8rem;
  color: var(--text-muted);
  min-width: 50px;
  text-align: center;
}

.search-option {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  border: 1px solid transparent;
  transition: all 0.15s ease;
  user-select: none;
}

.search-option:hover {
  background: var(--bg-secondary, #f0f0f0);
  border-color: var(--border-color, #ddd);
}

.search-option input {
  display: none;
}

.search-option:has(input:checked) {
  background: #e3f2fd;
  border-color: #2196f3;
  color: #1565c0;
}

:root.dark .search-option:has(input:checked) {
  background: #1e3a5f;
  border-color: #64b5f6;
  color: #90caf9;
}

/* ==================== Document info ==================== */
.doc-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 24px;
  font-size: 0.82rem;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-light);
}

.doc-name {
  font-weight: 600;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}

.doc-status {
  color: #27ae60;
  flex-shrink: 0;
}

/* ==================== Paper page ==================== */
.paper-page {
  background: var(--paper-bg);
  width: 100%;
  max-width: 800px;
  margin: 24px auto;
  padding: 48px 56px;
  box-shadow: var(--paper-shadow);
  min-height: 400px;
  border-radius: 2px;
  /* FIX-VUEW：缩放改用真实回流布局的 zoom（CSS Baseline 2024），替代不参与
     布局的 transform: scale。旧实现的布局盒恒为 800px，≥150% 时视觉盒向四周
     溢出——横向被容器/视口裁切、纵向压过后续面板，且 transform-origin center
     使左缘侵入 float 左浮的大纲侧栏形成重叠。zoom 使布局盒随缩放同步伸缩、
     margin:auto 保持居中，两类缺陷从根消除；空间不足时浏览器给出原生滚动条
     而非裁切。兼容性：Chrome/Edge/Safari 长期支持，Firefox 126+（2024-05）。 */
  zoom: var(--zoom, 1);
  transition: background 0.3s;
}

/* ==================== Document content ==================== */
.document-content {
  line-height: 1.8;
  color: var(--text-primary);
  font-size: 14px;
  transition: color 0.3s;
}

.document-content h1 {
  font-size: 2.2rem;
  font-weight: bold;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 2px solid var(--accent);
  color: var(--text-primary);
  font-family: '华文中宋', 'SimHei', serif;
  text-align: center;
}

.document-content h2 {
  font-size: 1.6rem;
  font-weight: bold;
  margin-top: 28px;
  margin-bottom: 14px;
  color: var(--text-primary);
  font-family: '华文中宋', 'SimHei', serif;
}

.document-content h3 {
  font-size: 1.2rem;
  margin-top: 24px;
  margin-bottom: 12px;
  color: var(--text-secondary);
}

.document-content p {
  margin-bottom: 12px;
  text-align: justify;
}

.document-content ul,
.document-content ol {
  margin-bottom: 12px;
  padding-left: 28px;
}

.document-content li {
  margin-bottom: 6px;
}

.document-content strong {
  font-weight: 600;
  color: var(--text-primary);
}

.document-content em {
  font-style: italic;
}

.document-content table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 20px;
}

.document-content th,
.document-content td {
  border: 1px solid var(--border-color);
  padding: 8px 10px;
  text-align: left;
}

.document-content th {
  background-color: var(--bg-tertiary);
  font-weight: 600;
}

.document-content hr {
  border: none;
  border-top: 1px solid var(--border-color);
  margin: 24px 0;
}

.document-content blockquote {
  border-left: 4px solid var(--accent);
  padding-left: 14px;
  margin: 16px 0;
  color: var(--text-secondary);
  font-style: italic;
}

.document-content a {
  color: var(--accent);
  text-decoration: underline;
  cursor: pointer;
}

.document-content a:hover {
  text-decoration: none;
}

/* Search highlights */
:deep(.search-highlight) {
  background: var(--highlight);
  border-radius: 2px;
  padding: 0 1px;
}

:deep(.search-highlight-current) {
  background: var(--highlight-current);
  color: white;
  border-radius: 2px;
  padding: 0 1px;
}

/* ==================== Outline sidebar ==================== */
.outline-sidebar {
  float: left;
  width: 220px;
  margin: 24px 0 24px 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 0.82rem;
  max-height: 400px;
  overflow-y: auto;
  position: sticky;
  top: 16px;
}

.outline-header {
  padding: 10px 14px;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-color);
  font-size: 0.85rem;
}

.outline-list {
  padding: 6px 0;
}

.outline-item {
  padding: 5px 14px 5px calc(14px + 12px * (var(--level, 1) - 1));
  cursor: pointer;
  color: var(--text-secondary);
  line-height: 1.4;
  transition: background 0.1s, color 0.1s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.outline-item:hover {
  background: var(--bg-tertiary);
  color: var(--accent);
}

.outline-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  background: var(--bg-tertiary);
  color: var(--accent);
}

.outline-level-1 {
  --level: 1;
  font-weight: 600;
}

.outline-level-2 {
  --level: 2;
}

.outline-level-3 {
  --level: 3;
  font-size: 0.8rem;
}

/* Outline highlight flash on scroll target */
:deep(.outline-highlight) {
  animation: outlineFlash 2s ease-out;
}

@keyframes outlineFlash {
  0% { background: var(--accent-light); }
  100% { background: transparent; }
}

/* ==================== Stories panel ==================== */
.stories-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

:deep(.stories-toggle) {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.88rem;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}

:deep(.stories-toggle:hover) {
  background: var(--bg-tertiary);
}

:deep(.stories-toggle-icon) {
  display: inline-block;
  width: 12px;
  color: var(--text-muted);
  font-size: 0.75rem;
}

:deep(.stories-toggle-summary) {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 0.78rem;
}

/* ==================== Properties panel ==================== */
.properties-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.properties-panel .stories-content {
  padding: 16px;
  display: grid;
  gap: 12px;
}

.property-item {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.property-label {
  color: var(--text-muted);
  font-size: 0.85rem;
  min-width: 80px;
}

.property-value {
  color: var(--text-primary);
  font-size: 0.9rem;
  word-break: break-word;
}

.doc-flags-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.doc-flags-content {
  padding: 16px;
  display: grid;
  gap: 10px;
}

.flag-item {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}

.flag-badge {
  display: inline-block;
  padding: 2px 10px;
  background: var(--accent-bg, rgba(59, 130, 246, 0.12));
  color: var(--accent-color, #3b82f6);
  border-radius: 12px;
  font-size: 0.82rem;
  font-weight: 500;
  white-space: nowrap;
}

.flag-description {
  color: var(--text-muted);
  font-size: 0.85rem;
}

/* TOC / Index styles moved to TocIndexPanel.vue */

/* ==================== Revision marks ==================== */
.revisions-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.revisions-panel .stories-content {
  padding: 12px 16px;
  display: grid;
  gap: 8px;
}

.revision-mode-toolbar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  margin-bottom: 4px;
}

.revision-mode-btn {
  padding: 4px 12px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.82rem;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s;
}

.revision-mode-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.revision-mode-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.revision-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  padding: 6px 10px;
  background: var(--bg-primary);
  border-left: 3px solid var(--border-color);
  border-radius: 4px;
  font-size: 0.85rem;
}

.revision-item.revision-type-insert {
  border-left-color: #27ae60;
}

.revision-item.revision-type-delete {
  border-left-color: #e74c3c;
}

.revision-item.revision-type-format {
  border-left-color: #f39c12;
}

.revision-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 500;
  white-space: nowrap;
}

.revision-type-insert .revision-badge {
  background: rgba(39, 174, 96, 0.12);
  color: #27ae60;
}

.revision-type-delete .revision-badge {
  background: rgba(231, 76, 60, 0.12);
  color: #e74c3c;
}

.revision-type-format .revision-badge {
  background: rgba(243, 156, 18, 0.12);
  color: #f39c12;
}

.revision-author {
  color: var(--text-primary);
  font-weight: 500;
}

.revision-time {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.revision-count {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 0.8rem;
}

/* Bookmarks styles moved to BookmarksPanel.vue */

/* ==================== Sections (page layout) ==================== */
.sections-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.sections-content {
  padding: 12px 16px;
  display: grid;
  gap: 12px;
}

.section-item {
  padding: 10px 12px;
  background: var(--bg-primary);
  border-left: 3px solid #9b59b6;
  border-radius: 4px;
}

.section-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.section-index {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 0.9rem;
}

.section-break,
.section-orientation {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.75rem;
  background: rgba(155, 89, 182, 0.12);
  color: #9b59b6;
}

.section-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 6px 16px;
}

.section-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-field-label {
  color: var(--text-muted);
  font-size: 0.72rem;
}

.section-field-value {
  color: var(--text-primary);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}

/* Inline revision marks inside the rendered document */
.document-content ins.rev-insert,
.document-content del.rev-delete {
  text-decoration-thickness: 1px;
  cursor: help;
  border-radius: 2px;
  padding: 0 1px;
}

.document-content ins.rev-insert {
  text-decoration: underline;
  color: #27ae60;
  background: rgba(39, 174, 96, 0.08);
}

.document-content del.rev-delete {
  text-decoration: line-through;
  color: #e74c3c;
  background: rgba(231, 76, 60, 0.08);
  opacity: 0.85;
}

.stories-content {
  padding: 4px 16px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.story-section {
  padding: 10px 12px;
  background: var(--bg-primary);
  border-left: 3px solid var(--accent);
  border-radius: 4px;
}

.story-section-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 6px;
}

.story-section-text {
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--text-secondary);
  max-height: 240px;
  overflow-y: auto;
}

.story-section-text :deep(p) {
  margin: 0 0 6px 0;
}

.story-section-text :deep(p:last-child) {
  margin-bottom: 0;
}

.story-section-images {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.story-image-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.story-image {
  border-radius: 4px;
  border: 1px solid var(--border-color);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.story-image-caption {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

/* ==================== Page fields (PAGE / NUMPAGES) ==================== */
.page-fields-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.page-fields-content {
  padding: 12px 16px;
  display: grid;
  gap: 10px;
}

.page-field-item {
  padding: 8px 12px;
  background: var(--bg-primary);
  border-left: 3px solid #16a085;
  border-radius: 4px;
  font-size: 0.85rem;
}

.page-field-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.page-field-type {
  color: var(--text-primary);
  font-weight: 600;
}

.page-field-result {
  color: #16a085;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.page-field-instruction {
  color: var(--text-muted);
  font-size: 0.8rem;
  word-break: break-all;
}

.page-field-cp {
  color: var(--text-muted);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
}

/* ==================== Cross-references (REF / NOTEREF) ==================== */
.cross-refs-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.cross-refs-content {
  padding: 12px 16px;
  display: grid;
  gap: 10px;
}

.cross-ref-item {
  padding: 8px 12px;
  background: var(--bg-primary);
  border-left: 3px solid #8e44ad;
  border-radius: 4px;
  font-size: 0.85rem;
}

.cross-ref-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.cross-ref-type {
  color: var(--text-primary);
  font-weight: 600;
}

.cross-ref-result {
  color: #8e44ad;
  font-weight: 600;
}

.cross-ref-target {
  color: var(--text-muted);
  font-size: 0.8rem;
  margin-top: 2px;
}

.cross-ref-target code {
  background: var(--bg-tertiary);
  padding: 1px 6px;
  border-radius: 3px;
  font-family: 'SF Mono', Consolas, Monaco, monospace;
  color: #8e44ad;
}

.cross-ref-instruction {
  color: var(--text-muted);
  font-size: 0.8rem;
  word-break: break-all;
  margin-top: 2px;
}

.cross-ref-switches {
  color: var(--text-muted);
  font-size: 0.78rem;
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
}

.cross-ref-switch {
  display: inline-block;
  padding: 1px 6px;
  background: var(--bg-tertiary);
  border-radius: 3px;
  font-family: 'SF Mono', Consolas, Monaco, monospace;
  color: #8e44ad;
  font-size: 0.74rem;
}

.cross-ref-cp {
  color: var(--text-muted);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
}

/* ==================== Shapes (Office Art) ==================== */
.shapes-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.shapes-content {
  padding: 12px 16px;
  display: grid;
  gap: 10px;
}

.textbox-anchor-marker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0 6px 0;
  padding: 3px 10px;
  background: linear-gradient(135deg, #eef5ff, #e8f0fe);
  border: 1px dashed #4a90d9;
  border-radius: 12px;
  font-size: 0.78rem;
  color: #2c6fbb;
  cursor: help;
  user-select: none;
  transition: all 0.15s ease;
}

.textbox-anchor-marker:hover {
  background: linear-gradient(135deg, #dde9fa, #d4e4f8);
  border-color: #2c6fbb;
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(74, 144, 217, 0.25);
}

.textbox-anchor-icon {
  font-size: 1rem;
  line-height: 1;
  color: #4a90d9;
}

.textbox-anchor-label {
  font-weight: 600;
  letter-spacing: 0.5px;
}

.textbox-anchor-info {
  color: #5a7a9b;
  font-size: 0.72rem;
  border-left: 1px solid #b8d0e8;
  padding-left: 6px;
}

:root.dark .textbox-anchor-marker {
  background: linear-gradient(135deg, #1e2d44, #243755);
  border-color: #4a90d9;
  color: #8cb8e8;
}

:root.dark .textbox-anchor-marker:hover {
  background: linear-gradient(135deg, #2a3f5f, #2d4a6e);
}

:root.dark .textbox-anchor-info {
  color: #7a9bbf;
  border-left-color: #3a5a7a;
}

.inline-picture-container {
  margin: 12px 0;
  text-align: center;
}

.inline-picture {
  max-width: 100%;
  height: auto;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  display: inline-block;
  vertical-align: middle;
}

.inline-picture-caption {
  margin-top: 6px;
  font-size: 0.78rem;
  color: #888;
  font-style: italic;
}

:root.dark .inline-picture {
  border-color: #444;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

:root.dark .inline-picture-caption {
  color: #999;
}

.chart-placeholder {
  margin: 16px 0;
  padding: 24px;
  text-align: center;
  background: var(--bg-secondary, #f8f9fa);
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  color: #64748b;
}

.chart-placeholder-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 8px;
  display: block;
}

.chart-svg {
  width: 100%;
  max-width: 320px;
  height: auto;
  margin: 0 auto 8px;
  display: block;
}

.chart-preview-image {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0 auto 8px;
  border-radius: 4px;
}

.chart-placeholder-label {
  font-size: 0.85rem;
  font-weight: 500;
}

:root.dark .chart-placeholder {
  background: #1e293b;
  border-color: #475569;
  color: #94a3b8;
}

.shape-item {
  padding: 8px 12px;
  background: var(--bg-primary);
  border-left: 3px solid #3498db;
  border-radius: 4px;
  font-size: 0.85rem;
}

.shape-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.shape-type {
  color: var(--text-primary);
  font-weight: 600;
}

.shape-floating {
  background: #f1c40f;
  color: #333;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 600;
}

.shape-picture {
  background: #27ae60;
  color: white;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 600;
}

.shape-spid,
.shape-position,
.shape-size,
.shape-anchor,
.shape-fcpic,
.shape-name,
.shape-group {
  color: var(--text-muted);
  font-size: 0.8rem;
  margin-top: 2px;
}

/* ==================== Equations ==================== */

.equations-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.equations-content {
  padding: 12px 16px;
  display: grid;
  gap: 10px;
}

.equation-item {
  padding: 8px 12px;
  background: var(--bg-primary);
  border-left: 3px solid #9b59b6;
  border-radius: 4px;
  font-size: 0.85rem;
}

.equation-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.equation-id {
  color: var(--text-primary);
  font-weight: 600;
}

.equation-has-picture {
  background: #27ae60;
  color: white;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 600;
}

.equation-label {
  color: var(--text-muted);
  font-size: 0.78rem;
}

.equation-code {
  display: block;
  background: var(--bg-tertiary);
  padding: 6px 10px;
  border-radius: 4px;
  font-family: 'SF Mono', Consolas, Monaco, monospace;
  font-size: 0.8rem;
  word-break: break-all;
  margin-top: 4px;
  color: var(--text-primary);
}

.equation-latex .equation-code {
  color: #9b59b6;
}

.equation-eqntext .equation-code {
  color: var(--text-muted);
  font-size: 0.75rem;
}

/* ==================== Charts (MSGraph/Excel/SmartArt) ==================== */
.charts-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.charts-content {
  padding: 12px 16px;
  display: grid;
  gap: 10px;
}

.chart-item {
  padding: 8px 12px;
  background: var(--bg-primary);
  border-left: 3px solid #1abc9c;
  border-radius: 4px;
  font-size: 0.85rem;
}

.chart-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.chart-id {
  color: var(--text-primary);
  font-weight: 600;
}

.chart-type {
  background: #1abc9c;
  color: white;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 600;
}

.chart-has-picture {
  background: #27ae60;
  color: white;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 600;
}

.chart-has-data {
  background: #3498db;
  color: white;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 600;
}

.chart-label {
  color: var(--text-muted);
  font-size: 0.78rem;
}

.chart-value {
  display: block;
  background: var(--bg-tertiary);
  padding: 4px 8px;
  border-radius: 3px;
  font-size: 0.78rem;
  word-break: break-all;
  margin-top: 2px;
  color: var(--text-primary);
}

/* ==================== WordArt (Office Art) ==================== */
.wordart-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.wordart-content {
  padding: 12px 16px;
  display: grid;
  gap: 10px;
}

.wordart-item {
  padding: 8px 12px;
  background: var(--bg-primary);
  border-left: 3px solid #e74c3c;
  border-radius: 4px;
  font-size: 0.85rem;
}

.wordart-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.wordart-id {
  color: var(--text-primary);
  font-weight: 600;
}

.wordart-effect {
  background: #e74c3c;
  color: white;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 600;
}

.wordart-label {
  color: var(--text-muted);
  font-size: 0.78rem;
}

.wordart-value {
  display: block;
  background: var(--bg-tertiary);
  padding: 4px 8px;
  border-radius: 3px;
  font-size: 0.78rem;
  word-break: break-all;
  margin-top: 2px;
  color: var(--text-primary);
}

.wordart-color-list {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.wordart-color {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  cursor: pointer;
}

/* ==================== Embedded images ==================== */
.images-panel {
  margin: 16px auto;
  max-width: var(--page-max-width, 820px);
  padding: 0 16px;
  box-sizing: border-box;
}

.images-content {
  padding: 4px 16px 14px 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.image-item {
  flex: 0 0 auto;
  max-width: 100%;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.08));
  border-radius: 6px;
  padding: 6px;
  background: var(--bg-primary);
  box-sizing: border-box;
}

.image-item img {
  display: block;
  max-width: 100%;
  height: auto;
  max-height: 320px;
  border-radius: 3px;
}

.image-meta {
  margin-top: 6px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.image-format,
.image-size,
.image-floating {
  background: var(--bg-secondary, #f5f5f5);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.image-floating {
  background: #e8f4fd;
  color: #1976d2;
}

/* ==================== Stats panel ==================== */
.stats-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary, #f5f5f5);
  border: 1px solid var(--border-color, #ddd);
  border-radius: 8px;
  overflow: hidden;
}

.stats-content {
  padding: 12px 16px 16px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 12px 8px;
  background: var(--bg-primary, #fff);
  border-radius: 8px;
  border: 1px solid var(--border-color, #e8e8e8);
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--accent, #1a73e8);
  line-height: 1.2;
}

.stat-label {
  font-size: 0.78rem;
  color: var(--text-secondary, #888);
}

/* ==================== Shortcuts Panel ==================== */
.shortcuts-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.shortcuts-panel {
  background: var(--bg-primary, #fff);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  width: min(480px, calc(100vw - 32px));
  max-height: min(70vh, 500px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.shortcuts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  font-size: 15px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color, #e8e8e8);
}

.shortcuts-close {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  color: var(--text-secondary, #666);
  line-height: 1;
}

.shortcuts-close:hover {
  background: var(--bg-secondary, #f0f0f0);
  color: var(--text-primary, #333);
}

.shortcuts-body {
  padding: 8px 0;
  overflow-y: auto;
  flex: 1;
}

.shortcut-row {
  display: flex;
  align-items: center;
  padding: 8px 20px;
  gap: 12px;
}

.shortcut-keys {
  display: inline-block;
  background: var(--bg-secondary, #f0f0f0);
  border: 1px solid var(--border-color, #d8d8d8);
  border-radius: 4px;
  padding: 2px 7px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  color: var(--text-primary, #333);
  white-space: nowrap;
  box-shadow: 0 1px 0 rgba(0,0,0,0.08);
}

.shortcut-label {
  font-size: 14px;
  color: var(--text-primary, #333);
  margin-left: auto;
  text-align: right;
  white-space: nowrap;
}

/* ==================== Print styles ==================== */
@media print {
  .doc-preview {
    background: none !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    min-height: auto !important;
  }

  .toolbar {
    display: none !important;
  }

  .search-bar {
    display: none !important;
  }

  .doc-info {
    display: none !important;
  }

  .stories-panel {
    display: none !important;
  }

  .images-panel {
    display: none !important;
  }

  .paper-page {
    box-shadow: none !important;
    padding: 0 !important;
    margin: 0 !important;
    max-width: none !important;
    transform: none !important;
  }

  .document-content {
    color: #000 !important;
  }
}

/* ==================== Mobile ==================== */
@media (max-width: 900px) {
  .outline-sidebar {
    float: none;
    width: auto;
    margin: 16px;
    max-height: 280px;
    position: static;
  }

  .doc-preview {
    border-radius: 0 !important;
  }

  .paper-page {
    padding: 24px 16px;
    margin: 8px auto;
  }

  .doc-info {
    padding: 8px 14px;
    font-size: 0.8rem;
  }

  .toolbar {
    padding: 6px 8px;
    gap: 4px;
  }

  .toolbar-left {
    overflow-x: auto;
    flex: 1;
    gap: 2px;
    scrollbar-width: none;
    -ms-overflow-style: none;
    touch-action: pan-x;
  }

  .toolbar-left::-webkit-scrollbar {
    display: none;
  }

  .toolbar-right {
    gap: 2px;
  }

  .toolbar-btn {
    min-width: 36px;
    height: 36px;
    padding: 0 6px;
    font-size: 0.82rem;
    flex-shrink: 0;
  }

  .toolbar-sep {
    margin: 0 2px;
    flex-shrink: 0;
  }

  .toolbar-right .doc-stats {
    font-size: 0.7rem;
  }

  .zoom-label {
    min-width: 36px;
  }

  .pagination-controls {
    gap: 2px;
  }

  .pagination-btn {
    min-width: 34px;
    height: 34px;
    font-size: 0.8rem;
  }

  .search-bar {
    padding: 8px 12px;
    gap: 6px;
    flex-wrap: nowrap;
  }

  .search-bar .toolbar-btn {
    min-width: 34px;
    height: 34px;
  }

  .properties-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 640px) {
  .doc-preview {
    min-height: 300px;
  }

  .paper-page {
    padding: 16px 10px;
    margin: 6px auto;
  }

  .loading-container,
  .error-container {
    padding: 60px 20px;
  }

  .doc-stats {
    display: none;
  }

  .toolbar {
    padding: 4px 6px;
    gap: 2px;
  }

  .toolbar-left {
    gap: 1px;
  }

  .toolbar-btn {
    min-width: 40px;
    height: 40px;
    padding: 0 5px;
    font-size: 0.85rem;
  }

  .toolbar-sep {
    display: none;
  }

  .pagination-controls {
    gap: 1px;
  }

  .pagination-btn {
    min-width: 38px;
    height: 38px;
    font-size: 0.78rem;
  }

  .pagination-current {
    font-size: 0.75rem;
    min-width: 50px;
  }

  .search-bar {
    padding: 6px 8px;
    gap: 4px;
  }

  .search-bar .toolbar-btn {
    min-width: 38px;
    height: 38px;
  }

  .outline-sidebar {
    margin: 10px;
    max-height: 240px;
    border-radius: 6px;
    font-size: 0.78rem;
  }

  .stories-panel,
  .properties-panel,
  .doc-flags-panel,
  :deep(.toc-panel),
  .revisions-panel,
  :deep(.bookmarks-panel),
  .sections-panel,
  .page-fields-panel,
  .cross-refs-panel,
  .shapes-panel,
  .equations-panel,
  .charts-panel,
  .wordart-panel,
  .images-panel,
  .stats-panel {
    max-width: 100%;
    margin: 0 10px 20px 10px;
  }

  .stories-content,
  .properties-content,
  .doc-flags-content,
  :deep(.toc-content),
  .revisions-content,
  :deep(.bookmarks-content),
  .sections-content,
  .page-fields-content,
  .cross-refs-content,
  .shapes-content,
  .equations-content,
  .charts-content,
  .wordart-content,
  .images-content,
  .stats-content {
    padding: 8px 10px;
  }

  .properties-grid {
    grid-template-columns: 1fr;
  }

  .section-grid {
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }

  .stories-toggle {
    padding: 10px;
    font-size: 0.82rem;
  }

  .revision-mode-btn {
    padding: 6px 10px;
    font-size: 0.75rem;
  }

  .shortcuts-panel {
    width: calc(100vw - 24px);
    max-height: min(80vh, 480px);
    border-radius: 10px;
  }

  .shortcut-row {
    padding: 6px 14px;
  }

  .page-host .page-content {
    padding: 0 4px;
  }
}

@media (max-width: 480px) {
  .toolbar-btn {
    min-width: 44px;
    height: 44px;
    padding: 0 6px;
    font-size: 0.9rem;
  }

  .pagination-btn {
    min-width: 42px;
    height: 42px;
    font-size: 0.82rem;
  }

  .paper-page {
    padding: 12px 8px;
    margin: 4px auto;
  }

  .pagination-current {
    font-size: 0.72rem;
    min-width: 44px;
  }

  .toolbar-left .toolbar-btn.zoom-reset-label {
    display: none;
  }

  .outline-header {
    padding: 8px 10px;
    font-size: 0.8rem;
  }

  .outline-item {
    padding: 6px 10px 6px calc(10px + 12px * (var(--level, 1) - 1));
    font-size: 0.78rem;
  }
}
</style>
