/**
 * 全局键盘快捷键分发（从 DocPreview.vue 抽离，行为逐条保留）。
 *
 * 只依赖注入的 refs 与回调，不直接触碰解析器/渲染状态。
 */
import type { Ref } from 'vue'

export interface KeyboardShortcutOptions {
  showSearch: Ref<boolean>
  showShortcuts: Ref<boolean>
  totalPages: Ref<number>
  previewRef: Ref<HTMLElement | null>
  searchBarRef: Ref<{ focus: () => void } | null>
  onToggleSearch: () => void
  onPrint: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onNextMatch: () => void
  onPrevMatch: () => void
  onPrevPage: () => void
  onNextPage: () => void
  onGoToPage: (page: number) => void
}

export function useKeyboardShortcuts(options: KeyboardShortcutOptions) {
  const o = options

  function toggleShortcuts() {
    o.showShortcuts.value = !o.showShortcuts.value
  }

  function handleKeydown(e: KeyboardEvent) {
    const isCtrl = e.ctrlKey || e.metaKey

    if (isCtrl && e.key === 'f') {
      e.preventDefault()
      if (!o.showSearch.value) o.onToggleSearch()
      else o.searchBarRef.value?.focus()
      return
    }
    if (isCtrl && e.key === 'p') {
      e.preventDefault()
      o.onPrint()
      return
    }
    if (e.key === 'Escape') {
      if (o.showSearch.value) { o.onToggleSearch(); return }
      if (o.showShortcuts.value) { o.showShortcuts.value = false; return }
    }
    if (e.key === '=' || e.key === '+') {
      if (isCtrl) { e.preventDefault(); o.onZoomIn() }
      return
    }
    if (e.key === '-') {
      if (isCtrl) { e.preventDefault(); o.onZoomOut() }
      return
    }
    if (e.key === '0' && isCtrl) {
      e.preventDefault()
      o.onZoomReset()
      return
    }
    if ((e.key === 'F3' && e.shiftKey) || (isCtrl && e.shiftKey && e.key === 'g')) {
      if (o.showSearch.value) { e.preventDefault(); o.onPrevMatch() }
      return
    }
    if (e.key === 'F3' || (isCtrl && e.key === 'g')) {
      if (o.showSearch.value) { e.preventDefault(); o.onNextMatch() }
      return
    }

    const target = e.target as HTMLElement
    const isInputFocused = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    if (isInputFocused) return

    const inPreview = !!o.previewRef.value && target instanceof Node && o.previewRef.value.contains(target)

    if (e.key === 'PageUp') {
      if (!inPreview) return
      e.preventDefault(); o.onPrevPage(); return
    }
    if (e.key === 'PageDown') {
      if (!inPreview) return
      e.preventDefault(); o.onNextPage(); return
    }
    if (e.key === 'Home') {
      if (!inPreview) return
      e.preventDefault(); o.onGoToPage(1); return
    }
    if (e.key === 'End') {
      if (!inPreview) return
      e.preventDefault(); o.onGoToPage(o.totalPages.value); return
    }
    if (e.key === '?' || (isCtrl && e.key === '/')) {
      if (isInputFocused) return
      e.preventDefault(); toggleShortcuts(); return
    }
  }

  return { handleKeydown, toggleShortcuts }
}
