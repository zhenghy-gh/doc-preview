<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, onErrorCaptured, nextTick } from 'vue'
import { parseDocFileWithFormat, parseDocFileFromBuffer } from '../utils/docParser'
import { parseWithWorker } from '../utils/parseWithWorker'
import { renderTableHtml, splitTableCells } from '../utils/tableText'
import type { CharacterFormat, ParagraphFormat, CharStyleSegment, TableInfo, RevisionMark, RevisionType, BookmarkRange, SectionInfo, PageFieldRange, CrossReferenceRange, ShapeInfo, EquationInfo, ChartInfo, WordArtInfo } from '../utils/docFormat'
import type { DocumentFields } from '../utils/fieldParser'
import { applyRevisionsToText } from '../utils/revisionRender'
import type { RevisionMode } from '../utils/revisionRender'

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
  document?: { paragraphs: FormattedParagraphOutput[]; stories?: DocumentStories; images?: string[]; pictures?: PictureInfo[]; hyperlinks?: HyperlinkRange[]; toc?: TocEntry[]; properties?: DocumentProperties; docFlags?: DocumentFlags; revisions?: RevisionMark[]; documentFields?: DocumentFields; bookmarks?: BookmarkRange[]; sections?: SectionInfo[]; pageFields?: PageFieldRange[]; crossReferences?: CrossReferenceRange[]; shapes?: ShapeInfo[]; equations?: EquationInfo[]; charts?: ChartInfo[]; wordArts?: WordArtInfo[] }
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

// --- Zoom ---
const zoomLevel = ref(100)
const MIN_ZOOM = 50
const MAX_ZOOM = 200
const ZOOM_STEP = 10

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
  const container = previewRef.value?.querySelector('.document-content')
  if (!container) return
  const pageElements = container.querySelectorAll('.page-content')
  const target = pageElements[page - 1]
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

function updateTotalPages() {
  nextTick(() => {
    const container = previewRef.value?.querySelector('.document-content')
    if (!container) {
      totalPages.value = 1
      return
    }
    const pageElements = container.querySelectorAll('.page-content')
    totalPages.value = pageElements.length || 1
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

// --- Document stats ---
const wordCount = ref(0)
const charCount = ref(0)
const paragraphCount = ref(0)
const chineseCharCount = ref(0)
const isRichFormat = ref(false)

// --- Stories (headers / footnotes / endnotes / comments / textboxes) ---
const stories = ref<DocumentStories | null>(null)
const showStories = ref(false)
const STORY_LABELS: Record<string, string> = {
  headers: '页眉/页脚',
  footnotes: '脚注',
  endnotes: '尾注',
  comments: '批注',
  textboxes: '文本框',
}

// --- Embedded images extracted from the Data stream ---
const images = ref<string[]>([])
const pictures = ref<PictureInfo[]>([])
const showImages = ref(false)

// --- Hyperlinks extracted from PlcfFld ---
const hyperlinks = ref<HyperlinkRange[]>([])

// --- Table of Contents ---
const toc = ref<TocEntry[]>([])
const showToc = ref(false)

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

const PAGE_FIELD_TYPE_LABEL: Record<string, string> = {
  page: '当前页码 (PAGE)',
  numPages: '总页数 (NUMPAGES)',
  section: '当前节 (SECTION)',
  sectionPages: '节内页数 (SECTIONPAGES)',
}

// --- Cross-references (REF / NOTEREF) ---
const crossReferences = ref<CrossReferenceRange[]>([])
const showCrossReferences = ref(false)

const CROSS_REF_TYPE_LABEL: Record<string, string> = {
  ref: '引用 (REF)',
  noteref: '脚注引用 (NOTEREF)',
}

const CROSS_REF_SWITCH_LABEL: Record<string, string> = {
  '\\h': '超链接',
  '\\n': '段落编号',
  '\\r': '段落编号(无分隔符)',
  '\\w': '完整段落编号',
  '\\p': '相对位置(上方/下方)',
  '\\f': '插入引用类型',
  '\\d': '分隔符',
}

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

const SHAPE_TYPE_LABEL: Record<string, string> = {
  rectangle: '矩形',
  ellipse: '椭圆',
  line: '线条',
  freeform: '自由形状',
  textbox: '文本框',
  picture: '图片',
  group: '组合',
  unknown: '未知',
}

const SHAPE_ANCHOR_LABEL: Record<string, string> = {
  char: '字符',
  paragraph: '段落',
  page: '页面',
  margin: '边距',
  unknown: '未知',
}

const BREAK_TYPE_LABEL: Record<string, string> = {
  nextPage: '下一页',
  oddPage: '奇数页',
  evenPage: '偶数页',
  continuous: '连续',
}

const CHART_TYPE_LABEL: Record<string, string> = {
  msgraph: 'MSGraph',
  excel: 'Excel',
  smartart: 'SmartArt',
  oleobject: 'OLE 对象',
  chart: '图表',
  unknown: '未知',
}

const CHART_SUBTYPE_LABEL: Record<string, string> = {
  column: '柱状图',
  bar: '条形图',
  line: '折线图',
  pie: '饼图',
  area: '面积图',
  scatter: '散点图',
  doughnut: '环形图',
  radar: '雷达图',
  surface: '曲面图',
  bubble: '气泡图',
  stock: '股价图',
  cone: '圆锥图',
  cylinder: '圆柱图',
  pyramid: '棱锥图',
  orgchart: '组织结构图',
  process: '流程',
  cycle: '循环',
  hierarchy: '层次结构',
  matrix: '矩阵',
  relationship: '关系',
  list: '列表',
  picture: '图片',
  chart: '图表',
  unknown: '未知',
}

function getChartTypeLabel(type: string): string {
  return CHART_TYPE_LABEL[type] || '未知'
}

function getChartSubtypeLabel(subtype: string): string {
  return CHART_SUBTYPE_LABEL[subtype] || '未知'
}

const WORDART_EFFECT_LABEL: Record<string, string> = {
  gradient: '渐变',
  shadow: '阴影',
  emboss: '浮雕',
  bevel: '斜角',
  outline: '轮廓',
  fill: '填充',
  '3d': '3D',
  rotate: '旋转',
  flip: '翻转',
  stretch: '拉伸',
  unknown: '未知',
}

function getWordArtEffectLabel(effect: string): string {
  return WORDART_EFFECT_LABEL[effect] || '未知'
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
    const author = r.author || (r.authorIndex !== undefined ? `作者#${r.authorIndex}` : '未知作者')
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
    insert: '插入',
    delete: '删除',
    format: '格式修订',
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

const docFlagItems = computed<Array<{ label: string; description: string }>>(() => {
  if (!docFlags.value) return []
  const items: Array<{ label: string; description: string }> = []
  if (docFlags.value.facingPages) {
    items.push({ label: '奇偶页不同', description: 'fFacingPages — 奇数页和偶数页有不同的页眉页脚' })
  }
  if (docFlags.value.titlePage) {
    items.push({ label: '首页不同', description: 'fTitlePage — 首页有独立的页眉页脚' })
  }
  if (docFlags.value.pmhMain) {
    items.push({ label: '有页眉', description: 'fPMHMain — 主文档包含页眉' })
  }
  if (docFlags.value.trackChanges) {
    items.push({ label: '修订模式', description: 'fRMW — 文档启用了修订记录（track changes）' })
  }
  if (docFlags.value.ftnRestart) {
    items.push({ label: '脚注重编号', description: 'fFtnRestart — 脚注每页或每节重新编号' })
  }
  if (docFlags.value.ftnEnd) {
    items.push({ label: '脚注在节末', description: 'fFtnEnd — 脚注位于节末' })
  }
  if (docFlags.value.ftnAtEnd) {
    items.push({ label: '脚注在文末', description: 'fFtnAtEnd — 脚注位于文档末尾' })
  }
  return items
})

const HEADER_PART_LABELS: Record<string, string> = {
  titleHeader: '首页页眉',
  titleFooter: '首页页脚',
  oddHeader: '奇数页页眉',
  oddFooter: '奇数页页脚',
  evenHeader: '偶数页页眉',
  evenFooter: '偶数页页脚',
}

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
          label: HEADER_PART_LABELS[key] || key,
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
          label: HEADER_PART_LABELS[key] || key,
          text: text.trim(),
        })
      }
    }
  } else if (stories.value.headers && stories.value.headers.trim()) {
    // 没有 headerParts 时回退到合并的 headers 文本
    out.push({ key: 'headers', label: '页眉/页脚', text: stories.value.headers.trim() })
  }

  // 其他 story（footnotes/endnotes/comments/textboxes）
  const otherKeys: Array<keyof DocumentStories> = ['footnotes', 'endnotes', 'comments', 'textboxes']
  for (const key of otherKeys) {
    const text = stories.value[key] as string | undefined
    if (text && text.trim()) {
      out.push({ key, label: STORY_LABELS[key], text: text.trim() })
    }
  }
  return out
})

