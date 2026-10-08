/**
 * safeStorage —— localStorage 的安全封装（W1-B / B1）。
 *
 * 背景：locale.ts 等模块曾在模块顶层/事件回调中直接访问 localStorage。
 * 在"存储被禁"的环境下（Safari 旧版无痕模式、企业策略禁用、嵌入第三方
 * iframe 的 deny 存储策略、SSR），任何一次裸调用都可能抛出
 * SecurityError / QuotaExceededError / TypeError —— 若发生在模块加载期
 * 则整个应用白屏。
 *
 * 设计：
 * - 原生访问全部在调用时动态进行并逐次 try/catch，不在模块加载期捕获
 *   localStorage 引用（避免把"当时不可用的引用"固化下来，也避免探测代码
 *   对部分实现的存根对象要求过多方法）；
 * - 每次成功 setItem 都同步维护一份内存镜像 Map：当原生写入因配额满或
 *   权限被拒而失败时，会话内的"写后读"一致性仍然成立；
 * - 原生存储完全不可用时自动退化为纯内存语义（刷新后丢失，属预期降级）。
 *
 * 注意：镜像值均为轻量字符串偏好项（locale/dark-mode 等），常驻内存开销可忽略。
 */

const memoryMirror = new Map<string, string>()

/** 读原生 localStorage。不可用（undefined）/抛异常 → undefined；键不存在 → null。 */
function nativeGetItem(key: string): string | null | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined
    return localStorage.getItem(key)
  } catch {
    return undefined
  }
}

/** 写原生 localStorage。返回是否成功（配额满/被禁/环境不支持 → false）。 */
function nativeSetItem(key: string, value: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** 删原生 localStorage 键。失败不抛出（内存镜像的删除不受影响）。 */
function nativeRemoveItem(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key)
  } catch {
    /* 删除失败可忽略：对调用方而言该键此后都读不到即可 */
  }
}

export const safeStorage = {
  /**
   * 读取键值：优先原生存储；原生不存在该键 / 环境不可用 / 抛异常时，
   * 回退到内存镜像；两处都没有则返回 null。
   */
  getItem(key: string): string | null {
    const native = nativeGetItem(key)
    if (typeof native === 'string') return native
    return memoryMirror.has(key) ? (memoryMirror.get(key) as string) : null
  },

  /**
   * 写入键值：始终先更新内存镜像（保证本会话内写后读一致），
   * 再尽力同步原生存储（失败静默，由镜像兜底）。
   */
  setItem(key: string, value: string): void {
    memoryMirror.set(key, value)
    nativeSetItem(key, value)
  },

  /** 删除键值：内存与原生各自删除，均不抛出。 */
  removeItem(key: string): void {
    memoryMirror.delete(key)
    nativeRemoveItem(key)
  },
}

export default safeStorage
