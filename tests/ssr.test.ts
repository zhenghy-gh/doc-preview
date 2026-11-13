import { afterEach, describe, expect, it, vi } from 'vitest'

describe('server-side rendering', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('keeps locale changes working when storage access is denied', async () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('storage denied') },
      setItem() { throw new Error('storage denied') },
    })
    vi.resetModules()

    const { currentLocale, setLocale } = await import('../src/utils/locale')
    expect(currentLocale.value).toBe('zh-CN')
    expect(() => setLocale('en')).not.toThrow()
    expect(currentLocale.value).toBe('en')
  })

  it('imports the public entry and renders DocPreview without browser globals', async () => {
    vi.stubGlobal('localStorage', undefined)
    vi.stubGlobal('document', undefined)
    vi.stubGlobal('window', undefined)
    vi.resetModules()

    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('@vue/server-renderer')
    const { default: DocPreview } = await import('../src/index')
    const { setLocale } = await import('../src/utils/locale')
    const html = await renderToString(createSSRApp(DocPreview, { source: null }))

    expect(() => setLocale('en')).not.toThrow()
    expect(html).toContain('class="doc-preview"')
    expect(html).toContain('role="status"')
  })
})
