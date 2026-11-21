// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { useDocSearch } from '../../src/composables/useDocSearch'

function setup() {
  const previewRef = ref<HTMLElement | null>(document.createElement('div'))
  const content = document.createElement('div')
  content.className = 'document-content'
  content.innerHTML = '<p>alpha keyword beta keyword gamma</p>'
  previewRef.value.appendChild(content)
  const restoreLayout = vi.fn()
  const rerender = vi.fn()
  const s = useDocSearch({
    previewRef,
    searchBarRef: ref(null),
    toolbarRef: ref(null),
    virtualScrollEnabled: ref(true),
    t: (k: string) => k,
    onRerender: rerender,
    onRestoreLayout: restoreLayout,
  })
  return { ...s, content, restoreLayout, rerender }
}

describe('useDocSearch', () => {
  it('finds all matches and builds the status label', () => {
    const s = setup()
    s.searchQuery.value = 'keyword'
    s.performSearch()
    expect(s.searchResults.value).toHaveLength(2)
    expect(s.searchStatusLabel.value).toBe('1 / 2')
    s.nextMatch()
    expect(s.searchStatusLabel.value).toBe('2 / 2')
    s.prevMatch()
    expect(s.searchStatusLabel.value).toBe('1 / 2')
  })

  it('disables virtual scroll on open and restores it on close', async () => {
    const s = setup()
    expect(s.showSearch.value).toBe(false)
    s.toggleSearch()
    expect(s.showSearch.value).toBe(true)
    s.toggleSearch()
    expect(s.showSearch.value).toBe(false)
    s.restoreVirtualScroll()
    await nextTick()
    expect(s.restoreLayout).toHaveBeenCalled()
  })

  it('rerenders and re-runs search after a display change', async () => {
    const s = setup()
    s.showSearch.value = true
    s.searchQuery.value = 'keyword'
    s.rerenderForDisplayChange()
    await nextTick()
    expect(s.rerender).toHaveBeenCalled()
    expect(s.searchResults.value).toHaveLength(2)
  })
})
