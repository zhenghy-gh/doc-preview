// T3-W3 · documentRenderer 单测（contract-split-r1 §1.2 Batch-C / §3.2 可单测标准）
// 依赖链含 textRender#escapeHtml（DOM 实现）→ 需 happy-dom 环境。
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { renderDocumentToPages, type RenderInput, type PictureSource } from '../src/utils/rendering/documentRenderer'
import type { RenderParagraph, ChartInfo, ShapeInfo, RevisionMark, SectionInfo } from '../src/utils/docFormat'

const t = (key: string) => key
const fontResolver = () => ''

function para(text: string, over: Partial<RenderParagraph['paraFormat']> = {}, cpStart = 0): RenderParagraph {
  return {
    text,
    charFormat: {},
    paraFormat: { ...over } as RenderParagraph['paraFormat'],
    _cpStart: cpStart,
  }
}

function makeChart(name: string): ChartInfo {
  return { id: 1, name, type: 'msgraph', subtype: 'chart' }
}

function baseInput(over: Partial<RenderInput> = {}): RenderInput {
  return {
    paragraphs: [],
    hyperlinks: [],
    revisions: [],
    revisionMode: 'marks',
    shapes: [],
    pictures: [],
    images: [],
    charts: [],
    sections: [],
    pageHeightPt: 842,
    showHiddenText: false,
    fontResolver,
    t,
    ...over,
  }
}

describe('renderDocumentToPages · 总编排', () => {
  it('returns the empty-document sentinel verbatim', () => {
    expect(renderDocumentToPages(baseInput())).toEqual(['<p>文档内容为空</p>'])
  })

  it('wraps paragraphs into .page-content containers', () => {
    const pages = renderDocumentToPages(baseInput({ paragraphs: [para('第一段'), para('第二段')] }))
    expect(pages).toHaveLength(1)
    expect(pages[0]).toContain('<div class="page-content">')
    expect(pages[0]).toContain('第一段')
    expect(pages[0]).toContain('第二段')
  })

  it('renders empty paragraphs as &nbsp; placeholders', () => {
    const pages = renderDocumentToPages(baseInput({ paragraphs: [para('   '), para('正文')] }))
    expect(pages[0]).toContain('<p style="margin:0;padding:0;height:0.6em;">&nbsp;</p>')
  })

  it('splits into multiple pages by estimated height', () => {
    // 每段约 45×24×1.5+4 ≈ 1620px，页高 1122px → 每段各占一页
    const longText = 'x'.repeat(45 * 80)
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para(longText), para(longText), para(longText)],
    }))
    expect(pages.length).toBeGreaterThanOrEqual(3)
  })

  it('injects column CSS and splits pages on section column-count change', () => {
    const sections: SectionInfo[] = [
      { cpStart: 0, cpEnd: 50, columnCount: 2, columnSpacingPt: 12 } as SectionInfo,
      { cpStart: 50, cpEnd: 100 } as SectionInfo,
    ]
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('双栏节内容', {}, 0), para('单栏节内容', {}, 60)],
      sections,
    }))
    expect(pages[0]).toContain('column-count: 2')
    expect(pages[pages.length - 1]).not.toContain('column-count')
  })

  it('honors pageBreakBefore as a hard page split', () => {
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('A'), para('B', { pageBreakBefore: true })],
    }))
    expect(pages).toHaveLength(2)
    expect(pages[0]).toContain('>A<')
    expect(pages[1]).toContain('>B<')
  })

  it('consumes \u0001 placeholders in document order: images first, then charts', () => {
    // DEF-005 方案A 落地后：Phase1 实际替换即置 hasHtml，图片替换结果不再被回退分支丢弃
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('\u0001 第一'), para('\u0001 第二')],
      images: ['data:image/png;base64,IMG'],
      charts: [makeChart('Chart A')],
    }))
    const joined = pages.join('')
    expect(joined).toContain('data:image/png;base64,IMG') // 第一段消费图片
    expect(joined).toContain('chart-placeholder')          // 第二段轮到图表（图表置 hasHtml）
    expect(joined).not.toContain('\u0001')
  })

  it('appends unconsumed charts after the body text (tail remainder)', () => {
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('纯文本，无占位符')],
      charts: [makeChart('Tail Chart')],
    }))
    const last = pages[pages.length - 1]
    expect(last.indexOf('chart-text-card')).toBeGreaterThan(last.indexOf('纯文本'))
  })

  it('places textbox anchor markers within their anchor paragraph page', () => {
    const shape: ShapeInfo = {
      spid: 2049, type: 'textbox', anchorType: 'topLeft',
      x: 900, y: 1800, width: 3000, height: 1500, anchorCp: 3,
    }
    const longText = 'x'.repeat(45 * 30)
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para(longText)],
      shapes: [shape],
    }))
    expect(pages.join('')).toContain('textbox-anchor-marker')
  })

  it('applies revision marks via the injected mode', () => {
    const revisions: RevisionMark[] = [{
      type: 'insert', author: '张三', time: 1700000000000, startDateSerial: 0, endDateSerial: 0,
      cpStart: 0, cpEnd: 2,
    } as unknown as RevisionMark]
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('新增')],
      revisions,
      revisionMode: 'marks',
    }))
    expect(pages.join('')).toMatch(/<ins|del/)
  })

  it('is reentrant: identical inputs yield identical outputs across calls (计数器收编)', () => {
    const input = baseInput({
      paragraphs: [para('\u0001 一'), para('\u0001 二')],
      charts: [makeChart('A'), makeChart('B'), makeChart('C')],
    })
    const first = renderDocumentToPages(input)
    const second = renderDocumentToPages(input)
    expect(first).toEqual(second)
    // 第二次调用计数器已重置：尾部兜底仍应从第 3 个图表开始（前两个被占位符消费）
    const joined = second.join('')
    expect((joined.match(/chart-placeholder-label/g) || []).length).toBeGreaterThanOrEqual(3)
  })
})

