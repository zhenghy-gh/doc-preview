// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import App from '../src/App.vue'
import { MAX_DOC_FILE_SIZE } from '../src/utils/docLimits'
import { currentLocale, setLocale } from '../src/utils/locale'

describe('App upload accessibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('labels the URL input in the active locale and keeps its example hint concise', () => {
    const originalLocale = currentLocale.value
    try {
      for (const [locale, expectedLabel] of [['zh-CN', '文档地址'], ['en', 'Document URL']] as const) {
        setLocale(locale)
        const wrapper = mount(App)
        try {
          const input = wrapper.get('.url-input')
          const inputId = input.attributes('id')
          const label = wrapper.get('label[for="' + inputId + '"]')

          expect(inputId).toBeTruthy()
          expect(label.text()).toBe(expectedLabel)
          expect(input.attributes('inputmode')).toBe('url')
          expect(input.attributes('enterkeyhint')).toBe('go')
          expect(input.attributes('placeholder')).toBe('https://...')
        } finally {
          wrapper.unmount()
        }
      }
    } finally {
      setLocale(originalLocale)
    }
  })

  it('announces upload validation errors through the persistent polite status region', async () => {
    const wrapper = mount(App)
    const status = wrapper.find('[role="status"]')
    expect(status.attributes('aria-live')).toBe('polite')
    expect(status.text()).toBe('')

    const fileInput = wrapper.get('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', {
      configurable: true,
      value: [new File(['not a doc'], 'notes.pdf')],
    })
    await fileInput.trigger('change')
    await flushPromises()

    expect(wrapper.find('.error-banner').text()).toContain('.pdf')
    expect(status.text()).toContain('.pdf')
    wrapper.unmount()
  })

  it('announces an oversized DOC with the same visible size limit', async () => {
    const wrapper = mount(App)
    const fileInput = wrapper.get('input[type="file"]')
    const file = new File(['doc'], 'large.doc')
    Object.defineProperty(file, 'size', { configurable: true, value: MAX_DOC_FILE_SIZE + 1 })
    Object.defineProperty(fileInput.element, 'files', { configurable: true, value: [file] })

    await fileInput.trigger('change')
    await flushPromises()

    expect(wrapper.find('.error-banner').text()).toContain('50 MiB')
    expect(wrapper.find('[role="status"]').text()).toContain('50 MiB')
    wrapper.unmount()
  })
})
