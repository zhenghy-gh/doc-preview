// @vitest-environment happy-dom
//
// TG-1 · 渲染管线黄金快照基线（vue-dev-4 · 2026-08-25）
//
// 目的：为 T3 渲染管线抽离（DocPreview.vue → 纯函数）提供逐字节等价安全网。
// 机制：合成 .doc 夹具（tests/_renderGolden.helpers.ts）→ mount DocPreview →
//       收集全部 .page-content 的 outerHTML → toMatchFileSnapshot 存入
//       tests/__snapshots__/render-golden/。
//
// 快照语义约定：
//   - 每个 .page-content 的完整 outerHTML（含分栏/分页内联样式），按 DOM 顺序以 '\n' 连接；
//   - v-html 注入的 .page-content 不携带 data-v-* 属性，快照对 scoped CSS 哈希漂移免疫，
//     对渲染输出本身逐字节敏感——这正是 T3 需要的安全网性质；
//   - 每例先做结构断言（可读失败），再写文件快照（逐字节比对）。
//
// 样本选择：对齐 qa T6 回归矩阵的样本类别（任务书 task-backlog-r1/T6）+
// captain TG-1 最低要求（表格/列表/图表占位/修订 ins-del 各≥1 例）。
// qa T6 正式矩阵上板后可在此追加同构用例。

import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import DocPreview from '../src/components/DocPreview.vue'
import { buildGoldenDocBytes } from './_renderGolden.helpers'

const here = dirname(fileURLToPath(import.meta.url))
const samplesR1Dir = resolve(here, '../docs/samples-r1')

const wrappers: VueWrapper[] = []

afterEach(() => {
  while (wrappers.length > 0) {
    wrappers.pop()?.unmount()
  }
})

/** 挂载组件并等待解析+渲染完成，返回全部 .page-content 的 outerHTML（按页序 '\n' 连接）。 */
async function renderGoldenBytes(bytes: ArrayBuffer, fileName: string): Promise<string> {
  const file = new File([bytes], fileName, { type: 'application/msword' })
  const wrapper = mount(DocPreview, { props: { source: file } })
  wrappers.push(wrapper)
  await vi.waitFor(
    () => {
      expect(wrapper.findAll('.page-content').length).toBeGreaterThan(0)
    },
    { timeout: 10_000 },
  )
  return wrapper
    .findAll('.page-content')
    .map(el => (el.element as HTMLElement).outerHTML)
    .join('\n')
}

/** 构造合成 .doc 并走同一渲染链路。 */
async function renderGoldenHtml(spec: Parameters<typeof buildGoldenDocBytes>[0], fileName: string): Promise<string> {
  return renderGoldenBytes(buildGoldenDocBytes(spec), fileName)
}

