/**
 * useI18n —— locale.ts 全局单例的组合式薄包装（COMPOSABLES-E · contract-split-r1 §1.3
 * 「composables 独立成波」/ vue-dev-2 契约草案域 E）。
 *
 * 设计要点：
 * - **纯委托，不复制状态**：locale/t/tMap 的唯一事实源仍是 `utils/locale.ts` 的
 *   模块级 shallowRef 单例。t()/tMap() 在渲染期读取该 ref，语言切换后所有消费
 *   组件自动重渲染——本包装不引入任何额外响应式副本。
 * - **持久化与启动恢复由单例承载**：`setLocale` 写入经 `safeStorage`（键
 *   `'locale'`），模块首次加载时自动恢复上次选择（B1/I18N-P0 已在 locale.ts
 *   落地）。本 composable 委托即得该保证，**不重复实现**，避免双写双源。
 * - **不引入 vue-i18n**：保持零依赖轻量方案，导出面与 locale.ts 逐一同构。
 *
 * 与直接 import locale.ts 相比的增量价值：
 * 1) 组件获得统一的组合式 API 入口（后续面板组件化时不再散落裸 import）；
 * 2) `locale` 以 `Readonly<Ref>` 暴露，编译期阻止外部误写 `.value`；
 * 3) 为测试提供单一可 mock 的注入点（未来可扩展 options.dict 测试字典，
 *    当前为保持零行为变更暂不加入）。
 */

import type { Ref } from 'vue'
import {
  currentLocale,
  setLocale as setLocaleSingleton,
  t as translate,
  tMap as translateMap,
} from '../utils/locale'
import type { Locale } from '../utils/locale'

/** useI18n 的返回契约（contract-split-r1 采纳的 vue-dev-2 域 E 草案） */
export interface UseI18nReturn {
  /** 当前语言只读视图。响应式：底层为 locale.ts 的模块级 shallowRef。 */
  locale: Readonly<Ref<Locale>>
  /**
   * 切换语言并持久化（键 `'locale'`，经 safeStorage，存储受限环境静默降级为
   * 会话内生效）。下次加载由 locale.ts 模块顶层自动恢复。
   */
  setLocale(locale: Locale): void
  /**
   * 翻译函数。支持 `{param}` 插值与函数字典值；缺键回退返回键名本身。
   * 渲染期调用即具备语言切换响应性。
   */
  t(key: string, params?: Record<string, unknown>): string
  /** 嵌套字典批量访问（如 `tMap('shortcuts.items', 'toggleSearch')`）；缺 subKey 回退返回 subKey。 */
  tMap(keyPrefix: string, subKey: string): string
}

const instance: UseI18nReturn = {
  locale: currentLocale,
  setLocale: setLocaleSingleton,
  t: translate,
  tMap: translateMap,
}

/**
 * i18n 组合式入口。全局单例语义：任意组件多次调用返回同一实例；
 * 语言状态跨组件共享，切换一处、全局生效。
 */
export function useI18n(): UseI18nReturn {
  return instance
}
