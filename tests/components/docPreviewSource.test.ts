// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import DocPreview from '../../src/components/DocPreview.vue'

const { parseFile, parseBuffer } = vi.hoisted(() => ({
  parseFile: vi.fn(),
  parseBuffer: vi.fn(),
}))

vi.mock('../../src/utils/docParser', () => ({
  parseDocFileWithFormat: parseFile,
  parseDocFileFromBuffer: parseBuffer,
}))

vi.mock('../../src/utils/parseWithWorker', () => ({
  parseWithWorker: vi.fn(),
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
    parseFile.mockReset()
    parseBuffer.mockReset()
  })

  it('starts idle when there is no source', async () => {
    const wrapper = mount(DocPreview, { props: { source: null } })
    await flushPromises()

    expect(wrapper.find('.loading-container').exists()).toBe(false)
    expect(wrapper.vm.getPlainText()).toBe('')

    wrapper.unmount()
  })

  it('clears the rendered document when source becomes null', async () => {
    parseFile.mockResolvedValue(parsedDocument)
    const wrapper = mount(DocPreview, { props: { source: new File(['doc'], 'sample.doc') } })
    await flushPromises()

    expect(wrapper.vm.getPlainText()).toContain('Loaded document body')

    await wrapper.setProps({ source: null })
    await flushPromises()

    expect(wrapper.vm.getPlainText()).toBe('')
    expect(wrapper.find('.doc-info .doc-name').text()).toBe('')
    expect(wrapper.find('.page-host').exists()).toBe(false)
    expect(wrapper.find('.enhanced-error').exists()).toBe(false)

    wrapper.unmount()
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

  it('does not parse a URL response after the source is cleared', async () => {
    let resolveFetch: ((response: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void) | undefined
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
      resolveFetch = resolve
    })))
    const wrapper = mount(DocPreview, { props: { source: 'https://example.test/pending.doc' } })
    await flushPromises()

    await wrapper.setProps({ source: null })
    resolveFetch?.({ ok: true, arrayBuffer: async () => new ArrayBuffer(32) })
    await flushPromises()

    expect(parseBuffer).not.toHaveBeenCalled()
    expect(wrapper.vm.getPlainText()).toBe('')

    wrapper.unmount()
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
