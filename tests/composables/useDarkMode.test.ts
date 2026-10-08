// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

// 本文件每个用例都走 vi.resetModules() + 动态 import 重载模块图，首个用例还要
// 承担整张模块图的首次转换。59 个测试文件并行时该步可能超过默认 5000ms 超时
// （实测本机套件 environment 阶段可达 1900s）。仅放宽超时上限，断言不变。
vi.setConfig({ testTimeout: 30000 })

/**
 * W1-C useDarkMode 单一数据源验证（ui-kit-dev · 2026-08-25）
 *
 * 对应验收红线：
 * - 初始值兜底 prefers-color-scheme
 * - localStorage('dark-mode') 持久化 + 刷新（重新加载模块）后保持
 * - 多标签页 storage 事件实时同步
 * - html.dark class 由 composable 统一挂载/摘除
 *
 * composable 为模块级单例：用 vi.resetModules() + 动态 import 在每个用例中
 * 取得全新实例，模拟「页面刷新后重新初始化」。
 */

const STORAGE_KEY = 'dark-mode'

let systemPrefersDark = false

function stubMatchMedia(): void {
  const matcher = (query: string) => ({
    matches: systemPrefersDark && query.includes('dark'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
  ;(window as unknown as { matchMedia: unknown }).matchMedia = matcher
}

async function loadFreshModule() {
  vi.resetModules()
  const mod = await import('../../src/composables/useDarkMode')
  return mod.useDarkMode()
}

function dispatchStorageEvent(key: string | null, newValue: string | null): void {
  let event: Event
  try {
    event = new StorageEvent('storage', { key, newValue })
  } catch {
    event = Object.assign(new Event('storage'), { key, newValue })
  }
  window.dispatchEvent(event)
}

beforeEach(() => {
  systemPrefersDark = false
  stubMatchMedia()
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('useDarkMode 单一数据源', () => {
  it('无存储偏好且系统浅色 → 初始为亮色，不挂 dark class', async () => {
    const { darkMode } = await loadFreshModule()
    expect(darkMode.value).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('无存储偏好且系统深色 → 兜底 prefers-color-scheme 为暗色', async () => {
    systemPrefersDark = true
    const { darkMode } = await loadFreshModule()
    expect(darkMode.value).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('历史持久化偏好优先于系统偏好（兼容旧键 dark-mode）', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'false')
    systemPrefersDark = true
    let { darkMode } = await loadFreshModule()
    expect(darkMode.value).toBe(false)

    window.localStorage.setItem(STORAGE_KEY, 'true')
    systemPrefersDark = false
    ;({ darkMode } = await loadFreshModule())
    expect(darkMode.value).toBe(true)
  })

  it('toggle 后同步挂载/摘除 html.dark 并写回持久化', async () => {
    const { darkMode, toggleDarkMode } = await loadFreshModule()
    expect(darkMode.value).toBe(false)

    toggleDarkMode()
    await nextTick()
    expect(darkMode.value).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true')

    toggleDarkMode()
    await nextTick()
    expect(darkMode.value).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false')
  })

  it('刷新（重载模块）后持久化偏好恢复', async () => {
    let ctx = await loadFreshModule()
    ctx.toggleDarkMode()
    await nextTick()

    ctx = await loadFreshModule() // 模拟刷新
    expect(ctx.darkMode.value).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('他标签页 storage 事件实时同步本页状态与 class', async () => {
    const { darkMode } = await loadFreshModule()
    expect(darkMode.value).toBe(false)

    dispatchStorageEvent(STORAGE_KEY, 'true')
    await nextTick()
    expect(darkMode.value).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    // 他处清除键（newValue=null）→ 保持当前态不跳变
    dispatchStorageEvent(STORAGE_KEY, null)
    await nextTick()
    expect(darkMode.value).toBe(true)

    // 无关键不受干扰
    dispatchStorageEvent('locale', 'en')
    await nextTick()
    expect(darkMode.value).toBe(true)
  })
})