describe('DEF-005 方案A 回归', () => {
  it('回归①：无样式纯图段渲染出 <img>（修复前被回退分支丢弃）', () => {
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('\u0001 图注')],
      images: ['data:image/png;base64,PURE'],
    }))
    const joined = pages.join('')
    expect(joined).toContain('<img src="data:image/png;base64,PURE"')
    expect(joined).toContain('图注')
  })

  it('回归②：双图顺序保持（计数器推进与显示一致）', () => {
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('\u0001 甲图'), para('\u0001 乙图')],
      images: ['data:image/png;base64,ONE', 'data:image/png;base64,TWO'],
    }))
    const joined = pages.join('')
    expect(joined).toContain('data:image/png;base64,ONE')
    expect(joined).toContain('data:image/png;base64,TWO')
    expect(joined.indexOf('ONE')).toBeLessThan(joined.indexOf('TWO'))
  })
})

describe('R-1 列表项抑制语义钉死（reviewer findings-r1）', () => {
  it('reuses the first result-text match without changing duplicate-result output', () => {
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('正文中的链接结果')],
      hyperlinks: [
        { cpStart: 0, cpEnd: 1, url: 'https://example.com/one', result: '链接结果' },
        { cpStart: 2, cpEnd: 3, url: 'https://example.com/two', result: '链接结果' },
      ],
    }))
    const joined = pages.join('')
    expect((joined.match(/<a href=/g) || []).length).toBe(1)
    expect(joined).toContain('https://example.com/one')
  })

  it('列表项不吃全文超链接：链接只落在其锚定正文段，<li> 内无 <a>', () => {
    // 超链接窗口 [0,4) 覆盖正文段；修复前列表项（文本长 1）因共享全文列表被误注入
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [
        para('前导链接文字段落'),
        para('1. 甲', { listType: 'ordered', listLevel: 0 }),
        para('2. 乙', { listType: 'ordered', listLevel: 0 }),
      ],
      // FIELD-CP-GOV：放置改为结果文本锚定，result 必须真实出现于目标段文本
      hyperlinks: [{ cpStart: 0, cpEnd: 4, url: 'https://example.com/x', result: '链接文字' }],
    }))
    const joined = pages.join('')
    expect((joined.match(/<a href="https:\/\/example\.com\/x"/g) || []).length).toBe(1)
    expect(joined).toContain('<ol')
    // 提取 <li> 行断言无锚点
    const liParts = joined.split(/<li[^>]*>/).slice(1).map(x => x.split('</li>')[0])
    expect(liParts.length).toBe(2)
    for (const li of liParts) expect(li).not.toContain('<a ')
    expect(liParts[0]).toContain('甲')
    expect(liParts[1]).toContain('乙')
  })

  it('列表项不吃全文修订：marks 不误包、accepted 不误删', () => {
    const rev = {
      type: 'insert' as const, cpStart: 0, cpEnd: 2,
      authorIndex: 0, author: '张三', timestamp: 1700000000000,
    }
    const mk = (mode: 'marks' | 'accepted') => renderDocumentToPages(baseInput({
      paragraphs: [
        para('修订正文'),
        para('1. 甲', { listType: 'ordered', listLevel: 0 }),
        para('2. 乙', { listType: 'ordered', listLevel: 0 }),
      ],
      revisions: [rev],
      revisionMode: mode,
    }))

    const marks = mk('marks').join('')
    // <ins> 只出现在正文段（一次），列表项干净
    expect((marks.match(/<ins/g) || []).length).toBe(1)
    const liMarks = marks.split(/<li[^>]*>/).slice(1).map(x => x.split('</li>')[0])
    expect(liMarks[0]).not.toContain('<ins')
    expect(liMarks[0]).toContain('甲')

    const accepted = mk('accepted').join('')
    // accepted 模式下 insert 保留为普通文本；列表项文本不得被误删
    const liAccepted = accepted.split(/<li[^>]*>/).slice(1).map(x => x.split('</li>')[0])
    expect(liAccepted[0]).toContain('甲')
    expect(liAccepted[1]).toContain('乙')
  })
})

