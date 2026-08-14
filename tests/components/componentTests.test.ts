// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
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
    expect(wrapper.find('.progress-percent').exists()).toBe(false)
    expect(wrapper.text()).toContain('a.doc')
  })

  it('renders determinate progress with percentage', () => {
    const wrapper = mount(LoadingOverlay, {
      props: { progressPercent: 45, progressStep: '解析中', fileSize: '1.2 MB' },
    })
    expect(wrapper.find('.progress-percent').text()).toBe('45%')
    expect(wrapper.find('.progress-bar').attributes('style')).toContain('width: 45%')
    expect(wrapper.text()).toContain('1.2 MB')
  })

  it('clamps progress beyond 100', () => {
    const wrapper = mount(LoadingOverlay, { props: { progressPercent: 150 } })
    expect(wrapper.find('.progress-bar').attributes('style')).toContain('width: 100%')
  })
})

describe('ShortcutsPanel', () => {
  it('shows the shortcut list and closes via the close button', async () => {
    const wrapper = mount(ShortcutsPanel, { props: { modelValue: true } })
    expect(wrapper.find('.shortcuts-overlay').exists()).toBe(true)
    expect(wrapper.findAll('kbd').length).toBeGreaterThan(0)
    await wrapper.find('.shortcuts-close').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('renders nothing when closed', () => {
    const wrapper = mount(ShortcutsPanel, { props: { modelValue: false } })
    expect(wrapper.find('.shortcuts-overlay').exists()).toBe(false)
  })
})
