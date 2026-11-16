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

  it('exposes the dark-mode pressed state and returns to the system scheme', async () => {
    const originalLocale = currentLocale.value
    const originalDarkMode = localStorage.getItem('dark-mode')
    const originalColorSchemeMeta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
    const originalMeta = originalColorSchemeMeta?.content
    const colorSchemeMeta = originalColorSchemeMeta ?? document.createElement('meta')
    colorSchemeMeta.name = 'color-scheme'
    if (!originalColorSchemeMeta) document.head.append(colorSchemeMeta)
    const hadDarkClass = document.documentElement.classList.contains('dark')
    const hadLightClass = document.documentElement.classList.contains('light')
    const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    const mediaListeners: ((event: MediaQueryListEvent) => void)[] = []
    let systemDark = false
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        get matches() { return systemDark },
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.push(listener),
        removeEventListener: vi.fn(),
      })),
    })
    localStorage.removeItem('dark-mode')
    const wrapper = mount(App)
    try {
      const themeButton = wrapper.get('.theme-btn:not(.lang-switch)')
      expect(themeButton.attributes('aria-label')).toBe('暗色模式')
      expect(themeButton.attributes('aria-pressed')).toBe('false')
      expect(themeButton.attributes('title')).toBe('切换暗色模式')
      expect(colorSchemeMeta.content).toBe('light dark')

      systemDark = true
      mediaListeners.forEach(listener => listener({ matches: true } as MediaQueryListEvent))
      await flushPromises()
      expect(themeButton.attributes('aria-pressed')).toBe('true')
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(colorSchemeMeta.content).toBe('light dark')

      setLocale('en')
      await flushPromises()
      expect(themeButton.attributes('aria-label')).toBe('Dark mode')
      await themeButton.trigger('click')
      expect(themeButton.attributes('aria-pressed')).toBe('false')
      expect(themeButton.attributes('title')).toBe('Switch to dark mode')
      expect(localStorage.getItem('dark-mode')).toBe('light')
      expect(colorSchemeMeta.content).toBe('light')

      setLocale('zh-CN')
      await flushPromises()
      expect(themeButton.attributes('aria-label')).toBe('暗色模式')
      await themeButton.trigger('click')
      expect(themeButton.attributes('aria-pressed')).toBe('true')
      expect(themeButton.attributes('title')).toBe('切换亮色模式')
      expect(localStorage.getItem('dark-mode')).toBeNull()
      expect(colorSchemeMeta.content).toBe('light dark')
    } finally {
      wrapper.unmount()
      setLocale(originalLocale)
      if (originalDarkMode === null) localStorage.removeItem('dark-mode')
      else localStorage.setItem('dark-mode', originalDarkMode)
      document.documentElement.classList.toggle('dark', hadDarkClass)
      document.documentElement.classList.toggle('light', hadLightClass)
      if (originalMeta !== undefined) colorSchemeMeta.content = originalMeta
      if (!originalColorSchemeMeta) colorSchemeMeta.remove()
      if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia)
      else delete (window as Window & { matchMedia?: unknown }).matchMedia
    }
  })

  it('keeps the app usable when browser storage is unavailable', async () => {
    const originalLocale = currentLocale.value
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage blocked') },
      setItem: () => { throw new Error('storage blocked') },
      removeItem: () => { throw new Error('storage blocked') },
    })
    const wrapper = mount(App)
    try {
      expect(wrapper.find('.upload-area').exists()).toBe(true)
      const themeButton = wrapper.get('.theme-btn:not(.lang-switch)')
      const initialPressed = themeButton.attributes('aria-pressed')
      await themeButton.trigger('click')
      expect(themeButton.attributes('aria-pressed')).not.toBe(initialPressed)

      const fileInput = wrapper.get('.file-input')
      Object.defineProperty(fileInput.element, 'files', {
        configurable: true,
        value: [new File(['doc'], 'storage-blocked.doc')],
      })
      await fileInput.trigger('change')
      await flushPromises()
      const fontButton = wrapper.get('.header-actions .header-btn:nth-child(1)')
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const initialFontPressed = fontButton.attributes('aria-pressed')
      await fontButton.trigger('click')
      expect(fontButton.attributes('aria-pressed')).not.toBe(initialFontPressed)
    } finally {
      wrapper.unmount()
      setLocale(originalLocale)
    }
  })

  it('synchronizes the browser title when the UI locale changes', async () => {
    const originalLocale = currentLocale.value
    const originalTitle = document.title
    const originalLanguage = document.documentElement.lang
    const wrapper = mount(App)
    try {
      setLocale('zh-CN')
      await flushPromises()
      expect(document.title).toBe('DOC文件在线预览')
      expect(document.documentElement.lang).toBe('zh-CN')
      expect(wrapper.get('.lang-switch').attributes('title')).toBe('切换语言')
      expect(wrapper.get('.lang-switch').attributes('aria-label')).toBe('EN，切换到英文')

      setLocale('en')
      await flushPromises()
      expect(document.title).toBe('DOC File Online Preview')
      expect(document.documentElement.lang).toBe('en')
      expect(wrapper.get('.lang-switch').attributes('title')).toBe('Switch language')
      expect(wrapper.get('.lang-switch').attributes('aria-label')).toBe('中文, switch to Chinese')
    } finally {
      wrapper.unmount()
      setLocale(originalLocale)
      document.title = originalTitle
      document.documentElement.lang = originalLanguage
    }
  })

  it('labels the URL input in the active locale and keeps its example hint concise', () => {
    const originalLocale = currentLocale.value
    try {
      for (const [locale, expectedLabel] of [['zh-CN', '文档地址'], ['en', 'Document URL']] as const) {
        setLocale(locale)
        const wrapper = mount(App)
        try {
          expect(wrapper.findAll('button').every(button => button.attributes('type') === 'button')).toBe(true)
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

  it('reports an empty URL submission through the visible and live error regions', async () => {
    const originalLocale = currentLocale.value
    const wrapper = mount(App)
    try {
      setLocale('en')
      await flushPromises()
      await wrapper.get('.url-btn').trigger('click')
      expect(wrapper.get('.error-banner').text()).toBe('Enter a document URL')
      expect(wrapper.find('[role="status"]').text()).toBe('Enter a document URL')

      setLocale('zh-CN')
      await flushPromises()
      expect(wrapper.get('.error-banner').text()).toBe('请输入文档地址')
      expect(wrapper.find('[role="status"]').text()).toBe('请输入文档地址')
    } finally {
      wrapper.unmount()
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
