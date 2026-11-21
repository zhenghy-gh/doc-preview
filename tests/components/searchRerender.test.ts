// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import DocPreview from '../../src/components/DocPreview.vue'

type SetupState = Record<string, any>

/**
 * 显示类切换（隐藏文字 / 修订模式）会重建 v-html 页面。本组用例钉住
 * 「重建后自动恢复搜索高亮」契约：否则状态栏仍显示 1/N 但正文无高亮、
 * 上一/下一匹配按钮点了没反应。
 *
 * 注意：fixture 必须让重渲染真的产出不同 HTML（隐藏文字样式 / 修订标记），
 * 否则 Vue 对相同 v-html 字符串不做 DOM patch，无法暴露高亮丢失。
 */
async function mountWithActiveSearch(opts: { hidden?: boolean; revision?: boolean } = {}) {
  const wrapper = mount(DocPreview, { props: { source: null } })
  const state = (wrapper.vm.$ as unknown as { setupState: SetupState }).setupState
  state.loading = false
  // formatTextWithCharacterStyles 仅在覆盖 >=80% 文本时才走细粒度分支，
  // 因此隐藏段要覆盖整段，才能真实改变重渲染 HTML。
  const charFormat = opts.hidden
    ? { styles: [{ start: 0, end: 18, style: { hidden: true } }] }
    : {}
  const revisions = opts.revision
    ? [{ type: 'insert', cpStart: 6, cpEnd: 13, author: 'Tester' }]
    : []
  state.lastParseResult = {
    paragraphs: [{ text: 'alpha keyword beta', charFormat, paraFormat: {} }],
    hyperlinks: [],
    revisions,
  }
  state.applyFormattedPages(
    state.lastParseResult.paragraphs,
    state.lastParseResult.hyperlinks,
    state.lastParseResult.revisions,
  )
  state.showSearch = true
  state.searchQuery = 'keyword'
  await nextTick()
  state.performSearch()
  await nextTick()
  return { wrapper, state }
}

describe('search highlight survives display re-render', () => {
  it('keeps highlights after toggling hidden text', async () => {
    const { wrapper, state } = await mountWithActiveSearch({ hidden: true })
    expect(wrapper.findAll('.search-highlight')).toHaveLength(1)

    state.toggleHiddenText()
    await nextTick()
    await nextTick()
    expect(wrapper.findAll('.search-highlight')).toHaveLength(1)
    wrapper.unmount()
  })

  it('keeps highlights after changing revision mode', async () => {
    const { wrapper, state } = await mountWithActiveSearch({ revision: true })
    expect(wrapper.findAll('.search-highlight')).toHaveLength(1)

    state.setRevisionMode('accepted')
    await nextTick()
    await nextTick()
    expect(wrapper.findAll('.search-highlight')).toHaveLength(1)
    wrapper.unmount()
  })
})
