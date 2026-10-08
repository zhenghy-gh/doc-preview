// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ShortcutsPanel from '../src/components/ShortcutsPanel.vue'
import { setLocale } from '../src/utils/locale'

/**
 * I18N-P0 回归钉（vue-dev-6 · 2026-08-26）
 *
 * 背景：shortcuts.items 在 locale.ts 双字典中是嵌套 Record（17 条），
 * ShortcutsPanel 曾用扁平键 t('shortcuts.items.xxx') 查询 —— t() 对
 * dotted key 必然 miss 并回退返回 key 本身，导致中英双语下面板 13 条
 * 标签全部渲染成 "shortcuts.items.nextMatch" 之类原始串。
 *
 * 修复：组件改走 useI18n().tMap('shortcuts.items', subKey)。
 * 本文件钉死两个不变量：
 *   R1 任何语言下标签都不得再出现裸 key 前缀 'shortcuts.items.'
 *   R2 双语各自命中真实文案（zh 抽样 + en 抽样），13 条数量不回退
 */

afterEach(() => {
  // locale 是模块级单例，测后还原避免污染其他用例（对齐 chartRenderer 冒烟先例）
  setLocale('zh-CN')
})

function mountLabels() {
  const wrapper = mount(ShortcutsPanel, { props: { modelValue: true } })
  return wrapper.findAll('.shortcut-label').map(n => n.text())
}

describe('ShortcutsPanel i18n labels (I18N-P0 regression)', () => {
  it('zh-CN: renders real labels, never raw keys', () => {
    const labels = mountLabels()
    expect(labels.length).toBe(13)
    expect(labels.join('\n')).not.toContain('shortcuts.items.')
    expect(labels).toContain('搜索文档')
    expect(labels).toContain('上一个匹配')
    expect(labels).toContain('上一页')
    expect(labels).toContain('重置缩放')
  })

  it('en: renders translated labels after setLocale(en)', () => {
    setLocale('en')
    const labels = mountLabels()
    expect(labels.length).toBe(13)
    expect(labels.join('\n')).not.toContain('shortcuts.items.')
    expect(labels).toContain('Search document')
    expect(labels).toContain('Previous match')
    expect(labels).toContain('Previous page')
    expect(labels).toContain('Reset zoom')
  })
})
