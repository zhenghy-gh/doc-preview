// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import DocPreview from '../../src/components/DocPreview.vue'

type State = Record<string, any>

describe('copy feedback scoping', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => {} },
    })
  })

  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  })

  it('shows the ✓ on the originating instance, never on a sibling DocPreview', async () => {
    const a = mount(DocPreview, { props: { source: null }, attachTo: document.body })
    const b = mount(DocPreview, { props: { source: null }, attachTo: document.body })
    for (const wrapper of [a, b]) {
      const state = (wrapper.vm.$ as unknown as { setupState: State }).setupState
      state.loading = false
      state.plainText = 'copy me'
    }
    await nextTick()

    const stateB = (b.vm.$ as unknown as { setupState: State }).setupState
    await stateB.copyText()
    await nextTick()

    expect(a.find('.toolbar-btn[data-action="copy-text"]').text()).toContain('📋')
    expect(b.find('.toolbar-btn[data-action="copy-text"]').text()).toBe('✓')
    a.unmount()
    b.unmount()
  })
})
