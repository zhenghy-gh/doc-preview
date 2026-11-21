/**
 * UI 展示格式化纯函数（从 DocPreview.vue 抽离）。
 */

export type Translator = (key: string, params?: Record<string, unknown>) => string

/** 面板标题计数括号按语言取形：zh 全角（n）、en 半角 (n)。 */
export function formatPanelTitle(t: Translator, isEnglish: boolean, key: string, n: number): string {
  const base = t(key)
  return isEnglish ? `${base} (${n})` : `${base}（${n}）`
}

/** 尺寸格式化：pt → “x.x磅 (y.yy cm)”；undefined/≤0 返回空串。 */
export function formatSizePt(t: Translator, pt: number | undefined): string {
  if (pt === undefined || pt <= 0) return ''
  const cm = (pt * 0.0353).toFixed(2)
  return t('sections.sizePt', { pt: pt.toFixed(1), cm })
}
