<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, onErrorCaptured, nextTick } from 'vue'
import { parseDocFileWithFormat, parseDocFileFromBuffer } from '../utils/docParser'
import type { ParseProgressStage } from '../utils/docParser'
import { parseWithWorker } from '../utils/parseWithWorker'
import { renderTableHtml, renderNestedTableHtml, splitTableCells } from '../utils/tableText'
import type { CharacterFormat, ParagraphFormat, CharStyleSegment, TableInfo, RevisionMark, RevisionType, BookmarkRange, SectionInfo, PageFieldRange, CrossReferenceRange, ShapeInfo, EquationInfo, ChartInfo, WordArtInfo } from '../utils/docFormat'
import type { DocumentFields } from '../utils/fieldParser'
import { applyRevisionsToText } from '../utils/revisionRender'
import type { RevisionMode } from '../utils/revisionRender'
import { WORD_VERSION_LABELS, type WordVersion } from '../utils/fibParser'
import { t } from '../utils/locale'
import DocStatsPanel from './DocStatsPanel.vue'
import ShortcutsPanel from './ShortcutsPanel.vue'
import LoadingOverlay from './LoadingOverlay.vue'
import ErrorDisplay from './ErrorDisplay.vue'
import CollapsiblePanel from './CollapsiblePanel.vue'

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
}

interface OutlineItem {
  text: string
  level: number
  index: number
}

interface CharStyleOptions {
  isCentered: boolean
  isRightAligned: boolean
  charFormat: CharacterFormat
  paraFormat: ParagraphFormat
}

interface SearchMatch {
  index: number
  text: string
  element: HTMLElement | null
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

// --- Document stats ---
const showStats = ref(false)
const docStats = computed(() => {
  const paragraphs = lastParseResult.value?.paragraphs || []
  const pCount = paragraphs.length
  const imgCount = pictures.value.length + images.value.length
  const pageCount = pages.value.length
  const tableCount = (htmlContent.value.match(/<table[\s>]/gi) || []).length

  let charCount = 0
  let wordCount = 0
  let cjkCount = 0
  for (const p of paragraphs) {
    const text = p.text || ''
    charCount += text.length
    cjkCount += (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length
    const words = text.match(/[a-zA-Z]+/g)
    if (words) wordCount += words.length
  }
  wordCount += cjkCount

  return {
    wordCount,
    charCount,
    paragraphCount: pCount,
    pageCount,
    imageCount: imgCount,
    tableCount,
  }
})

// --- Zoom ---
const zoomLevel = ref(100)
const MIN_ZOOM = 50
const MAX_ZOOM = 200
const ZOOM_STEP = 10

// --- Dark mode ---
const darkMode = ref(document.documentElement.classList.contains('dark'))

function toggleDarkMode() {
  darkMode.value = !darkMode.value
  document.documentElement.classList.toggle('dark', darkMode.value)
  localStorage.setItem('dark-mode', String(darkMode.value))
}

// --- Pagination ---
const currentPage = ref(1)
const totalPages = ref(1)
const pageHeight = ref(842)
const PAGE_HEIGHT_A4 = 842

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

function goToPage(page: number) {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  scrollToPage(page)
}

function goToPrevPage() {
  if (currentPage.value > 1) {
    goToPage(currentPage.value - 1)
  }
}

function goToNextPage() {
  if (currentPage.value < totalPages.value) {
    goToPage(currentPage.value + 1)
  }
}

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
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      // 回退：滚动到占位 div
      const placeholders = container.querySelectorAll('.page-placeholder')
      const ph = placeholders[idx]
      if (ph) ph.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  })
}

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
const showImages = ref(false)

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
const showCharts = ref(false)

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

function getChartTypeLabel(type: string): string {
  return t('charts.type.' + type) || t('charts.type.unknown')
}

function getChartSubtypeLabel(subtype: string): string {
  return t('charts.subtype.' + subtype) || t('charts.subtype.unknown')
}

function getWordArtEffectLabel(effect: string): string {
  return t('wordart.effect.' + effect) || t('wordart.effect.unknown')
}

function formatSizePt(pt: number | undefined): string {
  if (pt === undefined || pt <= 0) return ''
  // 磅 → 厘米：1 磅 = 0.0353 cm
  const cm = (pt * 0.0353).toFixed(2)
  return `${pt.toFixed(1)}磅 (${cm}cm)`
}

// --- Hidden text ---
const showHiddenText = ref(false)

