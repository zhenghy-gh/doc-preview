// @vitest-environment happy-dom
//
// PERF-T1 · 虚拟滚动高度缓存专项（perf-dev · 2026-08-25）
//
// 覆盖三件事：
//   1) measureVisiblePageHeights 以 data-page-idx 绝对页码为缓存键——
//      旧实现用 NodeList 序号当页码，visibleStart>0 后系统性写错 key；
//   2) 测量值对 FIX-VUEW 的 CSS zoom 归一化（gBCR 视觉像素 → 布局像素入库）；
//   3) updateVisibleRange 的视口度量按 zoom 换算，与布局像素累计同单位系。
// happy-dom 中 gBCR 默认全 0，因此逐元素覆写以注入确定的视觉高度。
// 注意：VTU mount 默认不挂到 document.body，DOM 查询必须走 wrapper 作用域。

import { describe, it, expect, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import DocPreview from '../src/components/DocPreview.vue'
import { PT_TO_PX } from '../src/utils/rendering/pageBuilder'

const wrappers: VueWrapper[] = []
afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount()
})

function stubVisualHeight(el: Element, visualPx: number) {
  ;(el as HTMLElement).getBoundingClientRect = () =>
    ({
      height: visualPx, width: 100, top: 0, left: 0, right: 100, bottom: visualPx,
      x: 0, y: 0, toJSON() { return this },
    }) as DOMRect
}

function stubRectTop(el: HTMLElement, topVisual: number) {
  el.getBoundingClientRect = () =>
    ({
      height: 99999, width: 800, top: topVisual, left: 0,
      right: 800, bottom: topVisual + 99999, x: 0, y: topVisual,
      toJSON() { return this },
    }) as DOMRect
}

/** 挂载（source=null 不触发解析），注入 N 页合成 pages 并打开 [start,end] 窗口。 */
async function mountWithPages(n: number, start: number, end: number) {
  const wrapper = mount(DocPreview, { props: { source: null } })
  wrappers.push(wrapper)
  const ss = wrapper.vm.$.setupState as Record<string, any>
  ss.loading = false // source=null 不会结束 loading，手动进入 preview 分支
  await nextTick()
  ss.pages = Array.from({ length: n }, (_, i) => `<div class="page-content"><p>p${i}</p></div>`)
  ss.htmlContent = (ss.pages as string[]).join('\n')
  ss.visibleStart = start
  ss.visibleEnd = end
  await nextTick()
  await nextTick()
  return { wrapper, ss }
}

function docContent(wrapper: VueWrapper): HTMLElement {
  const el = wrapper.find('.document-content')
  expect(el.exists()).toBe(true)
  return el.element as HTMLElement
}

describe('PERF-T1 · virtual scroll height cache', () => {
  it('keys measurements by ABSOLUTE page index when the window starts > 0', async () => {
    // 渲染窗口为第 2~4 页：NodeList 序号(0,1,2) ≠ 绝对页码(2,3,4)
    const { wrapper, ss } = await mountWithPages(6, 2, 4)
    const hosts = docContent(wrapper).querySelectorAll('.page-host[data-page-idx]')
    expect(hosts.length).toBe(3)
    expect([...hosts].map(h => h.getAttribute('data-page-idx'))).toEqual(['2', '3', '4'])

    const visual = [222, 333, 444]
    hosts.forEach((h, i) => {
      const pc = h.querySelector('.page-content') ?? h
      stubVisualHeight(pc, visual[i])
    })

    const changed = ss.measureVisiblePageHeights()
    expect(changed).toBe(true)
    const cache = ss.pageHeights as Record<number, number>
    // 旧实现会把这些值错写到 key 0/1/2
    expect(cache[2]).toBeCloseTo(222, 6)
    expect(cache[3]).toBeCloseTo(333, 6)
    expect(cache[4]).toBeCloseTo(444, 6)
    expect(cache[0]).toBeUndefined()
    expect(cache[1]).toBeUndefined()
  })

  it('normalizes measured heights to layout px under >100% CSS zoom', async () => {
    const { wrapper, ss } = await mountWithPages(6, 1, 3)
    ss.zoomLevel = 150 // .paper-page { zoom: 1.5 }
    await nextTick()

    const layoutHeights = [100, 250] // 页面真实布局高度（第三页不测）
    const hosts = docContent(wrapper).querySelectorAll('.page-host[data-page-idx]')
    expect(hosts.length).toBe(3)
    hosts.forEach((h, i) => {
      if (i >= layoutHeights.length) return
      const pc = h.querySelector('.page-content') ?? h
      stubVisualHeight(pc, layoutHeights[i] * 1.5) // gBCR 返回缩放后视觉像素
    })

    ss.measureVisiblePageHeights()
    const cache = ss.pageHeights as Record<number, number>
    // 入库的是布局像素（视觉 ÷ 1.5），而非视觉像素本身
    expect(cache[1]).toBeCloseTo(100, 6)
    expect(cache[2]).toBeCloseTo(250, 6)
  })

  it('updateVisibleRange compares viewport metrics in zoom-normalized units', async () => {
    const defaultH = Math.max(400, 842 * PT_TO_PX) // 未测页的占位估算高度
    const { wrapper, ss } = await mountWithPages(6, 0, 5)
    ss.zoomLevel = 200 // zoom=2：视觉像素 ÷2 = 布局像素
    await nextTick()

    // 容器顶部在视觉坐标系位于 -defaultH*4*2 → viewportTop_layout = 4*defaultH：
    // index 0..3 的页底均 ≤ viewportTop（页底恰在视口顶=可见面积为零）→ rawStart=4；
    // 视口高 768/2=384 布局像素，首个累计超出窗口底的 i 决定 rawEnd。
    stubRectTop(docContent(wrapper), -defaultH * 4 * 2)

    ss.updateVisibleRange()

    let acc = 0
    let rawStart = 0
    let rawEnd = 5
    for (let i = 0; i < 6; i++) {
      if (acc + defaultH <= 4 * defaultH) rawStart = i + 1
      if (acc > 4 * defaultH + 768 / 2) { rawEnd = i - 1; break }
      acc += defaultH
    }
    // 与实现同式的期望值推导后断言（含 VIRTUAL_BUFFER=1 缓冲）
    expect(ss.visibleStart).toBe(Math.max(0, rawStart - 1))
    expect(ss.visibleEnd).toBe(Math.min(5, rawEnd + 1))
    // 关键不变量：zoom 归一化下，窗口必须落在布局坐标推得的同一范围
    expect(ss.visibleStart).toBe(3)
    expect(ss.visibleEnd).toBe(5)
  })
})
