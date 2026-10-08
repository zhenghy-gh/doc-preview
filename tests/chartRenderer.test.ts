// T3-W1a · chartRenderer 单测（contract-split-r1 §1.2 Batch-A / §3.2 可单测标准）
// 依赖链含 textRender#escapeHtml（内部经 DOM div 转义）→ 需 happy-dom 环境。
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import {
  chartTypeLabel,
  chartSubtypeLabel,
  renderChartSvg,
  renderChartHtml,
} from '../src/utils/rendering/chartRenderer'
import type { ChartInfo, Translator } from '../src/utils/docFormat'

const DICT: Record<string, string> = {
  'charts.type.column': '柱状图',
  'charts.type.msgraph': 'MSGraph',
  'charts.type.unknown': '未知图表',
  'charts.subtype.bar': '条形图',
  'charts.subtype.clustered': '簇状',
  'charts.subtype.unknown': '未知子类型',
}

/** 与 utils/locale#t 行为一致：缺失键返回键名本身（非空 → `||` 回退不触发） */
const t: Translator = (key) => DICT[key] ?? key

function makeChart(partial: Partial<ChartInfo>): ChartInfo {
  return {
    id: 1,
    name: 'Chart 1',
    type: 'msgraph',
    subtype: 'chart',
    ...partial,
  }
}

describe('chartTypeLabel / chartSubtypeLabel', () => {
  it('translates known keys via the injected translator', () => {
    expect(chartTypeLabel('column', t)).toBe('柱状图')
    expect(chartSubtypeLabel('clustered', t)).toBe('簇状')
  })

  it('missing entries surface as raw i18n keys (locale#t returns key itself)', () => {
    // 生产现实钉死：locale#t 缺失键返回键名本身（非 falsy），
    // 因此 `|| t('charts.type.unknown')` 回退分支实际不可达。
    expect(chartTypeLabel('noSuchType', t)).toBe('charts.type.noSuchType')
    expect(chartSubtypeLabel('noSuchSubtype', t)).toBe('charts.subtype.noSuchSubtype')
  })
})

