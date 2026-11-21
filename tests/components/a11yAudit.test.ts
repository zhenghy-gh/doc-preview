// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import CollapsiblePanel from '../../src/components/CollapsiblePanel.vue'
import PreviewToolbar from '../../src/components/PreviewToolbar.vue'
import DocSearchBar from '../../src/components/DocSearchBar.vue'
import OutlineSidebar from '../../src/components/OutlineSidebar.vue'

const searchSource = readFileSync(resolve(process.cwd(), 'src/components/DocSearchBar.vue'), 'utf8')

/** 提取某条 CSS 规则的声明体；规则不存在时返回空串（⇒ 断言失败）。 */
function cssRule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? ''
}

describe('a11y audit: DocSearchBar option checkboxes', () => {
  it('keeps option checkboxes keyboard-focusable (visually hidden, not display:none)', () => {
    // display:none removes an input from the tab order and the accessibility tree,
    // so keyboard users could never toggle case-sensitive / whole-word.
    const rule = cssRule(searchSource, '.search-option input')
    expect(rule, '.search-option input rule missing').not.toBe('')
    expect(rule).not.toMatch(/display\s*:\s*none/)
    expect(rule).toMatch(/position\s*:\s*absolute/)
    expect(rule).toMatch(/clip\s*:/)
  })

  it('renders a focus ring on the option label when its checkbox is keyboard-focused', () => {
    expect(searchSource, 'missing :has(input:focus-visible) focus style').toMatch(
      /\.search-option:has\(input:focus-visible\)/,
    )
  })

  it('gives both option checkboxes accessible names and keeps the live result status', () => {
    const w = mount(DocSearchBar, {
      props: {
        query: '',
        caseSensitive: false,
        wholeWord: false,
        statusLabel: '无匹配结果',
        resultCount: 0,
      },
    })
    const boxes = w.findAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(2)
    for (const box of boxes) expect(box.attributes('aria-label')).toBeTruthy()
    const status = w.find('#doc-search-status')
    expect(status.attributes('role')).toBe('status')
    expect(status.attributes('aria-live')).toBe('polite')
    expect(w.find('input.search-input').attributes('aria-describedby')).toBe('doc-search-status')
    w.unmount()
  })
})

describe('a11y audit: CollapsiblePanel disclosure wiring', () => {
  it('links the toggle to its region only while expanded, and labels the region by the toggle', async () => {
    const w = mount(CollapsiblePanel, {
      props: { modelValue: true, title: '面板' },
      slots: { default: '<p>content</p>' },
    })
    const toggle = w.find('button.stories-toggle')
    const region = w.find('[role="region"]')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(toggle.attributes('aria-controls')).toBeTruthy()
    expect(region.attributes('id')).toBe(toggle.attributes('aria-controls'))
    expect(region.attributes('aria-labelledby')).toBe(toggle.attributes('id'))

    await w.setProps({ modelValue: false })
    const collapsedToggle = w.find('button.stories-toggle')
    expect(collapsedToggle.attributes('aria-expanded')).toBe('false')
    // region is removed by v-if; a dangling aria-controls would point at nothing.
    expect(w.find('[role="region"]').exists()).toBe(false)
    expect(collapsedToggle.attributes('aria-controls')).toBeUndefined()
    w.unmount()
  })
})

describe('a11y audit: PreviewToolbar toggle state', () => {
  const baseProps = {
    zoomLabel: '100%',
    canZoomOut: true,
    canZoomIn: true,
    searchOpen: false,
    outlineAvailable: true,
    outlineOpen: true,
    hiddenTextShown: false,
    darkMode: false,
    shortcutsOpen: false,
    wordCount: 10,
    paragraphCount: 2,
    charCount: 50,
    currentPage: 1,
    totalPages: 3,
  }

  it('gives every button an accessible name and reflects zoom bounds as disabled', async () => {
    const w = mount(PreviewToolbar, { props: baseProps })
    expect(w.find('[role="toolbar"]').attributes('aria-label')).toBeTruthy()
    for (const btn of w.findAll('button')) expect(btn.attributes('aria-label')).toBeTruthy()
    const zoom = w.findAll('button.toolbar-btn')
    expect(zoom[0].attributes('disabled')).toBeUndefined()
    expect(zoom[2].attributes('disabled')).toBeUndefined()
    await w.setProps({ canZoomOut: false, canZoomIn: false })
    expect(w.findAll('button.toolbar-btn')[0].attributes('disabled')).toBeDefined()
    expect(w.findAll('button.toolbar-btn')[2].attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('exposes aria-pressed for hidden-text and theme toggles', async () => {
    const w = mount(PreviewToolbar, { props: baseProps })
    let pressed = w.findAll('button[aria-pressed]')
    expect(pressed).toHaveLength(2)
    expect(pressed.map(b => b.attributes('aria-pressed'))).toEqual(['false', 'false'])
    await w.setProps({ hiddenTextShown: true, darkMode: true })
    pressed = w.findAll('button[aria-pressed]')
    expect(pressed.map(b => b.attributes('aria-pressed'))).toEqual(['true', 'true'])
    w.unmount()
  })

  it('wires aria-controls only to expanded search/outline/shortcuts panels', async () => {
    // DOM order: search toggle, outline toggle, shortcuts toggle.
    const w = mount(PreviewToolbar, { props: baseProps })
    let expanded = w.findAll('button[aria-expanded]')
    expect(expanded).toHaveLength(3)
    // searchOpen=false, outlineOpen=true, shortcutsOpen=false
    expect(expanded[0].attributes('aria-controls')).toBeUndefined()
    expect(expanded[1].attributes('aria-controls')).toBe('doc-outline-sidebar')
    expect(expanded[2].attributes('aria-controls')).toBeUndefined()
    expect(expanded[1].attributes('aria-expanded')).toBe('true')

    await w.setProps({ searchOpen: true, outlineOpen: false, shortcutsOpen: true })
    expanded = w.findAll('button[aria-expanded]')
    expect(expanded[0].attributes('aria-controls')).toBe('doc-search-bar')
    expect(expanded[1].attributes('aria-controls')).toBeUndefined()
    expect(expanded[2].attributes('aria-controls')).toBe('doc-shortcuts-panel')
    w.unmount()
  })
})

describe('a11y audit: OutlineSidebar focusability', () => {
  it('keeps every outline item keyboard-focusable', () => {
    const w = mount(OutlineSidebar, {
      attachTo: document.body,
      props: { items: [{ text: 'Chapter 1', level: 1, index: 0 }] },
    })
    const item = w.find('.outline-item')
    expect(item.attributes('tabindex')).toBe('0')
    ;(item.element as HTMLElement).focus()
    expect(document.activeElement).toBe(item.element)
    w.unmount()
  })
})
