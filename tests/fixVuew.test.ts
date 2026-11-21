// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import DocPreview from '../src/components/DocPreview.vue'

/**
 * FIX-VUEW 回归钉（vue-dev-6 · 2026-08-26）
 *
 * ① 复制按钮定位：showCopySuccess 曾用 `.toolbar-btn[title*="复制"]` 中文
 *    title 文本选择器，i18n 化或切 EN 后即失效。现改为语言无关的
 *    data-action="copy-text" 属性。本用例挂载真实组件（经 setupState 关闭
 *    初始 loading 以渲染工具栏），钉住该属性真实出现在渲染输出中。
 * ② 缩放实现：.paper-page 曾用不参与布局的 transform: scale —— 布局盒恒为
 *    800px，≥150% 时视觉盒溢出被裁切并与 float 左浮的大纲侧栏重叠。
 *    现改用真实回流的 zoom。静态守卫防止未来回退到 transform 方案。
 */

const componentSource = () =>
  readFileSync(join(process.cwd(), 'src/components/DocPreview.vue'), 'utf8')

async function mountWithToolbar() {
  const wrapper = mount(DocPreview, { props: { source: null } })
  // loading 初始恒 true（等待加载），无 source 时不会自动结束；
  // 经实例 setupState 直接关闭以渲染工具栏（perf-baseline 同款驱动手法）。
  ;(wrapper.vm.$ as unknown as { setupState: Record<string, unknown> }).setupState.loading = false
  await nextTick()
  return wrapper
}

describe('FIX-VUEW', () => {
  it('copy button carries stable data-action attribute (locale-proof)', async () => {
    const wrapper = await mountWithToolbar()
    const btn = wrapper.find('.toolbar-btn[data-action="copy-text"]')
    expect(btn.exists()).toBe(true)
    // 确认就是复制按钮本身（图标在位、可访问名非空），而非误配的其它按钮
    expect(btn.text()).toContain('📋')
    expect(btn.attributes('aria-label')).toBeTruthy()
    wrapper.unmount()
  })

  it('paper-page zooms via reflow-aware zoom, never transform:scale', () => {
    const src = componentSource()
    expect(src).toMatch(/\.paper-page\s*\{[^}]*zoom:\s*var\(--zoom/s)
    expect(src).not.toMatch(/transform:\s*scale\(var\(--zoom/)
    // 旧失效选择器不得作为查询实参复活（注释中的历史说明不受限）
    expect(src).not.toMatch(/querySelector\(\s*[`'"][^`'"]*title\*=/)
  })

  it('skip link targets a focusable document content anchor', () => {
    const src = componentSource()
    expect(src).toMatch(/<a[^>]+class="skip-link"[^>]+href="#doc-content"/s)
    expect(src).toMatch(/<div[^>]+id="doc-content"[^>]+class="document-content"[^>]+tabindex="-1"/s)
    expect(src).toMatch(/const content = previewRef\.value\?\.querySelector\('\.document-content'\) as HTMLElement \| null/)
    expect(src).toMatch(/if \(content\) \{\s*content\.focus\(\)\s*\} else \{/s)
  })

  it('pagination status announces page changes', () => {
    // 分页控件已抽到 PreviewToolbar.vue（Phase 1），守卫相应迁移。
    const src = readFileSync(join(process.cwd(), 'src/components/PreviewToolbar.vue'), 'utf8')
    expect(src).toMatch(/class="pagination-info"[\s\S]*role="status"[\s\S]*aria-live="polite"/)
  })

  it('rich clipboard copy guards optional browser APIs before construction', () => {
    // 复制逻辑已抽到 composables/useExport.ts（Phase 1），守卫相应迁移。
    const src = readFileSync(join(process.cwd(), 'src/composables/useExport.ts'), 'utf8')
    expect(src).toMatch(/typeof ClipboardItem === 'undefined'/)
    expect(src).toMatch(/typeof navigator\.clipboard\?\.write !== 'function'/)
    expect(src).toMatch(/try \{[\s\S]*new Blob\(\[htmlContent\.value\]/)
  })
})
