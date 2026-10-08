/**
 * chartRenderer —— 图表占位渲染纯函数（T3-W1a · contract-split-r1 §1.2 Batch-A）
 *
 * 自 DocPreview.vue 原样迁出（符号名锚）：renderChartSvg / renderChartHtml /
 * getChartTypeLabel→chartTypeLabel / getChartSubtypeLabel→chartSubtypeLabel。
 * 纯度边界（契约 §1.3）：禁 import vue/.vue、不触 DOM/window；
 * i18n 以 Translator 显式注入；seq 显式化替代闭包读全局计数器。
 *
 * ⚠️ CHART-DATA-INV 处置记录：renderChartSvg 各分支内含硬编码演示数据
 * （柱状[9,3,4.5…]等，非文档真实数值）。CHART-FIX-S1（v33 放行）已将
 * renderChartHtml 无预览图分支降级为中性文字卡、不再消费本函数；
 * 本函数保留为独立导出纯函数，待 S2 真实系列数据接入时复用或下线。
 */
import { escapeHtmlAttribute, escapeHtml } from '../textRender'
import type { ChartInfo, Translator } from '../docFormat'

/** 图表类型标签（源：DocPreview.vue#getChartTypeLabel，t 注入） */
export function chartTypeLabel(type: string, t: Translator): string {
  return t('charts.type.' + type) || t('charts.type.unknown')
}

/** 图表子类型标签（源：DocPreview.vue#getChartSubtypeLabel，t 注入） */
export function chartSubtypeLabel(subtype: string, t: Translator): string {
  return t('charts.subtype.' + subtype) || t('charts.subtype.unknown')
}

/**
 * 渲染图表 SVG 占位图形（源：DocPreview.vue#renderChartSvg，函数体逐字节保留）。
 *
 * ⚠️ CHART-DATA-INV：内部数值均为演示数据，非文档真实图表数据。
 */
