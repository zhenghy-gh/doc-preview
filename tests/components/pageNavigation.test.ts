// @vitest-environment happy-dom
//
// 页码导航 × 虚拟滚动回归：
//   1) scrollToPage 必须以「绝对页码 data-page-idx」定位目标页，而非用绝对页码去
//      索引稀疏的 .page-content / .page-placeholder NodeList —— 虚拟滚动下 DOM 只
//      渲染窗口内的页，NodeList 下标与页码错位，旧实现会滚到错误页面；
//   2) 搜索临时关闭虚拟滚动 → 关闭搜索恢复，所有页重新渲染 / 窗口重新计算。
import { describe, it, expect, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import DocPreview from '../../src/components/DocPreview.vue'

type State = Record<string, any>
const wrappers: VueWrapper[] = []
const scrollProto = HTMLElement.prototype
const originalScrollIntoView = scrollProto.scrollIntoView
afterEach(() => {
  scrollProto.scrollIntoView = originalScrollIntoView
  while (wrappers.length > 0) wrappers.pop()?.unmount()
})

async function mountWithPages(n: number, start: number, end: number) {
  const wrapper = mount(DocPreview, { props: { source: null } })
  wrappers.push(wrapper)
  const state = (wrapper.vm.$ as unknown as { setupState: State }).setupState
  state.loading = false
  await nextTick()
  state.pages = Array.from({ length: n }, (_, i) => `<div class="page-content"><p>p${i}</p></div>`)
  state.htmlContent = (state.pages as string[]).join('\n')
  state.updateTotalPages()
  state.virtualScrollEnabled = true
  state.visibleStart = start
  state.visibleEnd = end
  await nextTick()
  await nextTick()
  return { wrapper, state }
}

/** 在原型上打桩，记录 scrollIntoView 命中的绝对页码。
 *  扩窗会重建 .page-host 节点，故不能给单个元素打桩——必须在原型上拦截。 */
function recordScrollTargets(): string[] {
  const calls: string[] = []
  scrollProto.scrollIntoView = function (this: HTMLElement) {
    const host = this.closest('[data-page-idx]') as HTMLElement | null
    calls.push(host?.getAttribute('data-page-idx') ?? '?')
  }
  return calls
}

describe('page navigation under virtual scroll', () => {
  it('scrolls to the requested page by absolute index even when the window must expand', async () => {
    // 20 页，初始窗口 [5,7]；跳到第 15 页（idx=14）会扩窗为 [13,15]。
    // 扩窗后 DOM 仅渲染 3 个 .page-content（页码 13/14/15），旧实现取
    // pageElements[14] 越界 → 落到 placeholders[14]（实为第 17 页）。
    const { state } = await mountWithPages(20, 5, 7)
    const calls = recordScrollTargets()

    state.goToPage(15) // page=15 → idx=14
    await nextTick()
    await nextTick()

    expect(state.currentPage).toBe(15)
    expect(state.visibleStart).toBe(13)
    expect(state.visibleEnd).toBe(15)
    // 必须且只滚动到绝对页码 14；旧实现会记下 '17'（错误页）。
    expect(calls).toEqual(['14'])
  })

  it('scrolls to within-window pages by absolute index (window already covers target)', async () => {
    const { state } = await mountWithPages(20, 10, 12)
    const calls = recordScrollTargets()

    state.goToPage(12) // idx=11，已在 [10,12] 内，不扩窗
    await nextTick()
    await nextTick()

    expect(calls).toEqual(['11'])
  })

  it('search disables virtual scroll (all pages rendered) and closing restores it', async () => {
    const { wrapper, state } = await mountWithPages(20, 0, 2)
    // 初始：虚拟滚动开启，窗口外页面渲染为占位符
    expect(wrapper.findAll('.page-placeholder').length).toBe(17)

    state.toggleSearch()
    await nextTick()
    expect(state.virtualScrollEnabled).toBe(false)
    // 搜索态所有页必须真实渲染，才能遍历全部 DOM 做高亮
    expect(wrapper.findAll('.page-placeholder').length).toBe(0)
    expect(wrapper.findAll('.page-host').length).toBe(20)

    state.toggleSearch()
    await nextTick()
    await nextTick()
    expect(state.virtualScrollEnabled).toBe(true)
    // 恢复后窗口外重新变回占位符
    expect(wrapper.findAll('.page-placeholder').length).toBeGreaterThan(0)
  })
})
