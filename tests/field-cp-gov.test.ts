/**
 * FIELD-CP-GOV 解析侧修复验收（R-F2-1 / R-F2-2 / R-F4-1 / R-F4-2）
 *
 * 规格来源：docs/changelog/2026-08-26-field-cp-gov-parser-spec.md §四
 * - R-F2-1：extractAllFields 的 result 与 instruction 统一字节轴（cp×2）切片；
 *   仅当 textBytes 缺失时回退 text 轴并标注 axis:'text'。
 * - R-F4-1：_cpStart 单轴不变式——相邻保留段 _cpStart 差 == 前段最终 text.length + 1。
 * - R-F4-2：replacePageFieldsInText 等长原地替换，mainText 总长恒定。
 */
import { describe, it, expect } from 'vitest'
import { extractAllFields } from '../src/utils/fieldParser'
import { DocParser } from '../src/utils/docParser'

/** 将字符串按 UTF-16LE 写入字节数组的指定 cp 偏移处。 */
function writeUtf16le(target: Uint8Array, cpOffsetBytes: number, s: string) {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    target[cpOffsetBytes + i * 2] = code & 0xff
    target[cpOffsetBytes + i * 2 + 1] = (code >> 8) & 0xff
  }
}

describe('R-F2-1 extractAllFields result 与 instruction 同轴（纯函数）', () => {
  const instr = 'HYPERLINK "https://e.com"'
  const resultText = '条目链接'
  // 布局：\u0013@cp0，instr@cp1..25，\u0014@cp26，result@cp27..30，\u0015@cp31
  const fldEntries = [
    { cp: 0, ch: 0x13, flt: 37 },
    { cp: 26, ch: 0x14, flt: 37 },
    { cp: 31, ch: 0x15, flt: 37 },
  ]

  function buildBytes(): Uint8Array {
    const bytes = new Uint8Array(64)
    writeUtf16le(bytes, 1 * 2, instr)
    writeUtf16le(bytes, 27 * 2, resultText)
    return bytes
  }

  it('text 参数为空串也能从字节轴提取 result/url（证明不再依赖调用方字符轴）', () => {
    // 修复前：result = ''.slice(27,31) === '' —— 空结果即失败。
    const fields = extractAllFields(fldEntries, '', buildBytes())
    expect(fields).toHaveLength(1)
    expect(fields[0].result).toBe('条目链接')
    expect(fields[0].url).toBe('https://e.com')
    expect(fields[0].instruction).toBe(instr)
    expect(fields[0].axis).toBe('raw')
  })

  it('text 轴故意给错位内容时不产生跨段污染（字节轴胜出）', () => {
    // 模拟实证 L1：调用方字符轴上该窗口是别的文本（'错位文本'）。
    const wrongAxisText = '\x13' + instr + '\x14' + '错位文本\x15'
    const fields = extractAllFields(fldEntries, wrongAxisText, buildBytes())
    expect(fields[0].result).toBe('条目链接')
    expect(fields[0].axis).toBe('raw')
  })

  it('textBytes 缺失时回退 text 轴并标注 axis:text', () => {
    const text = '\x13' + instr + '\x14' + resultText + '\x15'
    const fields = extractAllFields(fldEntries, text)
    expect(fields).toHaveLength(1)
    expect(fields[0].result).toBe(resultText)
    expect(fields[0].axis).toBe('text')
  })

  it('textBytes 越界覆盖 result 窗口时同样回退并标注', () => {
    const text = '\x13' + instr + '\x14' + resultText + '\x15'
    const shortBytes = new Uint8Array(10) // 只够 instruction 的一半，result 窗口越界
    writeUtf16le(shortBytes, 1 * 2, 'HYPER')
    const fields = extractAllFields(fldEntries, text, shortBytes)
    expect(fields[0].axis).toBe('text')
    expect(fields[0].result).toBe(resultText)
  })
})

describe('R-F4-1 _cpStart 单轴不变式', () => {
  it('normalizeParagraphCpAxis：相邻保留段差 == 前段最终 text.length + 1', () => {
    const parser = new DocParser(new ArrayBuffer(SECTOR_SIZE))
    const paras = [
      { text: '首段三字', _cpStart: 999 },   // 模拟上游漂移值
      { text: 'de', _cpStart: 12345 },
      { text: '', _cpStart: -5 },
      { text: '尾段四个字', _cpStart: 777 },
    ]
    ;(parser as unknown as { normalizeParagraphCpAxis: (p: unknown[]) => void }).normalizeParagraphCpAxis(paras)
    expect(paras.map(p => p._cpStart)).toEqual([0, 5, 8, 9])
    for (let i = 1; i < paras.length; i++) {
      expect(paras[i]._cpStart - paras[i - 1]._cpStart).toBe(paras[i - 1].text.length + 1)
    }
  })

  it('端到端：真实解析管线产出满足不变式（含域码清洗缩短前序段场景）', () => {
    // 两段 UTF-16 文本，第一段含 HYPERLINK 域指令字符序列（下游 cleanWordFieldCodes
    // 会剔除指令文本使前序段缩短）——旧实现的 _cpStart 在此漂移，新实现必须守住不变式。
    const buffer = buildTwoParaOleWithFieldLikeText()
    const parser = new DocParser(buffer)
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const paras = result.document!.paragraphs as Array<{ text: string; _cpStart?: number }>
    expect(paras.length).toBeGreaterThanOrEqual(2)
    expect(paras[0]._cpStart).toBe(0)
    for (let i = 1; i < paras.length; i++) {
      const delta = paras[i]._cpStart! - paras[i - 1]._cpStart!
      expect(delta).toBe((paras[i - 1].text || '').length + 1)
    }
  })
})