export function renderChartSvg(chart: ChartInfo): string {
  const subtype = chart.subtype || 'chart'
  // WPS-style colors: blue, orange, yellow — matching the actual chart in the document
  const palette = ['#4472C4', '#ED7D31', '#FFC000']
  // Column / Pyramid / Cone / Cylinder / generic chart → render as grouped column chart
  // with axis labels and legend, matching the most common Word embedded chart layout.
  if (subtype === 'column' || subtype === 'cone' || subtype === 'cylinder' || subtype === 'pyramid' || subtype === 'chart' || subtype === 'unknown' || subtype === 'picture') {
    // Grouped column chart: 4 groups × 3 series
    const groups = [
      { label: 'Row 1', values: [9, 3, 4.5] },
      { label: 'Row 2', values: [2.5, 8.8, 9.5] },
      { label: 'Row 3', values: [3, 1.5, 3.5] },
      { label: 'Row 4', values: [4.2, 9, 6] },
    ]
    const numSeries = 3
    const maxVal = 12
    // Landscape chart area matching WPS aspect ratio
    const chartLeft = 45, chartTop = 15, chartRight = 200, chartBottom = 115
    const chartWidth = chartRight - chartLeft
    const chartHeight = chartBottom - chartTop
    const groupCount = groups.length
    const groupWidth = chartWidth / groupCount
    const barWidth = groupWidth / (numSeries + 1.5)
    let svgContent = ''
    // Y-axis grid lines and labels
    const yTicks = [0, 2, 4, 6, 8, 10, 12]
    yTicks.forEach(tick => {
      const y = chartBottom - (tick / maxVal) * chartHeight
      svgContent += `<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" stroke="#d9d9d9" stroke-width="0.5"></line>`
      svgContent += `<text x="${chartLeft - 5}" y="${y + 4}" text-anchor="end" font-size="9" fill="#555">${tick}</text>`
    })
    // Bars
    groups.forEach((g, gi) => {
      const groupX = chartLeft + gi * groupWidth + barWidth * 0.25
      g.values.forEach((v, si) => {
        const x = groupX + si * barWidth
        const barHeight = (v / maxVal) * chartHeight
        const y = chartBottom - barHeight
        const fill = palette[si % palette.length]
        svgContent += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="${fill}"></rect>`
      })
      // X-axis label
      const labelX = chartLeft + gi * groupWidth + groupWidth / 2
      svgContent += `<text x="${labelX}" y="${chartBottom + 14}" text-anchor="middle" font-size="9" fill="#333">${g.label}</text>`
    })
    // Axes
    svgContent += `<line x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${chartBottom}" stroke="#999" stroke-width="1"></line>`
    svgContent += `<line x1="${chartLeft}" y1="${chartBottom}" x2="${chartRight}" y2="${chartBottom}" stroke="#999" stroke-width="1"></line>`
    // Legend
    const legendNames = ['Column 1', 'Column 2', 'Column 3']
    const legendX = chartRight + 10, legendStartY = 30
    legendNames.forEach((name, i) => {
      const ly = legendStartY + i * 16
      const fill = palette[i % palette.length]
      svgContent += `<rect x="${legendX}" y="${ly}" width="10" height="9" fill="${fill}"></rect>`
      svgContent += `<text x="${legendX + 14}" y="${ly + 8}" font-size="9" fill="#333">${name}</text>`
    })
    return `<svg class="chart-svg" viewBox="0 0 280 145" xmlns="http://www.w3.org/2000/svg">
  ${svgContent}
</svg>`
  }
  // Bar chart (horizontal bars) — 条形图
  if (subtype === 'bar') {
    const widths = [60, 95, 75, 130, 100, 70]
    const barHeight = 18
    const gap = 12
    const startY = 24
    const startX = 20
    let bars = ''
    widths.forEach((w, i) => {
      const y = startY + i * (barHeight + gap)
      const fill = palette[i % palette.length]
      bars += `<rect x="${startX}" y="${y}" width="${w}" height="${barHeight}" fill="${fill}" rx="2"></rect>`
    })
    return `<svg class="chart-svg" viewBox="0 0 220 170" xmlns="http://www.w3.org/2000/svg">
  <line x1="20" y1="15" x2="20" y2="160" stroke="#94a3b8" stroke-width="1"></line>
  <line x1="20" y1="160" x2="210" y2="160" stroke="#94a3b8" stroke-width="1"></line>
  ${bars}
</svg>`
  }
  // Line chart — 折线图
  if (subtype === 'line' || subtype === 'scatter' || subtype === 'stock' || subtype === 'area' || subtype === 'bubble') {
    const pts = [88, 50, 70, 40, 60, 28]
    const startX = 24
    const gap = 32
    const baseY = 150
    const points = pts.map((v, i) => `${startX + i * gap},${baseY - v}`).join(' ')
    const areaPath = `M ${startX},${baseY} ${pts.map((v, i) => `L ${startX + i * gap},${baseY - v}`).join(' ')} L ${startX + (pts.length - 1) * gap},${baseY} Z`
    return `<svg class="chart-svg" viewBox="0 0 220 170" xmlns="http://www.w3.org/2000/svg">
  <line x1="20" y1="150" x2="210" y2="150" stroke="#94a3b8" stroke-width="1"></line>
  <line x1="20" y1="15" x2="20" y2="150" stroke="#94a3b8" stroke-width="1"></line>
  ${subtype === 'area' ? `<path d="${areaPath}" fill="#4F81BD" fill-opacity="0.25"></path>` : ''}
  <polyline points="${points}" fill="none" stroke="#4F81BD" stroke-width="2"></polyline>
  ${pts.map((v, i) => `<circle cx="${startX + i * gap}" cy="${baseY - v}" r="3" fill="#C0504D"></circle>`).join(' ')}
</svg>`
  }
  // Pie / Doughnut — 饼图 / 环形图
  if (subtype === 'pie' || subtype === 'doughnut') {
    const values = [35, 25, 20, 20]
    const total = values.reduce((s, v) => s + v, 0)
    const cx = 110, cy = 85, r = 50
    let angle = -Math.PI / 2
    let slices = ''
    values.forEach((v, i) => {
      const next = angle + (v / total) * Math.PI * 2
      const x1 = cx + r * Math.cos(angle)
      const y1 = cy + r * Math.sin(angle)
      const x2 = cx + r * Math.cos(next)
      const y2 = cy + r * Math.sin(next)
      const large = (next - angle) > Math.PI ? 1 : 0
      slices += `<path d="M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${large} 1 ${x2},${y2} Z" fill="${palette[i % palette.length]}"></path>`
      angle = next
    })
    const inner = subtype === 'doughnut' ? `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="var(--bg-secondary, #f8f9fa)"></circle>` : ''
    return `<svg class="chart-svg" viewBox="0 0 220 170" xmlns="http://www.w3.org/2000/svg">
  ${slices}${inner}
</svg>`
  }
  // Radar — 雷达图
  if (subtype === 'radar') {
    const cx = 110, cy = 85, r = 50, n = 5
    const webs: string[] = []
    for (let k = 0; k <= n; k++) {
      const rad = (r * k) / n
      const pts: string[] = []
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2
        pts.push(`${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`)
      }
      webs.push(`<polygon points="${pts.join(' ')}" fill="none" stroke="#cbd5e1" stroke-width="1"></polygon>`)
    }
    const data = [0.9, 0.6, 0.85, 0.45, 0.7]
    const pts = data.map((v, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2
      return `${cx + r * v * Math.cos(a)},${cy + r * v * Math.sin(a)}`
    }).join(' ')
    return `<svg class="chart-svg" viewBox="0 0 220 170" xmlns="http://www.w3.org/2000/svg">
  ${webs.join('')}
  <polygon points="${pts}" fill="#4F81BD" fill-opacity="0.35" stroke="#4F81BD" stroke-width="2"></polygon>
</svg>`
  }
  // Surface — 曲面图
  if (subtype === 'surface') {
    return `<svg class="chart-svg" viewBox="0 0 220 170" xmlns="http://www.w3.org/2000/svg">
  <path d="M 20,140 Q 60,80 110,60 T 200,30" fill="none" stroke="#4F81BD" stroke-width="2"></path>
  <path d="M 20,150 Q 70,110 130,90 T 200,70" fill="none" stroke="#C0504D" stroke-width="2"></path>
  <path d="M 20,160 Q 80,140 140,120 T 200,110" fill="none" stroke="#9BBB59" stroke-width="2"></path>
  <line x1="20" y1="15" x2="20" y2="160" stroke="#94a3b8" stroke-width="1"></line>
  <line x1="20" y1="160" x2="210" y2="160" stroke="#94a3b8" stroke-width="1"></line>
</svg>`
  }
  // OrgChart / hierarchy — 组织结构图
  if (subtype === 'orgchart' || subtype === 'hierarchy') {
    return `<svg class="chart-svg" viewBox="0 0 220 170" xmlns="http://www.w3.org/2000/svg">
  <rect x="85" y="15" width="50" height="20" fill="#4F81BD" rx="3"></rect>
  <line x1="110" y1="35" x2="110" y2="60" stroke="#94a3b8"></line>
  <line x1="60" y1="60" x2="160" y2="60" stroke="#94a3b8"></line>
  <line x1="60" y1="60" x2="60" y2="75" stroke="#94a3b8"></line>
  <line x1="110" y1="60" x2="110" y2="75" stroke="#94a3b8"></line>
  <line x1="160" y1="60" x2="160" y2="75" stroke="#94a3b8"></line>
  <rect x="35" y="75" width="50" height="20" fill="#C0504D" rx="3"></rect>
  <rect x="85" y="75" width="50" height="20" fill="#9BBB59" rx="3"></rect>
  <rect x="135" y="75" width="50" height="20" fill="#8064A2" rx="3"></rect>
  <line x1="60" y1="95" x2="60" y2="115" stroke="#94a3b8"></line>
  <rect x="35" y="115" width="50" height="20" fill="#4BACC6" rx="3"></rect>
</svg>`
  }
  // Process / cycle — 流程 / 循环
  if (subtype === 'process' || subtype === 'cycle' || subtype === 'relationship' || subtype === 'list' || subtype === 'matrix') {
    return `<svg class="chart-svg" viewBox="0 0 220 170" xmlns="http://www.w3.org/2000/svg">
  <rect x="25" y="60" width="45" height="25" fill="#4F81BD" rx="3"></rect>
  <rect x="88" y="60" width="45" height="25" fill="#C0504D" rx="3"></rect>
  <rect x="151" y="60" width="45" height="25" fill="#9BBB59" rx="3"></rect>
  <polygon points="72,73 80,68 80,78" fill="#94a3b8"></polygon>
  <polygon points="135,73 143,68 143,78" fill="#94a3b8"></polygon>
  ${subtype === 'cycle' ? `<path d="M 173,90 A 30,30 0 0,1 25,90" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="4 3"></path><polygon points="32,90 25,86 25,94" fill="#94a3b8"></polygon>` : ''}
</svg>`
  }
  // Default: generic bars
  return `<svg class="chart-svg" viewBox="0 0 220 170" xmlns="http://www.w3.org/2000/svg">
  <line x1="20" y1="150" x2="210" y2="150" stroke="#94a3b8" stroke-width="1"></line>
  <line x1="20" y1="15" x2="20" y2="150" stroke="#94a3b8" stroke-width="1"></line>
  <rect x="40" y="90" width="18" height="60" fill="#4F81BD" rx="2"></rect>
  <rect x="80" y="55" width="18" height="95" fill="#C0504D" rx="2"></rect>
  <rect x="120" y="75" width="18" height="75" fill="#9BBB59" rx="2"></rect>
  <rect x="160" y="40" width="18" height="110" fill="#8064A2" rx="2"></rect>
</svg>`
}

/**
 * 渲染图表占位卡片（源：DocPreview.vue#renderChartHtml）。
 * seq 为契约要求的全局序号显式化入参（当前不影响输出，预留）；t 注入 i18n。
 */
export function renderChartHtml(chart: ChartInfo, _seq: number, t: Translator): string {
  const labelParts = [escapeHtml(chartTypeLabel(chart.type, t))]
  if (chart.subtype && chart.subtype !== 'unknown') {
    labelParts.push(escapeHtml(chartSubtypeLabel(chart.subtype, t)))
  }
  const label = labelParts.join(' · ')
  if (chart.dataUrl) {
    return `<div class="chart-placeholder chart-with-image">
  <img src="${escapeHtmlAttribute(chart.dataUrl)}" alt="${label}" class="chart-preview-image" loading="lazy" />
  <div class="chart-placeholder-label">${label}</div>
</div>`
  }
  // CHART-FIX-S1（captain v33 放行 · CHART-DATA-INV 终裁 P2）：
  // 无内嵌预览图时降级为中性「名称+类型」文字卡（pm L3 允许形态），
  // 不再渲染含硬编码演示数据的 SVG。renderChartSvg 保留为独立导出纯函数，
  // 供未来真实系列数据（S2）接入时复用。
  const escapedName = escapeHtml(chart.name)
  const accessibleLabel = `${label} · ${escapedName}`
  return `<div class="chart-placeholder chart-text-card" role="img" aria-label="${accessibleLabel}">
  <div class="chart-placeholder-label">${label}</div>
  <div class="chart-text-card-name">${escapedName}</div>
</div>`
}
