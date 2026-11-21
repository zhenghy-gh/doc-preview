/**
 * useDocSearch —— 搜索状态、高亮包装与匹配导航（从 DocPreview.vue 抽离）。
 *
 * 高亮只操作 DOM Range（searchUtils），从不改写 htmlContent 字符串；
 * 搜索期间临时关闭虚拟滚动以渲染全部页面，关闭后经 restoreVirtualScroll 恢复。
 */
import { computed, nextTick, ref, type Ref } from 'vue'
import { highlightTextMatches, clearSearchHighlights, type SearchHighlight } from '../utils/searchUtils'
import type { Translator } from '../utils/docFormat'

export interface DocSearchOptions {
  previewRef: Ref<HTMLElement | null>
  searchBarRef: Ref<{ focus: () => void } | null>
  toolbarRef: Ref<{ focusSearchToggle: () => void } | null>
  virtualScrollEnabled: Ref<boolean>
  t: Translator
  /** 隐藏文字/修订切换后的全量重渲染（由组件基于 lastParseResult 注入） */
  onRerender: () => void
  /** 虚拟滚动恢复后的重新测量/校准（useDocViewport 提供） */
  onRestoreLayout: () => void
}

export function useDocSearch(options: DocSearchOptions) {
  const { previewRef, searchBarRef, toolbarRef, virtualScrollEnabled, t } = options

  const showSearch = ref(false)
  const searchQuery = ref('')
  const searchResults = ref<SearchHighlight[]>([])
  const currentSearchIndex = ref(-1)
  const searchCaseSensitive = ref(false)
  const searchWholeWord = ref(false)

  /** 恢复虚拟滚动的唯一入口（搜索关闭 / 大纲导航共用）：搜索开启时保持关闭。 */
  function restoreVirtualScroll() {
    if (showSearch.value) return
    virtualScrollEnabled.value = true
    nextTick(() => options.onRestoreLayout())
  }

  function clearHighlights() {
    if (previewRef.value) clearSearchHighlights(previewRef.value)
  }

  function scrollToMatch(idx: number) {
    const matches = previewRef.value?.querySelectorAll('.search-highlight') as NodeListOf<HTMLElement>
    if (idx >= 0 && idx < matches.length) {
      matches.forEach((el, i) => el.classList.toggle('search-highlight-current', i === idx))
      const current = matches[idx]
      if (current && typeof current.scrollIntoView === 'function') {
        current.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
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

  function toggleSearch() {
    showSearch.value = !showSearch.value
    if (showSearch.value) {
      searchQuery.value = ''
      searchResults.value = []
      currentSearchIndex.value = -1
      virtualScrollEnabled.value = false
      nextTick(() => searchBarRef.value?.focus())
    } else {
      clearHighlights()
      restoreVirtualScroll()
      nextTick(() => toolbarRef.value?.focusSearchToggle())
    }
  }

  /** 显示类切换后重建 DOM 会抹掉高亮 span，重渲染后在 nextTick 重跑搜索恢复状态与 DOM。 */
  function rerenderForDisplayChange() {
    options.onRerender()
    if (showSearch.value && searchQuery.value.trim()) nextTick(() => performSearch())
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
    if (searchResults.value.length === 0) return t('search.no.results')
    return `${currentSearchIndex.value + 1} / ${searchResults.value.length}`
  })

  return {
    showSearch,
    searchQuery,
    searchResults,
    currentSearchIndex,
    searchCaseSensitive,
    searchWholeWord,
    searchStatusLabel,
    restoreVirtualScroll,
    toggleSearch,
    performSearch,
    clearHighlights,
    scrollToMatch,
    nextMatch,
    prevMatch,
    rerenderForDisplayChange,
  }
}