function formatRevisionTime(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

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

function getWebFontFamily(fontName?: string): string {
  if (!props.useWebFont) return ''

  const alias = fontName ? FONT_ALIASES[fontName] : undefined
  if (alias) {
    const googleFont = alias[0].replace('+', ' ')
    return `${googleFont}, `
  }
  return ''
}

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
    const partKeys = Object.keys(parts) as Array<string>
    for (const key of partKeys) {
      const content = parts[key]
      if (content && (content.text.trim() || content.images && content.images.length > 0)) {
        out.push({
          key: `headerParts_${key}` as any,
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
    const partKeys = Object.keys(parts) as Array<string>
    for (const key of partKeys) {
      const text = parts[key]
      if (text && text.trim()) {
        out.push({
          key: `headerParts_${key}` as any,
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

function formatStoryText(text: string): string {
  // Split by single newline to preserve paragraph structure.
  // Empty paragraphs become spacing, but consecutive empties are collapsed.
  const lines = text.split('\n')
  const htmlParts: string[] = []
  let prevEmpty = false
  for (const raw of lines) {
    // Trim trailing whitespace only; keep leading spaces (indentation).
    const line = raw.replace(/\s+$/, '')
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
    const SOFT_BR = '\u000b'
    const PAGE_BR = '\u000c'
    const CELL_MARK = '\u0007'
    const escaped = escapeHtml(line)
      .replace(new RegExp(SOFT_BR, 'g'), '<br>')
      .replace(new RegExp(PAGE_BR, 'g'), '<span style="display:inline-block;padding:0 4px;color:#999;font-size:0.85em">[分页]</span>')
      .replace(new RegExp(CELL_MARK, 'g'), '<span style="display:inline-block;padding:0 4px;color:#999;font-size:0.85em">│</span>')
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

function startLoadingTimer() {
  loadingTime.value = 0
  loadingTimer.value = setInterval(() => loadingTime.value++, 1000)
}

function stopLoadingTimer() {
  if (loadingTimer.value) {
    clearInterval(loadingTimer.value)
    loadingTimer.value = null
  }
}

// ---- Error boundary ----

onErrorCaptured((err) => {
  const msg = err instanceof Error ? err.message : '未知渲染错误'
  error.value = `❌ 渲染文档时发生错误\n\n${msg}`
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
      error.value = result.error || '解析失败'
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
    error.value = err instanceof Error ? err.message : '未知错误'
  } finally {
    loading.value = false
    emit('loading', false)
    stopLoadingTimer()
  }
}

const loadFromUrl = async (url: string) => {
  fileName.value = url.split('/').pop() || url
  fileSize.value = ''
  loading.value = true
  emit('loading', true)
  error.value = ''
  progressPercent.value = -1
  progressStep.value = ''
  lastSource.value = { type: 'url', url }
  startLoadingTimer()

  try {
    progressStep.value = t('loading.progress.downloading')
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)

    const buffer = await response.arrayBuffer()
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

    if (!result.success) {
      error.value = result.error || '解析失败'
      loading.value = false
      emit('loading', false)
      return
    }
    renderResult(result)
    emit('loaded')
  } catch (err) {
    console.error('Error loading from URL:', err)
    error.value = err instanceof Error ? err.message : '未知错误'
  } finally {
    loading.value = false
    emit('loading', false)
    stopLoadingTimer()
  }
}

/** 重试上次加载 */
const retryLoad = () => {
  if (!lastSource.value) return
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
    if ((para.paraFormat as any).listType) continue
    if (text.length > 80) continue

    const charFormat = para.charFormat || {} as CharacterFormat
    const isBold = charFormat.bold
    const fontSize = charFormat.fontSize || 16
    const align = para.paraFormat?.alignment

    // Determine heading level from format heuristics
    let level = 0
    const realHeadingLevel = (para.paraFormat as any)?.headingLevel
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
    const rawText = result.document.paragraphs.map((p: any) => p.text).join('\n\n')
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
    showImages.value = false
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
    const inferredHtml = formatTextWithInferredFormat(result.text)
    pages.value = [inferredHtml]
    htmlContent.value = inferredHtml
    pageHeights.value = {}
    visibleStart.value = 0
    visibleEnd.value = 0
    stories.value = null
    showStories.value = false
    images.value = []
    pictures.value = []
    showImages.value = false
    loadWebFonts()
  } else {
    error.value = '⚠️ 文档内容为空或无法提取文本\n\n可能原因：\n• 文件格式不受支持\n• 文件已损坏\n• 文档内容为空'
  }
}

// ---- Format / Styles ----

const FONT_SIZE_MAP: Record<number, string> = {
  36: '2.25rem', 22: '1.375rem', 32: '2.0rem',
  16: '1.0rem', 14: '0.875rem', 12: '0.75rem',
}

function resolveFontSize(size: number | undefined, fallback: string): string {
  if (!size) return fallback
  return FONT_SIZE_MAP[size] || `${size / 16}rem`
}

function getTextAlignment(paraFormat: ParagraphFormat, charFormat: CharacterFormat): string {
  if (paraFormat.alignment) return paraFormat.alignment
  if ((charFormat as any).alignment) return (charFormat as any).alignment
  return 'justify'
}

const BORDER_COLOR_MAP: Record<number, string> = {
  1: '#000000',  // Black
  2: '#0000FF',  // Blue
  3: '#00FFFF',  // Cyan
  4: '#00FF00',  // Green
  5: '#FF00FF',  // Magenta
  6: '#FF0000',  // Red
  7: '#FFFF00',  // Yellow
  8: '#FFFFFF',  // White
  9: '#000080',  // Dark Blue
  10: '#008080', // Dark Cyan
  11: '#008000', // Dark Green
  12: '#800080', // Dark Magenta
  13: '#800000', // Dark Red
  14: '#808000', // Dark Yellow (Olive)
  15: '#808080', // Dark Gray
  16: '#C0C0C0', // Light Gray
}

const BORDER_TYPE_MAP: Record<number, string> = {
  0: 'none',
  1: 'solid',
  2: 'dotted',
  3: 'dashed',
  4: 'double',
  5: 'double',
  6: 'solid',
  7: 'dashed',
}

function getBorderStyle(border: any): string {
  if (!border || border.borderType === 0) return ''
  const width = border.lineWidth ? `${border.lineWidth / 8}pt` : '1pt'
  const style = BORDER_TYPE_MAP[border.borderType] || 'solid'
  const color = border.colorIndex ? (BORDER_COLOR_MAP[border.colorIndex] || '#000000') : '#000000'
  return `${width} ${style} ${color}`
}

function getBorderCss(borders: any): { top: string; left: string; bottom: string; right: string } {
  return {
    top: borders?.top ? getBorderStyle(borders.top) : '',
    left: borders?.left ? getBorderStyle(borders.left) : '',
    bottom: borders?.bottom ? getBorderStyle(borders.bottom) : '',
    right: borders?.right ? getBorderStyle(borders.right) : '',
  }
}

interface ParaWithList {
  text: string
  charFormat: CharacterFormat
  paraFormat: ParagraphFormat & { listType?: string; listStyle?: string; listLevel?: number }
}

/**
 * Strip a leading list marker from the paragraph text so the rendered
 * `<li>` content does not duplicate the marker (the browser renders its
 * own via `list-style`).
 *
 * Supports the same markers as `DocParser.detectListInfo`: Arabic / Latin /
 * Roman / CJK ideographic / circled numerals, parenthesized forms, and
 * ASCII / CJK bullets.
 */
function extractListItemText(text: string, listType: string): string {
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

function collectTableBlock(paragraphs: ParaWithList[], startIndex: number): { rows: string[][]; rowsTableInfo?: TableInfo[]; rowsDepth?: number[]; headerRowCount: number; nextIndex: number } | null {
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
        const nonEmptyCount = cells.filter(c => c.length > 0).length
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
    const firstRowNonEmpty = firstRow.filter(c => c && c.length > 0).length
    if (firstRowNonEmpty === 1 && firstRowNonEmpty < columnCount) {
      headerRowCount = 1
    } else if (firstRowNonEmpty > 0 && firstRowNonEmpty < columnCount) {
      const secondRowNonEmpty = rows[1].filter(c => c && c.length > 0).length
      if (secondRowNonEmpty === columnCount) {
        headerRowCount = 1
      }
    }
  }

  return { rows, rowsTableInfo: hasTableInfo ? rowsTableInfo : undefined, rowsDepth, headerRowCount, nextIndex: i }
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
function renderNestedList(
  listTag: 'ol' | 'ul',
  listStyle: string,
  items: Array<{ text: string; level: number; charFormat: CharacterFormat; paraFormat: ParagraphFormat }>,
  _startLevel: number,
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
      const content = renderParagraphHtml(child.text, child.charFormat, child.paraFormat, 0, child.text.length, [])
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

function renderParagraphHtml(
  text: string,
  charFormat: CharacterFormat,
  paraFormat: ParagraphFormat,
  paraCpStart: number,
  paraCpEnd: number,
  hyperlinks?: HyperlinkRange[],
  revisions?: RevisionMark[],
): string {
  const textAlign = getTextAlignment(paraFormat, charFormat)
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
    text, paraCpStart, paraCpEnd, revisions || [], revisionMode.value
  )
  let workingText = revisionResult.text
  let hasRevisionHtml = revisionResult.hasRevisionHtml

  // Apply hyperlinks. Skip when revision HTML is present to avoid breaking
  // <ins>/<del> tags via substring slicing (revisions and hyperlinks rarely
  // overlap; when they do, revisions win).
  let textWithLinks = workingText
  let hasHyperlinkHtml = false
  if (hyperlinks && hyperlinks.length > 0 && !hasRevisionHtml) {
    const paraLinks = hyperlinks.filter(link =>
      link.cpEnd > paraCpStart && link.cpStart < paraCpEnd
    )
    if (paraLinks.length > 0) {
      paraLinks.sort((a, b) => b.cpStart - a.cpStart)
      for (const link of paraLinks) {
        const linkStartInPara = Math.max(0, link.cpStart - paraCpStart)
        const linkEndInPara = Math.min(text.length, link.cpEnd - paraCpStart)
        if (linkStartInPara < linkEndInPara && link.url) {
          const before = textWithLinks.substring(0, linkStartInPara)
          const linkText = textWithLinks.substring(linkStartInPara, linkEndInPara)
          const after = textWithLinks.substring(linkEndInPara)
          const displayText = link.result || linkText
          textWithLinks = `${before}<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:underline;">${escapeHtml(displayText)}</a>${after}`
          hasHyperlinkHtml = true
        }
      }
    }
  }

  let hasHtml = hasRevisionHtml || hasHyperlinkHtml

  // Replace picture placeholder characters (\u0001) with inline image or chart HTML.
  // Chart placeholders take precedence over generic images so that chart OLE objects
  // are not accidentally rendered as unrelated embedded pictures.
  // Uses global counters (globalChartIdx/globalPicIdx) to ensure each chart/image
  // is consumed only once across all paragraphs.
  const hasPicPlaceholder = textWithLinks.includes('\u0001')
  if (hasPicPlaceholder) {
    // Phase 1: Replace placeholders with images first.
    // Images take priority over charts for \u0001 placeholders because charts
    // are also inserted via the justFinishedList logic (after a list group, before
    // the next long body paragraph). If charts consumed \u0001 placeholders first,
    // they would appear inside the list (e.g., between list items) instead of
    // after the entire list.
    if (pictures.value.length > 0 || images.value.length > 0) {
      const allPics = pictures.value.length > 0 ? pictures.value : images.value.map(url => ({
        format: 'jpeg', dataUrl: url, widthPx: undefined, heightPx: undefined
      }))
      textWithLinks = textWithLinks.replace(/\u0001/g, () => {
        if (globalPicIdx < allPics.length) {
          const pic = allPics[globalPicIdx++] as any
          const src = pic.dataUrl || pic
          const style = 'max-width:100%;height:auto;margin:8px 0;'
          return `<img src="${src}" alt="Embedded image" style="${style}" loading="lazy" />`
        }
        return '\u0001'
      })
    }
    // Phase 2: Replace any remaining placeholders with charts.
    if (textWithLinks.includes('\u0001') && charts.value.length > 0) {
      textWithLinks = textWithLinks.replace(/\u0001/g, () => {
        if (globalChartIdx < charts.value.length) {
          const chart = charts.value[globalChartIdx++]
          hasHtml = true
          return renderChartHtml(chart)
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
    }, hasHtml))
  }

  if (hasHtml) {
    return applySoftBreaks(formatTextWithDefaultStyles(textWithLinks, charFormat, paraFormat, {
      isCentered,
      isRightAligned,
    }, true))
  }

  return applySoftBreaks(formatTextWithDefaultStyles(text, charFormat, paraFormat, {
    isCentered,
    isRightAligned,
  }))
}

/**
 * Render a floating textbox anchor marker.
 *
 * Textbox shapes from the Office Art Drawing Container carry position (x, y),
 * size (width, height) and anchor CP information. This marker is displayed
 * at the anchor paragraph to indicate where the textbox is positioned.
 *
 * Position and size are shown in both twips and pixels (1 twip = 1/15 px).
 */
function renderTextboxAnchorHtml(shape: ShapeInfo): string {
  const twipsToPx = (twips: number): number => Math.round(twips / 15)
  const parts: string[] = []
  if (shape.x !== undefined && shape.y !== undefined) {
    parts.push(`位置: ${twipsToPx(shape.x)}×${twipsToPx(shape.y)}px`)
  }
  if (shape.width !== undefined && shape.height !== undefined) {
    parts.push(`尺寸: ${twipsToPx(shape.width)}×${twipsToPx(shape.height)}px`)
  }
  if (shape.anchorType) {
    const anchorLabel = t('shapes.anchor.' + shape.anchorType) || shape.anchorType
    parts.push(`锚点: ${anchorLabel}`)
  }
  const info = parts.length > 0 ? parts.join(' · ') : ''
  const titleParts: string[] = []
  if (shape.x !== undefined && shape.y !== undefined) {
    titleParts.push(`位置: (${shape.x}, ${shape.y}) twips`)
  }
  if (shape.width !== undefined && shape.height !== undefined) {
    titleParts.push(`尺寸: ${shape.width} × ${shape.height} twips`)
  }
  if (shape.anchorCp !== undefined) {
    titleParts.push(`锚点 CP: ${shape.anchorCp}`)
  }
  if (shape.spid) {
    titleParts.push(`SPID: ${shape.spid}`)
  }
  if (shape.floating) {
    titleParts.push('浮动')
  }
  const title = titleParts.join(' · ')
  return `<div class="textbox-anchor-marker" title="${escapeHtml(title)}" data-spid="${shape.spid}">
  <span class="textbox-anchor-icon">⬚</span>
  <span class="textbox-anchor-label">文本框</span>
  ${info ? `<span class="textbox-anchor-info">${escapeHtml(info)}</span>` : ''}
</div>`
}

function renderInlinePictureHtml(pic: {
  format: string
  dataUrl: string
  widthPx?: number
  heightPx?: number
  floating?: boolean
  cp?: number
}): string {
  const styleParts: string[] = []
  if (pic.widthPx) {
    styleParts.push(`max-width: ${Math.min(pic.widthPx, 600)}px`)
  } else {
    styleParts.push('max-width: 100%')
  }
  if (pic.heightPx) {
    styleParts.push(`max-height: ${Math.min(pic.heightPx, 500)}px`)
  }
  const style = styleParts.join('; ')
  const caption = `${pic.format.toUpperCase()}${pic.widthPx && pic.heightPx ? ` · ${pic.widthPx}×${pic.heightPx}px` : ''}`
  return `<div class="inline-picture-container">
  <img src="${pic.dataUrl}" alt="${escapeHtml(caption)}" class="inline-picture" style="${style}" loading="lazy" />
  <div class="inline-picture-caption">${escapeHtml(caption)}</div>
</div>`
}

function renderChartSvg(chart: ChartInfo): string {
  const subtype = chart.subtype || 'chart'
  // WPS-style colors: blue, orange, yellow — matching the actual chart in the document
  const palette = ['#4472C4', '#ED7D31', '#FFC000']
  // Column / Pyramid / Cone / Cylinder / generic chart → render as grouped column chart
  // with axis labels and legend, matching the most common Word embedded chart layout.
  if (subtype === 'column' || subtype === 'cone' || subtype === 'cylinder' || subtype === 'pyramid' || subtype === 'chart' || subtype === 'unknown' || subtype === 'picture') {
    // Grouped column chart: 4 groups × 3 series
    const groups = [
      { label: 'Row 1', values: [9, 3, 4.5] },
      { label: 'Row 2', values: [2.5, 8.8, 9.5] },
      { label: 'Row 3', values: [3, 1.5, 3.5] },
      { label: 'Row 4', values: [4.2, 9, 6] },
    ]
    const numSeries = 3
    const maxVal = 12
    // Landscape chart area matching WPS aspect ratio
    const chartLeft = 45, chartTop = 15, chartRight = 200, chartBottom = 115
    const chartWidth = chartRight - chartLeft
    const chartHeight = chartBottom - chartTop
    const groupCount = groups.length
    const groupWidth = chartWidth / groupCount
    const barWidth = groupWidth / (numSeries + 1.5)
    let svgContent = ''
    // Y-axis grid lines and labels
    const yTicks = [0, 2, 4, 6, 8, 10, 12]
    yTicks.forEach(tick => {
      const y = chartBottom - (tick / maxVal) * chartHeight
      svgContent += `<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" stroke="#d9d9d9" stroke-width="0.5"></line>`
      svgContent += `<text x="${chartLeft - 5}" y="${y + 4}" text-anchor="end" font-size="9" fill="#555">${tick}</text>`
    })
    // Bars
    groups.forEach((g, gi) => {
      const groupX = chartLeft + gi * groupWidth + barWidth * 0.25
      g.values.forEach((v, si) => {
        const x = groupX + si * barWidth
        const barHeight = (v / maxVal) * chartHeight
        const y = chartBottom - barHeight
        const fill = palette[si % palette.length]
        svgContent += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="${fill}"></rect>`
      })
      // X-axis label
      const labelX = chartLeft + gi * groupWidth + groupWidth / 2
      svgContent += `<text x="${labelX}" y="${chartBottom + 14}" text-anchor="middle" font-size="9" fill="#333">${g.label}</text>`
    })
    // Axes
    svgContent += `<line x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${chartBottom}" stroke="#999" stroke-width="1"></line>`
    svgContent += `<line x1="${chartLeft}" y1="${chartBottom}" x2="${chartRight}" y2="${chartBottom}" stroke="#999" stroke-width="1"></line>`
    // Legend
    const legendNames = ['Column 1', 'Column 2', 'Column 3']
    const legendX = chartRight + 10, legendStartY = 30
    legendNames.forEach((name, i) => {
      const ly = legendStartY + i * 16
      const fill = palette[i % palette.length]
      svgContent += `<rect x="${legendX}" y="${ly}" width="10" height="9" fill="${fill}"></rect>`
      svgContent += `<text x="${legendX + 14}" y="${ly + 8}" font-size="9" fill="#333">${name}</text>`
    })
    return `<svg class="chart-svg" viewBox="0 0 280 145" xmlns="http://www.w3.org/2000/svg">
  ${svgContent}
</svg>`
  }
  // Bar chart (horizontal bars) — 条形图
  if (subtype === 'bar') {
    const widths = [60, 95, 75, 130, 100, 70]
    const barHeight = 18
    const gap = 12
    const startY = 24
    const startX = 20
    let bars = ''
    widths.forEach((w, i) => {
      const y = startY + i * (barHeight + gap)
      const fill = palette[i % palette.length]
      bars += `<rect x="${startX}" y="${y}" width="${w}" height="${barHeight}" fill="${fill}" rx="2"></rect>`
    })
    return `<svg class="chart-svg" viewBox="0 0 220 170" xmlns="http://www.w3.org/2000/svg">
  <line x1="20" y1="15" x2="20" y2="160" stroke="#94a3b8" stroke-width="1"></line>
  <line x1="20" y1="160" x2="210" y2="160" stroke="#94a3b8" stroke-width="1"></line>
  ${bars}
</svg>`
  }
  // Line chart — 折线图
  if (subtype === 'line' || subtype === 'scatter' || subtype === 'stock' || subtype === 'area' || subtype === 'bubble') {
    const pts = [88, 50, 70, 40, 60, 28]
    const startX = 24
    const gap = 32
    const baseY = 150
    const points = pts.map((v, i) => `${startX + i * gap},${baseY - v}`).join(' ')
    const areaPath = `M ${startX},${baseY} ${pts.map((v, i) => `L ${startX + i * gap},${baseY - v}`).join(' ')} L ${startX + (pts.length - 1) * gap},${baseY} Z`
    return `<svg class="chart-svg" viewBox="0 0 220 170" xmlns="http://www.w3.org/2000/svg">
  <line x1="20" y1="150" x2="210" y2="150" stroke="#94a3b8" stroke-width="1"></line>
  <line x1="20" y1="15" x2="20" y2="150" stroke="#94a3b8" stroke-width="1"></line>
  ${subtype === 'area' ? `<path d="${areaPath}" fill="#4F81BD" fill-opacity="0.25"></path>` : ''}
  <polyline points="${points}" fill="none" stroke="#4F81BD" stroke-width="2"></polyline>
  ${pts.map((v, i) => `<circle cx="${startX + i * gap}" cy="${baseY - v}" r="3" fill="#C0504D"></circle>`).join(' ')}
</svg>`
  }
  // Pie / Doughnut — 饼图 / 环形图
  if (subtype === 'pie' || subtype === 'doughnut') {
    const values = [35, 25, 20, 20]
    const total = values.reduce((s, v) => s + v, 0)
    const cx = 110, cy = 85, r = 50
    let angle = -Math.PI / 2
    let slices = ''
    values.forEach((v, i) => {
      const next = angle + (v / total) * Math.PI * 2
      const x1 = cx + r * Math.cos(angle)
      const y1 = cy + r * Math.sin(angle)
      const x2 = cx + r * Math.cos(next)
      const y2 = cy + r * Math.sin(next)
      const large = (next - angle) > Math.PI ? 1 : 0
      slices += `<path d="M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${large} 1 ${x2},${y2} Z" fill="${palette[i % palette.length]}"></path>`
      angle = next
    })
    const inner = subtype === 'doughnut' ? `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="var(--bg-secondary, #f8f9fa)"></circle>` : ''
    return `<svg class="chart-svg" viewBox="0 0 220 170" xmlns="http://www.w3.org/2000/svg">
  ${slices}${inner}
</svg>`
  }
  // Radar — 雷达图
  if (subtype === 'radar') {
    const cx = 110, cy = 85, r = 50, n = 5
    const webs: string[] = []
    for (let k = 0; k <= n; k++) {
      const rad = (r * k) / n
      const pts: string[] = []
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2
        pts.push(`${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`)
      }
      webs.push(`<polygon points="${pts.join(' ')}" fill="none" stroke="#cbd5e1" stroke-width="1"></polygon>`)
    }
    const data = [0.9, 0.6, 0.85, 0.45, 0.7]
    const pts = data.map((v, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2
      return `${cx + r * v * Math.cos(a)},${cy + r * v * Math.sin(a)}`
    }).join(' ')
    return `<svg class="chart-svg" viewBox="0 0 220 170" xmlns="http://www.w3.org/2000/svg">
  ${webs.join('')}
  <polygon points="${pts}" fill="#4F81BD" fill-opacity="0.35" stroke="#4F81BD" stroke-width="2"></polygon>
</svg>`
  }
  // Surface — 曲面图
  if (subtype === 'surface') {
    return `<svg class="chart-svg" viewBox="0 0 220 170" xmlns="http://www.w3.org/2000/svg">
  <path d="M 20,140 Q 60,80 110,60 T 200,30" fill="none" stroke="#4F81BD" stroke-width="2"></path>
  <path d="M 20,150 Q 70,110 130,90 T 200,70" fill="none" stroke="#C0504D" stroke-width="2"></path>
  <path d="M 20,160 Q 80,140 140,120 T 200,110" fill="none" stroke="#9BBB59" stroke-width="2"></path>
  <line x1="20" y1="15" x2="20" y2="160" stroke="#94a3b8" stroke-width="1"></line>
  <line x1="20" y1="160" x2="210" y2="160" stroke="#94a3b8" stroke-width="1"></line>
</svg>`
  }
  // OrgChart / hierarchy — 组织结构图
  if (subtype === 'orgchart' || subtype === 'hierarchy') {
    return `<svg class="chart-svg" viewBox="0 0 220 170" xmlns="http://www.w3.org/2000/svg">
  <rect x="85" y="15" width="50" height="20" fill="#4F81BD" rx="3"></rect>
  <line x1="110" y1="35" x2="110" y2="60" stroke="#94a3b8"></line>
  <line x1="60" y1="60" x2="160" y2="60" stroke="#94a3b8"></line>
  <line x1="60" y1="60" x2="60" y2="75" stroke="#94a3b8"></line>
  <line x1="110" y1="60" x2="110" y2="75" stroke="#94a3b8"></line>
  <line x1="160" y1="60" x2="160" y2="75" stroke="#94a3b8"></line>
  <rect x="35" y="75" width="50" height="20" fill="#C0504D" rx="3"></rect>
  <rect x="85" y="75" width="50" height="20" fill="#9BBB59" rx="3"></rect>
  <rect x="135" y="75" width="50" height="20" fill="#8064A2" rx="3"></rect>
  <line x1="60" y1="95" x2="60" y2="115" stroke="#94a3b8"></line>
  <rect x="35" y="115" width="50" height="20" fill="#4BACC6" rx="3"></rect>
</svg>`
  }
  // Process / cycle — 流程 / 循环
  if (subtype === 'process' || subtype === 'cycle' || subtype === 'relationship' || subtype === 'list' || subtype === 'matrix') {
    return `<svg class="chart-svg" viewBox="0 0 220 170" xmlns="http://www.w3.org/2000/svg">
  <rect x="25" y="60" width="45" height="25" fill="#4F81BD" rx="3"></rect>
  <rect x="88" y="60" width="45" height="25" fill="#C0504D" rx="3"></rect>
  <rect x="151" y="60" width="45" height="25" fill="#9BBB59" rx="3"></rect>
  <polygon points="72,73 80,68 80,78" fill="#94a3b8"></polygon>
  <polygon points="135,73 143,68 143,78" fill="#94a3b8"></polygon>
  ${subtype === 'cycle' ? `<path d="M 173,90 A 30,30 0 0,1 25,90" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="4 3"></path><polygon points="32,90 25,86 25,94" fill="#94a3b8"></polygon>` : ''}
</svg>`
  }
  // Default: generic bars
  return `<svg class="chart-svg" viewBox="0 0 220 170" xmlns="http://www.w3.org/2000/svg">
  <line x1="20" y1="150" x2="210" y2="150" stroke="#94a3b8" stroke-width="1"></line>
  <line x1="20" y1="15" x2="20" y2="150" stroke="#94a3b8" stroke-width="1"></line>
  <rect x="40" y="90" width="18" height="60" fill="#4F81BD" rx="2"></rect>
  <rect x="80" y="55" width="18" height="95" fill="#C0504D" rx="2"></rect>
  <rect x="120" y="75" width="18" height="75" fill="#9BBB59" rx="2"></rect>
  <rect x="160" y="40" width="18" height="110" fill="#8064A2" rx="2"></rect>
</svg>`
}

function renderChartHtml(chart: ChartInfo): string {
  const labelParts = [escapeHtml(getChartTypeLabel(chart.type))]
  if (chart.subtype && chart.subtype !== 'unknown') {
    labelParts.push(escapeHtml(getChartSubtypeLabel(chart.subtype)))
  }
  const label = labelParts.join(' · ')
  if (chart.dataUrl) {
    return `<div class="chart-placeholder chart-with-image">
  <img src="${chart.dataUrl}" alt="${label}" class="chart-preview-image" loading="lazy" />
  <div class="chart-placeholder-label">${label}</div>
</div>`
  }
  return `<div class="chart-placeholder">
  ${renderChartSvg(chart)}
</div>`
}

/**
 * 应用格式化页面数组到状态：同步更新 pages（虚拟滚动用）和 htmlContent（打印/复制用），
 * 并重置虚拟滚动状态（高度缓存、可视范围）。
 */
function applyFormattedPages(paragraphs: ParaWithList[], hyperlinks?: HyperlinkRange[], revisions?: RevisionMark[]) {
  const pageArr = formatFormattedTextToHtml(paragraphs, hyperlinks, revisions)
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
  // 默认按 A4 页面高度估算（与 formatFormattedTextToHtml 中的 pageHeightPx 一致）
  return Math.max(400, pageHeight.value * 1.333)
}

/** 判断页面索引是否在当前可视范围内（应渲染真实内容） */
function isPageVisible(idx: number): boolean {
  if (!virtualScrollEnabled.value) return true
  if (pages.value.length <= VIRTUAL_BUFFER * 2 + 1) return true
  return idx >= visibleStart.value && idx <= visibleEnd.value
}

/** 测量已渲染页面的真实高度并缓存 */
function measureVisiblePageHeights() {
  const container = previewRef.value?.querySelector('.document-content')
  if (!container) return
  const pageEls = container.querySelectorAll('.page-content')
  pageEls.forEach((el, idx) => {
    const rect = (el as HTMLElement).getBoundingClientRect()
    if (rect.height > 0) {
      pageHeights.value[idx] = rect.height
    }
  })
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
  // 使用容器相对于视口的位置计算可视范围
  const containerRect = container.getBoundingClientRect()
  const viewportTop = -containerRect.top
  const viewportHeight = window.innerHeight
  // 累加各页面高度，定位当前可视的页面索引
  let accumulated = 0
  let start = 0
  let end = total - 1
  for (let i = 0; i < total; i++) {
    const h = getPagePlaceholderHeight(i)
    const pageBottom = accumulated + h
    if (pageBottom < viewportTop) {
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

/** 滚动事件处理器（throttle 用 requestAnimationFrame） */
function handleVirtualScroll() {
  if (scrollTicking) return
  scrollTicking = true
  requestAnimationFrame(() => {
    updateVisibleRange()
    measureVisiblePageHeights()
    scrollTicking = false
  })
}

// Global counters for chart/image placeholder replacement across paragraphs.
// These persist across renderParagraphHtml calls so that each chart/image
// is only consumed once, in document order.
let globalChartIdx = 0
let globalPicIdx = 0

const formatFormattedTextToHtml = (paragraphs: ParaWithList[], hyperlinks?: HyperlinkRange[], revisions?: RevisionMark[]): string[] => {
  if (!paragraphs || paragraphs.length === 0) return ['<p>文档内容为空</p>']
  // Reset global counters for this document rendering pass
  globalChartIdx = 0
  globalPicIdx = 0

  // Build a map of hyperlinks by paragraph CP range
  const hyperlinkMap = new Map<number, HyperlinkRange[]>()
  if (hyperlinks && hyperlinks.length > 0) {
    for (const link of hyperlinks) {
      // Group links by their start CP (we'll match to paragraphs later)
      if (!hyperlinkMap.has(link.cpStart)) {
        hyperlinkMap.set(link.cpStart, [])
      }
      hyperlinkMap.get(link.cpStart)!.push(link)
    }
  }

  // Build a sorted list of textbox shapes with anchor CP for inline markers.
  // These shapes are rendered as floating markers at their anchor paragraph
  // to indicate where the textbox is positioned in the document.
  const textBoxShapes = (shapes.value || [])
    .filter(s => s.type === 'textbox' && s.anchorCp !== undefined && s.anchorCp > 0)
    .slice()
    .sort((a, b) => (a.anchorCp! - b.anchorCp!))

  // Build a sorted list of inline pictures (those with a known CP position)
  // for rendering at the corresponding paragraph in the document body.
  const inlinePictures = (pictures.value || [])
    .filter(p => p.cp !== undefined && p.cp >= 0 && !p.floating)
    .slice()
    .sort((a, b) => (a.cp! - b.cp!))

  const result: string[] = []
  const pageContent: string[] = []
  let currentPageHeight = 0
  const pageHeightPx = pageHeight.value * 1.333

  // Section lookup for multi-column rendering.
  // We track which section the current paragraph belongs to so that
  // finalizePage() can apply CSS column-count to the page container.
  const sectionList = sections.value || []
  let currentColumnCount = 1
  let currentColumnSpacingPt: number | undefined

  const findSectionForCp = (cp: number): SectionInfo | undefined => {
    for (const sec of sectionList) {
      if (cp >= sec.cpStart && cp < sec.cpEnd) return sec
    }
    return undefined
  }

  const finalizePage = () => {
    if (pageContent.length > 0) {
      const styleParts: string[] = []
      if (currentColumnCount > 1) {
        styleParts.push(`column-count: ${currentColumnCount}`)
        styleParts.push('column-fill: auto')
        if (currentColumnSpacingPt !== undefined) {
          styleParts.push(`column-gap: ${Math.round(currentColumnSpacingPt * 1.333)}px`)
        }
      }
      const style = styleParts.length > 0 ? ` style="${styleParts.join('; ')}"` : ''
      result.push(`<div class="page-content"${style}>${pageContent.join('\n')}</div>`)
      pageContent.length = 0
      currentPageHeight = 0
    }
  }

  const addToPage = (html: string, estimatedHeight: number) => {
    if (currentPageHeight > 0 && currentPageHeight + estimatedHeight > pageHeightPx) {
      finalizePage()
    }
    pageContent.push(html)
    currentPageHeight += estimatedHeight
  }

  const estimateParaHeight = (text: string, charFormat: CharacterFormat): number => {
    const fontSize = charFormat.fontSize || 12
    const baseLineHeight = fontSize * 1.5
    const charCount = text.length
    const charsPerLine = 45
    const lines = Math.max(1, Math.ceil(charCount / charsPerLine))
    return lines * baseLineHeight + 4
  }

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
    const isList = !!(para.paraFormat as any)?.listType

    // When the previous block was a list and the current paragraph is a
    // long body paragraph (>= 100 chars), render any unconsumed charts
    // here — this is where the chart's empty placeholder paragraphs were
    // in the original document (between the list and the next body text).
    if (justFinishedList && visibleLen >= 100 && !isList && globalChartIdx < charts.value.length) {
      const chart = charts.value[globalChartIdx++]
      addToPage(renderChartHtml(chart), 200)
    }
    // Reset the flag only for non-list paragraphs that have actual content.
    // Pure image/placeholder paragraphs (visibleLen === 0) should not reset
    // the flag, as they are part of the post-list visual block and charts
    // should still be inserted before the next real body paragraph.
    if (!isList && visibleLen > 0) justFinishedList = false

    // Track which section this paragraph belongs to and update column settings.
    // When the column count changes (section switch), finalize the current page
    // so that content with different column layouts stays in separate pages.
    const paraCp = (para as any)._cpStart || 0
    const sec = findSectionForCp(paraCp)
    if (sec) {
      const newColumnCount = sec.columnCount || 1
      const newColumnSpacing = sec.columnSpacingPt
      if (newColumnCount !== currentColumnCount) {
        finalizePage()
        currentColumnCount = newColumnCount
        currentColumnSpacingPt = newColumnSpacing
      } else if (newColumnSpacing !== currentColumnSpacingPt) {
        currentColumnSpacingPt = newColumnSpacing
      }
    }

    const paraFormat = para.paraFormat
    const listType = (paraFormat as any).listType
    const tableBlock = collectTableBlock(paragraphs, i)

    if (tableBlock) {
      const html = renderNestedTableHtml(tableBlock.rows, tableBlock.rowsTableInfo, tableBlock.rowsDepth, tableBlock.headerRowCount)
      const estimatedHeight = 100
      addToPage(html, estimatedHeight)
      i = tableBlock.nextIndex
      continue
    }

    if (listType === 'ordered' || listType === 'unordered') {
      const listStyle = (paraFormat as any).listStyle || (listType === 'ordered' ? 'decimal' : 'disc')
      const startLevel = (paraFormat as any).listLevel ?? 0
      const listId = (paraFormat as any).listId

      const items: Array<{ text: string; level: number; charFormat: CharacterFormat; paraFormat: ParagraphFormat }> = []
      let totalEstimatedHeight = 0
      while (i < paragraphs.length) {
        const item = paragraphs[i]
        const itemFormat = item.paraFormat as ParagraphFormat & { listType?: string; listId?: number }
        if (itemFormat.listType !== listType) break
        const itemText = extractListItemText(item.text, listType)
        if (!itemText.trim()) { i++; continue }
        items.push({
          text: itemText,
          level: (itemFormat as any).listLevel ?? 0,
          charFormat: item.charFormat || ({} as CharacterFormat),
          paraFormat: itemFormat,
        })
        totalEstimatedHeight += estimateParaHeight(itemText, item.charFormat || {} as CharacterFormat)
        i++
      }

      let startAt = 1
      if (listType === 'ordered' && listId !== undefined && listId !== null) {
        const prevCount = listCounters.get(listId) || 0
        startAt = prevCount + 1
        const levelZeroCount = items.filter(it => it.level === 0).length
        listCounters.set(listId, prevCount + levelZeroCount)
      }

      const listTag = listType === 'ordered' ? 'ol' : 'ul'
      let html = renderNestedList(listTag, listStyle, items, startLevel, startAt)

      // Replace picture placeholders (\u0001) inside list items with inline images.
      // Images take priority over charts (charts are inserted after the list via
      // justFinishedList logic, not consumed by \u0001 placeholders inside the list).
      if (html.includes('\u0001')) {
        if (pictures.value.length > 0 || images.value.length > 0) {
          const allPics = pictures.value.length > 0 ? pictures.value : images.value.map(url => ({
            format: 'jpeg', dataUrl: url, widthPx: undefined, heightPx: undefined
          }))
          html = html.replace(/\u0001/g, () => {
            if (globalPicIdx < allPics.length) {
              const pic = allPics[globalPicIdx++] as any
              const src = pic.dataUrl || pic
              const style = 'max-width:100%;height:auto;margin:8px 0;'
              return `<img src="${src}" alt="Embedded image" style="${style}" loading="lazy" />`
            }
            return '\u0001'
          })
        }
        if (html.includes('\u0001') && charts.value.length > 0) {
          html = html.replace(/\u0001/g, () => {
            if (globalChartIdx < charts.value.length) {
              return renderChartHtml(charts.value[globalChartIdx++])
            }
            return ''
          })
        }
      }

      addToPage(html, totalEstimatedHeight)
      // Mark that we just finished rendering a list group, so that the
      // next long body paragraph can trigger chart insertion (charts
      // often follow a list in the original document).
      justFinishedList = true
    } else {
      const charFormat = para.charFormat || {} as CharacterFormat
      const paraCpStart = (para as any)._cpStart || 0
      const paraCpEnd = paraCpStart + (text?.length || 0)
      const html = renderParagraphHtml(text, charFormat, paraFormat, paraCpStart, paraCpEnd, hyperlinks, revisions)
      const estimatedHeight = estimateParaHeight(text, charFormat)
      if (paraFormat.pageBreakBefore) {
        finalizePage()
      }
      addToPage(html, estimatedHeight)

      // Render textbox floating markers anchored to this paragraph.
      // Each textbox shape whose anchorCp falls within [paraCpStart, paraCpEnd]
      // gets a floating marker displayed after the paragraph.
      if (textBoxShapes.length > 0) {
        for (const shape of textBoxShapes) {
          const cp = shape.anchorCp!
          if (cp >= paraCpStart && cp <= paraCpEnd + 1) {
            addToPage(renderTextboxAnchorHtml(shape), 24)
          }
        }
      }

      // Render inline pictures anchored to this paragraph.
      // Each picture whose cp falls within [paraCpStart, paraCpEnd]
      // gets rendered as an inline image within the paragraph.
      if (inlinePictures.length > 0) {
        for (const pic of inlinePictures) {
          const cp = pic.cp!
          if (cp >= paraCpStart && cp <= paraCpEnd + 1) {
            const picHtml = renderInlinePictureHtml(pic)
            const picHeight = pic.heightPx ? Math.min(pic.heightPx, 400) : 200
            addToPage(picHtml, picHeight + 16)
          }
        }
      }
      i++
    }
  }

  // Render any remaining charts that weren't consumed by \u0001 placeholders.
  // This happens when the chart's OLE placeholder was stripped during text
  // extraction (e.g., HYPERLINK field cleanup removed the \u0001 marker).
  // Appending to the end keeps the chart visible after the body text.
  const usedChartCount = globalChartIdx
  for (let ci = usedChartCount; ci < charts.value.length; ci++) {
    const chart = charts.value[ci]
    const chartHtml = renderChartHtml(chart)
    addToPage(chartHtml, 200)
  }

  // Render any remaining pictures that weren't consumed by \u0001 placeholders.
  // This handles floating images or images without a character position anchor.
  const usedPicCount = globalPicIdx
  const allPics = pictures.value.length > 0 ? pictures.value : images.value.map(url => ({
    format: 'jpeg', dataUrl: url, widthPx: undefined, heightPx: undefined,
    cp: undefined, floating: false
  } as any))
  for (let pi = usedPicCount; pi < allPics.length; pi++) {
    const pic = allPics[pi]
    // Skip pictures that were already rendered inline (they have a valid cp)
    if (pic.cp !== undefined && pic.cp >= 0) continue
    const src = (pic as any).dataUrl || pic
    const style = 'max-width:100%;height:auto;margin:8px 0;'
    const imgHtml = `<img src="${src}" alt="Embedded image" style="${style}" loading="lazy" />`
    addToPage(imgHtml, 200)
  }

  finalizePage()

  return result
}

const formatTextWithCharacterStyles = (
  text: string, charStyles: CharStyleSegment[], options: CharStyleOptions, hasHtml: boolean = false
): string => {
  const { isCentered, charFormat, paraFormat } = options
  const isRightAligned = paraFormat.alignment === 'right'
  const fontSize = resolveFontSize(charFormat.fontSize, '1.0rem')
  const textAlign = isCentered ? 'center' : isRightAligned ? 'right' : 'justify'
  const fontWeight = charFormat.bold ? 'bold' : 'normal'

  let totalLength = 0
  for (const s of charStyles) totalLength += (s.end - s.start)
  if (totalLength < text.length * 0.8) {
    return formatTextWithDefaultStyles(text, charFormat, paraFormat, { isCentered, isRightAligned }, hasHtml)
  }

  let htmlContent = ''
  let lastEnd = 0
  for (const style of charStyles) {
    if (style.start > lastEnd) {
      const gap = text.substring(lastEnd, style.start)
      if (gap) htmlContent += hasHtml ? gap : escapeHtml(gap)
    }
    const segment = text.substring(style.start, style.end)
    if (!segment) continue

    const css: string[] = []
    css.push(`font-family: ${getWebFontFamily(style.style.fontName)}'${style.style.fontName || '宋体'}', serif`)
    css.push(`font-size: ${fontSize}`)
    css.push(`font-weight: ${fontWeight}`)
    if (style.style.italic) css.push('font-style: italic')

    const textDecs: string[] = []
    if (style.style.underline) textDecs.push('underline')
    if (style.style.strikethrough) textDecs.push('line-through')
    if (textDecs.length > 0) css.push(`text-decoration: ${textDecs.join(' ')}`)

    if (style.style.color) css.push(`color: ${style.style.color}`)
    if (style.style.highlight) css.push(`background-color: ${style.style.highlight}`)
    if (style.style.superscript) css.push('vertical-align: super; font-size: 0.7em')
    if (style.style.subscript) css.push('vertical-align: sub; font-size: 0.7em')
    if (style.style.smallCaps) css.push('font-variant: small-caps')
    if (style.style.allCaps) css.push('text-transform: uppercase')
    if (style.style.outline) css.push('text-shadow: 1px 0 0 currentColor, -1px 0 0 currentColor, 0 1px 0 currentColor, 0 -1px 0 currentColor')
    if (style.style.shadow) css.push('text-shadow: 2px 2px 2px rgba(0,0,0,0.5)')
    if (style.style.letterSpacing !== undefined && style.style.letterSpacing !== 0) {
      css.push(`letter-spacing: ${style.style.letterSpacing}pt`)
    }
    if (style.style.hidden) {
      if (showHiddenText.value) {
        css.push('border-bottom: 1px dotted #888; color: #888;')
      } else {
        css.push('display: none;')
      }
    }

    htmlContent += `<span style="${css.join('; ')}">${hasHtml ? segment : escapeHtml(segment)}</span>`
    lastEnd = style.end
  }
  if (lastEnd < text.length) {
    const rem = text.substring(lastEnd)
    if (rem) htmlContent += hasHtml ? rem : escapeHtml(rem)
  }

  const pCss: string[] = []
  pCss.push(`font-size:${fontSize}`)
  pCss.push(`text-align:${textAlign}`)
  if (paraFormat.lineSpacing) pCss.push(`line-height: ${paraFormat.lineSpacing}`)
  if (paraFormat.spaceBefore) pCss.push(`margin-top: ${paraFormat.spaceBefore}pt`)
  if (paraFormat.spaceAfter) pCss.push(`margin-bottom: ${paraFormat.spaceAfter}pt`)
  if (paraFormat.indent) pCss.push(`margin-left: ${paraFormat.indent}pt`)
  if (paraFormat.rightIndent) pCss.push(`margin-right: ${paraFormat.rightIndent}pt`)
  if (paraFormat.firstLineIndent) pCss.push(`text-indent: ${paraFormat.firstLineIndent}pt`)
  if (paraFormat.backgroundColor) pCss.push(`background-color: ${paraFormat.backgroundColor}`)
  if (paraFormat.borders) {
    const borderCss = getBorderCss(paraFormat.borders)
    if (borderCss.top) pCss.push(`border-top: ${borderCss.top}`)
    if (borderCss.left) pCss.push(`border-left: ${borderCss.left}`)
    if (borderCss.bottom) pCss.push(`border-bottom: ${borderCss.bottom}`)
    if (borderCss.right) pCss.push(`border-right: ${borderCss.right}`)
    pCss.push('padding: 4px')
  }

  const headingLevel = (paraFormat as any)?.headingLevel
  const hasTabs = text.includes('\t')
  const finalContent = hasTabs && (!paraFormat.tabs || paraFormat.tabs.length === 0)
    ? `<span style="white-space: pre; tab-size: 3;">${htmlContent}</span>`
    : htmlContent

  const hasPageBreak = paraFormat.pageBreakBefore
  const pageBreakHtml = hasPageBreak
    ? '<div style="page-break-before: always; break-before: page; border-top: 2px dashed var(--border); margin: 24px 0 16px 0; position: relative;"><span style="position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: var(--bg); padding: 0 8px; font-size: 12px; color: var(--muted);">— 分页 —</span></div>'
    : ''

  if (headingLevel && headingLevel >= 1 && headingLevel <= 6) {
    return `${pageBreakHtml}<h${headingLevel} style="${pCss.join('; ')}">${finalContent}</h${headingLevel}>`
  }
  return `${pageBreakHtml}<p style="${pCss.join('; ')}">${finalContent}</p>`
}

const formatTextWithDefaultStyles = (
  text: string, charFormat: CharacterFormat, paraFormat: ParagraphFormat,
  options: { isCentered: boolean; isRightAligned: boolean }, hasHtml: boolean = false
): string => {
  const { isCentered, isRightAligned } = options
  const css: string[] = []
  css.push(`font-family: ${getWebFontFamily(charFormat.fontName)}'${charFormat.fontName || '宋体'}', 'SimSun', serif`)
  css.push(`font-size: ${resolveFontSize(charFormat.fontSize, '1.0rem')}`)
  if (charFormat.bold) css.push('font-weight: bold')
  if (charFormat.italic) css.push('font-style: italic')

  const textDecorations: string[] = []
  if (charFormat.underline) textDecorations.push('underline')
  if (charFormat.strikethrough) textDecorations.push('line-through')
  if (textDecorations.length > 0) css.push(`text-decoration: ${textDecorations.join(' ')}`)

  if (charFormat.color) css.push(`color: ${charFormat.color}`)
  if (charFormat.highlight) css.push(`background-color: ${charFormat.highlight}`)
  if (charFormat.superscript) css.push('vertical-align: super; font-size: 0.7em')
  if (charFormat.subscript) css.push('vertical-align: sub; font-size: 0.7em')
  if (charFormat.smallCaps) css.push('font-variant: small-caps')
  if (charFormat.allCaps) css.push('text-transform: uppercase')
  if (charFormat.outline) css.push('text-shadow: 1px 0 0 currentColor, -1px 0 0 currentColor, 0 1px 0 currentColor, 0 -1px 0 currentColor')
  if (charFormat.shadow) css.push('text-shadow: 2px 2px 2px rgba(0,0,0,0.5)')
  if (charFormat.letterSpacing !== undefined && charFormat.letterSpacing !== 0) {
    css.push(`letter-spacing: ${charFormat.letterSpacing}pt`)
  }
  if (charFormat.hidden) {
    if (showHiddenText.value) {
      css.push('border-bottom: 1px dotted #888; color: #888;')
    } else {
      css.push('display: none;')
    }
  }

  css.push(`text-align: ${isCentered ? 'center' : isRightAligned ? 'right' : 'justify'}`)

  if (paraFormat.lineSpacing) css.push(`line-height: ${paraFormat.lineSpacing}`)
  if (paraFormat.spaceBefore) css.push(`margin-top: ${paraFormat.spaceBefore}pt`)
  if (paraFormat.spaceAfter) css.push(`margin-bottom: ${paraFormat.spaceAfter}pt`)
  if (paraFormat.indent) css.push(`margin-left: ${paraFormat.indent}pt`)
  if (paraFormat.rightIndent) css.push(`margin-right: ${paraFormat.rightIndent}pt`)
  if (paraFormat.firstLineIndent) css.push(`text-indent: ${paraFormat.firstLineIndent}pt`)
  if (paraFormat.backgroundColor) css.push(`background-color: ${paraFormat.backgroundColor}`)
  if (paraFormat.borders) {
    const borderCss = getBorderCss(paraFormat.borders)
    if (borderCss.top) css.push(`border-top: ${borderCss.top}`)
    if (borderCss.left) css.push(`border-left: ${borderCss.left}`)
    if (borderCss.bottom) css.push(`border-bottom: ${borderCss.bottom}`)
    if (borderCss.right) css.push(`border-right: ${borderCss.right}`)
    css.push('padding: 4px')
  }

  const hasPageBreak = paraFormat.pageBreakBefore

  const headingLevel = (paraFormat as any)?.headingLevel
  const hasTabs = text.includes('\t')
  const finalText = hasTabs
    ? applyTabStops(text, paraFormat.tabs, charFormat.fontSize || 12, charFormat.fontName || '宋体', hasHtml)
    : (hasHtml ? text : escapeHtml(text))

  const pageBreakHtml = hasPageBreak
    ? '<div style="page-break-before: always; break-before: page; border-top: 2px dashed var(--border); margin: 24px 0 16px 0; position: relative;"><span style="position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: var(--bg); padding: 0 8px; font-size: 12px; color: var(--muted);">— 分页 —</span></div>'
    : ''

  if (headingLevel && headingLevel >= 1 && headingLevel <= 6) {
    return `${pageBreakHtml}<h${headingLevel} style="${css.join('; ')}">${finalText}</h${headingLevel}>`
  }
  return `${pageBreakHtml}<p style="${css.join('; ')}">${finalText}</p>`
}

const formatTextWithInferredFormat = (text: string): string => {
  const paragraphs = text.split(/\n+/).filter(p => p.trim())
  if (paragraphs.length === 0) return `<p style="font-family:${getWebFontFamily('宋体')}'宋体',serif;font-size:1.0rem">${escapeHtml(text)}</p>`

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
      html += `<h1 style="font-family:${getWebFontFamily('宋体')}'宋体',serif;font-size:1.375rem;font-weight:bold;text-align:center">${escapeHtml(t)}</h1>`
    } else {
      html += `<p style="font-family:${getWebFontFamily('宋体')}'宋体','SimSun',serif;font-size:1.0rem;text-align:justify">${escapeHtml(t)}</p>`
    }
    i++
  }
  return html
}

// ---- Utilities ----

let _escapeDiv: HTMLDivElement | null = null
const escapeHtml = (text: string): string => {
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
 * @param fontSize - 字体大小（磅值）
 * @param fontFamily - 字体族
 * @returns 处理后的 HTML 字符串（\t 被替换为 span 空白间隔）
 */
function applyTabStops(
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

// ---- Zoom ----

function zoomIn() {
  zoomLevel.value = Math.min(MAX_ZOOM, zoomLevel.value + ZOOM_STEP)
}

function zoomOut() {
  zoomLevel.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomLevel.value - ZOOM_STEP))
}

function zoomReset() {
  zoomLevel.value = 100
}

const zoomLabel = computed(() => `${zoomLevel.value}%`)

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
    })
  }
}

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

  // Build query: apply case sensitivity and whole-word matching
  const caseSensitive = searchCaseSensitive.value
  const wholeWord = searchWholeWord.value
  const query = caseSensitive ? rawQuery : rawQuery.toLowerCase()
  // Escape regex special chars for whole-word matching
  const escapedQuery = rawQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const wordRegex = wholeWord
    ? new RegExp(`(^|[^\\w])(${escapedQuery})($|[^\\w])`, caseSensitive ? 'g' : 'gi')
    : null

  const treeWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)
  const matches: SearchMatch[] = []
  let index = 0

  while (treeWalker.nextNode()) {
    const node = treeWalker.currentNode as Text
    const text = node.textContent || ''
    const lower = caseSensitive ? text : text.toLowerCase()

    if (wordRegex) {
      // Whole-word matching using regex
      wordRegex.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = wordRegex.exec(text)) !== null) {
        const matchStart = m.index + m[1].length
        const matchEnd = matchStart + m[2].length
        const span = document.createElement('span')
        span.className = 'search-highlight'
        span.textContent = text.substring(matchStart, matchEnd)
        span.dataset.searchIndex = String(index)
        const range = document.createRange()
        range.setStart(node, matchStart)
        range.setEnd(node, matchEnd)
        range.deleteContents()
        range.insertNode(span)
        matches.push({ index, text: m[2], element: span })
        index++
        // Advance past the match to avoid infinite loop on zero-length matches
        if (m[0].length === 0) wordRegex.lastIndex++
      }
    } else {
      // Substring matching (case-insensitive by default)
      let pos = 0
      while ((pos = lower.indexOf(query, pos)) !== -1) {
        const span = document.createElement('span')
        span.className = 'search-highlight'
        span.textContent = text.substring(pos, pos + query.length)
        span.dataset.searchIndex = String(index)
        const range = document.createRange()
        range.setStart(node, pos)
        range.setEnd(node, pos + query.length)
        range.deleteContents()
        range.insertNode(span)
        matches.push({ index, text: query, element: span })
        index++
        pos += query.length
      }
    }
  }

  searchResults.value = matches
  if (matches.length > 0) {
    currentSearchIndex.value = 0
    scrollToMatch(0)
  }
}

function clearHighlights() {
  previewRef.value?.querySelectorAll('.search-highlight').forEach(el => {
    const parent = el.parentNode
    if (parent) {
      const text = document.createTextNode(el.textContent || '')
      parent.replaceChild(text, el)
      parent.normalize()
    }
  })
}

function scrollToMatch(idx: number) {
  const matches = previewRef.value?.querySelectorAll('.search-highlight') as NodeListOf<HTMLElement>
  if (idx >= 0 && idx < matches.length) {
    matches.forEach((el, i) => {
      el.classList.toggle('search-highlight-current', i === idx)
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }
}

function nextMatch() {
  if (searchResults.value.length === 0) return
  currentSearchIndex.value = (currentSearchIndex.value + 1) % searchResults.value.length
  scrollToMatch(currentSearchIndex.value)
}

function prevMatch() {
  if (searchResults.value.length === 0) return
  currentSearchIndex.value = (currentSearchIndex.value - 1 + searchResults.value.length) % searchResults.value.length
  scrollToMatch(currentSearchIndex.value)
}

const searchStatusLabel = computed(() => {
  if (searchResults.value.length === 0) return '无匹配'
  return `${currentSearchIndex.value + 1} / ${searchResults.value.length}`
})

// ---- Print ----

function printDocument() {
  if (!htmlContent.value) return
  
  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    alert('请允许弹出窗口以进行打印')
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
        content: "第 " counter(page) " 页 / 共 " counter(pages) " 页";
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
  
  printWindow.document.write(printContent)
  printWindow.document.close()
  
  printWindow.addEventListener('load', () => {
    setTimeout(() => {
      printWindow.print()
      printWindow.close()
    }, 500)
  })
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
    if (target) {
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

async function copyText() {
  if (!plainText.value) return
  
  const tryRichCopy = async () => {
    if (!htmlContent.value) return false
    
    const blob = new Blob([htmlContent.value], { type: 'text/html' })
    const item = new ClipboardItem({ 'text/html': blob })
    
    try {
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
    const btn = document.querySelector('.toolbar-btn[title*="复制"]')
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

function escapeMdText(text: string): string {
  return text
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

function convertInlineToMd(node: ChildNode): string {
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
      return `[${inner}](${href})`
    }
    case 'img': {
      const src = el.getAttribute('src') || ''
      const alt = el.getAttribute('alt') || ''
      return src ? `![${alt}](${src})` : inner
    }
    case 'sub': return `<sub>${inner}</sub>`
    case 'sup': return `<sup>${inner}</sup>`
    case 'br': return '\n'
    case 'span': case 'font': return inner
    default: return inner
  }
}

function getTableColCount(table: HTMLTableElement): number {
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

function convertTableToMd(table: HTMLTableElement): string {
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
      const colspan = parseInt(cell.getAttribute('colspan') || '1')
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

function convertListToMd(list: HTMLElement, indent: number = 0): string[] {
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

function convertBlockToMd(node: ChildNode): string {
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

function downloadMarkdown() {
  if (!htmlContent.value) return

  const container = document.createElement('div')
  container.innerHTML = htmlContent.value

  const parts: string[] = []
  const pageContents = container.querySelectorAll('.page-content')

  pageContents.forEach(pc => {
    for (const child of pc.childNodes) {
      const md = convertBlockToMd(child)
      if (md) parts.push(md)
    }
  })

  const mdContent = parts.join('\n\n')
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

  // F3 or Ctrl+G for next match
  if (e.key === 'F3' || (isCtrl && e.key === 'g')) {
    if (showSearch.value) { e.preventDefault(); nextMatch() }
    return
  }

  // Shift+F3 or Ctrl+Shift+G for prev match
  if (e.key === 'F3' && e.shiftKey || (isCtrl && e.shiftKey && e.key === 'g')) {
    if (showSearch.value) { e.preventDefault(); prevMatch() }
    return
  }

  // PageUp/PageDown for pagination navigation (skip when focus is in input)
  const target = e.target as HTMLElement
  const isInputFocused = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  if (isInputFocused) return

  if (e.key === 'PageUp') {
    e.preventDefault()
    goToPrevPage()
    return
  }

  if (e.key === 'PageDown') {
    e.preventDefault()
    goToNextPage()
    return
  }

  // Home/End for first/last page (Ctrl or standalone)
  if (e.key === 'Home') {
    e.preventDefault()
    goToPage(1)
    return
  }

  if (e.key === 'End') {
    e.preventDefault()
    goToPage(totalPages.value)
    return
  }

  // ? or Ctrl+/ to toggle shortcuts panel
  if (e.key === '?' || (isCtrl && e.key === '/')) {
    e.preventDefault()
    toggleShortcuts()
    return
  }
}

// ---- Watchers ----

watch(() => props.source, (newSource) => {
  if (newSource) {
    typeof newSource === 'string' ? loadFromUrl(newSource) : loadFromFile(newSource)
  }
})

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('scroll', handleVirtualScroll, { passive: true })
  window.addEventListener('resize', handleVirtualScroll, { passive: true })
  if (props.source) {
    typeof props.source === 'string' ? loadFromUrl(props.source) : loadFromFile(props.source)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('scroll', handleVirtualScroll)
  window.removeEventListener('resize', handleVirtualScroll)
})

// ---- Expose for parent components ----

function reload() {
  if (props.source) {
    typeof props.source === 'string' ? loadFromUrl(props.source) : loadFromFile(props.source)
  }
}

function getPlainText(): string {
  return plainText.value
}

function focusContent() {
  previewRef.value?.querySelector('.document-content')?.scrollIntoView({ block: 'start' })
  previewRef.value?.focus()
}

defineExpose({ reload, getPlainText, focusContent })
</script>

<template>
  <div class="doc-preview" :style="{ '--zoom': zoomLevel / 100 }" tabindex="-1">
    <a class="skip-link" href="#" @click.prevent="focusContent">跳到文档内容</a>
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
    <div v-else ref="previewRef" class="preview-wrapper">
      <!-- Toolbar -->
      <div class="toolbar">
        <div class="toolbar-left">
          <!-- Zoom -->
          <button class="toolbar-btn" @click="zoomOut" :disabled="zoomLevel <= MIN_ZOOM" title="缩小" aria-label="缩小">−</button>
          <button class="toolbar-btn zoom-label" @click="zoomReset" title="重置缩放" aria-label="重置缩放为 100%">{{ zoomLabel }}</button>
          <button class="toolbar-btn" @click="zoomIn" :disabled="zoomLevel >= MAX_ZOOM" title="放大" aria-label="放大">+</button>

          <span class="toolbar-sep" role="separator"></span>

          <!-- Search -->
          <button class="toolbar-btn" @click="toggleSearch" :class="{ active: showSearch }" title="搜索文档" aria-label="搜索文档">
            🔍
          </button>

          <span class="toolbar-sep" role="separator"></span>

          <!-- Print -->
          <button class="toolbar-btn" @click="printDocument" title="打印 / 导出 PDF" aria-label="打印">🖨️</button>

          <!-- Download text -->
          <button class="toolbar-btn" @click="downloadText" :title="t('toolbar.download.txt')" :aria-label="t('toolbar.download.txt')">📥</button>

          <!-- Download HTML -->
          <button class="toolbar-btn" @click="downloadHtml" :title="t('toolbar.download.html')" :aria-label="t('toolbar.download.html')">🌐</button>

          <!-- Download Markdown -->
          <button class="toolbar-btn" @click="downloadMarkdown" :title="t('toolbar.download.md')" :aria-label="t('toolbar.download.md')">📝</button>

          <!-- Copy text -->
          <button class="toolbar-btn" @click="copyText" :title="t('toolbar.copy')" :aria-label="t('toolbar.copy')">📋</button>

          <span class="toolbar-sep" role="separator"></span>

          <!-- Outline TOC -->
          <button
            class="toolbar-btn"
            :class="{ active: showOutline }"
            :disabled="outline.length === 0"
            @click="showOutline = !showOutline"
            :title="t('toolbar.outline')"
            :aria-label="t('toolbar.outline')"
          >📑</button>

          <!-- Hidden text toggle -->
          <button
            class="toolbar-btn"
            :class="{ active: showHiddenText }"
            @click="toggleHiddenText"
            :title="showHiddenText ? t('toolbar.hidden.show') : t('toolbar.hidden.hide')"
            :aria-label="t('toolbar.hidden.toggle')"
          >👁️</button>
        </div>

        <div class="toolbar-right">
          <span class="doc-stats" v-if="wordCount > 0">
            {{ wordCount }} {{ t('stats.words') }} · {{ paragraphCount }} {{ t('stats.paragraphs') }} · {{ charCount }} {{ t('stats.chars') }}
          </span>

          <span class="toolbar-sep" role="separator"></span>

          <!-- Dark mode toggle -->
          <button
            class="toolbar-btn"
            :class="{ active: darkMode }"
            @click="toggleDarkMode"
            :title="darkMode ? t('app.theme.light') : t('app.theme.dark')"
            :aria-label="t('toolbar.theme')"
          >
            {{ darkMode ? '☀️' : '🌙' }}
          </button>

          <!-- Shortcuts -->
          <button
            class="toolbar-btn"
            :class="{ active: showShortcuts }"
            @click="toggleShortcuts"
            :title="t('toolbar.shortcuts') + ' (?)'"
            :aria-label="t('toolbar.shortcuts')"
          >⌨️</button>

          <span class="toolbar-sep" role="separator"></span>

          <!-- Pagination controls -->
          <div class="pagination-controls">
            <button
              class="pagination-btn"
              @click="goToPrevPage"
              :disabled="currentPage <= 1"
              :title="t('pagination.prev')"
              :aria-label="t('pagination.prev')"
            >◀</button>
            <span class="pagination-info">
              {{ currentPage }} / {{ totalPages }}
            </span>
            <button
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
      <div v-if="showSearch" class="search-bar">
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          class="search-input"
          :placeholder="t('search.placeholder')"
          @input="performSearch"
          @keyup.enter="nextMatch"
        />
        <label class="search-option" :title="t('search.case')">
          <input type="checkbox" v-model="searchCaseSensitive" @change="performSearch" />
          <span>Aa</span>
        </label>
        <label class="search-option" :title="t('search.word')">
          <input type="checkbox" v-model="searchWholeWord" @change="performSearch" />
          <span>W</span>
        </label>
        <span class="search-status">{{ searchStatusLabel }}</span>
        <button class="toolbar-btn" @click="prevMatch" :disabled="searchResults.length === 0" :title="t('search.placeholder') + ' ▲'" aria-label="前一个匹配">▲</button>
        <button class="toolbar-btn" @click="nextMatch" :disabled="searchResults.length === 0" :title="t('search.placeholder') + ' ▼'" aria-label="后一个匹配">▼</button>
        <button class="toolbar-btn" @click="toggleSearch" :title="t('toolbar.search')" aria-label="关闭搜索">✕</button>
      </div>

      <!-- Document info -->
      <div class="doc-info">
        <span class="doc-name">{{ fileName }}</span>
        <span class="doc-status">{{ t('doc.status.ok') }}</span>
      </div>

      <!-- Document outline sidebar -->
      <div v-if="showOutline && outline.length > 0" class="outline-sidebar">
        <div class="outline-header">{{ t('outline.header') }}</div>
        <div class="outline-list">
          <div
            v-for="item in outline"
            :key="item.index"
            class="outline-item"
            :class="'outline-level-' + item.level"
            @click="scrollToOutline(item)"
          >{{ item.text }}</div>
        </div>
      </div>

      <!-- Document content (paper-like) -->
      <div class="paper-page">
        <div class="document-content">
          <template v-for="(pageHtml, idx) in pages" :key="idx">
            <div
              v-if="isPageVisible(idx)"
              class="page-host"
              v-html="pageHtml"
            ></div>
            <div
              v-else
              class="page-placeholder"
              :style="{ height: getPagePlaceholderHeight(idx) + 'px' }"
            ></div>
          </template>
        </div>
      </div>

      <!-- Stories panel (headers / footnotes / endnotes / comments / textboxes) -->
      <CollapsiblePanel
        v-if="storySections.length > 0"
        v-model="showStories"
        :title="`${t('story.title')}（${storySections.length}）`"
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
                :alt="`图片 ${idx + 1}`"
                :style="{
                  maxWidth: '100%',
                  height: 'auto',
                  maxHeight: '200px',
                }"
                class="story-image"
              />
              <span class="story-image-caption">{{ img.format?.toUpperCase() || '图片' }}</span>
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

      <!-- Table of Contents -->
      <CollapsiblePanel
        v-if="toc.length > 0"
        v-model="showToc"
        :title="`${t('toc.title')}（${toc.length}）`"
        panel-class="toc-panel"
      >
        <div class="toc-content">
          <ul class="toc-list">
            <li
              v-for="(entry, index) in toc"
              :key="index"
              class="toc-item"
              :class="`toc-level-${entry.level}`"
            >
              <span class="toc-text">{{ entry.text }}</span>
              <span v-if="entry.pageNumber" class="toc-page">{{ entry.pageNumber }}</span>
            </li>
          </ul>
        </div>
      </CollapsiblePanel>

      <!-- Index -->
      <CollapsiblePanel
        v-if="index.length > 0"
        v-model="showIndex"
        :title="`${t('index.title')}（${index.length}）`"
        panel-class="toc-panel"
      >
        <div class="toc-content">
          <ul class="toc-list">
            <li
              v-for="(entry, i) in index"
              :key="i"
              class="toc-item"
              :class="{ 'toc-level-2': entry.subTerm }"
            >
              <span class="toc-text">{{ entry.mainTerm }}</span>
              <span v-if="entry.subTerm" class="toc-subterm">· {{ entry.subTerm }}</span>
              <span v-if="entry.pageNumber" class="toc-page">{{ entry.pageNumber }}</span>
            </li>
          </ul>
        </div>
      </CollapsiblePanel>

      <!-- Revision marks (track changes: insert / delete) -->
      <CollapsiblePanel
        v-if="revisions.length > 0"
        v-model="showRevisions"
        :title="`${t('revisions.title')}（${revisions.length}）`"
        :summary="t('revisions.count', { n: revisionItems.length })"
        panel-class="revisions-panel"
      >
        <div class="revision-mode-toolbar" role="group" :aria-label="t('revisions.title')">
          <button
            class="revision-mode-btn"
            :class="{ active: revisionMode === 'marks' }"
            :aria-pressed="revisionMode === 'marks'"
            @click="setRevisionMode('marks')"
            :title="t('revisions.marks')"
          >{{ t('revisions.marks') }}</button>
          <button
            class="revision-mode-btn"
            :class="{ active: revisionMode === 'accepted' }"
            :aria-pressed="revisionMode === 'accepted'"
            @click="setRevisionMode('accepted')"
            :title="t('revisions.accept')"
          >{{ t('revisions.accept') }}</button>
          <button
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
      <CollapsiblePanel
        v-if="bookmarks.length > 0"
        v-model="showBookmarks"
        :title="`${t('bookmarks.title')}（${bookmarks.length}）`"
        :summary="t('bookmarks.summary')"
        panel-class="bookmarks-panel"
      >
        <div class="bookmarks-content">
          <div
            v-for="(bm, idx) in bookmarks"
            :key="idx"
            class="bookmark-item"
          >
            <span class="bookmark-name">{{ bm.name }}</span>
            <span class="bookmark-range">CP: {{ bm.cpStart }} – {{ bm.cpEnd }}</span>
          </div>
        </div>
      </CollapsiblePanel>

      <!-- Sections (page layout from PlcfSed/SEPX) -->
      <CollapsiblePanel
        v-if="sections.length > 0"
        v-model="showSections"
        :title="`${t('sections.title')}（${sections.length}）`"
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
              <span class="section-index">节 {{ sec.index + 1 }}</span>
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
        :title="`${t('pageFields.title')}（${pageFields.length}）`"
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
        :title="`${t('crossRefs.title')}（${crossReferences.length}）`"
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
              {{ t('crossRefs.target') }}：<code>{{ cr.targetBookmarkName }}</code>
            </div>
            <div class="cross-ref-instruction">{{ t('crossRefs.instruction', { inst: cr.instruction }) }}</div>
            <div v-if="cr.switches.length > 0" class="cross-ref-switches">
              {{ t('crossRefs.switches') }}：
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
        :title="`${t('shapes.title')}（${shapes.length}）`"
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
        :title="`${t('equations.title')}（${equations.length}）`"
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
        :title="`${t('charts.title')}（${charts.length}）`"
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
        :title="`${t('wordart.title')}（${wordArts.length}）`"
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
        :title="`${t('images.title')}（${pictures.length > 0 ? pictures.length : images.length}）`"
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
              <img :src="pic.dataUrl" :alt="`图片 ${idx + 1}`" loading="lazy" />
              <div class="image-meta">
                <span class="image-format">{{ pic.format.toUpperCase() }}</span>
                <template v-if="pic.widthPx && pic.heightPx">
                  <span class="image-size">{{ pic.widthPx }} × {{ pic.heightPx }}</span>
                </template>
                <span v-if="pic.floating" class="image-floating">浮动</span>
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
      <!-- <DocStatsPanel v-model="showStats" :stats="docStats" /> -->

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
  transform: scale(var(--zoom, 1));
  transform-origin: top center;
  transition: transform 0.2s ease, background 0.3s;
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

.stories-toggle {
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

.stories-toggle:hover {
  background: var(--bg-tertiary);
}

.stories-toggle-icon {
  display: inline-block;
  width: 12px;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.stories-toggle-summary {
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

.toc-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.toc-content {
  padding: 16px;
}

.toc-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.toc-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-color);
}

.toc-item:last-child {
  border-bottom: none;
}

.toc-level-1 {
  font-weight: bold;
  font-size: 1rem;
  padding-left: 0;
}

.toc-level-2 {
  font-size: 0.95rem;
  padding-left: 16px;
}

.toc-level-3 {
  font-size: 0.9rem;
  padding-left: 32px;
}

.toc-level-4,
.toc-level-5,
.toc-level-6,
.toc-level-7,
.toc-level-8,
.toc-level-9 {
  font-size: 0.85rem;
  padding-left: calc(16px * var(--level, 4));
}

.toc-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toc-page {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-left: 12px;
}

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

/* ==================== Bookmarks ==================== */
.bookmarks-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.bookmarks-content {
  padding: 12px 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px;
}

.bookmark-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 10px;
  background: var(--bg-primary);
  border-left: 3px solid #3498db;
  border-radius: 4px;
  font-size: 0.85rem;
}

.bookmark-name {
  color: var(--text-primary);
  font-weight: 500;
  word-break: break-all;
}

.bookmark-range {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

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
  .toc-panel,
  .revisions-panel,
  .bookmarks-panel,
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
  .toc-content,
  .revisions-content,
  .bookmarks-content,
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
