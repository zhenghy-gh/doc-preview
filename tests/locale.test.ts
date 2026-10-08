import { describe, it, expect, vi, beforeEach } from 'vitest'

// 本文件用 vi.resetModules() + 动态 import 重载模块图：首个用例要承担整张模块图
// 的重新转换与求值。59 个测试文件并行时该步可能超过默认 5000ms 超时
// （实测本机套件 environment 阶段可达 1900s，而该用例单跑仅约 700ms）。
// 因此仅放宽超时上限，断言与用例语义均不变。
vi.setConfig({ testTimeout: 30000 })

function stubStorage(saved: string | null) {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => saved),
    setItem: vi.fn(),
  })
}

describe('locale', () => {
  beforeEach(() => {
    stubStorage(null)
    vi.resetModules()
  })

  it('translates strings, functions, params and falls back to the key', async () => {
    const { t, setLocale, currentLocale } = await import('../src/utils/locale')
    expect(t('app.title')).toBe('DOC文件在线预览')
    // String value + params exercises the placeholder replacement loop
    expect(t('app.title', { foo: 'bar' })).toBe('DOC文件在线预览')
    // Function value with params
    expect(t('loading.size', { size: '1.5 MB' })).toContain('1.5 MB')
    // Function value with several params (textbox anchor tooltip)
    expect(t('textbox.anchor.tooltip', { type: 'rect', x: 1, y: 2, w: 3, h: 4, cp: 5, spid: 6 })).toContain('SPID: 6')
    // Missing key falls back to the key itself
    expect(t('nonexistent.key')).toBe('nonexistent.key')
    // Nested Record values are not directly translatable via t()
    expect(t('shortcuts.items')).toBe('shortcuts.items')
    setLocale('en')
    expect(currentLocale.value).toBe('en')
    expect(t('app.title')).toBe('DOC File Online Preview')
    expect(t('textbox.anchor.tooltip', { type: 'rect', x: 1, y: 2, w: 3, h: 4, cp: 5, spid: 6 })).toContain('SPID: 6')
  })

  it('maps nested keys with tMap', async () => {
    const { tMap, setLocale } = await import('../src/utils/locale')
    const en = tMap('shortcuts.items', 'pageUp')
    expect(typeof en).toBe('string')
    expect(en.length).toBeGreaterThan(0)
    setLocale('zh-CN')
    const zh = tMap('shortcuts.items', 'pageUp')
    expect(zh.length).toBeGreaterThan(0)
    expect(tMap('shortcuts.items', 'missingSub')).toBe('missingSub')
    expect(tMap('nope', 'x')).toBe('x')
  })

  it('restores a saved locale from localStorage on load', async () => {
    stubStorage('en')
    vi.resetModules()
    const { t, currentLocale } = await import('../src/utils/locale')
    expect(currentLocale.value).toBe('en')
    expect(t('app.title')).toBe('DOC File Online Preview')
  })
})
