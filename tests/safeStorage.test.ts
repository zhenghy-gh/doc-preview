import { describe, it, expect, vi, afterEach } from 'vitest'
import { safeStorage } from '../src/utils/safeStorage'

/**
 * B1 safeStorage 单测：覆盖原生可用 / undefined / 读取抛异常 /
 * 写入抛异常（配额满）/ 部分实现存根 等场景。
 * 注意 safeStorage 的内存镜像是模块级单例，因此各用例使用互不相同的键名，
 * 避免用例间通过镜像串扰。
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('safeStorage', () => {
  it('delegates to native localStorage when it works', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })

    expect(safeStorage.getItem('deleg-key')).toBeNull()
    safeStorage.setItem('deleg-key', 'v1')
    expect(store.get('deleg-key')).toBe('v1') // 原生侧真实写入
    expect(safeStorage.getItem('deleg-key')).toBe('v1')
    safeStorage.removeItem('deleg-key')
    expect(store.has('deleg-key')).toBe(false)
    expect(safeStorage.getItem('deleg-key')).toBeNull()
  })

  it('falls back to in-memory semantics when localStorage is undefined', () => {
    // node 环境/SSR：全局根本没有 localStorage
    vi.stubGlobal('localStorage', undefined)
    expect(() => safeStorage.setItem('mem-only', '1')).not.toThrow()
    expect(safeStorage.getItem('mem-only')).toBe('1')
    safeStorage.removeItem('mem-only')
    expect(safeStorage.getItem('mem-only')).toBeNull()
  })

  it('does not throw and serves the mirror when getItem throws (denied storage)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError: storage denied')
      },
      setItem: () => {
        throw new Error('SecurityError: storage denied')
      },
    })
    expect(safeStorage.getItem('denied')).toBeNull() // 不抛，返回 null
    expect(() => safeStorage.setItem('denied', 'yes')).not.toThrow()
    expect(safeStorage.getItem('denied')).toBe('yes') // 内存镜像兜底可读回
  })

  it('keeps session read-back consistency when setItem throws (quota exceeded)', () => {
    const nativeCalls: string[] = []
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k === 'old-key' ? 'kept' : null),
      setItem: () => {
        nativeCalls.push('set')
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    })
    safeStorage.setItem('quota-key', 'val')
    expect(nativeCalls).toEqual(['set']) // 确实尝试过原生写入
    expect(safeStorage.getItem('quota-key')).toBe('val') // 镜像兜底
    expect(safeStorage.getItem('old-key')).toBe('kept') // 原生可读路径不受影响
  })

  it('survives partially-implemented storage objects (missing methods)', () => {
    // 模拟残缺存根：只有 getItem，没有 setItem/removeItem
    vi.stubGlobal('localStorage', { getItem: () => null })
    expect(() => {
      safeStorage.setItem('partial', 'q')
      safeStorage.removeItem('partial')
    }).not.toThrow()
    // removeItem 先删内存镜像、原生调用抛错被吞 —— 因此该键此后读不到
    expect(safeStorage.getItem('partial')).toBeNull()
  })

  it('removeItem clears both native and mirror copies', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    safeStorage.setItem('both', 'x')
    expect(store.has('both')).toBe(true)
    safeStorage.removeItem('both')
    expect(store.has('both')).toBe(false)
    expect(safeStorage.getItem('both')).toBeNull()
  })

  it('prefers the native value over a stale mirror entry', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    safeStorage.setItem('prio', 'from-mirror-write')
    store.set('prio', 'external-overwrite') // 宿主页面绕过封装直接改原生存储
    expect(safeStorage.getItem('prio')).toBe('external-overwrite') // 原生优先
  })
})
