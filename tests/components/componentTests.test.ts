// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { currentLocale, setLocale } from '../../src/utils/locale'
import CollapsiblePanel from '../../src/components/CollapsiblePanel.vue'
import DocStatsPanel from '../../src/components/DocStatsPanel.vue'
import ErrorDisplay from '../../src/components/ErrorDisplay.vue'
import LoadingOverlay from '../../src/components/LoadingOverlay.vue'
import ShortcutsPanel from '../../src/components/ShortcutsPanel.vue'

describe('CollapsiblePanel', () => {
  it('toggles and emits update:modelValue', async () => {
    const wrapper = mount(CollapsiblePanel, {
      props: { modelValue: true, title: '面板' },
      slots: { default: '<p>content</p>' },
    })
    expect(wrapper.text()).toContain('面板')
    expect(wrapper.find('.stories-content').exists()).toBe(true)
    await wrapper.find('.stories-toggle').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('hides content when collapsed and shows summary', () => {
    const wrapper = mount(CollapsiblePanel, {
      props: { modelValue: false, title: 'T', summary: '3 items', panelClass: 'extra' },
    })
    expect(wrapper.find('.stories-content').exists()).toBe(false)
    expect(wrapper.find('.stories-toggle-summary').text()).toBe('3 items')
    expect(wrapper.classes()).toContain('extra')
  })
})

describe('DocStatsPanel', () => {
  it('renders stats when paragraphs exist', () => {
    const wrapper = mount(DocStatsPanel, {
      props: {
        modelValue: true,
        stats: { wordCount: 1234, charCount: 5678, paragraphCount: 42, pageCount: 3, imageCount: 2, tableCount: 1 },
      },
    })
    expect(wrapper.text()).toContain('1,234')
    expect(wrapper.find('.stories-content').exists()).toBe(true)
  })

  it('renders nothing without paragraphs', () => {
    const wrapper = mount(DocStatsPanel, {
      props: {
        modelValue: true,
        stats: { wordCount: 0, charCount: 0, paragraphCount: 0, pageCount: 0, imageCount: 0, tableCount: 0 },
      },
    })
    expect(wrapper.find('.collapsible-panel').exists()).toBe(false)
  })
})

describe('ErrorDisplay', () => {
  it('classifies and displays the error with a retry button', async () => {
    const wrapper = mount(ErrorDisplay, {
      props: { error: 'Failed to fetch the file' },
    })
    expect(wrapper.text().length).toBeGreaterThan(0)
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    const retryBtn = wrapper.find('.error-retry-btn')
    expect(retryBtn.exists()).toBe(true)
    await retryBtn.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('shows the raw error in a details block', () => {
    const wrapper = mount(ErrorDisplay, {
      props: { error: '404 Not Found' },
    })
    expect(wrapper.find('details.error-raw').exists()).toBe(true)
  })
})

describe('LoadingOverlay', () => {
  it('renders indeterminate mode by default', () => {
    const wrapper = mount(LoadingOverlay, { props: { fileName: 'a.doc' } })
    expect(wrapper.find('.progress-bar.indeterminate').exists()).toBe(true)
    expect(wrapper.find('[role="progressbar"]').attributes('aria-label')).toBe('文档加载进度')
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBeUndefined()
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuetext')).toBe('正在解析文档...')
    expect(wrapper.find('.progress-percent').exists()).toBe(false)
    expect(wrapper.text()).toContain('a.doc')
  })

  it('renders determinate progress with percentage', async () => {
    const wrapper = mount(LoadingOverlay, {
      props: { progressPercent: 45, progressStep: '解析中', fileSize: '1.2 MB' },
    })
    expect(wrapper.find('.progress-percent').text()).toBe('45%')
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('45')
    expect(wrapper.find('.progress-bar').attributes('style')).toContain('width: 45%')
    await wrapper.setProps({ progressPercent: -1 })
    expect(wrapper.find('.progress-bar.indeterminate').exists()).toBe(true)
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBeUndefined()
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuetext')).toBe('解析中')
    expect(wrapper.find('.progress-percent').exists()).toBe(false)
    expect(wrapper.text()).toContain('1.2 MB')
  })

  it('clamps progress beyond 100', () => {
    const wrapper = mount(LoadingOverlay, { props: { progressPercent: 150 } })
    expect(wrapper.find('.progress-bar').attributes('style')).toContain('width: 100%')
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('100')
  })
})

describe('ShortcutsPanel', () => {
  it('opens the native shortcuts dialog and closes via the close button', async () => {
    const wrapper = mount(ShortcutsPanel, { props: { modelValue: true } })
    await nextTick()
    const dialog = wrapper.get('dialog')
    expect((dialog.element as HTMLDialogElement).open).toBe(true)
    expect(dialog.attributes('aria-labelledby')).toBe('shortcuts-title')
    expect(wrapper.findAll('kbd').length).toBeGreaterThan(0)
    await wrapper.find('.shortcuts-close').trigger('click')
    await nextTick()
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    wrapper.unmount()
  })

  it('resolves nested shortcut labels and updates with the active locale', async () => {
    const originalLocale = currentLocale.value
    setLocale('en')
    const wrapper = mount(ShortcutsPanel, { props: { modelValue: true } })
    try {
      const labels = wrapper.findAll('.shortcut-label')
      expect(labels[0].text()).toBe('Search document')
      expect(labels[1].text()).toBe('Next match')
      expect(wrapper.text()).not.toContain('shortcuts.items.')

      setLocale('zh-CN')
      await nextTick()
      expect(wrapper.findAll('.shortcut-label')[0].text()).toBe('搜索文档')
      expect(wrapper.findAll('.shortcut-label')[1].text()).toBe('下一个匹配')
      expect(wrapper.text()).not.toContain('shortcuts.items.')
    } finally {
      wrapper.unmount()
      setLocale(originalLocale)
    }
  })

  it('shows Command modifiers on Apple platforms and Control elsewhere', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    const macWrapper = mount(ShortcutsPanel, { props: { modelValue: true } })
    try {
      const macKeys = macWrapper.findAll('kbd').map(key => key.text())
      expect(macKeys[0]).toBe('⌘F')
      expect(macKeys[2]).toBe('⌘G')
      expect(macKeys[3]).toBe('⇧F3')
      expect(macKeys[4]).toBe('⇧⌘G')
      expect(macKeys).not.toContain('Ctrl+F')
    } finally {
      macWrapper.unmount()
      vi.unstubAllGlobals()
    }

    vi.stubGlobal('navigator', { platform: 'Win32' })
    const windowsWrapper = mount(ShortcutsPanel, { props: { modelValue: true } })
    try {
      const windowsKeys = windowsWrapper.findAll('kbd').map(key => key.text())
      expect(windowsKeys[0]).toBe('Ctrl+F')
      expect(windowsKeys[4]).toBe('Ctrl+Shift+G')
    } finally {
      windowsWrapper.unmount()
      vi.unstubAllGlobals()
    }
  })

  it('keeps the native shortcuts dialog closed when modelValue is false', async () => {
    const wrapper = mount(ShortcutsPanel, { props: { modelValue: false } })
    await nextTick()
    expect((wrapper.get('dialog').element as HTMLDialogElement).open).toBe(false)
    wrapper.unmount()
  })
})
