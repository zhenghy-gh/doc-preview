// T3-W1a · inlineAssetRenderer 单测（contract-split-r1 §1.2 Batch-A / §3.2 可单测标准）
// 依赖链含 textRender#escapeHtml（内部经 DOM div 转义）→ 需 happy-dom 环境。
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import {
  twipsToPx,
  renderTextboxAnchorHtml,
  renderInlinePictureHtml,
} from '../src/utils/rendering/inlineAssetRenderer'
import type { ShapeInfo, Translator } from '../src/utils/docFormat'

const DICT: Record<string, string> = {
  'shapes.anchor.topLeft': '左上角',
}

/** 与 utils/locale#t 行为一致：缺失键返回键名本身 */
const t: Translator = (key) => DICT[key] ?? key

function makeShape(partial: Partial<ShapeInfo>): ShapeInfo {
  return {
    spid: 2049,
    type: 'textbox',
    anchorType: 'topLeft',
    ...partial,
  }
}

describe('twipsToPx', () => {
  it('converts twips to px with rounding (1 twip = 1/15 px)', () => {
    expect(twipsToPx(900)).toBe(60)
    expect(twipsToPx(15)).toBe(1)
    expect(twipsToPx(7)).toBe(0)
  })
})

describe('renderTextboxAnchorHtml', () => {
  it('renders position/size in px and anchor label via the injected translator', () => {
    const html = renderTextboxAnchorHtml(
      makeShape({ x: 900, y: 1800, width: 3000, height: 1500 }),
      t
    )
    expect(html).toContain('<div class="textbox-anchor-marker"')
    expect(html).toContain('位置: 60×120px')
    expect(html).toContain('尺寸: 200×100px')
    expect(html).toContain('锚点: 左上角')
    expect(html).toContain('data-spid="2049"')
    expect(html).toContain('textbox-anchor-icon')
  })

  it('keeps raw twips plus CP/SPID metadata in the title tooltip', () => {
    const html = renderTextboxAnchorHtml(
      makeShape({ x: 900, y: 1800, width: 3000, height: 1500, anchorCp: 42, floating: true }),
      t
    )
    expect(html).toContain('title="位置: (900, 1800) twips · 尺寸: 3000 × 1500 twips · 锚点 CP: 42 · SPID: 2049 · 浮动"')
  })

  it('escapes & < > in translator output inside info span and title', () => {
    // 存量行为钉死（本波次不顺手修，已另报 reviewer）：textRender#escapeHtml
    // 为 textContent→innerHTML 回读实现，只转义 & < >，不转义引号 —— 因此含
    // 引号的翻译值在 title="..." 属性语境理论可突破属性边界；当前插值字段均为
    // 数字与受信词典文案，实际不可达。
    const hostile: Translator = (key) => `<b>&"</b>${key}`
    const html = renderTextboxAnchorHtml(makeShape({ anchorType: 'topLeft' }), hostile)
    // 实证钉死：& 与 < > 被转义，双引号原样保留（textContent→innerHTML 不编码引号）
    expect(html).toContain('&lt;b&gt;&amp;"&lt;/b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('falls back to the raw anchorType when the translator has no entry', () => {
    // locale#t 缺失键返回键名本身（非 falsy）→ || shape.anchorType 回退不触发，
    // 显示的是翻译键名。此处钉死该生产行为防漂移。
    const html = renderTextboxAnchorHtml(makeShape({ anchorType: 'topLeft' }), (key) => key)
    expect(html).toContain('锚点: shapes.anchor.topLeft')
  })

  it('renders a marker without geometry parts when x/y/width/height are absent', () => {
    const html = renderTextboxAnchorHtml(
      makeShape({ x: undefined, y: undefined, width: undefined, height: undefined, anchorType: 'topLeft' }),
      t
    )
    expect(html).toContain('class="textbox-anchor-marker"')
    expect(html).toContain('<span class="textbox-anchor-label">文本框</span>')
    // 仅剩锚点信息段，无位置/尺寸段
    expect(html).toContain('<span class="textbox-anchor-info">锚点: 左上角</span>')
    expect(html).not.toContain('位置:')
    expect(html).not.toContain('尺寸:')
  })

  it('is pure: identical input yields byte-identical output', () => {
    const shape = makeShape({ x: 450, y: 450, width: 600, height: 300 })
    expect(renderTextboxAnchorHtml(shape, t)).toBe(renderTextboxAnchorHtml({ ...shape }, t))
  })
})

describe('renderInlinePictureHtml', () => {
  it('clamps oversized pictures to the 600px/500px caps', () => {
    const html = renderInlinePictureHtml(
      { format: 'jpeg', dataUrl: 'data:image/jpeg;base64,BBB', widthPx: 800, heightPx: 2000 },
      t
    )
    expect(html).toContain('max-width: 600px')
    expect(html).toContain('max-height: 500px')
    expect(html).toContain('<div class="inline-picture-container">')
  })

  it('uses fluid width when no intrinsic size is known', () => {
    const html = renderInlinePictureHtml({ format: 'png', dataUrl: 'data:image/png;base64,C' }, t)
    expect(html).toContain('max-width: 100%')
    expect(html).not.toContain('max-height')
  })

  it('renders an uppercase format caption with dimensions', () => {
    const html = renderInlinePictureHtml(
      { format: 'jpeg', dataUrl: 'x', widthPx: 320, heightPx: 240 },
      t
    )
    expect(html).toContain('alt="JPEG · 320×240px"')
    expect(html).toContain('<div class="inline-picture-caption">JPEG · 320×240px</div>')
  })

  it('passes the dataUrl through unmodified and marks lazy loading', () => {
    const url = 'data:image/gif;base64,D'
    const html = renderInlinePictureHtml({ format: 'gif', dataUrl: url }, t)
    expect(html).toContain(`<img src="${url}"`)
    expect(html).toContain('loading="lazy"')
  })

  it('accepts the reserved _t parameter without affecting output', () => {
    const pic = { format: 'png', dataUrl: 'x', widthPx: 10, heightPx: 10 }
    const other: Translator = () => 'anything'
    expect(renderInlinePictureHtml(pic, t)).toBe(renderInlinePictureHtml(pic, other))
  })
})
