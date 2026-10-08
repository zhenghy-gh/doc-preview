import { readonly, ref, watch } from 'vue'
import { safeStorage } from '../utils/safeStorage'

/**
 * 暗黑模式全局唯一状态源（W1-C · ui-kit-dev）
 *
 * App.vue 与 DocPreview.vue 统一消费本 composable，消除双状态源失同步
 * （此前两处各持一份 ref 各写 localStorage，从预览工具栏切换后 App 头部图标滞留旧态）。
 *
 * - localStorage 持久化走 net-dev 的 safeStorage（W1-B）：隐私模式/存储被禁/
 *   配额满等异常场景静默降级（原生失败时内存镜像保证会话内写后读一致），
 *   键名沿用历史 'dark-mode'，保持既有用户偏好兼容
 * - 初始值兜底 prefers-color-scheme（无存储偏好时跟随系统）
 * - 监听 storage 事件，多标签页实时同步
 * - `.dark` class 由本模块统一挂到 documentElement（html），与既有 CSS 变量机制一致
 */

const STORAGE_KEY = 'dark-mode'

const hasDOM = typeof document !== 'undefined'

function readStoredPreference(): boolean | null {
  if (!hasDOM) return null
  const raw = safeStorage.getItem(STORAGE_KEY)
  if (raw === 'true') return true
  if (raw === 'false') return false
  return null
}

function systemPrefersDark(): boolean {
  if (hasDOM && typeof window.matchMedia === 'function') {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    } catch {
      /* 部分环境不支持 matchMedia */
    }
  }
  return false
}

/** 模块级单例：所有消费者共享同一 ref */
const darkMode = ref(readStoredPreference() ?? systemPrefersDark())

function applyToDocument(value: boolean) {
  if (!hasDOM) return
  document.documentElement.classList.toggle('dark', value)
}

// 初始化即同步 class（替代原先散落在 App.vue 的挂载期逻辑）
applyToDocument(darkMode.value)

watch(darkMode, (value) => {
  applyToDocument(value)
  // safeStorage 内部已兜底写入失败（配额满/被禁），无需再 try/catch
  safeStorage.setItem(STORAGE_KEY, String(value))
})

// 多标签页同步：storage 事件只在「其他」标签页触发，此处跟随即可（同值回写不会形成风暴：
// 值相等时 watch 不触发）。注意：event.newValue 为 null 表示他处清除了键，保持当前态不跳变。
if (hasDOM && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || event.newValue === null) return
    const next = event.newValue === 'true'
    if (next !== darkMode.value) darkMode.value = next
  })
}

export function useDarkMode() {
  function toggleDarkMode() {
    darkMode.value = !darkMode.value
  }

  function setDarkMode(value: boolean) {
    darkMode.value = value
  }

  return {
    /** 是否暗黑模式（只读） */
    darkMode: readonly(darkMode),
    toggleDarkMode,
    setDarkMode,
  }
}
