/**
 * useWebFont —— 按需 Google Fonts 加载与字体族映射（从 DocPreview.vue 抽离）。
 *
 * 只暴露三个动作：loadWebFonts（幂等注入 stylesheet）、getWebFontFamily
 * （字体名 → CSS 前缀，供渲染层 fontResolver 使用）、injectWebFontOverrides
 * （全局 .document-content 字体覆盖）。启用状态由调用方以 getter 注入，
 * 本 composable 不持有 props 依赖。
 */
import { ref } from 'vue'

const FONT_ALIASES: Record<string, string[]> = {
  '宋体': ['Noto+Serif+SC', 'SimSun'],
  '仿宋': ['Noto+Serif+SC', 'FangSong'],
  '仿宋_GB2312': ['Noto+Serif+SC', 'FangSong_GB2312'],
  '黑体': ['Noto+Sans+SC', 'SimHei'],
  '楷体': ['Noto+Serif+SC', 'KaiTi'],
  '隶书': ['Noto+Serif+SC', 'LiSu'],
  '幼圆': ['Noto+Sans+SC', 'YouYuan'],
  'Times New Roman': ['Noto+Serif', 'Times+New+Roman'],
  'Arial': ['Noto+Sans', 'Arial'],
  'Verdana': ['Noto+Sans', 'Verdana'],
  'Georgia': ['Noto+Serif', 'Georgia'],
  'Microsoft YaHei': ['Noto+Sans+SC', 'Microsoft+YaHei'],
  '微软雅黑': ['Noto+Sans+SC', 'Microsoft+YaHei'],
  '华文中宋': ['Noto+Serif+SC', 'STZhongsong'],
  '华文仿宋': ['Noto+Serif+SC', 'STFangsong'],
  '华文黑体': ['Noto+Sans+SC', 'STHeiti'],
  '华文楷体': ['Noto+Serif+SC', 'STKaiti'],
  '新宋体': ['Noto+Serif+SC', 'NSimSun'],
}

export function useWebFont(enabled: () => boolean) {
  const webFontLoaded = ref(false)

  function loadWebFonts(): void {
    if (!enabled() || webFontLoaded.value) return
    const families = 'Noto+Serif+SC|Noto+Sans+SC|Noto+Serif|Noto+Sans'
    const link = document.createElement('link')
    link.href = `https://fonts.googleapis.com/css2?family=${families}&display=swap`
    link.rel = 'stylesheet'
    link.onload = () => {
      webFontLoaded.value = true
      injectWebFontOverrides()
    }
    link.onerror = () => {
      console.warn('Web Font loading failed, falling back to system fonts')
    }
    document.head.appendChild(link)
  }

  function getWebFontFamily(fontName?: string): string {
    if (!enabled()) return ''
    const alias = fontName ? FONT_ALIASES[fontName] : undefined
    // Google Fonts URL 用 '+' 连接多词字体名；CSS font-family 需要全部换成空格。
    // 旧实现只 replace 第一个 '+', 导致 'Noto+Serif+SC' → 'Noto Serif+SC'（非法 CSS 字体名）。
    if (alias) return `${alias[0].replace(/\+/g, ' ')}, `
    return ''
  }

  function injectWebFontOverrides(): void {
    if (!enabled()) return
    const styleId = 'doc-preview-webfont-overrides'
    let style = document.getElementById(styleId) as HTMLStyleElement
    if (!style) {
      style = document.createElement('style')
      style.id = styleId
      document.head.appendChild(style)
    }
    style.textContent = `
      .document-content h1 { font-family: 'Noto Serif SC', '华文中宋', 'SimHei', serif !important; }
      .document-content h2 { font-family: 'Noto Serif SC', '华文中宋', 'SimHei', serif !important; }
      .document-content h3 { font-family: 'Noto Serif SC', serif !important; }
      .document-content p { font-family: 'Noto Serif SC', '宋体', 'SimSun', serif !important; }
      .document-content li { font-family: 'Noto Serif SC', '宋体', 'SimSun', serif !important; }
      .document-content th,
      .document-content td { font-family: 'Noto Serif SC', '宋体', 'SimSun', serif !important; }
      .document-content blockquote { font-family: 'Noto Serif SC', '宋体', serif !important; }
    `
  }

  return { webFontLoaded, loadWebFonts, getWebFontFamily, injectWebFontOverrides }
}
