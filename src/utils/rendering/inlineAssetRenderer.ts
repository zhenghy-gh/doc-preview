/**
 * inlineAssetRenderer —— 文本框锚点标记 / 内联图片渲染纯函数（T3-W1a · contract-split-r1 §1.2 Batch-A）
 *
 * 自 DocPreview.vue 原样迁出（符号名锚）：renderTextboxAnchorHtml / renderInlinePictureHtml。
 * 纯度边界（契约 §1.3）：禁 import vue/.vue、不触 DOM/window；
 * i18n 以末参 Translator 注入（契约「二者增加末参 t」）。
 * twips→px 换算提升为模块导出 twipsToPx（公式原样：Math.round(twips / 15)），
 * W3 PageBuilder 落地时随 PT_TO_PX 一并收敛为共享常量。
 */
import { escapeHtml, escapeHtmlAttribute } from '../textRender'
import type { ShapeInfo, Translator } from '../docFormat'

/** twips → px 换算（源：DocPreview.vue#renderTextboxAnchorHtml 内部闭包，公式逐字保留） */
export const twipsToPx = (twips: number): number => Math.round(twips / 15)

/**
 * Render a floating textbox anchor marker.
 *
 * Textbox shapes from the Office Art Drawing Container carry position (x, y),
 * size (width, height) and anchor CP information. This marker is displayed
 * at the anchor paragraph to indicate where the textbox is positioned.
 *
 * Position and size are shown in both twips and pixels (1 twip = 1/15 px).
 */
export function renderTextboxAnchorHtml(shape: ShapeInfo, t: Translator): string {
  const parts: string[] = []
  if (shape.x !== undefined && shape.y !== undefined) {
    parts.push(`位置: ${twipsToPx(shape.x)}×${twipsToPx(shape.y)}px`)
  }
  if (shape.width !== undefined && shape.height !== undefined) {
    parts.push(`尺寸: ${twipsToPx(shape.width)}×${twipsToPx(shape.height)}px`)
  }
  if (shape.anchorType) {
    const anchorLabel = t('shapes.anchor.' + shape.anchorType) || shape.anchorType
    parts.push(`锚点: ${anchorLabel}`)
  }
  const info = parts.length > 0 ? parts.join(' · ') : ''
  const titleParts: string[] = []
  if (shape.x !== undefined && shape.y !== undefined) {
    titleParts.push(`位置: (${shape.x}, ${shape.y}) twips`)
  }
  if (shape.width !== undefined && shape.height !== undefined) {
    titleParts.push(`尺寸: ${shape.width} × ${shape.height} twips`)
  }
  if (shape.anchorCp !== undefined) {
    titleParts.push(`锚点 CP: ${shape.anchorCp}`)
  }
  if (shape.spid) {
    titleParts.push(`SPID: ${shape.spid}`)
  }
  if (shape.floating) {
    titleParts.push('浮动')
  }
  const title = titleParts.join(' · ')
  return `<div class="textbox-anchor-marker" title="${escapeHtml(title)}" data-spid="${shape.spid}">
  <span class="textbox-anchor-icon">⬚</span>
  <span class="textbox-anchor-label">文本框</span>
  ${info ? `<span class="textbox-anchor-info">${escapeHtml(info)}</span>` : ''}
</div>`
}

/**
 * 渲染内联图片容器（源：DocPreview.vue#renderInlinePictureHtml，函数体逐字节保留）。
 * _t 为契约要求的预留 i18n 入参（当前 caption 未用 i18n，不影响输出）。
 */
export function renderInlinePictureHtml(pic: {
  format: string
  dataUrl: string
  widthPx?: number
  heightPx?: number
  floating?: boolean
  cp?: number
}, _t: Translator): string {
  const styleParts: string[] = []
  if (pic.widthPx) {
    styleParts.push(`max-width: ${Math.min(pic.widthPx, 600)}px`)
  } else {
    styleParts.push('max-width: 100%')
  }
  if (pic.heightPx) {
    styleParts.push(`max-height: ${Math.min(pic.heightPx, 500)}px`)
  }
  const style = styleParts.join('; ')
  const caption = `${pic.format.toUpperCase()}${pic.widthPx && pic.heightPx ? ` · ${pic.widthPx}×${pic.heightPx}px` : ''}`
  return `<div class="inline-picture-container">
  <img src="${escapeHtmlAttribute(pic.dataUrl)}" alt="${escapeHtmlAttribute(caption)}" class="inline-picture" style="${style}" loading="lazy" />
  <div class="inline-picture-caption">${escapeHtml(caption)}</div>
</div>`
}
