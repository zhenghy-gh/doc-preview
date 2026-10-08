// T3-W2 · listRenderer 单测（contract-split-r1 §1.2 Batch-B / §3.2 可单测标准）
// ⚠️ 覆盖契约红线 R2：\u0001 双层消费顺序（第一层=renderParagraph 回调内部；第二层=先图后表两次全局 replace）
import { describe, it, expect } from 'vitest'
import {
  extractListItemText,
  renderNestedList,
  renderListBlock,
  type ParagraphHtmlFn,
} from '../src/utils/rendering/listRenderer'
import type { RenderParagraph, CharacterFormat, ParagraphFormat } from '../src/utils/docFormat'

function para(text: string, over: Partial<RenderParagraph['paraFormat']> = {}): RenderParagraph {
  return {
    text,
    charFormat: {},
    paraFormat: { listType: 'ordered', listLevel: 0, ...over } as RenderParagraph['paraFormat'],
    _cpStart: 0,
  }
}

const noopRender: ParagraphHtmlFn = (text) => `<p>${text}</p>`

describe('extractListItemText', () => {
  it('strips ordered markers of every supported family', () => {
    expect(extractListItemText('1. 项目', 'ordered')).toBe('项目')
    expect(extractListItemText('2) 项目', 'ordered')).toBe('项目')
    expect(extractListItemText('(3) 项目', 'ordered')).toBe('项目')
    expect(extractListItemText('一、项目', 'ordered')).toBe('项目')
    expect(extractListItemText('① 项目', 'ordered')).toBe('项目')
    expect(extractListItemText('II. 项目', 'ordered')).toBe('项目')
    expect(extractListItemText('1.2 子项', 'ordered')).toBe('子项')
  })

  it('strips unordered markers and leaves plain text untouched', () => {
    expect(extractListItemText('• 要点', 'unordered')).toBe('要点')
    expect(extractListItemText('- 要点', 'unordered')).toBe('要点')
    expect(extractListItemText('普通句子', 'unordered')).toBe('普通句子')
  })
})

describe('renderNestedList', () => {
  const items = [
    { text: 'A', level: 0, charFormat: {} as CharacterFormat, paraFormat: {} as ParagraphFormat },
    { text: 'B1', level: 1, charFormat: {} as CharacterFormat, paraFormat: {} as ParagraphFormat },
    { text: 'C', level: 0, charFormat: {} as CharacterFormat, paraFormat: {} as ParagraphFormat },
  ]

  it('builds nested structure from levels via callback-injected renderer', () => {
    const html = renderNestedList('ul', 'disc', items, noopRender)
    // B1 成为 A 的子列表
    expect(html).toContain('<ul style="list-style:disc;padding-left:2em">')
    expect(html).toContain('<li style="font-size:1.0rem">A<ul')
    expect(html).toContain('B1</li>')
    expect(html.indexOf('C') > html.indexOf('B1')).toBe(true)
  })

  it('emits start attribute only on root ol when startAt > 1', () => {
    const withStart = renderNestedList('ol', 'decimal', items, noopRender, 0, 4)
    expect(withStart).toContain('<ol start="4" style="list-style:decimal;')
    const noStart = renderNestedList('ol', 'decimal', items, noopRender)
    expect(noStart).not.toContain('start=')
  })

  it('invokes the injected paragraph callback per item and strips the <p> wrapper', () => {
    const calls: string[] = []
    const spy: ParagraphHtmlFn = (text, charFormat, _paraFormat, cpStart, cpEnd) => {
      calls.push(`${text}|${cpStart}-${cpEnd}|${charFormat === items[0].charFormat}`)
      return `<p style="font-size:x">${text}</p>`
    }
    const html = renderNestedList('ul', 'disc', [items[0]], spy)
    expect(calls).toEqual(['A|0-1|true'])
    // 回调返回值的外层 <p…>/</p> 被剥除，仅留内容
    expect(html).toContain('<li style="font-size:1.0rem">A</li>')
  })
})

