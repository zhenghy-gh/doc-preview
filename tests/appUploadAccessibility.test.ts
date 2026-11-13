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

  it('synchronizes the browser title when the UI locale changes', async () => {
    const originalLocale = currentLocale.value
    const originalTitle = document.title
    const wrapper = mount(App)
    try {
      setLocale('zh-CN')
      await flushPromises()
      expect(document.title).toBe('DOC文件在线预览')

      setLocale('en')
      await flushPromises()
      expect(document.title).toBe('DOC File Online Preview')
    } finally {
      wrapper.unmount()
      setLocale(originalLocale)
      document.title = originalTitle
    }
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
    let inputValue = 'C:\fakepath\notes.pdf'
    Object.defineProperty(fileInput.element, 'value', {
      configurable: true,
      get: () => inputValue,
      set: (value: string) => { inputValue = value },
    })
    Object.defineProperty(fileInput.element, 'files', {
      configurable: true,
      value: [new File(['not a doc'], 'notes.pdf')],
    })
    await fileInput.trigger('change')
    expect(inputValue).toBe('')
    await flushPromises()

    expect(wrapper.find('.error-banner').text()).toContain('.pdf')
    expect(status.text()).toContain('.pdf')
    wrapper.unmount()
  })

  it('localizes drag-and-drop format and size errors', async () => {
    const originalLocale = currentLocale.value
    const cases = [
      { locale: 'zh-CN', name: 'notes.pdf', expected: '不支持的文件格式 ".pdf"' },
      { locale: 'en', name: 'large.doc', expected: 'File exceeds the 50 MiB size limit' },
    ] as const

    try {
      for (const { locale, name, expected } of cases) {
        setLocale(locale)
        const wrapper = mount(App)
        const file = new File(['doc'], name)
        if (name === 'large.doc') {
          Object.defineProperty(file, 'size', { configurable: true, value: MAX_DOC_FILE_SIZE + 1 })
        }
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(dropEvent, 'dataTransfer', { value: { files: [file] } })

        try {
          wrapper.get('.upload-area').element.dispatchEvent(dropEvent)
          await flushPromises()
          expect(wrapper.find('.error-banner').text()).toContain(expected)
          expect(wrapper.find('[role="status"]').text()).toContain(expected)
        } finally {
          wrapper.unmount()
        }
      }
    } finally {
      setLocale(originalLocale)
    }
  })

  it('localizes file format and size validation messages', async () => {
    const originalLocale = currentLocale.value
    const messages = [
      {
        locale: 'zh-CN',
        cases: [
          ['notes.pdf', '不支持的文件格式 ".pdf"'],
          ['notes.docx', '.docx 格式暂不支持'],
          ['large.doc', '文件超过最大支持大小（50 MiB）'],
        ],
      },
      {
        locale: 'en',
        cases: [
          ['notes.pdf', 'Unsupported format ".pdf"'],
          ['notes.docx', '.docx format is not yet supported.'],
          ['large.doc', 'File exceeds the 50 MiB size limit'],
        ],
      },
    ] as const

    try {
      for (const testCase of messages) {
        setLocale(testCase.locale)
        const wrapper = mount(App)
        const fileInput = wrapper.get('input[type="file"]')
        const status = wrapper.get('[role="status"]')
        let inputValue = ''
        Object.defineProperty(fileInput.element, 'value', {
          configurable: true,
          get: () => inputValue,
          set: (value: string) => { inputValue = value },
        })
        try {
          for (const [name, expectedMessage] of testCase.cases) {
            const file = new File(['doc'], name)
            if (name === 'large.doc') {
              Object.defineProperty(file, 'size', { configurable: true, value: MAX_DOC_FILE_SIZE + 1 })
            }
            inputValue = 'selected-file:' + name
            Object.defineProperty(fileInput.element, 'files', { configurable: true, value: [file] })
            await fileInput.trigger('change')
            await flushPromises()
            expect(wrapper.find('.error-banner').text()).toContain(expectedMessage)
            expect(status.text()).toContain(expectedMessage)
          }
        } finally {
          wrapper.unmount()
        }
      }
    } finally {
      setLocale(originalLocale)
    }
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
