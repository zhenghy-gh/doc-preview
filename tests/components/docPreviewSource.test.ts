// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import DocPreview from '../../src/components/DocPreview.vue'
import { MAX_DOC_FILE_SIZE } from '../../src/utils/docLimits'
import { currentLocale, setLocale } from '../../src/utils/locale'

const { parseFile, parseBuffer, throwFromShortcutPanel } = vi.hoisted(() => ({
  parseFile: vi.fn(),
  parseBuffer: vi.fn(),
  throwFromShortcutPanel: { enabled: false, cause: undefined as unknown },
}))

vi.mock('../../src/utils/docParser', () => ({
  parseDocFileWithFormat: parseFile,
  parseDocFileFromBuffer: parseBuffer,
}))

vi.mock('../../src/utils/parseWithWorker', () => ({
  parseWithWorker: vi.fn(),
}))

vi.mock('../../src/components/ShortcutsPanel.vue', () => ({
  default: {
    setup() {
      return () => {
        if (throwFromShortcutPanel.enabled) throw throwFromShortcutPanel.cause
        return null
      }
    },
  },
}))

const parsedDocument = {
  success: true,
  document: {
    paragraphs: [{
      text: 'Loaded document body',
      charFormat: { fontSize: 12 },
      paraFormat: { alignment: 'left' },
      _cpStart: 0,
    }],
  },
}

