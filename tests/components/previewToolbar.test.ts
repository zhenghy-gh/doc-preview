// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PreviewToolbar from '../../src/components/PreviewToolbar.vue'

const baseProps = {
  zoomLabel: '100%',
  canZoomOut: true,
  canZoomIn: true,
  searchOpen: false,
  outlineAvailable: true,
  outlineOpen: false,
  hiddenTextShown: false,
  darkMode: false,
  shortcutsOpen: false,
  wordCount: 10,
  paragraphCount: 2,
  charCount: 50,
  currentPage: 1,
  totalPages: 3,
}

describe('PreviewToolbar', () => {
  it('emits the expected events for each action', async () => {
    const w = mount(PreviewToolbar, { props: baseProps })
    const buttons = w.findAll('button.toolbar-btn')
    await buttons[0].trigger('click') // zoom-out
    await buttons[1].trigger('click') // zoom-reset
    await buttons[2].trigger('click') // zoom-in
    await buttons[3].trigger('click') // search
    expect(w.emitted('zoom-out')).toHaveLength(1)
    expect(w.emitted('zoom-reset')).toHaveLength(1)
    expect(w.emitted('zoom-in')).toHaveLength(1)
    expect(w.emitted('toggle-search')).toHaveLength(1)
    expect(w.find('.toolbar-btn[data-action="copy-text"]').exists()).toBe(true)
    w.unmount()
  })

  it('disables pagination buttons at the bounds and exposes search focus', () => {
    const w = mount(PreviewToolbar, { props: { ...baseProps, currentPage: 1, totalPages: 1 } })
    const pageBtns = w.findAll('button.pagination-btn')
    expect(pageBtns[0].attributes('disabled')).toBeDefined()
    expect(pageBtns[1].attributes('disabled')).toBeDefined()
    expect(typeof (w.vm as unknown as { focusSearchToggle: () => void }).focusSearchToggle).toBe('function')
    w.unmount()
  })
})
