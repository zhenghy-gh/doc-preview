<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, onErrorCaptured, nextTick } from 'vue'
import { parseDocFileWithFormat, parseDocFileFromBuffer } from '../utils/docParser'
import { parseWithWorker } from '../utils/parseWithWorker'
import type { CharacterFormat, ParagraphFormat, CharStyleSegment } from '../utils/docFormat'

const WORKER_THRESHOLD = 1024 * 1024 // 1MB — files larger than this use Web Worker
const isWorkerSupported = typeof Worker !== 'undefined'
const isUsingWorker = ref(false)

// ---- Types ----

interface ParserOutput {
  success: boolean
  document?: { paragraphs: FormattedParagraphOutput[] }
  text?: string
  error?: string
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

// --- Outline / TOC ---
const outline = ref<OutlineItem[]>([])
const showOutline = ref(false)
const previewRef = ref<HTMLElement | null>(null)

// --- Zoom ---
const zoomLevel = ref(100)
const MIN_ZOOM = 50
const MAX_ZOOM = 200
const ZOOM_STEP = 10

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
    if (fontSize >= 32) level = 1
    else if (fontSize >= 22) level = 2
    else if (fontSize >= 18 && isBold) level = 2
    else if (isBold && text.length <= 40 && fontSize >= 16) level = 3
    else if (align === 'center' && text.length <= 30) level = 3

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
    htmlContent.value = formatFormattedTextToHtml(result.document.paragraphs)
  } else if (result.text) {
    isRichFormat.value = false
    plainText.value = result.text
    computeStats(result.text)
    htmlContent.value = formatTextWithInferredFormat(result.text)
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

interface ParaWithList {
  text: string
  charFormat: CharacterFormat
  paraFormat: ParagraphFormat & { listType?: string; listStyle?: string }
}

function extractListItemText(text: string, listType: string): string {
  if (listType === 'ordered') {
    return text.replace(/^[a-zA-Z0-9]+[\.\)]\s*/, '')
  }
  return text.replace(/^[•\-\*○●▪▸►→]\s*/, '')
}

const formatFormattedTextToHtml = (paragraphs: ParaWithList[]): string => {
  if (!paragraphs || paragraphs.length === 0) return '<p>文档内容为空</p>'

  const result: string[] = []
  let i = 0

  while (i < paragraphs.length) {
    const para = paragraphs[i]
    const text = para.text
    if (!text || !text.trim()) { i++; continue }

    const paraFormat = para.paraFormat
    const listType = (paraFormat as any).listType

    if (listType === 'ordered' || listType === 'unordered') {
      // Collect consecutive list items
      const listTag = listType === 'ordered' ? 'ol' : 'ul'
      const items: string[] = []
      const listStyle = (paraFormat as any).listStyle || (listType === 'ordered' ? 'decimal' : 'disc')

      while (i < paragraphs.length) {
        const item = paragraphs[i]
        const itemFormat = item.paraFormat
        if ((itemFormat as any).listType !== listType) break

        const itemText = extractListItemText(item.text, listType)
        if (!itemText.trim()) { i++; continue }

        const charFormat = item.charFormat || {} as CharacterFormat
        const textAlign = getTextAlignment(itemFormat, charFormat)
        const isCentered = textAlign === 'center'
        const isRightAligned = textAlign === 'right'
        const hasCharStyles = charFormat.styles && charFormat.styles.length > 0

        let content: string
        if (hasCharStyles) {
          content = formatTextWithCharacterStyles(itemText, charFormat.styles!, {
            isCentered, isRightAligned, charFormat: { ...charFormat }, paraFormat: { ...itemFormat }
          }).replace(/^<p[^>]*>/, '').replace(/<\/p>$/, '')
        } else {
          content = formatTextWithDefaultStyles(itemText, charFormat, itemFormat, { isCentered, isRightAligned })
            .replace(/^<p[^>]*>/, '').replace(/<\/p>$/, '')
        }
        items.push(`<li>${content}</li>`)
        i++
      }

      result.push(`<${listTag} style="list-style:${listStyle};padding-left:2em">${items.join('')}</${listTag}>`)
    } else {
      // Regular paragraph
      const charFormat = para.charFormat || {} as CharacterFormat
      const textAlign = getTextAlignment(paraFormat, charFormat)
      const isCentered = textAlign === 'center'
      const isRightAligned = textAlign === 'right'
      const hasCharStyles = charFormat.styles && charFormat.styles.length > 0

      if (hasCharStyles) {
        result.push(formatTextWithCharacterStyles(text, charFormat.styles!, {
          isCentered, isRightAligned, charFormat: { ...charFormat }, paraFormat: { ...paraFormat }
        }))
      } else {
        result.push(formatTextWithDefaultStyles(text, charFormat, paraFormat, { isCentered, isRightAligned }))
      }
      i++
    }
  }

  return result.join('\n')
}