function formatStoryText(text: string): string {
  return text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => `<p style="margin:0 0 6px 0">${escapeHtml(line)}</p>`)
    .join('')
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
  startLoadingTimer()

  try {
    // Use Web Worker for large files to keep UI responsive
    const useWorker = isWorkerSupported && file.size > WORKER_THRESHOLD
    isUsingWorker.value = useWorker

    let result
    if (useWorker) {
      const buffer = await file.arrayBuffer()
      result = await parseWithWorker(buffer)
    } else {
      result = await parseDocFileWithFormat(file)
    }

    if (!result.success) {
      error.value = result.error || '解析失败'
      loading.value = false
      emit('loading', false)
      return
    }
    renderResult(result)
    emit('loaded')
  } catch (err) {
    console.error('Error parsing DOC file:', err)
    error.value = `❌ 解析失败\n\n${err instanceof Error ? err.message : '未知错误'}`
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
  startLoadingTimer()

  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)

    const buffer = await response.arrayBuffer()
    fileSize.value = formatFileSize(buffer.byteLength)

    // Use Worker for large files
    const useWorker = isWorkerSupported && buffer.byteLength > WORKER_THRESHOLD
    isUsingWorker.value = useWorker
    const result = useWorker
      ? await parseWithWorker(buffer)
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
    const msg = err instanceof Error ? err.message : '未知错误'
    if (msg.includes('HTTP') || msg.includes('Failed to fetch')) {
      error.value = `❌ 无法从地址加载文件\n\n${msg}\n\n可能原因：\n• 地址不可达或已失效\n• 跨域限制（CORS）\n• 服务器返回了错误状态码`
    } else {
      error.value = `❌ 加载失败\n\n${msg}`
    }
  } finally {
    loading.value = false
    emit('loading', false)
    stopLoadingTimer()
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
    docProperties.value = result.document.properties || null
    docFlags.value = result.document.docFlags || null
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
    showCrossReferences.value = false
    // 缓存解析结果用于后续重新渲染（如切换隐藏文字显示）
    lastParseResult.value = {
      paragraphs: result.document.paragraphs as ParaWithList[],
      hyperlinks: result.document.hyperlinks,
      revisions: result.document.revisions,
    }
    htmlContent.value = formatFormattedTextToHtml(result.document.paragraphs, hyperlinks.value, revisions.value)
    stories.value = result.document.stories || null
    showStories.value = false
    images.value = result.document.images || []
    pictures.value = result.document.pictures || []
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
    htmlContent.value = formatTextWithInferredFormat(result.text)
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

function collectTableBlock(paragraphs: ParaWithList[], startIndex: number): { rows: string[][]; rowsTableInfo?: TableInfo[]; nextIndex: number } | null {
  const rows: string[][] = []
  const rowsTableInfo: TableInfo[] = []
  let hasTableInfo = false
  let i = startIndex

  while (i < paragraphs.length) {
    const para = paragraphs[i]
    const cells = splitTableCells(para.text.trim())
    if (!cells) break
    rows.push(cells)
    const tableInfo = (para.paraFormat as ParagraphFormat).table
    if (tableInfo) {
      hasTableInfo = true
      rowsTableInfo.push(tableInfo)
    } else {
      // Push a placeholder so indices align with rows[].
      rowsTableInfo.push({ inTable: true })
    }
    i++
  }

  if (rows.length < 2) return null
  return { rows, rowsTableInfo: hasTableInfo ? rowsTableInfo : undefined, nextIndex: i }
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
 */
function renderNestedList(
  listTag: 'ol' | 'ul',
  listStyle: string,
  items: Array<{ text: string; level: number; charFormat: CharacterFormat; paraFormat: ParagraphFormat }>,
  _startLevel: number,
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
  const render = (node: ListItemNode): string => {
    if (node.children.length === 0) return ''
    const renderedItems = node.children.map(child => {
      const content = renderParagraphHtml(child.text, child.charFormat, child.paraFormat, 0, child.text.length, [])
        .replace(/^<p[^>]*>/, '').replace(/<\/p>$/, '')
      const subList = render(child)
      return `<li>${content}${subList}</li>`
    })
    return `<${listTag} style="list-style:${listStyle};padding-left:2em">${renderedItems.join('')}</${listTag}>`
  }
  return render(root)
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

  const hasHtml = hasRevisionHtml || hasHyperlinkHtml

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

const formatFormattedTextToHtml = (paragraphs: ParaWithList[], hyperlinks?: HyperlinkRange[], revisions?: RevisionMark[]): string => {
  if (!paragraphs || paragraphs.length === 0) return '<p>文档内容为空</p>'

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

  const result: string[] = []
  const pageContent: string[] = []
  let currentPageHeight = 0
  const pageHeightPx = pageHeight.value * 1.333

  const finalizePage = () => {
    if (pageContent.length > 0) {
      result.push(`<div class="page-content">${pageContent.join('\n')}</div>`)
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

  while (i < paragraphs.length) {
    const para = paragraphs[i]
    const text = para.text
    if (!text || !text.trim()) { i++; continue }

    const paraFormat = para.paraFormat
    const listType = (paraFormat as any).listType
    const tableBlock = collectTableBlock(paragraphs, i)

    if (tableBlock) {
      const html = renderTableHtml(tableBlock.rows, tableBlock.rowsTableInfo)
      const estimatedHeight = 100
      addToPage(html, estimatedHeight)
      i = tableBlock.nextIndex
      continue
    }

    if (listType === 'ordered' || listType === 'unordered') {
      const listStyle = (paraFormat as any).listStyle || (listType === 'ordered' ? 'decimal' : 'disc')
      const startLevel = (paraFormat as any).listLevel ?? 0

      const items: Array<{ text: string; level: number; charFormat: CharacterFormat; paraFormat: ParagraphFormat }> = []
      let totalEstimatedHeight = 0
      while (i < paragraphs.length) {
        const item = paragraphs[i]
        const itemFormat = item.paraFormat as ParagraphFormat & { listType?: string }
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

      const listTag = listType === 'ordered' ? 'ol' : 'ul'
      const html = renderNestedList(listTag, listStyle, items, startLevel)
      addToPage(html, totalEstimatedHeight)
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
      i++
    }
  }

  finalizePage()

  return result.join('\n')
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
    nextTick(() => searchInputRef.value?.focus())
  } else {
    // Restore original HTML when closing search
    clearHighlights()
    if (originalHtml.value) {
      htmlContent.value = originalHtml.value
      originalHtml.value = ''
    }
  }
}

function toggleHiddenText() {
  showHiddenText.value = !showHiddenText.value
  // 重新渲染 HTML 以应用隐藏文字样式变化
  if (lastParseResult.value) {
    htmlContent.value = formatFormattedTextToHtml(
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
    htmlContent.value = formatFormattedTextToHtml(
      lastParseResult.value.paragraphs,
      lastParseResult.value.hyperlinks,
      lastParseResult.value.revisions
    )
  }
}

function performSearch() {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) {
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

  const treeWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)
  const matches: SearchMatch[] = []
  let index = 0

  while (treeWalker.nextNode()) {
    const node = treeWalker.currentNode as Text
    const text = node.textContent || ''
    const lower = text.toLowerCase()
    let pos = 0
    while ((pos = lower.indexOf(q, pos)) !== -1) {
      const span = document.createElement('span')
      span.className = 'search-highlight'
      span.textContent = text.substring(pos, pos + q.length)
      span.dataset.searchIndex = String(index)
      const range = document.createRange()
      range.setStart(node, pos)
      range.setEnd(node, pos + q.length)
      range.deleteContents()
      range.insertNode(span)
      matches.push({ index, text: q, element: span })
      index++
      pos += q.length
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
  window.print()
}

// ---- Download ----

// ---- Outline navigation ----

function scrollToOutline(item: OutlineItem) {
  showOutline.value = false
  // Find the nth paragraph element in the document
  const container = previewRef.value?.querySelector('.document-content')
  if (!container) return
  const paragraphs = container.querySelectorAll('p, h1, h2, h3, h4')
  const target = paragraphs[item.index]
  if (target) {
    target.scrollIntoView({ block: 'start', behavior: 'smooth' })
    target.classList.add('outline-highlight')
    setTimeout(() => target.classList.remove('outline-highlight'), 2000)
  }
}

async function copyText() {
  if (!plainText.value) return
  try {
    await navigator.clipboard.writeText(plainText.value)
  } catch {
    // Fallback
    const ta = document.createElement('textarea')
    ta.value = plainText.value
    ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
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

// ---- Keyboard shortcuts ----

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

  if (e.key === 'Escape' && showSearch.value) {
    toggleSearch()
    return
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
}

// ---- Watchers ----

watch(() => props.source, (newSource) => {
  if (newSource) {
    typeof newSource === 'string' ? loadFromUrl(newSource) : loadFromFile(newSource)
  }
})

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  if (props.source) {
    typeof props.source === 'string' ? loadFromUrl(props.source) : loadFromFile(props.source)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
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
    <div v-if="loading" class="loading-container">
      <div class="loading-spinner"></div>
      <p>正在解析文档...</p>
      <p class="loading-filename" v-if="fileName">{{ fileName }}</p>
      <p class="loading-meta">
        <span v-if="fileSize">大小: {{ fileSize }}</span>
        <span v-if="loadingTime > 2">已用: {{ loadingTime }}秒</span>
        <span v-if="isUsingWorker" class="worker-badge">⚡ 后台线程</span>
      </p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="error-container">
      <div class="error-icon">❌</div>
      <div class="error-message">{{ error }}</div>
    </div>

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
          <button class="toolbar-btn" @click="downloadText" title="下载为文本文件" aria-label="下载为文本文件">📥</button>

          <!-- Copy text -->
          <button class="toolbar-btn" @click="copyText" title="复制文本到剪贴板" aria-label="复制文本到剪贴板">📋</button>

          <span class="toolbar-sep" role="separator"></span>

          <!-- Outline TOC -->
          <button
            class="toolbar-btn"
            :class="{ active: showOutline }"
            :disabled="outline.length === 0"
            @click="showOutline = !showOutline"
            title="文档大纲"
            aria-label="文档大纲"
          >📑</button>

          <!-- Hidden text toggle -->
          <button
            class="toolbar-btn"
            :class="{ active: showHiddenText }"
            @click="toggleHiddenText"
            :title="showHiddenText ? '隐藏文字：显示中' : '隐藏文字：已隐藏'"
            aria-label="切换隐藏文字显示"
          >👁️</button>
        </div>

        <div class="toolbar-right">
          <span class="doc-stats" v-if="wordCount > 0">
            {{ wordCount }} 词 · {{ paragraphCount }} 段 · {{ charCount }} 字
          </span>

          <span class="toolbar-sep" role="separator"></span>

          <!-- Pagination controls -->
          <div class="pagination-controls">
            <button
              class="pagination-btn"
              @click="goToPrevPage"
              :disabled="currentPage <= 1"
              title="上一页"
              aria-label="上一页"
            >◀</button>
            <span class="pagination-info">
              {{ currentPage }} / {{ totalPages }}
            </span>
            <button
              class="pagination-btn"
              @click="goToNextPage"
              :disabled="currentPage >= totalPages"
              title="下一页"
              aria-label="下一页"
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
          placeholder="搜索文档内容..."
          @input="performSearch"
          @keyup.enter="nextMatch"
        />
        <span class="search-status">{{ searchStatusLabel }}</span>
        <button class="toolbar-btn" @click="prevMatch" :disabled="searchResults.length === 0" title="上一个">▲</button>
        <button class="toolbar-btn" @click="nextMatch" :disabled="searchResults.length === 0" title="下一个">▼</button>
        <button class="toolbar-btn" @click="toggleSearch" title="关闭搜索">✕</button>
      </div>

      <!-- Document info -->
      <div class="doc-info">
        <span class="doc-name">{{ fileName }}</span>
        <span class="doc-status">✓ 解析成功</span>
      </div>

      <!-- Document outline sidebar -->
      <div v-if="showOutline && outline.length > 0" class="outline-sidebar">
        <div class="outline-header">文档大纲</div>
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
        <div
          class="document-content"
          v-html="htmlContent"
        ></div>
      </div>

      <!-- Stories panel (headers / footnotes / endnotes / comments / textboxes) -->
      <div v-if="storySections.length > 0" class="stories-panel">
        <button
          class="stories-toggle"
          @click="showStories = !showStories"
          :aria-expanded="showStories"
        >
          <span class="stories-toggle-icon">{{ showStories ? '▾' : '▸' }}</span>
          <span>非正文内容（{{ storySections.length }}）</span>
          <span class="stories-toggle-summary">
            {{ storySections.map((s: StorySection) => s.label).join(' · ') }}
          </span>
        </button>
        <div v-if="showStories" class="stories-content">
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
        </div>
      </div>

      <!-- Document properties (title / author / keywords etc.) -->
      <div v-if="docProperties" class="properties-panel">
        <button
          class="stories-toggle"
          @click="showProperties = !showProperties"
          :aria-expanded="showProperties"
        >
          <span class="stories-toggle-icon">{{ showProperties ? '▾' : '▸' }}</span>
          <span>文档属性</span>
          <span class="stories-toggle-summary">
            {{ docProperties.title || docProperties.author || '查看详情' }}
          </span>
        </button>
        <div v-if="showProperties" class="properties-content">
          <div v-if="docProperties.title" class="property-item">
            <span class="property-label">标题:</span>
            <span class="property-value">{{ docProperties.title }}</span>
          </div>
          <div v-if="docProperties.subject" class="property-item">
            <span class="property-label">主题:</span>
            <span class="property-value">{{ docProperties.subject }}</span>
          </div>
          <div v-if="docProperties.author" class="property-item">
            <span class="property-label">作者:</span>
            <span class="property-value">{{ docProperties.author }}</span>
          </div>
          <div v-if="docProperties.lastAuthor" class="property-item">
            <span class="property-label">最后修改者:</span>
            <span class="property-value">{{ docProperties.lastAuthor }}</span>
          </div>
          <div v-if="docProperties.keywords" class="property-item">
            <span class="property-label">关键词:</span>
            <span class="property-value">{{ docProperties.keywords }}</span>
          </div>
          <div v-if="docProperties.comments" class="property-item">
            <span class="property-label">备注:</span>
            <span class="property-value">{{ docProperties.comments }}</span>
          </div>
          <div v-if="docProperties.pageCount" class="property-item">
            <span class="property-label">页数:</span>
            <span class="property-value">{{ docProperties.pageCount }}</span>
          </div>
          <div v-if="docProperties.wordCount" class="property-item">
            <span class="property-label">字数:</span>
            <span class="property-value">{{ docProperties.wordCount }}</span>
          </div>
          <div v-if="docProperties.charCount" class="property-item">
            <span class="property-label">字符数:</span>
            <span class="property-value">{{ docProperties.charCount }}</span>
          </div>
          <div v-if="docProperties.category" class="property-item">
            <span class="property-label">类别:</span>
            <span class="property-value">{{ docProperties.category }}</span>
          </div>
          <div v-if="docProperties.company" class="property-item">
            <span class="property-label">公司:</span>
            <span class="property-value">{{ docProperties.company }}</span>
          </div>
          <div v-if="docProperties.manager" class="property-item">
            <span class="property-label">经理:</span>
            <span class="property-value">{{ docProperties.manager }}</span>
          </div>
          <div v-if="docProperties.template" class="property-item">
            <span class="property-label">模板:</span>
            <span class="property-value">{{ docProperties.template }}</span>
          </div>
          <div v-if="docProperties.appName" class="property-item">
            <span class="property-label">应用程序:</span>
            <span class="property-value">{{ docProperties.appName }}</span>
          </div>
          <div v-if="docProperties.revisionNumber" class="property-item">
            <span class="property-label">修订号:</span>
            <span class="property-value">{{ docProperties.revisionNumber }}</span>
          </div>
          <div v-if="docProperties.lineCount" class="property-item">
            <span class="property-label">行数:</span>
            <span class="property-value">{{ docProperties.lineCount }}</span>
          </div>
          <div v-if="docProperties.paragraphCount" class="property-item">
            <span class="property-label">段落数:</span>
            <span class="property-value">{{ docProperties.paragraphCount }}</span>
          </div>
          <div v-if="docProperties.charCountWithSpaces" class="property-item">
            <span class="property-label">字符数(含空格):</span>
            <span class="property-value">{{ docProperties.charCountWithSpaces }}</span>
          </div>
        </div>
      </div>

      <!-- Document fields (from PlcfFld - AUTHOR/TITLE/DATE etc.) -->
      <div v-if="docFields" class="properties-panel">
        <button
          class="stories-toggle"
          @click="showProperties = !showProperties"
          :aria-expanded="showProperties"
        >
          <span class="stories-toggle-icon">{{ showProperties ? '▾' : '▸' }}</span>
          <span>文档域</span>
          <span class="stories-toggle-summary">
            {{ docFields.title || docFields.author || '查看详情' }}
          </span>
        </button>
        <div v-if="showProperties" class="properties-content">
          <div v-if="docFields.title" class="property-item">
            <span class="property-label">标题:</span>
            <span class="property-value">{{ docFields.title }}</span>
          </div>
          <div v-if="docFields.author" class="property-item">
            <span class="property-label">作者:</span>
            <span class="property-value">{{ docFields.author }}</span>
          </div>
          <div v-if="docFields.subject" class="property-item">
            <span class="property-label">主题:</span>
            <span class="property-value">{{ docFields.subject }}</span>
          </div>
          <div v-if="docFields.keywords" class="property-item">
            <span class="property-label">关键词:</span>
            <span class="property-value">{{ docFields.keywords }}</span>
          </div>
          <div v-if="docFields.comments" class="property-item">
            <span class="property-label">备注:</span>
            <span class="property-value">{{ docFields.comments }}</span>
          </div>
          <div v-if="docFields.lastSavedBy" class="property-item">
            <span class="property-label">最后保存者:</span>
            <span class="property-value">{{ docFields.lastSavedBy }}</span>
          </div>
          <div v-if="docFields.createDate" class="property-item">
            <span class="property-label">创建日期:</span>
            <span class="property-value">{{ docFields.createDate }}</span>
          </div>
          <div v-if="docFields.lastSavedDate" class="property-item">
            <span class="property-label">最后保存日期:</span>
            <span class="property-value">{{ docFields.lastSavedDate }}</span>
          </div>
          <div v-if="docFields.printDate" class="property-item">
            <span class="property-label">打印日期:</span>
            <span class="property-value">{{ docFields.printDate }}</span>
          </div>
          <div v-if="docFields.date" class="property-item">
            <span class="property-label">日期:</span>
            <span class="property-value">{{ docFields.date }}</span>
          </div>
          <div v-if="docFields.time" class="property-item">
            <span class="property-label">时间:</span>
            <span class="property-value">{{ docFields.time }}</span>
          </div>
          <div v-if="docFields.revisionNumber" class="property-item">
            <span class="property-label">修订号:</span>
            <span class="property-value">{{ docFields.revisionNumber }}</span>
          </div>
        </div>
      </div>

      <!-- Document flags from DOP (facing pages / title page / track changes etc.) -->
      <div v-if="docFlagItems.length > 0" class="doc-flags-panel">
        <button
          class="stories-toggle"
          @click="showDocFlags = !showDocFlags"
          :aria-expanded="showDocFlags"
        >
          <span class="stories-toggle-icon">{{ showDocFlags ? '▾' : '▸' }}</span>
          <span>文档标志</span>
          <span class="stories-toggle-summary">{{ docFlagItems.length }} 项</span>
        </button>
        <div v-if="showDocFlags" class="doc-flags-content">
          <div
            v-for="(item, index) in docFlagItems"
            :key="index"
            class="flag-item"
          >
            <span class="flag-badge">{{ item.label }}</span>
            <span class="flag-description">{{ item.description }}</span>
          </div>
        </div>
      </div>

      <!-- Table of Contents -->
      <div v-if="toc.length > 0" class="toc-panel">
        <button
          class="stories-toggle"
          @click="showToc = !showToc"
          :aria-expanded="showToc"
        >
          <span class="stories-toggle-icon">{{ showToc ? '▾' : '▸' }}</span>
          <span>目录（{{ toc.length }}）</span>
        </button>
        <div v-if="showToc" class="toc-content">
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
      </div>

      <!-- Revision marks (track changes: insert / delete) -->
      <div v-if="revisions.length > 0" class="revisions-panel">
        <button
          class="stories-toggle"
          @click="showRevisions = !showRevisions"
          :aria-expanded="showRevisions"
        >
          <span class="stories-toggle-icon">{{ showRevisions ? '▾' : '▸' }}</span>
          <span>修订记录（{{ revisions.length }}）</span>
          <span class="stories-toggle-summary">
            {{ revisionItems.length }} 批次
          </span>
        </button>
        <div v-if="showRevisions" class="revisions-content">
          <div class="revision-mode-toolbar" role="group" aria-label="修订显示模式">
            <button
              class="revision-mode-btn"
              :class="{ active: revisionMode === 'marks' }"
              :aria-pressed="revisionMode === 'marks'"
              @click="setRevisionMode('marks')"
              title="显示 <ins>/<del> 修订标记"
            >显示标记</button>
            <button
              class="revision-mode-btn"
              :class="{ active: revisionMode === 'accepted' }"
              :aria-pressed="revisionMode === 'accepted'"
              @click="setRevisionMode('accepted')"
              title="接受全部修订：保留插入文本，移除删除文本"
            >接受全部</button>
            <button
              class="revision-mode-btn"
              :class="{ active: revisionMode === 'rejected' }"
              :aria-pressed="revisionMode === 'rejected'"
              @click="setRevisionMode('rejected')"
              title="拒绝全部修订：移除插入文本，保留删除文本"
            >拒绝全部</button>
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
            <span class="revision-count">{{ item.count }} 处</span>
          </div>
        </div>
      </div>

      <!-- Bookmarks (named ranges from PlcfBkf/PlcfBkl/SttbfBkmk) -->
      <div v-if="bookmarks.length > 0" class="bookmarks-panel">
        <button
          class="stories-toggle"
          @click="showBookmarks = !showBookmarks"
          :aria-expanded="showBookmarks"
        >
          <span class="stories-toggle-icon">{{ showBookmarks ? '▾' : '▸' }}</span>
          <span>书签（{{ bookmarks.length }}）</span>
          <span class="stories-toggle-summary">命名范围</span>
        </button>
        <div v-if="showBookmarks" class="bookmarks-content">
          <div
            v-for="(bm, idx) in bookmarks"
            :key="idx"
            class="bookmark-item"
          >
            <span class="bookmark-name">{{ bm.name }}</span>
            <span class="bookmark-range">CP: {{ bm.cpStart }} – {{ bm.cpEnd }}</span>
          </div>
        </div>
      </div>

      <!-- Sections (page layout from PlcfSed/SEPX) -->
      <div v-if="sections.length > 0" class="sections-panel">
        <button
          class="stories-toggle"
          @click="showSections = !showSections"
          :aria-expanded="showSections"
        >
          <span class="stories-toggle-icon">{{ showSections ? '▾' : '▸' }}</span>
          <span>分节与页面布局（{{ sections.length }}）</span>
          <span class="stories-toggle-summary">纸张 / 边距 / 方向 / 分栏</span>
        </button>
        <div v-if="showSections" class="sections-content">
          <div
            v-for="(sec, idx) in sections"
            :key="idx"
            class="section-item"
          >
            <div class="section-header">
              <span class="section-index">节 {{ sec.index + 1 }}</span>
              <span v-if="sec.breakType" class="section-break">
                {{ BREAK_TYPE_LABEL[sec.breakType] || sec.breakType }}
              </span>
              <span v-if="sec.orientation" class="section-orientation">
                {{ sec.orientation === 'landscape' ? '横向' : '纵向' }}
              </span>
            </div>
            <div class="section-grid">
              <div v-if="sec.pageWidthPt && sec.pageHeightPt" class="section-field">
                <span class="section-field-label">页面尺寸</span>
                <span class="section-field-value">
                  {{ formatSizePt(sec.pageWidthPt) }} × {{ formatSizePt(sec.pageHeightPt) }}
                </span>
              </div>
              <div v-if="sec.marginLeftPt" class="section-field">
                <span class="section-field-label">左边距</span>
                <span class="section-field-value">{{ formatSizePt(sec.marginLeftPt) }}</span>
              </div>
              <div v-if="sec.marginRightPt" class="section-field">
                <span class="section-field-label">右边距</span>
                <span class="section-field-value">{{ formatSizePt(sec.marginRightPt) }}</span>
              </div>
              <div v-if="sec.marginTopPt" class="section-field">
                <span class="section-field-label">上边距</span>
                <span class="section-field-value">{{ formatSizePt(sec.marginTopPt) }}</span>
              </div>
              <div v-if="sec.marginBottomPt" class="section-field">
                <span class="section-field-label">下边距</span>
                <span class="section-field-value">{{ formatSizePt(sec.marginBottomPt) }}</span>
              </div>
              <div v-if="sec.gutterPt" class="section-field">
                <span class="section-field-label">装订线</span>
                <span class="section-field-value">{{ formatSizePt(sec.gutterPt) }}</span>
              </div>
              <div v-if="sec.columnCount && sec.columnCount > 1" class="section-field">
                <span class="section-field-label">分栏</span>
                <span class="section-field-value">
                  {{ sec.columnCount }} 栏
                  <span v-if="sec.columnSpacingPt">（间距 {{ formatSizePt(sec.columnSpacingPt) }}）</span>
                </span>
              </div>
              <div v-if="sec.pageStart !== undefined" class="section-field">
                <span class="section-field-label">起始页码</span>
                <span class="section-field-value">{{ sec.pageStart }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Page fields (PAGE / NUMPAGES / SECTION / SECTIONPAGES) -->
      <div v-if="pageFields.length > 0" class="page-fields-panel">
        <button
          class="stories-toggle"
          @click="showPageFields = !showPageFields"
          :aria-expanded="showPageFields"
        >
          <span class="stories-toggle-icon">{{ showPageFields ? '▾' : '▸' }}</span>
          <span>页码域（{{ pageFields.length }}）</span>
          <span class="stories-toggle-summary">PAGE / NUMPAGES</span>
        </button>
        <div v-if="showPageFields" class="page-fields-content">
          <div
            v-for="(pf, idx) in pageFields"
            :key="idx"
            class="page-field-item"
          >
            <div class="page-field-header">
              <span class="page-field-type">
                {{ PAGE_FIELD_TYPE_LABEL[pf.type] || pf.type }}
              </span>
              <span v-if="pf.result" class="page-field-result">值：{{ pf.result }}</span>
            </div>
            <div class="page-field-instruction">指令：{{ pf.instruction }}</div>
            <div class="page-field-cp">CP: {{ pf.cpStart }} – {{ pf.cpEnd }}</div>
          </div>
        </div>
      </div>

      <!-- Cross-references (REF / NOTEREF) -->
      <div v-if="crossReferences.length > 0" class="cross-refs-panel">
        <button
          class="stories-toggle"
          @click="showCrossReferences = !showCrossReferences"
          :aria-expanded="showCrossReferences"
        >
          <span class="stories-toggle-icon">{{ showCrossReferences ? '▾' : '▸' }}</span>
          <span>交叉引用（{{ crossReferences.length }}）</span>
          <span class="stories-toggle-summary">REF / NOTEREF</span>
        </button>
        <div v-if="showCrossReferences" class="cross-refs-content">
          <div
            v-for="(cr, idx) in crossReferences"
            :key="idx"
            class="cross-ref-item"
          >
            <div class="cross-ref-header">
              <span class="cross-ref-type">
                {{ CROSS_REF_TYPE_LABEL[cr.type] || cr.type }}
              </span>
              <span v-if="cr.result" class="cross-ref-result">显示：{{ cr.result }}</span>
            </div>
            <div class="cross-ref-target">
              目标书签：<code>{{ cr.targetBookmarkName }}</code>
            </div>
            <div class="cross-ref-instruction">指令：{{ cr.instruction }}</div>
            <div v-if="cr.switches.length > 0" class="cross-ref-switches">
              开关：
              <span
                v-for="sw in cr.switches"
                :key="sw"
                class="cross-ref-switch"
                :title="CROSS_REF_SWITCH_LABEL[sw]"
              >{{ sw }}{{ CROSS_REF_SWITCH_LABEL[sw] ? ` (${CROSS_REF_SWITCH_LABEL[sw]})` : '' }}</span>
            </div>
            <div class="cross-ref-cp">CP: {{ cr.cpStart }} – {{ cr.cpEnd }}</div>
          </div>
        </div>
      </div>

      <!-- Shapes (Office Art Drawing Container - floating images with anchors) -->
      <div v-if="shapes.length > 0" class="shapes-panel">
        <button
          class="stories-toggle"
          @click="showShapes = !showShapes"
          :aria-expanded="showShapes"
        >
          <span class="stories-toggle-icon">{{ showShapes ? '▾' : '▸' }}</span>
          <span>形状与图片锚点（{{ shapes.length }}）</span>
          <span class="stories-toggle-summary">浮动图片定位</span>
        </button>
        <div v-if="showShapes" class="shapes-content">
          <div
            v-for="(shape, idx) in shapes"
            :key="idx"
            class="shape-item"
          >
            <div class="shape-header">
              <span class="shape-type">{{ SHAPE_TYPE_LABEL[shape.type] || shape.type }}</span>
              <span v-if="shape.floating" class="shape-floating">浮动</span>
              <span v-if="shape.hasPicture" class="shape-picture">含图片</span>
            </div>
            <div class="shape-spid">形状 ID: {{ shape.spid }}</div>
            <div v-if="shape.x !== undefined && shape.y !== undefined" class="shape-position">
              位置: ({{ shape.x }}, {{ shape.y }}) twips
            </div>
            <div v-if="shape.width !== undefined && shape.height !== undefined" class="shape-size">
              尺寸: {{ shape.width }} × {{ shape.height }} twips
            </div>
            <div class="shape-anchor">
              锚点类型: {{ SHAPE_ANCHOR_LABEL[shape.anchorType] || shape.anchorType }}
              <span v-if="shape.anchorCp !== undefined"> (CP: {{ shape.anchorCp }})</span>
            </div>
            <div v-if="shape.fcPic !== undefined" class="shape-fcpic">
              图片偏移 (fcPic): {{ shape.fcPic }}
            </div>
            <div v-if="shape.name" class="shape-name">名称: {{ shape.name }}</div>
            <div v-if="shape.groupId !== undefined" class="shape-group">
              组合 ID: {{ shape.groupId }}
            </div>
          </div>
        </div>
      </div>

      <!-- Equations (Equation Editor OLE objects) -->
      <div v-if="equations.length > 0" class="equations-panel">
        <button
          class="stories-toggle"
          @click="showEquations = !showEquations"
          :aria-expanded="showEquations"
        >
          <span class="stories-toggle-icon">{{ showEquations ? '▾' : '▸' }}</span>
          <span>公式（{{ equations.length }}）</span>
          <span class="stories-toggle-summary">Equation Editor 公式</span>
        </button>
        <div v-if="showEquations" class="equations-content">
          <div
            v-for="(eq, idx) in equations"
            :key="idx"
            class="equation-item"
          >
            <div class="equation-header">
              <span class="equation-id">公式 {{ eq.id }}</span>
              <span v-if="eq.hasPicture" class="equation-has-picture">含图片</span>
            </div>
            <div v-if="eq.latex" class="equation-latex">
              <span class="equation-label">LaTeX:</span>
              <span class="equation-code">{{ eq.latex }}</span>
            </div>
            <div v-if="eq.eqnText" class="equation-eqntext">
              <span class="equation-label">原始:</span>
              <span class="equation-code">{{ eq.eqnText }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Charts (MSGraph/Excel/SmartArt OLE objects) -->
      <div v-if="charts.length > 0" class="charts-panel">
        <button
          class="stories-toggle"
          @click="showCharts = !showCharts"
          :aria-expanded="showCharts"
        >
          <span class="stories-toggle-icon">{{ showCharts ? '▾' : '▸' }}</span>
          <span>图表（{{ charts.length }}）</span>
          <span class="stories-toggle-summary">MSGraph/Excel/SmartArt 对象</span>
        </button>
        <div v-if="showCharts" class="charts-content">
          <div
            v-for="(chart, idx) in charts"
            :key="idx"
            class="chart-item"
          >
            <div class="chart-header">
              <span class="chart-id">图表 {{ chart.id }}</span>
              <span class="chart-type">{{ getChartTypeLabel(chart.type) }}</span>
              <span v-if="chart.hasPicture" class="chart-has-picture">含图片</span>
              <span v-if="chart.hasData" class="chart-has-data">含数据</span>
            </div>
            <div class="chart-name">
              <span class="chart-label">名称:</span>
              <span class="chart-value">{{ chart.name }}</span>
            </div>
            <div v-if="chart.subtype && chart.subtype !== 'unknown'" class="chart-subtype">
              <span class="chart-label">子类型:</span>
              <span class="chart-value">{{ getChartSubtypeLabel(chart.subtype) }}</span>
            </div>
            <div v-if="chart.dataSize" class="chart-datasize">
              <span class="chart-label">数据大小:</span>
              <span class="chart-value">{{ formatFileSize(chart.dataSize) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- WordArt (Office Art Drawing WordArt objects) -->
      <div v-if="wordArts.length > 0" class="wordart-panel">
        <button
          class="stories-toggle"
          @click="showWordArts = !showWordArts"
          :aria-expanded="showWordArts"
        >
          <span class="stories-toggle-icon">{{ showWordArts ? '▾' : '▸' }}</span>
          <span>艺术字（{{ wordArts.length }}）</span>
          <span class="stories-toggle-summary">Office Art WordArt 对象</span>
        </button>
        <div v-if="showWordArts" class="wordart-content">
          <div
            v-for="(wa, idx) in wordArts"
            :key="idx"
            class="wordart-item"
          >
            <div class="wordart-header">
              <span class="wordart-id">艺术字 {{ wa.id }}</span>
              <span v-for="(effect, eIdx) in wa.effects" :key="eIdx" class="wordart-effect">
                {{ getWordArtEffectLabel(effect) }}
              </span>
            </div>
            <div v-if="wa.text" class="wordart-text">
              <span class="wordart-label">文本:</span>
              <span class="wordart-value">{{ wa.text }}</span>
            </div>
            <div class="wordart-name">
              <span class="wordart-label">名称:</span>
              <span class="wordart-value">{{ wa.name }}</span>
            </div>
            <div v-if="wa.colors && wa.colors.length > 0" class="wordart-colors">
              <span class="wordart-label">颜色:</span>
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
      </div>

      <!-- Embedded images extracted from the Data stream -->
      <div v-if="pictures.length > 0 || images.length > 0" class="images-panel">
        <button
          class="stories-toggle"
          @click="showImages = !showImages"
          :aria-expanded="showImages"
        >
          <span class="stories-toggle-icon">{{ showImages ? '▾' : '▸' }}</span>
          <span>文档图片（{{ pictures.length > 0 ? pictures.length : images.length }}）</span>
          <span class="stories-toggle-summary">点击展开查看嵌入图片</span>
        </button>
        <div v-if="showImages" class="images-content">
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
              <img :src="src" :alt="`图片 ${idx + 1}`" loading="lazy" />
            </div>
          </template>
        </div>
      </div>
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

.properties-content {
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

.revisions-content {
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
@media (max-width: 768px) {
  .paper-page {
    padding: 28px 20px;
    margin: 12px auto;
  }

  .doc-info {
    padding: 8px 14px;
  }

  .toolbar {
    padding: 6px 10px;
  }

  .toolbar-right .doc-stats {
    font-size: 0.7rem;
  }
}

@media (max-width: 640px) {
  .doc-preview {
    min-height: 300px;
  }

  .paper-page {
    padding: 20px 14px;
    margin: 8px auto;
  }

  .loading-container,
  .error-container {
    padding: 60px 20px;
  }

  .doc-stats {
    display: none;
  }
}
</style>