describe('R-F4-2 replacePageFieldsInText 等长原地替换', () => {
  it('替换为纯结果文本（缩短），CP 一致性由 normalizeParagraphCpAxis 归一化保证', () => {
    const parser = new DocParser(new ArrayBuffer(SECTOR_SIZE))
    const fn = (parser as unknown as {
      replacePageFieldsInText: (t: string, f: Array<{ instruction: string; result: string }>) => string
    }).replacePageFieldsInText.bind(parser)
    const before = '第PAGE7页共NUMPAGES10页'
    const after = fn(before, [
      { instruction: 'PAGE', result: '7' },
      { instruction: 'NUMPAGES', result: '10' },
    ])
    expect(after).toBe('第7页共10页')
    expect(after).not.toContain('PAGE')
    expect(after).not.toContain('NUMPAGES')
  })
})

const SECTOR_SIZE = 512

/**
 * 最小双段 OLE 夹具：WordDocument 流 [2048..) 存两段 UTF-16 文本（\r 分隔），
 * 第一段携带 HYPERLINK 域指令样式的 ASCII 序列触发下游域码清洗缩短。
 */
function buildTwoParaOleWithFieldLikeText(): ArrayBuffer {
  const buf = new ArrayBuffer(SECTOR_SIZE * 20)
  const view = new Uint8Array(buf)
  const w16 = (off: number, v: number) => { view[off] = v & 0xff; view[off + 1] = (v >> 8) & 0xff }
  const w32 = (off: number, v: number) => {
    view[off] = v & 0xff; view[off + 1] = (v >> 8) & 0xff
    view[off + 2] = (v >> 16) & 0xff; view[off + 3] = (v >> 24) & 0xff
  }
  const END = 0xFFFFFFFE, FREE = 0xFFFFFFFF
  view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
  view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
  w16(26, 3); w16(30, 9); w16(32, 6)
  w32(48, 1); w32(56, 4096)
  w32(60, END); w32(64, 0); w32(68, END); w32(72, 0); w32(76, 0)
  for (let i = 1; i < 109; i++) w32(76 + i * 4, FREE)
  const fatBase = SECTOR_SIZE
  w32(fatBase + 0 * 4, END)
  for (let s = 2; s < 17; s++) w32(fatBase + s * 4, s + 1)
  w32(fatBase + 17 * 4, END)
  w32(fatBase + 1 * 4, END)
  for (let i = 18; i < 128; i++) w32(fatBase + i * 4, FREE)
  w32(fatBase + 18 * 4, END)

  const dirBase = SECTOR_SIZE * 2
  const writeDir = (off: number, name: string, type: number, start: number, size: number) => {
    for (let i = 0; i < name.length; i++) w16(off + i * 2, name.charCodeAt(i))
    w16(off + 64, name.length * 2)
    view[off + 66] = type
    view[off + 67] = 1
    w32(off + 116, start)
    w32(off + 120, size)
  }
  writeDir(dirBase + 0 * 128, 'Root Entry', 5, END, 0)
  writeDir(dirBase + 1 * 128, 'WordDocument', 2, 2, 8192)

  const wdBase = SECTOR_SIZE * 3
  w16(wdBase + 0, 0xA5EC)
  w16(wdBase + 2, 0x0101)
  w16(wdBase + 10, 0)
  w16(wdBase + 32, 0)
  w16(wdBase + 34, 22)
  const para1 = 'HYPERLINK "https://e.com/x" 链接说明文字'
  const para2 = '第二段落包含足够多的正文内容以通过显著内容过滤检查'
  const full = para1 + '\r' + para2 + '\r'
  const ccpText = full.length
  w32(wdBase + 36 + 12, ccpText)
  w16(wdBase + 124, 34)
  for (let i = 0; i < full.length; i++) {
    const code = full.charCodeAt(i)
    view[wdBase + 2048 + i * 2] = code & 0xff
    view[wdBase + 2048 + i * 2 + 1] = (code >> 8) & 0xff
  }
  return buf
}
