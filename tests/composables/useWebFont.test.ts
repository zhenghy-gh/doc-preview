// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useWebFont } from '../../src/composables/useWebFont'

describe('useWebFont', () => {
  it('maps known fonts to Google Font prefixes only when enabled', () => {
    const enabled = ref(false)
    const { getWebFontFamily } = useWebFont(() => enabled.value)
    expect(getWebFontFamily('宋体')).toBe('')
    expect(getWebFontFamily('Unknown')).toBe('')
    enabled.value = true
    expect(getWebFontFamily('宋体')).toBe('Noto Serif SC, ')
    expect(getWebFontFamily('微软雅黑')).toBe('Noto Sans SC, ')
    expect(getWebFontFamily('Times New Roman')).toBe('Noto Serif, ')
    expect(getWebFontFamily('Unknown')).toBe('')
  })

  it('injects override style once when loading succeeds', async () => {
    const enabled = ref(true)
    const { loadWebFonts, webFontLoaded } = useWebFont(() => enabled.value)
    loadWebFonts()
    const link = document.querySelector('link[href*="fonts.googleapis.com"]') as HTMLLinkElement
    expect(link).not.toBeNull()
    link.onload!(new Event('load'))
    await Promise.resolve()
    expect(webFontLoaded.value).toBe(true)
    const style = document.getElementById('doc-preview-webfont-overrides')
    expect(style?.textContent).toContain('.document-content p')
    loadWebFonts() // idempotent: no second link
    expect(document.querySelectorAll('link[href*="fonts.googleapis.com"]')).toHaveLength(1)
  })
})
