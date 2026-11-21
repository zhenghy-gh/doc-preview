/**
 * useDocViewport —— 分页导航 + 虚拟滚动状态机（从 DocPreview.vue 抽离）。
 *
 * 不持有 source/解析状态，只消费调用方注入的 pages/sections/previewRef/zoomLevel，
 * 返回页码、可视窗口、高度缓存与导航方法。所有 ref 仍为调用方传入的同一对象，
 * 因此与搜索（临时关闭虚拟滚动）、缩放、重渲染的联动语义原样保留。
 */
import { nextTick, ref, watch, type Ref } from 'vue'
import type { SectionInfo } from '../utils/docFormat'
import { PT_TO_PX } from '../utils/rendering/pageBuilder'

const VIRTUAL_BUFFER = 1 // 上下各缓冲的页面数
const PAGE_HEIGHT_A4 = 842

export interface DocViewportOptions {
  pages: Ref<string[]>
  sections: Ref<SectionInfo[]>
  previewRef: Ref<HTMLElement | null>
  zoomLevel: Ref<number>
}

export function useDocViewport(options: DocViewportOptions) {
  const { pages, sections, previewRef, zoomLevel } = options

  const currentPage = ref(1)
  const totalPages = ref(1)
  const pageHeight = ref(PAGE_HEIGHT_A4)
  const virtualScrollEnabled = ref(true)
  const visibleStart = ref(0)
  const visibleEnd = ref(0)
  const pageHeights = ref<Record<number, number>>({})
  let scrollTicking = false

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

  function scrollToPage(page: number) {
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
      // 虚拟滚动下 DOM 只渲染窗口内的 .page-content，NodeList 是稀疏的：
      // 两种页容器都带 data-page-idx（绝对页码），据此精确定位，避免下标错位。
      const target =
        container.querySelector<HTMLElement>(`.page-host[data-page-idx="${idx}"] .page-content`) ??
        container.querySelector<HTMLElement>(`.page-placeholder[data-page-idx="${idx}"]`)
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  }

  function goToPage(page: number) {
    if (page < 1 || page > totalPages.value) return
    currentPage.value = page
    scrollToPage(page)
  }
  function goToPrevPage() {
    if (currentPage.value > 1) goToPage(currentPage.value - 1)
  }
  function goToNextPage() {
    if (currentPage.value < totalPages.value) goToPage(currentPage.value + 1)
  }

  function updateTotalPages() {
    nextTick(() => {
      totalPages.value = pages.value.length || 1
      if (currentPage.value > totalPages.value) currentPage.value = totalPages.value
    })
  }

  /** 重置高度缓存与可视窗口（totalHint 为已知页数，用于设定初始 visibleEnd）。 */
  function resetViewport(totalHint = 0) {
    pageHeights.value = {}
    visibleStart.value = 0
    visibleEnd.value = Math.min(totalHint, VIRTUAL_BUFFER * 2 + 1)
  }

  function getPagePlaceholderHeight(idx: number): number {
    const cached = pageHeights.value[idx]
    if (cached && cached > 0) return cached
    return Math.max(400, pageHeight.value * PT_TO_PX)
  }

  function isPageVisible(idx: number): boolean {
    if (!virtualScrollEnabled.value) return true
    if (pages.value.length <= VIRTUAL_BUFFER * 2 + 1) return true
    return idx >= visibleStart.value && idx <= visibleEnd.value
  }

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
      const el = (host.querySelector('.page-content') as HTMLElement | null) ?? host
      const height = el.getBoundingClientRect().height / safeZoom
      if (height > 0 && Math.abs((pageHeights.value[idx] ?? -1) - height) > 0.5) {
        if (!next) next = { ...pageHeights.value }
        next[idx] = height
        changed = true
      }
    })
    if (changed && next) pageHeights.value = next
    return changed
  }

  function updateVisibleRange() {
    if (!virtualScrollEnabled.value) return
    const container = previewRef.value?.querySelector('.document-content') as HTMLElement | null
    if (!container) return
    const total = pages.value.length
    if (total === 0) return
    if (total <= VIRTUAL_BUFFER * 2 + 1) {
      visibleStart.value = 0
      visibleEnd.value = total - 1
      return
    }
    const containerRect = container.getBoundingClientRect()
    const zoomFactor = zoomLevel.value / 100
    const safeZoom = zoomFactor > 0 ? zoomFactor : 1
    const viewportTop = -containerRect.top / safeZoom
    const viewportHeight = window.innerHeight / safeZoom
    let accumulated = 0
    let start = 0
    let end = total - 1
    for (let i = 0; i < total; i++) {
      const h = getPagePlaceholderHeight(i)
      const pageBottom = accumulated + h
      if (pageBottom <= viewportTop) start = i + 1
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

  function handleVirtualScroll() {
    if (scrollTicking) return
    scrollTicking = true
    requestAnimationFrame(() => {
      updateVisibleRange()
      scrollTicking = false
    })
  }

  function attachViewportListeners() {
    window.addEventListener('scroll', handleVirtualScroll, { passive: true })
    window.addEventListener('resize', handleVirtualScroll, { passive: true })
  }
  function detachViewportListeners() {
    window.removeEventListener('scroll', handleVirtualScroll)
    window.removeEventListener('resize', handleVirtualScroll)
  }

  watch([visibleStart, visibleEnd], () => {
    nextTick(() => {
      if (measureVisiblePageHeights()) updateVisibleRange()
    })
  })
  watch(zoomLevel, () => {
    pageHeights.value = {}
    nextTick(() => {
      measureVisiblePageHeights()
      updateVisibleRange()
    })
  })

  return {
    currentPage,
    totalPages,
    pageHeight,
    virtualScrollEnabled,
    visibleStart,
    visibleEnd,
    pageHeights,
    updatePageHeight,
    goToPage,
    goToPrevPage,
    goToNextPage,
    scrollToPage,
    updateTotalPages,
    resetViewport,
    getPagePlaceholderHeight,
    isPageVisible,
    measureVisiblePageHeights,
    updateVisibleRange,
    handleVirtualScroll,
    attachViewportListeners,
    detachViewportListeners,
  }
}