describe('render pipeline golden snapshots (TG-1)', () => {
  it('golden/text-formats: 字符级样式段 + 段落对齐/缩进/大纲级别', async () => {
    // 段落布局（cp = JS 字符串下标）：
    //   [0..8)   标题段（居中 + 大纲级别0）
    //   [9..)    正文段（含 粗体 / 斜体 / 大字号 三段字符样式）
    //   尾段     右对齐英文行
    const text = '文档格式快照标题\r正文包含粗体与斜体与大字号混排。\rRight aligned tail line.\r'
    const boldAt = text.indexOf('粗体')
    const italicAt = text.indexOf('斜体')
    const bigAt = text.indexOf('大字号')

    const html = await renderGoldenHtml(
      {
        text,
        charRuns: [
          { cpStart: boldAt, bold: true },
          { cpStart: boldAt + '粗体'.length, bold: false },
          { cpStart: italicAt, italic: true },
          { cpStart: italicAt + '斜体'.length, italic: false },
          { cpStart: bigAt, fontSizePt: 22 },
        ],
        paraRuns: [
          { cpStart: 0, alignment: 'center', outlineLevel: 0 },
          { cpStart: 9, indentPt: 12 },
          { cpStart: text.indexOf('Right aligned'), alignment: 'right' },
        ],
      },
      'text-formats.doc',
    )

    expect(html).toContain('文档格式快照标题')
    expect(html).toContain('粗体')
    expect(html).toContain('font-size') // 字符样式以内联样式落盘
    expect(html).toContain('<p')
    await expect(html).toMatchFileSnapshot('./__snapshots__/render-golden/text-formats.html')
  })

  it('golden/table: 2 行 ×3 列带边框与垂直合并起始', async () => {
    const text =
      '表格前导段落\r' +
      '表头甲\u0007表头乙\u0007表头丙\u0007' +
      '数据壹\u0007数据贰\u0007数据叁\u0007' +
      '表格后继段落\r'
    const row1Cp = text.indexOf('表头甲')
    const row2Cp = text.indexOf('数据壹')

    const html = await renderGoldenHtml(
      {
        text,
        paraRuns: [
          { cpStart: 0 },
          {
            cpStart: row1Cp,
            inTable: true,
            tableDepth: 1,
            cells: [
              { verticalMerge: 'none' },
              { verticalMerge: 'none' },
              { verticalMerge: 'none' },
            ],
            borders: {
              top: { lineWidth: 4, borderType: 1, colorIndex: 1 },
              bottom: { lineWidth: 4, borderType: 1, colorIndex: 1 },
              insideH: { lineWidth: 2, borderType: 1, colorIndex: 1 },
              insideV: { lineWidth: 2, borderType: 1, colorIndex: 1 },
            },
          },
          {
            cpStart: row2Cp,
            inTable: true,
            tableDepth: 1,
            cells: [
              { verticalMerge: 'restart' },
              { verticalMerge: 'none' },
              { verticalMerge: 'none' },
            ],
          },
          { cpStart: text.indexOf('表格后继段落') },
        ],
      },
      'table.doc',
    )

    expect(html).toContain('<table')
    expect(html).toContain('<td')
    expect(html).toContain('表头甲')
    await expect(html).toMatchFileSnapshot('./__snapshots__/render-golden/table.html')
  })

  it('golden/list: LST/LFO 有序列表 + 跨非列表段编号续接', async () => {
    // 列表项 → 普通段落 → 列表项续接：触发 DocPreview computeListContinuity 的 <ol start="N"> 路径
    const text = '项目甲\r中断普通段落\r项目乙续接\r项目丙续接\r'

    const html = await renderGoldenHtml(
      {
        text,
        paraRuns: [
          { cpStart: 0, ilstLegacy: 0, ilvl: 0 },
          { cpStart: text.indexOf('中断普通段落') },
          { cpStart: text.indexOf('项目乙续接'), ilstLegacy: 0, ilvl: 0 },
          { cpStart: text.indexOf('项目丙续接'), ilstLegacy: 0, ilvl: 0 },
        ],
        lists: [{ lsid: 0x12345678, iStartAt: 1, nfc: 0 }],
      },
      'list.doc',
    )

    expect(html).toContain('<ol')
    expect(html).toContain('start="2"') // 续接编号：首块 1 项，第二连续块从 2 起（computeListContinuity）
    await expect(html).toMatchFileSnapshot('./__snapshots__/render-golden/list.html')
  })

  it('golden/list-revision: 列表 × 前置段落修订组合（R-1 抑制语义钉死）', async () => {
    // R-1（reviewer findings-r1 · P0）：列表项刻意不吃全文超链接与修订。
    // 修复前：前置段落的 insert 修订窗口 [0,2) 会命中列表项文本（长 1-2 字符），
    // marks 模式在 <li> 内产生错误 <ins>、accepted/rejected 模式误删列表项文本。
    // 本夹具钉死抑制语义：<ins> 仅出现在正文段，两个 <li> 内容干净。
    const text = '修订新增段落\r1. 列表甲项\r2. 列表乙项\r'
    const dttm = 0x01020304

    const html = await renderGoldenHtml(
      {
        text,
        revisionAuthors: ['张三'],
        charRuns: [{ cpStart: 0, insertMark: { authorIndex: 0, dttm } }],
        paraRuns: [
          { cpStart: 0 },
          { cpStart: text.indexOf('1. 列表甲项'), ilstLegacy: 0, ilvl: 0 },
          { cpStart: text.indexOf('2. 列表乙项'), ilstLegacy: 0, ilvl: 0 },
        ],
        lists: [{ lsid: 0x12345678, iStartAt: 1, nfc: 0 }],
      },
      'list-revision.doc',
    )

    expect(html).toContain('<ol')
    expect(html).toContain('<ins')                       // 正文段有修订标记
    const liParts = html.split(/<li[^>]*>/).slice(1).map(x => x.split('</li>')[0])
    expect(liParts.length).toBe(2)
    for (const li of liParts) {
      expect(li).not.toContain('<ins')                   // 列表项不吃修订（R-1）
      expect(li).not.toContain('<del')
    }
    await expect(html).toMatchFileSnapshot('./__snapshots__/render-golden/list-revision.html')
  })

  it('golden/revisions: 插入修订 ins + 删除修订 del（marks 默认模式）', async () => {
    // cp 布局：[0..4)保留 [4..8)插入修订 [8..11)正文 [11..14)删除修订 [14..)尾段
    const text = '保留新增插入中间删除文本尾部段落\r'
    const insertCp = text.indexOf('新增插入')
    const deleteCp = text.indexOf('删除文本')
    const dttm = 0x01020304

    const html = await renderGoldenHtml(
      {
        text,
        revisionAuthors: ['张三', '李四'],
        charRuns: [
          { cpStart: insertCp, insertMark: { authorIndex: 0, dttm } },
          { cpStart: insertCp + '新增插入'.length },
          { cpStart: deleteCp, deleteMark: { authorIndex: 1, dttm } },
        ],
      },
      'revisions.doc',
    )

    expect(html).toContain('<ins')
    expect(html).toContain('<del')
    await expect(html).toMatchFileSnapshot('./__snapshots__/render-golden/revisions.html')
  })

  it('golden/chart: 列表后长正文触发图表占位注入', async () => {
    // 触发条件（formatFormattedTextToHtml 主循环）：justFinishedList && visibleLen>=100 && charts 未消费
    const longBody =
      '这是一段足够长的正文文本，用于满足图表占位启发式的一百字符可见长度阈值，' +
      '从而在列表结束之后的位置注入 MSGraph 图表占位标记。' +
      '追加补充文字以确保在任何统计口径下都能稳定超过一百个字符的长度要求，保证夹具确定性。'
    expect(longBody.length).toBeGreaterThanOrEqual(100)
    const text = `列表项一\r列表项二\r${longBody}\r`

    const html = await renderGoldenHtml(
      {
        text,
        paraRuns: [
          { cpStart: 0, ilstLegacy: 0, ilvl: 0 },
          { cpStart: text.indexOf('列表项二'), ilstLegacy: 0, ilvl: 0 },
          { cpStart: text.indexOf(longBody) },
        ],
        lists: [{ lsid: 0x12345678, iStartAt: 1, nfc: 0 }],
        withChartStorage: true,
      },
      'chart.doc',
    )

    expect(html).toContain('chart-placeholder')
    await expect(html).toMatchFileSnapshot('./__snapshots__/render-golden/chart.html')
  })

  it('golden/list-hyperlink: 列表 × HYPERLINK 域组合（PlcfFld 字节合成）', async () => {
    // 域字符直接写入主文本：\u0013 指令 \u0014 结果 \u0015；flt=37(HYPERLINK)。
    // ⚠ 坐标系约定（FIELD-CP-GOV F1 裁决后统一）：PlcfFld 的 aCP 属 RAW 轴
    //   （含域字符的流内 code-unit 下标），与 fieldTextData 字节切片（cp×2）同轴；
    //   PAPX/段落 CP 按剥离轴计算（解析器构建段落时剥离域字符）——两轴各归其位。
    const B = '\u0013', S = '\u0014', E = '\u0015'
    const itemText = `项目乙含${B}HYPERLINK "https://e.com/item"${S}条目链接${E}字段`
    const bodyText = `正文段落带${B}HYPERLINK "https://e.com/body"${S}正文链接${E}收尾。`
    const text = `项目甲普通\r${itemText}\r${bodyText}\r`
    const stripped = text.replace(/[\u0013\u0014\u0015]/g, '')

    const html = await renderGoldenHtml(
      {
        text,
        paraRuns: [
          { cpStart: 0, ilstLegacy: 0, ilvl: 0 },
          { cpStart: stripped.indexOf('项目乙含'), ilstLegacy: 0, ilvl: 0 },
          { cpStart: stripped.indexOf('正文段落带') },
        ],
        lists: [{ lsid: 0x12345678, iStartAt: 1, nfc: 0 }],
        plcfFld: [
          { cp: text.indexOf(B), ch: 0x13, flt: 37 },
          { cp: text.indexOf(S), ch: 0x14, flt: 0 },
          { cp: text.indexOf(E), ch: 0x15, flt: 0 },
          { cp: text.lastIndexOf(B), ch: 0x13, flt: 37 },
          { cp: text.lastIndexOf(S), ch: 0x14, flt: 0 },
          { cp: text.lastIndexOf(E), ch: 0x15, flt: 0 },
          { cp: text.length, ch: 0, flt: 0 },
        ],
      },
      'list-hyperlink.doc',
    )

    expect(html).toContain('<ol')
    // ✅ 已翻转（FIELD-CP-GOV 护栏②，2026-08-26）：解析侧 F2 修复
    // （extractAllFields result 与 instruction 统一字节轴切片，
    //   规格见 docs/changelog/2026-08-26-field-cp-gov-parser-spec.md §四）
    // + 渲染侧结果文本锚定（documentRenderer）联合生效：
    // body 段注入 <a href="https://e.com/body">正文链接</a>；
    // 列表项 '条目链接' 因 R-1 抑制语义保持纯文本（不生成 <a>）。
    expect(html).toContain('条目链接')
    expect(html).toContain('<a href="https://e.com/body"')
    expect(html).toContain('>正文链接</a>')
    expect(html).not.toContain('e.com/item')
    await expect(html).toMatchFileSnapshot('./__snapshots__/render-golden/list-hyperlink.html')
  })

  it('golden/picture-paragraph: 纯图片占位段落（DEF-005 方案A 新行为钉死）', async () => {
    // 触发条件与原缺陷一致：占位段无字符样式段、无修订/超链接/图表。
    // DEF-005 方案A 落地后 replaced>0 → hasHtml=true → <img> 进入输出；
    // 本用例若回退到旧实现将失败（<img> 丢失且残留 \u0001）。
    const text = '前导段落\r\u0001\r尾段段落\r'

    const html = await renderGoldenHtml(
      {
        text,
        withDataPicture: true,
      },
      'picture-paragraph.doc',
    )

    expect(html).toContain('<img src="data:image/png')
    expect(html).not.toContain('\u0001')
    await expect(html).toMatchFileSnapshot('./__snapshots__/render-golden/picture-paragraph.html')
  })
})