// ═══ 循环 #13 · 长尾分支补测（占位符消费/锚定过滤/守卫侧）═══
describe('长尾分支：占位符消费与资产锚定', () => {
  it('pictures 数组混入裸字符串时走 typeof 防御分支', () => {
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('\u0001 字符串图')],
      pictures: ['data:image/png;base64,RAWSTR' as unknown as PictureSource],
    }))
    expect(pages.join('')).toContain('src="data:image/png;base64,RAWSTR"')
  })

  it('占位符数量超过图表数时多余占位符替换为空串（charts-only，无图片门卫拦截）', () => {
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('\u0001\u0001 双占位')],
      charts: [makeChart('Single')],
    }))
    const joined = pages.join('')
    expect(joined).toContain('chart-placeholder')
    expect(joined).not.toContain('\u0001')
  })

  it('软换行 \\v 在两条渲染路径都转换为 <br>', () => {
    const plain = renderDocumentToPages(baseInput({ paragraphs: [para('上\v下')] }))
    expect(plain.join('')).toContain('上<br>下')
    const styled = renderDocumentToPages(baseInput({
      paragraphs: [{
        text: '上\v下',
        charFormat: { styles: [{ start: 0, end: 1, style: { bold: true } }] },
        paraFormat: {},
        _cpStart: 0,
      } as RenderParagraph],
    }))
    expect(styled.join('')).toContain('<br>')
  })

  it('textbox 无有效 anchorCp 被过滤；floating 图片不进内联锚定集合', () => {
    const noAnchor = { spid: 1, type: 'textbox', anchorType: 'topLeft', x: 0, y: 0, width: 10, height: 10 } as unknown as ShapeInfo
    const zeroAnchor = { ...noAnchor, anchorCp: 0 } as ShapeInfo
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('正文内容')],
      shapes: [noAnchor, zeroAnchor],
      pictures: [{ format: 'png', dataUrl: 'data:image/png;base64,FLTPIC', cp: 1, floating: true }],
    }))
    const joined = pages.join('')
    expect(joined).not.toContain('textbox-anchor-marker')
    expect(joined).not.toContain('inline-picture-container')
    // floating 图片绕开内联与尾部（cp 已定义 → 尾部 skip），两口径都不渲染属既定契约镜像
    expect(joined).not.toContain('FLTPIC')
  })

  it('缺少 url 或 result 的超链接被守卫跳过，不产生锚定', () => {
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('前导正文段文字'), para('另一段')],
      hyperlinks: [
        { cpStart: 0, cpEnd: 2, url: '', result: '正文' },
        { cpStart: 0, cpEnd: 2, url: 'https://x.example', result: '' },
      ],
    }))
    expect(pages.join('')).not.toContain('<a ')
  })

  it('嵌入式图片按 cp 锚定到覆盖段落，heightPx 按 400px 上限折算', () => {
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('abcd', {}, 0)],
      pictures: [
        { format: 'png', dataUrl: 'data:image/png;base64,NEST1', cp: 2, floating: false, widthPx: 300, heightPx: 800 },
        { format: 'png', dataUrl: 'data:image/png;base64,NEST2', cp: 3, floating: false, heightPx: 100 },
        { format: 'png', dataUrl: 'data:image/png;base64,NEST3', cp: 4, floating: false },
      ],
    }))
    const joined = pages.join('')
    expect(joined).toContain('inline-picture-container')
    expect(joined).toContain('NEST1')
    expect(joined).toContain('NEST2')
    expect(joined).toContain('NEST3')
    expect(joined).toContain('max-height: 500px') // 800px 图被钳制
    expect(joined).toContain('max-width: 300px')
    expect(joined).toContain('PNG · 300×800px') // 宽高三行 caption
    expect(joined).toContain('max-width: 100%') // 无 widthPx 走百分比回退
  })

  it('cp 超出全部段落范围的图片在尾部兜底被 skip（避免与锚定路径双渲染）', () => {
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('短段', {}, 0)],
      pictures: [{ format: 'png', dataUrl: 'data:image/png;base64,FARAWAY', cp: 99999, floating: false }],
    }))
    expect(pages.join('')).not.toContain('FARAWAY')
  })

  it('falls back to binary CP lookup when paragraph CPs are non-monotonic', () => {
    const shape = {
      spid: 7, type: 'textbox', anchorType: 'topLeft', x: 0, y: 0, width: 10, height: 10, anchorCp: 101,
    } as unknown as ShapeInfo
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('A', {}, 100), para('B', {}, 0)],
      shapes: [shape],
      pictures: [{ format: 'png', dataUrl: 'data:image/png;base64,NONMONO', cp: 1, floating: false }],
    }))
    const joined = pages.join('')
    expect(joined).toContain('textbox-anchor-marker')
    expect(joined).toContain('NONMONO')
  })

  it('images 兜底残量在尾部以 <img> 追加（占位符消费不足的欠账清偿）', () => {
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('\u0001 只消费一张')],
      images: ['data:image/png;base64,USED', 'data:image/png;base64,TAIL'],
    }))
    const joined = pages.join('')
    expect(joined).toContain('src="data:image/png;base64,USED"')
    expect(joined).toContain('src="data:image/png;base64,TAIL"')
  })

  it('列表项 \u0001 在第一层耗尽后由第二层保留为字面量（双层消费镜像）', () => {
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [
        para('\u0001 正文吃图', {}, 0),
        para('\u0001 列表项', { listType: 'ordered', listLevel: 0 }, 10),
      ],
      images: ['data:image/png;base64,ONLY'],
    }))
    const joined = pages.join('')
    expect(joined).toContain('src="data:image/png;base64,ONLY"')
    expect(joined).toContain('<ol')
    // 图片耗尽 → 两层消费都保留 \u0001 字面量（原实现镜像红线）
    expect(joined).toContain('\u0001 列表项')
  })

  it('shapes/pictures/hyperlinks 传 undefined 时走 || 回退与守卫短路', () => {
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('裸段')],
      shapes: undefined as unknown as ShapeInfo[],
      pictures: undefined as unknown as PictureSource[],
      hyperlinks: undefined,
    }))
    expect(pages.join('')).toContain('裸段')
  })

  it('段落缺 charFormat 时以空对象兜底渲染', () => {
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [{ text: '无字符格式段', paraFormat: {}, _cpStart: 0 } as unknown as RenderParagraph],
    }))
    expect(pages.join('')).toContain('无字符格式段')
  })

  it('尾部兜底遇到未消费的字符串型图片直接作为 src', () => {
    const pages = renderDocumentToPages(baseInput({
      paragraphs: [para('无占位符正文')],
      pictures: ['data:image/png;base64,STRTAIL' as unknown as PictureSource],
    }))
    // 无 \u0001 → 第一层不消费；cp 未定义 → 尾部不 skip，走 typeof string 真侧
    expect(pages.join('')).toContain('src="data:image/png;base64,STRTAIL"')
  })
})