describe('renderChartSvg', () => {
  it('renders a grouped column chart skeleton for column-like subtypes', () => {
    const svg = renderChartSvg(makeChart({ subtype: 'column' }))
    expect(svg).toContain('<svg class="chart-svg" viewBox="0 0 280 145"')
    // 12 根数据柱（4 组 × 3 系列演示数据，CHART-DATA-INV 已立项跟踪）+ 3 个图例色块 = 15
    expect(svg.match(/<rect /g)?.length).toBe(15)
    expect(svg).toContain('>Column 1</text>')
  })

  it('renders horizontal bars for subtype bar', () => {
    const svg = renderChartSvg(makeChart({ subtype: 'bar' }))
    expect(svg).toContain('viewBox="0 0 220 170"')
    expect(svg.match(/<rect /g)?.length).toBe(6)
  })

  it('renders a polyline line chart', () => {
    const svg = renderChartSvg(makeChart({ subtype: 'line' }))
    expect(svg).toContain('<polyline points="')
    expect(svg).not.toContain('<path d=')
  })

  it('renders pie slices and an extra circle for doughnut', () => {
    const pie = renderChartSvg(makeChart({ subtype: 'pie' }))
    expect(pie.match(/<path d="M /g)?.length).toBe(4)
    expect(pie).not.toContain('<circle')

    const doughnut = renderChartSvg(makeChart({ subtype: 'doughnut' }))
    expect(doughnut).toContain('<circle')
  })

  it('renders radar webs and data polygon', () => {
    const svg = renderChartSvg(makeChart({ subtype: 'radar' }))
    // 6 层网 + 1 个数据多边形
    expect(svg.match(/<polygon /g)?.length).toBe(7)
  })

  it("routes subtype 'unknown' into the grouped-column branch (per source)", () => {
    // 源码事实：'unknown'/'picture' 与 column/cone/cylinder/pyramid 同走分组柱状图分支
    const svg = renderChartSvg(makeChart({ subtype: 'unknown' }))
    expect(svg).toContain('viewBox="0 0 280 145"')
    expect(svg.match(/<rect /g)?.length).toBe(15)
  })

  it('is pure: identical input yields byte-identical output', () => {
    const chart = makeChart({ subtype: 'column' })
    expect(renderChartSvg(chart)).toBe(renderChartSvg(makeChart({ subtype: 'column' })))
  })
})

describe('renderChartHtml', () => {
  it('prefers the embedded preview image when dataUrl exists', () => {
    const html = renderChartHtml(
      makeChart({ subtype: 'column', dataUrl: 'data:image/png;base64,AAA' }),
      1,
      t
    )
    expect(html).toContain('class="chart-placeholder chart-with-image"')
    expect(html).toContain('<img src="data:image/png;base64,AAA"')
    expect(html).toContain('class="chart-preview-image"')
    expect(html).not.toContain('<svg')
  })

  it('escapes embedded preview URLs before placing them in src attributes', () => {
    const html = renderChartHtml(
      makeChart({ dataUrl: 'data:image/svg+xml,<svg onload="alert(1)">' }),
      1,
      t,
    )
    expect(html).toContain('src="data:image/svg+xml,&lt;svg onload=&quot;alert(1)&quot;&gt;"')
    expect(html).not.toContain('onload="alert(1)"')
  })

  it('degrades to a neutral name+type text card when no dataUrl exists (CHART-FIX-S1)', () => {
    const chart = makeChart({ subtype: 'bar', name: 'Embedded Chart 1' })
    const html = renderChartHtml(chart, 1, t)
    expect(html).toContain('<div class="chart-placeholder chart-text-card" role="img" aria-label="MSGraph · 条形图 · Embedded Chart 1">')
    expect(html).toContain('<div class="chart-placeholder-label">MSGraph · 条形图</div>')
    expect(html).toContain('<div class="chart-text-card-name">Embedded Chart 1</div>')
    // 不再输出含演示数据的 SVG
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('<rect')
  })

  it('escapes chart names in the fallback accessible label', () => {
    const html = renderChartHtml(
      makeChart({ subtype: 'bar', name: '<script>alert(1)</script>' }),
      1,
      t
    )
    expect(html).toContain('role="img" aria-label="MSGraph · 条形图 · &lt;script&gt;alert(1)&lt;/script&gt;"')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('keeps renderChartSvg itself untouched as an exported pure function (S2 复用面)', () => {
    const svg = renderChartSvg(makeChart({ subtype: 'pie' }))
    expect(svg).toContain('<svg class="chart-svg"')
  })

  it('escapes i18n labels before embedding into HTML attributes', () => {
    // 注意：label 只在 dataUrl（图片预览）分支输出；纯 SVG 分支不嵌入 label。
    const hostile: Translator = (key) => `<b>${key}</b>`
    const html = renderChartHtml(
      makeChart({ type: 'msgraph', subtype: 'chart', dataUrl: 'data:image/png;base64,A' }),
      1,
      hostile
    )
    expect(html).toContain('alt="&lt;b&gt;charts.type.msgraph&lt;/b&gt; · &lt;b&gt;charts.subtype.chart&lt;/b&gt;"')
    expect(html).not.toContain('<b>charts.')
  })

  it('accepts any seq value without affecting output (reserved parameter)', () => {
    const chart = makeChart({ subtype: 'pie' })
    expect(renderChartHtml(chart, 1, t)).toBe(renderChartHtml(chart, 999, t))
  })

  it('omits the subtype label when subtype is unknown', () => {
    const html = renderChartHtml(
      makeChart({ type: 'column', subtype: 'unknown', dataUrl: 'x' }),
      1,
      t
    )
    // type=column 有词条、subtype=unknown 不追加 → alt 仅一个标签段
    expect(html).toContain('alt="柱状图"')
  })
})

describe('i18n bilingual smoke（真实词典 · S1 验收项）', () => {
  it('resolves type/subtype labels in zh-CN and en via real locale dictionary', async () => {
    const { t: realT, setLocale } = await import('../src/utils/locale')
    const chart = makeChart({ type: 'msgraph', subtype: 'column', name: 'OLE Object 1' })
    try {
      setLocale('zh-CN')
      const zh = renderChartHtml(chart, 1, realT)
      expect(zh).toContain('柱状图')
      expect(zh).toContain('MSGraph')
      expect(zh).toContain('>OLE Object 1<')
      setLocale('en')
      const en = renderChartHtml(chart, 1, realT)
      expect(en).toContain('Column')
      expect(en).toContain('MSGraph')
      expect(en).toContain('>OLE Object 1<')
    } finally {
      setLocale('zh-CN') // 还原模块级单例，避免跨用例泄漏
    }
  })
})
