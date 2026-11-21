// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DocSearchBar from '../../src/components/DocSearchBar.vue'
import OutlineSidebar from '../../src/components/OutlineSidebar.vue'

const searchProps = {
  query: '',
  caseSensitive: false,
  wholeWord: false,
  statusLabel: '无结果',
  resultCount: 0,
}

describe('DocSearchBar', () => {
  it('keeps the search DOM contract (ids, roles, ARIA, option labels)', () => {
    const w = mount(DocSearchBar, { props: searchProps })
    expect(w.find('#doc-search-bar').attributes('role')).toBe('search')
    expect(w.find('#doc-search-bar').attributes('aria-label')).toBeTruthy()
    const input = w.find('input.search-input')
    expect(input.attributes('type')).toBe('search')
    expect(input.attributes('aria-describedby')).toBe('doc-search-status')
    expect(w.find('#doc-search-status').attributes('role')).toBe('status')
    expect(w.find('#doc-search-status').attributes('aria-live')).toBe('polite')
    expect(w.findAll('label.search-option')).toHaveLength(2)
    expect(w.findAll('label.search-option span').map((s) => s.text())).toEqual(['Aa', 'W'])
    // 上一/下一按钮在无结果时禁用
    const navButtons = w.findAll('button.toolbar-btn')
    expect(navButtons).toHaveLength(3)
    expect(navButtons[0].attributes('disabled')).toBeDefined()
    expect(navButtons[1].attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('emits query update + perform-search on input, next-match on Enter', async () => {
    const w = mount(DocSearchBar, { props: searchProps })
    const input = w.find('input.search-input')
    await input.setValue('keyword')
    expect(w.emitted('update:query')).toEqual([['keyword']])
    expect(w.emitted('perform-search')).toHaveLength(1)
    await input.trigger('keyup.enter')
    expect(w.emitted('next-match')).toHaveLength(1)
    w.unmount()
  })

  it('forwards checkbox options and nav/close buttons', async () => {
    const w = mount(DocSearchBar, { props: { ...searchProps, resultCount: 2 } })
    const navButtons = w.findAll('button.toolbar-btn')
    expect(navButtons[0].attributes('disabled')).toBeUndefined()
    expect(navButtons[1].attributes('disabled')).toBeUndefined()

    const boxes = w.findAll('input[type="checkbox"]')
    boxes[0].element.checked = true
    await boxes[0].trigger('change')
    expect(w.emitted('update:caseSensitive')).toEqual([[true]])
    boxes[1].element.checked = true
    await boxes[1].trigger('change')
    expect(w.emitted('update:wholeWord')).toEqual([[true]])
    expect(w.emitted('perform-search')).toHaveLength(2)

    await navButtons[0].trigger('click') // prev
    await navButtons[1].trigger('click') // next
    await navButtons[2].trigger('click') // close
    expect(w.emitted('prev-match')).toHaveLength(1)
    expect(w.emitted('next-match')).toHaveLength(1)
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })

  it('exposes focus() for Ctrl+F / toolbar focus forwarding', () => {
    const w = mount(DocSearchBar, { props: searchProps, attachTo: document.body })
    const exposed = w.vm as unknown as { focus: () => void }
    expect(typeof exposed.focus).toBe('function')
    exposed.focus()
    expect(document.activeElement).toBe(w.find('input.search-input').element)
    w.unmount()
  })
})

describe('OutlineSidebar', () => {
  const items = [
    { text: 'Chapter 1', level: 1, index: 0 },
    { text: 'Section 1.1', level: 2, index: 3 },
    { text: 'Sub 1.1.1', level: 3, index: 5 },
  ]

  it('renders items with level classes, roles and ARIA labels', () => {
    const w = mount(OutlineSidebar, { props: { items } })
    expect(w.find('#doc-outline-sidebar').attributes('role')).toBe('navigation')
    expect(w.find('#doc-outline-sidebar').attributes('aria-label')).toBeTruthy()
    const rendered = w.findAll('.outline-item')
    expect(rendered).toHaveLength(3)
    expect(rendered[0].classes()).toContain('outline-level-1')
    expect(rendered[1].classes()).toContain('outline-level-2')
    expect(rendered[2].classes()).toContain('outline-level-3')
    expect(rendered[0].attributes('role')).toBe('button')
    expect(rendered[0].attributes('tabindex')).toBe('0')
    expect(rendered[0].attributes('aria-label')).toBe('Chapter 1')
    expect(rendered[0].text()).toBe('Chapter 1')
    w.unmount()
  })

  it('emits navigate on click, Enter and Space', async () => {
    const w = mount(OutlineSidebar, { props: { items } })
    const rendered = w.findAll('.outline-item')
    await rendered[0].trigger('click')
    await rendered[1].trigger('keydown.enter')
    await rendered[2].trigger('keydown.space')
    expect(w.emitted('navigate')).toEqual([[items[0]], [items[1]], [items[2]]])
    w.unmount()
  })
})
