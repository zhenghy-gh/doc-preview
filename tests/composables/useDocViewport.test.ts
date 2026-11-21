// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { ref, nextTick } from 'vue'
import { useDocViewport } from '../../src/composables/useDocViewport'
import { PT_TO_PX } from '../../src/utils/rendering/pageBuilder'
import type { SectionInfo } from '../../src/utils/docFormat'

function setup(pageCount = 5) {
  const pages = ref(Array.from({ length: pageCount }, (_, i) => `<div class="page-content">p${i}</div>`))
  const sections = ref<SectionInfo[]>([])
  const previewRef = ref<HTMLElement | null>(null)
  const zoomLevel = ref(100)
  return { pages, sections, previewRef, zoomLevel, ...useDocViewport({ pages, sections, previewRef, zoomLevel }) }
}

describe('useDocViewport', () => {
  it('falls back to A4 for page height and uses first section height when present', () => {
    const v = setup()
    v.updatePageHeight()
    expect(v.pageHeight.value).toBe(842)
    v.sections.value = [{ cpStart: 0, cpEnd: 1, index: 0, pageHeightPt: 595 }]
    v.updatePageHeight()
    expect(v.pageHeight.value).toBe(595)
  })

  it('clamps page navigation and refreshes total from pages array', async () => {
    const v = setup(3)
    v.goToPage(99)
    expect(v.currentPage.value).toBe(1)
    v.updateTotalPages()
    await nextTick()
    expect(v.totalPages.value).toBe(3)
    v.goToNextPage()
    expect(v.currentPage.value).toBe(2)
    v.goToPrevPage()
    expect(v.currentPage.value).toBe(1)
  })

  it('keeps placeholder height from cache or A4 fallback', () => {
    const v = setup()
    expect(v.getPagePlaceholderHeight(0)).toBe(Math.max(400, 842 * PT_TO_PX))
    v.pageHeights.value = { 1: 1234 }
    expect(v.getPagePlaceholderHeight(1)).toBe(1234)
  })

  it('shows all pages when virtual scroll is off or document is small', () => {
    const v = setup(3)
    expect(v.isPageVisible(2)).toBe(true)
    v.pages.value = Array.from({ length: 10 }, () => 'p')
    v.virtualScrollEnabled.value = false
    expect(v.isPageVisible(9)).toBe(true)
  })
})
