// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import DocPreview from '../../src/components/DocPreview.vue'
import { sanitizePreviewHtml } from '../../src/utils/sanitizeHtml'

const { parseFile } = vi.hoisted(() => ({ parseFile: vi.fn() }))

vi.mock('../../src/utils/docParser', () => ({
  parseDocFileWithFormat: parseFile,
  parseDocFileFromBuffer: vi.fn(),
}))

vi.mock('../../src/utils/parseWithWorker', () => ({
  parseWithWorker: vi.fn(),
}))

describe('untrusted preview HTML', () => {
  afterEach(() => {
    parseFile.mockReset()
  })

  it('removes executable elements, event attributes and unsafe URL schemes', () => {
    const sanitized = sanitizePreviewHtml(
      '<p style="font-weight:bold">Safe<script>window.__xss = true</script>' +
      '<img src="x" onerror="window.__xss = true">' +
      '<a href="javascript:alert(1)" onclick="alert(2)">link</a></p>',
    )
    const host = document.createElement('div')
    host.innerHTML = sanitized

    expect(host.querySelector('p')?.style.fontWeight).toBe('bold')
    expect(host.querySelector('script')).toBeNull()
    expect(host.querySelector('img')?.hasAttribute('onerror')).toBe(false)
    expect(host.querySelector('a')?.hasAttribute('onclick')).toBe(false)
    expect(host.querySelector('a')?.hasAttribute('href')).toBe(false)
  })

  it('sanitizes unlinked document text when a paragraph also has a hyperlink', async () => {
    const text = '<img src="x" onerror="window.__xss = true"> linked text'
    const start = text.indexOf('linked text')
    parseFile.mockResolvedValue({
      success: true,
      document: {
        paragraphs: [{
          text,
          charFormat: { fontSize: 12 },
          paraFormat: { alignment: 'left' },
          _cpStart: 0,
        }],
        hyperlinks: [{
          cpStart: start,
          cpEnd: text.length,
          url: 'javascript:window.__xss=true',
          result: 'linked text',
        }],
      },
    })

    const wrapper = mount(DocPreview, { props: { source: new File(['doc'], 'unsafe.doc') } })
    await flushPromises()

    const rendered = wrapper.get('.document-content')
    expect(rendered.find('img').attributes('onerror')).toBeUndefined()
    expect(rendered.find('a').attributes('href')).toBeUndefined()
    expect(rendered.text()).toContain('linked text')

    wrapper.unmount()
  })
})
