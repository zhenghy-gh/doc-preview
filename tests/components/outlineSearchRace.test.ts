// @vitest-environment happy-dom
/**
 * 大纲导航 × 搜索的虚拟滚动恢复竞态回归。
 *
 * `scrollToOutline` 临时关闭虚拟滚动后，用一个 600ms 定时器恢复。若这期间用户
 * 打开搜索（搜索依赖全页 DOM 渲染），旧定时器会把虚拟滚动重新打开，导致页面
 * 重新变成占位符、搜索高亮/计数失效。本组用例先用 fake timer 证伪，再钉住修复。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import DocPreview from '../../src/components/DocPreview.vue'

type SetupState = Record<string, any>
const wrappers: VueWrapper[] = []

afterEach(() => {
  vi.useRealTimers()
  while (wrappers.length > 0) wrappers.pop()?.unmount()
})

async function mountWithPages(n = 20) {
  const wrapper = mount(DocPreview, { props: { source: null } })
  wrappers.push(wrapper)
  const state = (wrapper.vm.$ as unknown as { setupState: SetupState }).setupState
  state.loading = false
  await nextTick()
  state.pages = Array.from({ length: n }, (_, i) => `<div class="page-content"><p>p${i}</p></div>`)
  state.htmlContent = (state.pages as string[]).join('\n')
  state.updateTotalPages()
  state.virtualScrollEnabled = true
  state.visibleStart = 0
  state.visibleEnd = 2
  await nextTick()
  await nextTick()
  return { wrapper, state }
}

describe('outline navigation restore vs search', () => {
  it('does NOT re-enable virtual scroll when search was opened during the restore delay', async () => {
    vi.useFakeTimers()
    const { state } = await mountWithPages()

    state.scrollToOutline({ text: 'p5', level: 1, index: 5 })
    await nextTick()
    expect(state.virtualScrollEnabled).toBe(false)

    // 用户在 600ms 窗口内开启搜索：搜索要求所有页面真实渲染
    state.toggleSearch()
    await nextTick()
    expect(state.showSearch).toBe(true)
    expect(state.virtualScrollEnabled).toBe(false)

    // 大纲导航的恢复定时器到期，但搜索仍开着 —— 绝不能把虚拟滚动重新打开
    vi.advanceTimersByTime(700)
    await nextTick()
    await nextTick()
    expect(state.showSearch).toBe(true)
    expect(state.virtualScrollEnabled).toBe(false)
  })

  it('still restores virtual scroll after navigation when search stayed closed', async () => {
    vi.useFakeTimers()
    const { state } = await mountWithPages()

    state.scrollToOutline({ text: 'p5', level: 1, index: 5 })
    await nextTick()
    expect(state.virtualScrollEnabled).toBe(false)

    vi.advanceTimersByTime(700)
    await nextTick()
    await nextTick()
    expect(state.virtualScrollEnabled).toBe(true)
  })
})