describe('renderListBlock（双层 \\u0001 消费红线）', () => {
  const est = (_text: string, _cf: CharacterFormat) => 10

  it('collects consecutive same-type paragraphs and returns nextIndex past the block', () => {
    const paragraphs = [
      para('1. 一'),
      para('2. 二'),
      para('正文段', { listType: undefined }),
      para('• 点', { listType: 'unordered' }),
    ]
    const r = renderListBlock({
      paragraphs, startIndex: 0, listType: 'ordered',
      listCounters: new Map(), estimateItemHeight: est,
      renderParagraph: noopRender, hasPictures: false, hasCharts: false,
      consumePictureHtml: () => null, consumeChartHtml: () => null,
    })
    expect(r.nextIndex).toBe(2)
    expect(r.html).toContain('<ol')
    expect(r.estimatedHeight).toBe(20)
  })

  it('skips marker-only empty items without counting their height', () => {
    // 注意原语义：无尾随空白的 '1.' 不匹配剥离正则 → 非空照计；
    // 只有剥空后的条目（如 '1. '）才跳过
    const paragraphs = [para('1. '), para('2. 实项')]
    let calls = 0
    const r = renderListBlock({
      paragraphs, startIndex: 0, listType: 'ordered',
      listCounters: new Map(), estimateItemHeight: () => { calls++; return 5 },
      renderParagraph: noopRender, hasPictures: false, hasCharts: false,
      consumePictureHtml: () => null, consumeChartHtml: () => null,
    })
    expect(calls).toBe(1)
    expect(r.estimatedHeight).toBe(5)
    expect(r.nextIndex).toBe(2)
  })

  it('continues numbering from listCounters and only counts level-0 items', () => {
    const counters = new Map<number, number>([[7, 3]])
    const paragraphs = [
      para('x. 一', { listId: 7, listLevel: 0 }),
      para('y. 子', { listId: 7, listLevel: 1 }),
      para('z. 二', { listId: 7, listLevel: 0 }),
    ]
    const r = renderListBlock({
      paragraphs, startIndex: 0, listType: 'ordered', listCounters: counters,
      estimateItemHeight: est, renderParagraph: noopRender,
      hasPictures: false, hasCharts: false,
      consumePictureHtml: () => null, consumeChartHtml: () => null,
    })
    expect(r.html).toContain('start="4"')
    expect(counters.get(7)).toBe(5) // 3 + 两个 level-0
  })

  it('does not touch counters for unordered lists', () => {
    const counters = new Map<number, number>()
    renderListBlock({
      paragraphs: [para('• a', { listType: 'unordered' }), para('• b', { listType: 'unordered' })],
      startIndex: 0, listType: 'unordered', listCounters: counters,
      estimateItemHeight: est, renderParagraph: noopRender,
      hasPictures: false, hasCharts: false,
      consumePictureHtml: () => null, consumeChartHtml: () => null,
    })
    expect(counters.size).toBe(0)
  })

  it('R2 第一层：renderParagraph 回调收到含占位符的原文并可在内部先行消费', () => {
    const seenTexts: string[] = []
    // 模拟宿主 renderParagraphHtml 的第一层消费：回调内直接吃掉占位符
    const innerConsumer: ParagraphHtmlFn = (text) => {
      seenTexts.push(text)
      return `<p>${text.replace(/\u0001/g, '<img src="inner">')}</p>`
    }
    let outerPicCalls = 0
    const r = renderListBlock({
      paragraphs: [para('\u0001 图'), para('\u0002 图二')],
      startIndex: 0, listType: 'ordered', listCounters: new Map(),
      estimateItemHeight: est, renderParagraph: innerConsumer,
      hasPictures: true, hasCharts: false,
      consumePictureHtml: () => { outerPicCalls++; return '<img src="outer">' },
      consumeChartHtml: () => null,
    })
    expect(seenTexts).toEqual(['\u0001 图', '\u0002 图二'])
    expect(r.html).toContain('<img src="inner">') // 第一层已替换
    expect(outerPicCalls).toBe(0) // 无残留 → 第二层图片阶段零调用
  })

  it('R2 第二层：残留占位符先图后表；图耗尽保留字面量、表耗尽插入空串', () => {
    // 场景：3 个占位符，图片只够 1 个 → 剩余字面量进入图表阶段；图表够 2 个 → 清空
    const picLog: (string | null)[] = ['<img src="p1">', null, null]
    const chartLog: (string | null)[] = ['<div class="chart-placeholder">c1</div>', '<div class="chart-placeholder">c2</div>']
    const order: string[] = []
    const r = renderListBlock({
      paragraphs: [para('\u0001\u0001\u0001')],
      startIndex: 0, listType: 'ordered', listCounters: new Map(),
      estimateItemHeight: est,
      renderParagraph: (t) => { order.push('render'); return `<p>${t}</p>` },
      hasPictures: true, hasCharts: true,
      consumePictureHtml: () => { order.push('pic'); const v = picLog.shift() ?? null; return v },
      consumeChartHtml: () => { order.push('chart'); const v = chartLog.shift() ?? null; return v },
    })
    expect(order.filter(x => x === 'pic')).toHaveLength(3) // replace 对每个 \u0001 各调一次
    expect(order.filter(x => x === 'chart')).toHaveLength(2) // 仅剩的 2 个占位符
    expect(order.indexOf('render')).toBeLessThan(order.indexOf('pic')) // 第一层先于第二层
    expect(r.html).toBe('<ol style="list-style:decimal;padding-left:2em"><li style="font-size:1.0rem"><img src="p1"><div class="chart-placeholder">c1</div><div class="chart-placeholder">c2</div></li></ol>')
  })

  it('hasCharts=false 时短路：残留占位符原样保留（镜像原门卫）', () => {
    const r = renderListBlock({
      paragraphs: [para('\u0001 尾')],
      startIndex: 0, listType: 'ordered', listCounters: new Map(),
      estimateItemHeight: est, renderParagraph: noopRender,
      hasPictures: false, hasCharts: false,
      consumePictureHtml: () => { throw new Error('不应被调用') },
      consumeChartHtml: () => { throw new Error('不应被调用') },
    })
    expect(r.html).toBe('<ol style="list-style:decimal;padding-left:2em"><li style="font-size:1.0rem">\u0001 尾</li></ol>')
  })

  it('hasPictures=true 但全部耗尽：字面量保留且图表阶段接手为空串', () => {
    let charts = 0
    const r = renderListBlock({
      paragraphs: [para('\u0001')],
      startIndex: 0, listType: 'ordered', listCounters: new Map(),
      estimateItemHeight: est, renderParagraph: noopRender,
      hasPictures: true, hasCharts: true,
      consumePictureHtml: () => null, // 图片耗尽
      consumeChartHtml: () => (++charts <= 1 ? '<chart/>' : null),
    })
    // 图片阶段返回 null → 字面量保留 → 图表阶段 replace 成功一次
    expect(r.html).toBe('<ol style="list-style:decimal;padding-left:2em"><li style="font-size:1.0rem"><chart/></li></ol>')
    expect(charts).toBe(1)
  })
})