const formatTextWithCharacterStyles = (
  text: string, charStyles: CharStyleSegment[], options: CharStyleOptions
): string => {
  const { isCentered, charFormat, paraFormat } = options
  const isRightAligned = paraFormat.alignment === 'right'
  const fontSize = resolveFontSize(charFormat.fontSize, '1.0rem')
  const textAlign = isCentered ? 'center' : isRightAligned ? 'right' : 'justify'
  const fontWeight = charFormat.bold ? 'bold' : 'normal'

  let totalLength = 0
  for (const s of charStyles) totalLength += (s.end - s.start)
  if (totalLength < text.length * 0.8) {
    return formatTextWithDefaultStyles(text, charFormat, {} as ParagraphFormat, { isCentered, isRightAligned })
  }

  let htmlContent = ''
  let lastEnd = 0
  for (const style of charStyles) {
    if (style.start > lastEnd) {
      const gap = text.substring(lastEnd, style.start)
      if (gap) htmlContent += escapeHtml(gap)
    }
    const segment = text.substring(style.start, style.end)
    if (!segment) continue

    const css: string[] = []
    css.push(`font-family: '${style.style.fontName || '宋体'}', serif`)
    css.push(`font-size: ${fontSize}`)
    css.push(`font-weight: ${fontWeight}`)
    if (style.style.underline) css.push('text-decoration: underline')
    htmlContent += `<span style="${css.join('; ')}">${escapeHtml(segment)}</span>`
    lastEnd = style.end
  }
  if (lastEnd < text.length) {
    const rem = text.substring(lastEnd)
    if (rem) htmlContent += escapeHtml(rem)
  }
  return `<p style="font-size:${fontSize};text-align:${textAlign}">${htmlContent}</p>`
}

const formatTextWithDefaultStyles = (
  text: string, charFormat: CharacterFormat, _paraFormat: ParagraphFormat,
  options: { isCentered: boolean; isRightAligned: boolean }
): string => {
  const { isCentered, isRightAligned } = options
  const css: string[] = []
  css.push(`font-family: '${charFormat.fontName || '宋体'}', 'SimSun', serif`)
  css.push(`font-size: ${resolveFontSize(charFormat.fontSize, '1.0rem')}`)
  if (charFormat.bold) css.push('font-weight: bold')
  if (charFormat.italic) css.push('font-style: italic')
  if (charFormat.underline) css.push('text-decoration: underline')
  if (charFormat.color) css.push(`color: ${charFormat.color}`)
  css.push(`text-align: ${isCentered ? 'center' : isRightAligned ? 'right' : 'justify'}`)
  return `<p style="${css.join('; ')}">${escapeHtml(text)}</p>`
}

const formatTextWithInferredFormat = (text: string): string => {
  const paragraphs = text.split(/\n+/).filter(p => p.trim())
  if (paragraphs.length === 0) return `<p style="font-family:'宋体',serif;font-size:1.0rem">${escapeHtml(text)}</p>`

  let html = ''
  for (const para of paragraphs) {
    const t = para.trim()
    if (!t) continue
    const chineseRatio = (t.match(/[\u4e00-\u9fff]/g) || []).length / t.length
    if (t.length < 20 && chineseRatio > 0.5) {
      html += `<h1 style="font-family:'宋体',serif;font-size:1.375rem;font-weight:bold;text-align:center">${escapeHtml(t)}</h1>`
    } else {
      html += `<p style="font-family:'宋体','SimSun',serif;font-size:1.0rem;text-align:justify">${escapeHtml(t)}</p>`
    }
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
        </div>

        <div class="toolbar-right">
          <span class="doc-stats" v-if="wordCount > 0">
            {{ wordCount }} 词 · {{ paragraphCount }} 段 · {{ charCount }} 字
          </span>
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
