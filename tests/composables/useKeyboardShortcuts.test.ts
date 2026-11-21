// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useKeyboardShortcuts } from '../../src/composables/useKeyboardShortcuts'

function setup() {
  const calls: string[] = []
  const push = (name: string) => () => calls.push(name)
  const showSearch = ref(false)
  const showShortcuts = ref(false)
  const totalPages = ref(9)
  const previewRef = ref<HTMLElement | null>(document.createElement('div'))
  const searchBarRef = ref<{ focus: () => void } | null>({ focus: () => calls.push('focusSearch') })
  const k = useKeyboardShortcuts({
    showSearch,
    showShortcuts,
    totalPages,
    previewRef,
    searchBarRef,
    onToggleSearch: () => {
      calls.push('search')
      showSearch.value = !showSearch.value
    },
    onPrint: push('print'),
    onZoomIn: push('zoomIn'),
    onZoomOut: push('zoomOut'),
    onZoomReset: push('zoomReset'),
    onNextMatch: push('next'),
    onPrevMatch: push('prev'),
    onPrevPage: push('prevPage'),
    onNextPage: push('nextPage'),
    onGoToPage: (p) => calls.push(`goTo${p}`),
  })
  return { ...k, calls, showSearch, showShortcuts, previewRef }
}

function key(k: string, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key: k, ...init })
  const prevent = vi.spyOn(e, 'preventDefault')
  return { e, prevent }
}

describe('useKeyboardShortcuts', () => {
  it('maps Ctrl combinations to the right actions', () => {
    const k = setup()
    k.handleKeydown(key('f', { ctrlKey: true }).e)
    expect(k.calls).toEqual(['search'])
    k.handleKeydown(key('p', { ctrlKey: true }).e)
    expect(k.calls).toEqual(['search', 'print'])
    k.handleKeydown(key('=', { ctrlKey: true }).e)
    k.handleKeydown(key('-', { ctrlKey: true }).e)
    k.handleKeydown(key('0', { ctrlKey: true }).e)
    expect(k.calls.slice(-3)).toEqual(['zoomIn', 'zoomOut', 'zoomReset'])
  })

  it('only hijacks page keys when focus is inside the preview', () => {
    const k = setup()
    k.handleKeydown(key('PageDown'))
    expect(k.calls).toEqual([])
    const outside = document.createElement('div')
    const outsideEvent = key('PageDown').e
    Object.defineProperty(outsideEvent, 'target', { value: outside })
    k.handleKeydown(outsideEvent)
    expect(k.calls).toEqual([])
    const inside = document.createElement('p')
    k.previewRef.value!.appendChild(inside)
    const event = key('PageDown').e
    Object.defineProperty(event, 'target', { value: inside })
    k.handleKeydown(event)
    expect(k.calls).toEqual(['nextPage'])
  })

  it('Escape closes search first, then shortcuts panel', () => {
    const k = setup()
    k.showSearch.value = true
    k.showShortcuts.value = true
    k.handleKeydown(key('Escape').e)
    expect(k.calls).toEqual(['search'])
    expect(k.showShortcuts.value).toBe(true)
    k.handleKeydown(key('Escape').e)
    expect(k.showShortcuts.value).toBe(false)
  })

  it('toggles shortcuts with ? and leaves text fields alone', () => {
    const k = setup()
    k.handleKeydown(key('?').e)
    expect(k.showShortcuts.value).toBe(true)
    const input = document.createElement('input')
    const event = key('?').e
    Object.defineProperty(event, 'target', { value: input })
    k.handleKeydown(event)
    expect(k.showShortcuts.value).toBe(true) // unchanged
  })
})
