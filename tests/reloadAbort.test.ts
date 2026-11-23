// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import DocPreview from '../src/components/DocPreview.vue'

const wrappers: VueWrapper[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  wrappers.forEach(w => w.unmount())
  wrappers.length = 0
})

/** reload() 必须取消在途 URL 加载，否则旧请求的迟到结果会覆盖重载后的状态。 */
describe('reload aborts in-flight URL load', () => {
  it('aborts the previous fetch when reload is invoked', async () => {
    const signals: AbortSignal[] = []
    const reasons: unknown[] = []
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal: AbortSignal }) => {
      init.signal.addEventListener('abort', () => reasons.push(init.signal.reason))
      signals.push(init.signal)
      // 永不 resolve：模拟慢响应，便于观察取消行为
      return new Promise<Response>(() => {})
    }))

    const wrapper = mount(DocPreview, { props: { source: 'http://example.test/a.doc' } })
    wrappers.push(wrapper)
    await nextTick()
    expect(signals.length).toBe(1)
    expect(signals[0].aborted).toBe(false)

    ;(wrapper.vm as unknown as { reload: () => void }).reload()
    await nextTick()

    expect(signals).toHaveLength(2)
    expect(signals[0].aborted).toBe(true) // 旧请求被取消
    expect(reasons[0]).toBe('reload') // 必须由 reload 主动取消（否则 loadFromUrl 自取消的原因会是 'superseded'）
    expect(signals[1].aborted).toBe(false) // 新请求正常在途
  })
})
