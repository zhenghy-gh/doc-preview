// @vitest-environment happy-dom
//
// 搜索高亮走 DOM Range 包装（searchUtils），从不改写 htmlContent 字符串；
// 因此 toggleSearch 的 originalHtml 保存/恢复是死逻辑，且当搜索期间发生
// 显示切换（隐藏文字/修订 → applyFormattedPages 更新 htmlContent）时，
// 关闭搜索会把 htmlContent 回滚到过期内容，污染复制/打印。
import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import DocPreview from '../../src/components/DocPreview.vue'

type State = Record<string, any>

function renderWith(state: State, text: string) {
  state.lastParseResult = {
    paragraphs: [{ text, charFormat: {}, paraFormat: {} }],
    hyperlinks: [],
    revisions: [],
  }
  state.applyFormattedPages(
    state.lastParseResult.paragraphs,
    state.lastParseResult.hyperlinks,
    state.lastParseResult.revisions,
  )
}

describe('closing search must not clobber a re-rendered htmlContent', () => {
  it('keeps the newest html after a display change made while search was open', async () => {
    const wrapper = mount(DocPreview, { props: { source: null } })
    const state = (wrapper.vm.$ as unknown as { setupState: State }).setupState
    state.loading = false
    await nextTick()

    renderWith(state, 'first version')
    const original = state.htmlContent as string
    expect(original).toContain('first version')

    // 打开搜索（原实现保存 originalHtml = first version）
    state.toggleSearch()
    await nextTick()
    expect(state.virtualScrollEnabled).toBe(false)

    // 搜索期间发生显示切换：渲染内容更新为 second version
    renderWith(state, 'second version')
    const changed = state.htmlContent as string
    expect(changed).toContain('second version')
    expect(changed).not.toContain('first version')

    // 关闭搜索：htmlContent 必须保留最新渲染结果，不得回滚到 first version
    state.toggleSearch()
    await nextTick()
    expect(state.htmlContent).toBe(changed)
    expect(state.htmlContent).toContain('second version')
    wrapper.unmount()
  })
})