describe('DocPreview source lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    parseFile.mockReset()
    parseBuffer.mockReset()
    throwFromShortcutPanel.enabled = false
    throwFromShortcutPanel.cause = undefined
  })

  it('scopes optional web font styles to opted-in previews and loads them once', async () => {
    const appendToHead = document.head.appendChild.bind(document.head)
    const appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
      if (node.nodeName === 'LINK' && (node as HTMLLinkElement).id === 'doc-preview-web-fonts') {
        const marker = document.createElement('meta')
        marker.id = 'doc-preview-web-fonts'
        appendToHead(marker)
        return node
      }
      return appendToHead(node)
    })
    parseFile.mockResolvedValue(parsedDocument)
    const source = new File(['doc'], 'sample.doc')
    const optedIn = mount(DocPreview, { props: { source, useWebFont: true } })
    const defaultPreview = mount(DocPreview, { props: { source } })
    await flushPromises()

    expect(optedIn.find('.doc-preview').classes()).toContain('web-font-enabled')
    expect(defaultPreview.find('.doc-preview').classes()).not.toContain('web-font-enabled')
    expect(appendSpy.mock.calls.filter(([node]) => node.nodeName === 'LINK')).toHaveLength(1)
    const override = document.querySelector('#doc-preview-webfont-overrides')
    expect(override?.textContent).toContain('.doc-preview.web-font-enabled .document-content')
    expect(override?.textContent).not.toContain('\n    .document-content')

    await defaultPreview.setProps({ useWebFont: true })
    await flushPromises()
    expect(defaultPreview.find('.doc-preview').classes()).toContain('web-font-enabled')
    expect(appendSpy.mock.calls.filter(([node]) => node.nodeName === 'LINK')).toHaveLength(1)

    optedIn.unmount()
    defaultPreview.unmount()
  })

  it('starts idle when there is no source', async () => {
    const wrapper = mount(DocPreview, { props: { source: null } })
    await flushPromises()

    expect(wrapper.find('.loading-container').exists()).toBe(false)
    expect(wrapper.find('[role="status"]').attributes('aria-live')).toBe('polite')
    expect(wrapper.find('[role="status"]').text()).toBe('')
    expect(wrapper.vm.getPlainText()).toBe('')

    wrapper.unmount()
  })

  it('rejects an oversized File before reading or parsing it', async () => {
    const arrayBuffer = vi.fn()
    const oversizedFile = {
      name: 'oversized.doc',
      size: MAX_DOC_FILE_SIZE + 1,
      arrayBuffer,
    } as unknown as File
    const wrapper = mount(DocPreview, { props: { source: oversizedFile } })
    await flushPromises()

    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(parseFile).not.toHaveBeenCalled()
    expect(wrapper.find('.enhanced-error').text()).toContain('50 MiB')
    wrapper.unmount()
  })

  it('rejects an oversized URL response before reading its body', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const cancel = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => String(MAX_DOC_FILE_SIZE + 1) },
      body: { cancel },
    }))
    const wrapper = mount(DocPreview, { props: { source: 'https://example.test/oversized.doc' } })
    await flushPromises()

    expect(cancel).toHaveBeenCalledOnce()
    expect(parseBuffer).not.toHaveBeenCalled()
    expect(wrapper.find('.enhanced-error').text()).toContain('50 MiB')
    wrapper.unmount()
  })

  it('localizes oversized local files and URL responses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const originalLocale = currentLocale.value
    const cancel = vi.fn().mockResolvedValue(undefined)
    const oversizedFile = {
      name: 'oversized.doc',
      size: MAX_DOC_FILE_SIZE + 1,
      arrayBuffer: vi.fn(),
    } as unknown as File
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => String(MAX_DOC_FILE_SIZE + 1) },
      body: { cancel },
    }))
    const cases = [
      { locale: 'zh-CN', expected: '文件超过最大支持大小（50 MiB）' },
      { locale: 'en', expected: 'File exceeds the 50 MiB size limit' },
    ] as const

    try {
      for (const { locale, expected } of cases) {
        setLocale(locale)
        for (const source of [oversizedFile, 'https://example.test/oversized.doc'] as const) {
          const wrapper = mount(DocPreview, { props: { source } })
          try {
            await flushPromises()
            expect(wrapper.find('.enhanced-error').text()).toContain(expected)
            expect(wrapper.find('.error-title').text()).toBe(
              locale === 'en' ? 'File exceeds size limit' : '文件超过大小限制',
            )
          } finally {
            wrapper.unmount()
          }
        }
      }
      expect(cancel).toHaveBeenCalledTimes(2)
    } finally {
      setLocale(originalLocale)
    }
  })

  it('localizes render-boundary summaries and retains raw error details', async () => {
    const originalLocale = currentLocale.value
    const cases = [
      {
        locale: 'en',
        cause: new Error('synthetic render failure'),
        title: 'Document could not be displayed',
        detail: 'preview could not render',
        raw: 'synthetic render failure',
      },
      {
        locale: 'zh-CN',
        cause: new Error('synthetic render failure'),
        title: '文档无法显示',
        detail: '预览内容无法渲染',
        raw: 'synthetic render failure',
      },
      {
        locale: 'en',
        cause: 'synthetic non-error render failure',
        title: 'Document could not be displayed',
        detail: 'preview could not render',
        raw: 'Unknown error',
      },
    ] as const
    parseFile.mockResolvedValue(parsedDocument)

    try {
      for (const testCase of cases) {
        setLocale(testCase.locale)
        throwFromShortcutPanel.enabled = true
        throwFromShortcutPanel.cause = testCase.cause
        const wrapper = mount(DocPreview, { props: { source: new File(['doc'], 'sample.doc') } })
        try {
          await flushPromises()
          expect(wrapper.get('.error-title').text()).toBe(testCase.title)
          expect(wrapper.get('.error-detail').text()).toContain(testCase.detail)
          expect(wrapper.get('.error-raw pre').text()).toContain(testCase.raw)
        } finally {
          wrapper.unmount()
          throwFromShortcutPanel.enabled = false
          throwFromShortcutPanel.cause = undefined
        }
      }
    } finally {
      setLocale(originalLocale)
    }
  })

  it('clears the rendered document when source becomes null', async () => {
    parseFile.mockResolvedValue(parsedDocument)
    const wrapper = mount(DocPreview, { props: { source: new File(['doc'], 'sample.doc') } })
    await flushPromises()

    expect(wrapper.vm.getPlainText()).toContain('Loaded document body')
    expect(wrapper.find('[role="status"]').text()).toContain('sample.doc')

    await wrapper.setProps({ source: null })
    await flushPromises()

    expect(wrapper.vm.getPlainText()).toBe('')
    expect(wrapper.find('.doc-info .doc-name').text()).toBe('')
    expect(wrapper.find('.page-host').exists()).toBe(false)
    expect(wrapper.find('.enhanced-error').exists()).toBe(false)
    expect(wrapper.find('[role="status"]').text()).toBe('')

    wrapper.unmount()
  })

  it('clears previous text before loading a replacement that fails', async () => {
    parseFile
      .mockResolvedValueOnce(parsedDocument)
      .mockResolvedValueOnce({ success: false, error: 'Unreadable DOC' })
    const wrapper = mount(DocPreview, { props: { source: new File(['doc'], 'valid.doc') } })
    await flushPromises()
    expect(wrapper.vm.getPlainText()).toContain('Loaded document body')

    await wrapper.setProps({ source: new File(['bad'], 'invalid.doc') })
    expect(wrapper.vm.getPlainText()).toBe('')
    await flushPromises()

    expect(wrapper.vm.getPlainText()).toBe('')
    expect(wrapper.find('.enhanced-error').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('[role="status"]').text()).toBe('')
    wrapper.unmount()
  })

  it('does not announce success for empty parser output or render exceptions', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const throwingOutput = {
      success: true,
      get document() {
        throw new Error('synthetic render failure')
      },
    }
    parseFile
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce(throwingOutput)

    const emptyWrapper = mount(DocPreview, { props: { source: new File(['empty'], 'empty.doc') } })
    await flushPromises()
    expect(emptyWrapper.find('[role="alert"]').exists()).toBe(true)
    expect(emptyWrapper.find('[role="status"]').text()).toBe('')
    emptyWrapper.unmount()

    const throwingWrapper = mount(DocPreview, { props: { source: new File(['bad'], 'broken.doc') } })
    await flushPromises()
    expect(throwingWrapper.find('[role="alert"]').exists()).toBe(true)
    expect(throwingWrapper.find('[role="status"]').text()).toBe('')
    throwingWrapper.unmount()
  })

  it('does not render a stale result after the source is cleared', async () => {
    let resolveParse: ((value: typeof parsedDocument) => void) | undefined
    parseFile.mockImplementation(() => new Promise((resolve) => {
      resolveParse = resolve
    }))
    const wrapper = mount(DocPreview, { props: { source: new File(['doc'], 'pending.doc') } })
    await flushPromises()

    await wrapper.setProps({ source: null })
    resolveParse?.(parsedDocument)
    await flushPromises()

    expect(wrapper.vm.getPlainText()).toBe('')
    expect(wrapper.find('.page-host').exists()).toBe(false)

    wrapper.unmount()
  })

  it('aborts a URL request when the source is cleared', async () => {
    let resolveFetch: ((response: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void) | undefined
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, options?: RequestInit) => {
      requestSignal = options?.signal || undefined
      return new Promise((resolve) => {
        resolveFetch = resolve
      })
    }))
    const wrapper = mount(DocPreview, { props: { source: 'https://example.test/pending.doc' } })
    await flushPromises()
    expect(wrapper.find('[role="status"]').text()).toBe('')

    await wrapper.setProps({ source: null })
    resolveFetch?.({ ok: true, arrayBuffer: async () => new ArrayBuffer(32) })
    await flushPromises()

    expect(requestSignal?.aborted).toBe(true)
    expect(parseBuffer).not.toHaveBeenCalled()
    expect(wrapper.vm.getPlainText()).toBe('')

    wrapper.unmount()
  })

  it('aborts a pending URL request on unmount without parsing or emitting late events', async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    let requestSignal: AbortSignal | undefined
    const loaded = vi.fn()
    const errored = vi.fn()
    const loadingEvent = vi.fn()
    vi.stubGlobal('fetch', vi.fn((_url: string, options?: RequestInit) => {
      requestSignal = options?.signal || undefined
      return new Promise((resolve) => {
        resolveFetch = resolve
      })
    }))
    const wrapper = mount(DocPreview, {
      props: {
        source: 'https://example.test/pending.doc',
        onLoaded: loaded,
        onError: errored,
        onLoading: loadingEvent,
      },
    })
    await flushPromises()
    expect(wrapper.find('[role="status"]').text()).toBe('')
    expect(loadingEvent).toHaveBeenCalledTimes(1)
    expect(loadingEvent).toHaveBeenLastCalledWith(true)

    wrapper.unmount()
    expect(requestSignal?.aborted).toBe(true)
    resolveFetch?.({ ok: true } as Response)
    await flushPromises()

    expect(parseBuffer).not.toHaveBeenCalled()
    expect(loaded).not.toHaveBeenCalled()
    expect(errored).not.toHaveBeenCalled()
    expect(loadingEvent).toHaveBeenCalledTimes(1)
  })

  it('aborts an in-flight URL request when a file source replaces it', async () => {
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, options?: RequestInit) => {
      requestSignal = options?.signal || undefined
      return new Promise(() => {})
    }))
    parseFile.mockResolvedValue(parsedDocument)
    const wrapper = mount(DocPreview, { props: { source: 'https://example.test/pending.doc' } })
    await flushPromises()

    await wrapper.setProps({ source: new File(['doc'], 'replacement.doc') })
    await flushPromises()

    expect(requestSignal?.aborted).toBe(true)
    expect(wrapper.vm.getPlainText()).toContain('Loaded document body')

    wrapper.unmount()
  })

  it.each(['resolve', 'reject'] as const)('ignores pending file parser %s after unmount', async (settlement) => {
    let resolveParse: ((value: typeof parsedDocument) => void) | undefined
    let rejectParse: ((error: Error) => void) | undefined
    const loaded = vi.fn()
    const errored = vi.fn()
    const loadingEvent = vi.fn()
    parseFile.mockImplementationOnce(() => new Promise((resolve, reject) => {
      resolveParse = resolve
      rejectParse = reject
    }))
    const wrapper = mount(DocPreview, {
      props: {
        source: new File(['doc'], 'pending.doc'),
        onLoaded: loaded,
        onError: errored,
        onLoading: loadingEvent,
      },
    })
    await flushPromises()
    expect(wrapper.find('[role="status"]').text()).toBe('')
    expect(loadingEvent).toHaveBeenCalledTimes(1)
    expect(loadingEvent).toHaveBeenLastCalledWith(true)

    wrapper.unmount()
    if (settlement === 'resolve') resolveParse?.(parsedDocument)
    else rejectParse?.(new Error('late parser rejection'))
    await flushPromises()

    expect(loaded).not.toHaveBeenCalled()
    expect(errored).not.toHaveBeenCalled()
    expect(loadingEvent).toHaveBeenCalledTimes(1)
  })

  it('keeps the newer document when an earlier load resolves later', async () => {
    let resolveOldParse: ((value: typeof parsedDocument) => void) | undefined
    parseFile
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveOldParse = resolve
      }))
      .mockResolvedValueOnce({
        ...parsedDocument,
        document: {
          paragraphs: [{
            text: 'Newest document body',
            charFormat: { fontSize: 12 },
            paraFormat: { alignment: 'left' },
            _cpStart: 0,
          }],
        },
      })

    const wrapper = mount(DocPreview, { props: { source: new File(['old'], 'old.doc') } })
    await flushPromises()
    await wrapper.setProps({ source: new File(['new'], 'new.doc') })
    await flushPromises()
    expect(wrapper.vm.getPlainText()).toContain('Newest document body')

    resolveOldParse?.(parsedDocument)
    await flushPromises()
    expect(wrapper.vm.getPlainText()).toContain('Newest document body')

    wrapper.unmount()
  })
})
