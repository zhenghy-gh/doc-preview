// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * COMPOSABLES-E useI18n 单测（vue-dev-2 · 2026-08-25）
 *
 * 被测对象是 locale.ts 全局单例的纯委托薄包装，因此用例沿两条线验证：
 * 1) 委托正确性：locale/setLocale/t/tMap 行为与 utils/locale 语义逐一同构；
 * 2) 单例承载的持久化/启动恢复经包装后仍然成立（键 'locale'，safeStorage）。
 *
 * 模块级单例：仿 useDarkMode.test.ts 用 vi.resetModules() + 动态 import
 * 取得全新实例，模拟「页面刷新后重新初始化」（同时重置 locale.ts 的
 * shallowRef 与 safeStorage 内存镜像，保证用例间隔离）。
 */

const STORAGE_KEY = 'locale'

// 用例间清理持久化存储：locale.ts 模块初始化会读取 'locale' 键做启动恢复，
// 前序用例残留值会污染后续用例的默认值断言。
beforeEach(() => {
  window.localStorage.clear()
})

async function loadFresh() {
  vi.resetModules()
  const mod = await import('../../src/composables/useI18n')
  return mod.useI18n()
}

describe('useI18n', () => {
  it('returns the same singleton instance across calls', async () => {
    vi.resetModules()
    const mod = await import('../../src/composables/useI18n')
    expect(mod.useI18n()).toBe(mod.useI18n())
  })

  it('defaults to zh-CN and switches language via setLocale delegation', async () => {
    const { locale, setLocale } = await loadFresh()
    expect(locale.value).toBe('zh-CN')
    setLocale('en')
    expect(locale.value).toBe('en')
    setLocale('zh-CN')
    expect(locale.value).toBe('zh-CN')
  })

  it('persists the choice to localStorage under the "locale" key', async () => {
    const { setLocale } = await loadFresh()
    setLocale('en')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('en')
    setLocale('zh-CN')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('zh-CN')
  })

  it('restores the persisted locale on startup (fresh module load)', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'en')
    const { locale } = await loadFresh()
    expect(locale.value).toBe('en')
  })

  it('ignores an invalid persisted value and falls back to zh-CN', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'fr')
    const { locale } = await loadFresh()
    expect(locale.value).toBe('zh-CN')
  })

  it('delegates t() to the shared dictionary with live reactivity on switch', async () => {
    const { t, setLocale } = await loadFresh()
    expect(t('app.title')).toBe('DOC文件在线预览')
    setLocale('en')
    expect(t('app.title')).toBe('DOC File Online Preview')
    // 缺键回退返回键名本身（locale.ts 原样语义）
    expect(t('no.such.key')).toBe('no.such.key')
  })

  it('delegates tMap() for nested dictionaries and falls back to the subKey', async () => {
    const { tMap, setLocale } = await loadFresh()
    expect(tMap('shortcuts.items', 'toggleSearch')).toBe('搜索文档')
    setLocale('en')
    expect(tMap('shortcuts.items', 'toggleSearch')).toBe('Search document')
    // 缺 subKey 回退返回 subKey 本身（locale.ts 原样语义）
    expect(tMap('shortcuts.items', 'noSuchSubKey')).toBe('noSuchSubKey')
  })
})