describe('render pipeline golden snapshots — qa samples-r1 真实样本对齐', () => {
  // 与 qa《回归样本矩阵》(docs/samples-r1/) 的 textutil 生成类样本对齐。
  // corrupt-*/encrypted-* 为错误路径样本，不产出 .page-content，不在快照范围
  // （其行为由 errorClassifier/ErrorDisplay 测试覆盖）。
  const readSample = (name: string): ArrayBuffer => {
    const data = readFileSync(resolve(samplesR1Dir, name))
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  }

  it('golden/sample-textutil-zh: 中文正文（textutil 生成路径 + CJK 编码判定）', async () => {
    const html = await renderGoldenBytes(readSample('textutil-zh.doc'), 'textutil-zh.doc')
    expect(html).toContain('中文测试文档')
    expect(html).toContain("font-family: '仿宋', serif")
    await expect(html).toMatchFileSnapshot('./__snapshots__/render-golden/sample-textutil-zh.html')
  })

  it('golden/sample-textutil-en: 英文正文（含 SttbfFfn 字体名还原）', async () => {
    const html = await renderGoldenBytes(readSample('textutil-en.doc'), 'textutil-en.doc')
    expect(html).toContain('English Test Document')
    expect(html).toContain("'Times New Roman', serif")
    await expect(html).toMatchFileSnapshot('./__snapshots__/render-golden/sample-textutil-en.html')
  })

  it('golden/sample-textutil-mixed: 中英混排+列表（逐 run 字体切换）', async () => {
    const html = await renderGoldenBytes(readSample('textutil-mixed-list-bold-italic.doc'), 'mixed.doc')
    expect(html).toContain('中英混排')
    expect(html.length).toBeGreaterThan(200)
    await expect(html).toMatchFileSnapshot('./__snapshots__/render-golden/sample-textutil-mixed.html')
  })
})
