/**
 * 三合一 PR 验收测试（ENC-04 / ERR-CODE / DEF-004）
 *
 * ENC-04：跨编码兜底重试 —— 触发=过滤后为空 OR 符号汤占比超阈值；
 *         强制覆盖 CJK UTF-16LE 被误判为 8-bit 的场景。
 * ERR-CODE：ParseResult.errorCode 结构化错误码 + classifyError 按 code 优先判定。
 * DEF-004：maxScanBytes 根治 —— 持有验证过 fcMac 界时不受限，仅启发式无界扫描受限，
 *          超限置 scanLimitReached 告警标志。
 *
 * 夹具规格（leader 批准）：sparse-NUL 尾部 rel%19===18→0x00，nullRatio≈9.6%，
 * 双极性（fComplex true/false）均须走评分分支成功提取 UTF-16 文本。
 */
import { describe, it, expect } from 'vitest'
import { DocParser } from '../src/utils/docParser'
import { classifyError } from '../src/utils/errorClassifier'

const SECTOR = 512

/** OLE 容器骨架：FAT + 目录(WordDocument/0Table) + FIB(ccpText 可调)。与 docParser.test.ts 同族构造。 */
function buildOle(opts: {
  ccpText?: number
  complex?: boolean
  withChart?: boolean
  textRegion?: 'utf16Sentence' | 'cjk' | 'zeros'
  tail?: 'sparseNul' | 'pureA' | 'zeros'
}): ArrayBuffer {
  const buf = new ArrayBuffer(SECTOR * 20)
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
  const fatBase = SECTOR
  w32(fatBase + 0 * 4, END)
  for (let s = 2; s < 17; s++) w32(fatBase + s * 4, s + 1)
  w32(fatBase + 17 * 4, END)
  w32(fatBase + 1 * 4, END)
  for (let i = 18; i < 128; i++) w32(fatBase + i * 4, FREE)
  w32(fatBase + 18 * 4, END)

  const dirBase = SECTOR * 2
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
  writeDir(dirBase + 2 * 128, '0Table', 2, 18, 16)
  if (opts.withChart !== false) writeDir(dirBase + 3 * 128, 'MSGraph.Chart.8', 1, END, 0)

  const wdBase = SECTOR * 3
  w16(0 + wdBase, 0xA5EC)
  w16(2 + wdBase, 0x0101)
  w16(10 + wdBase, 0)
  w16(32 + wdBase, 0)
  w16(34 + wdBase, 22)
  const ccpText = opts.ccpText ?? 300
  w32(36 + 12 + wdBase, ccpText)
  w16(124 + wdBase, 34)
  w32(126 + 33 * 8 + wdBase, 500)
  w32(126 + 33 * 8 + 4 + wdBase, 10)
  view[wdBase + 10] = opts.complex === false ? 0x00 : 0x04

  const textEnd = 2048 + ccpText * 2
  if (opts.textRegion === 'utf16Sentence') {
    const sentence = 'The quick brown fox jumps over the lazy dog. '
    for (let i = 0; i < 600 && i < ccpText * 2; i += 2) {
      view[wdBase + 2048 + i] = sentence.charCodeAt((i / 2) % sentence.length)
    }
  } else if (opts.textRegion === 'cjk') {
    // CJK UTF-16LE，刻意避开低位字节=0x00 的码位 → NUL 占比极低 →
    // detectEncodingFromBinary 方法一会误判为 8-bit（ENC-04 目标场景）。
    const marker = '解析引擎验证文本'
    for (let i = 0; i < 600 && i < ccpText * 2; i += 2) {
      const code = marker.charCodeAt((i / 2) % marker.length)
      view[wdBase + 2048 + i] = code & 0xff
      view[wdBase + 2048 + i + 1] = (code >> 8) & 0xff
    }
  }
  // textRegion === 'zeros'：保持全零

  const tail = opts.tail ?? 'sparseNul'
  for (let i = textEnd; i < 8192; i++) {
    const rel = i - textEnd
    if (tail === 'zeros') view[wdBase + i] = 0x00
    else if (tail === 'sparseNul') { if (rel % 19 === 18) view[wdBase + i] = 0x00; else view[wdBase + i] = 0x41 }
    else view[wdBase + i] = 0x41
  }
  return buf
}

describe('ENC-04 sparse-NUL 评分分支双极性（批准备规格）', () => {
  it('fComplex=true 时评分回退选中 UTF-16 并返回纯段落结果', () => {
    const parser = new DocParser(buildOle({ complex: true, withChart: false, textRegion: 'utf16Sentence', tail: 'sparseNul' }))
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const paras = result.document!.paragraphs as Array<{ text: string }>
    expect(paras.length).toBeGreaterThan(0)
    expect(paras.map(p => p.text).join('')).toContain('quick brown fox')
    expect(result.document!.charts?.length ?? 0).toBe(0)
  })

  it('fComplex=false 时同样选中 UTF-16（比较臂翻转）', () => {
    const parser = new DocParser(buildOle({ complex: false, withChart: false, textRegion: 'utf16Sentence', tail: 'sparseNul' }))
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const paras = result.document!.paragraphs as Array<{ text: string }>
    expect(paras.map(p => p.text).join('')).toContain('quick brown fox')
  })
})

describe('ENC-04 CJK UTF-16LE 误判 8-bit 的强制覆盖场景', () => {
  it('binaryDetect 误判为 8-bit 时跨编码重试恢复出正确中文', () => {
    const parser = new DocParser(buildOle({ complex: false, withChart: false, textRegion: 'cjk', tail: 'pureA' }))
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const joined = (result.document!.paragraphs as Array<{ text: string }>).map(p => p.text).join('')
    expect(joined).toContain('解析引擎')
    expect(joined).toContain('验证文本')
  })

  it('同场景 fComplex=true（先验指向 8-bit）依然被证据推翻', () => {
    const parser = new DocParser(buildOle({ complex: true, withChart: false, textRegion: 'cjk', tail: 'pureA' }))
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const joined = (result.document!.paragraphs as Array<{ text: string }>).map(p => p.text).join('')
    expect(joined).toContain('解析引擎')
  })
})

describe('ERR-CODE 结构化错误码', () => {
  it('空文档失败出口附带 EMPTY_DOCUMENT 错误码', () => {
    const parser = new DocParser(buildOle({ textRegion: 'zeros', tail: 'zeros', complex: false }))
    const result = parser.parseWithFormat()
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('EMPTY_DOCUMENT')
  })

  it('OLE 签名失败出口附带 OLE_FORMAT 错误码', () => {
    const badBuf = new ArrayBuffer(512)
    const badView = new Uint8Array(badBuf)
    badView[0] = 0x00 // 破坏魔数
    const parser = new DocParser(badBuf)
    const result = parser.parseWithFormat()
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('OLE_FORMAT')
  })

  it('classifyError 按 code 优先判定（中文自由文案不再落 unknown）', () => {
    const r = classifyError('完全无法识别的自由文案 xyzzy', 'zh-CN', 'EMPTY_DOCUMENT')
    expect(r.category).toBe('corrupted')
    expect(r.raw).toContain('xyzzy')
  })

  it('classifyError 的 code 优先级高于关键字（PARSE_FAILED 覆盖网络关键词）', () => {
    const r = classifyError('failed to fetch', 'zh-CN', 'PARSE_FAILED')
    expect(r.category).toBe('parse')
  })

  it('无 code 时关键字路径保持兼容（回归保护）', () => {
    expect(classifyError('文档内容为空').category).toBe('corrupted')
    expect(classifyError('totally mysterious text').category).toBe('unknown')
    expect(classifyError('failed to fetch').category).toBe('network')
  })
})

describe('DEF-004 maxScanBytes 根治', () => {
  it('持有验证过 fcMac（ccpText 界）时不被 maxScanBytes 截断，cap 外内容完整提取', () => {
    // ccpText=3000 → fcMac=2048+6000=8048；cap=4096 < 8048。
    // 在旧截断点(4096)之后、fcMac(8048)之前埋一个能通过过滤器的可读标记；
    // 旧行为提取止步于 4096 必然丢失该标记，新行为必须完整读出。
    const buffer = buildOle({
      ccpText: 3000, complex: false, withChart: false,
      textRegion: 'utf16Sentence', tail: 'sparseNul',
    })
    const view = new Uint8Array(buffer)
    const wdBase = SECTOR * 3
    const marker = 'TAILMARK'
    for (let i = 0; i < marker.length * 2; i += 2) {
      view[wdBase + 7000 + i] = marker.charCodeAt(i / 2)
      view[wdBase + 7000 + i + 1] = 0
    }
    const parser = new DocParser(buffer, 4096)
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const joined = (result.document!.paragraphs as Array<{ text: string }>).map(p => p.text).join('')
    expect(joined).toContain('TAILMARK')
    expect(joined).toContain('quick brown fox')
    // 持有验证界不触发告警标志
    expect(parser.scanLimitReached).toBe(false)
  })

  it('启发式无界扫描超限时置位 scanLimitReached 告警标志', () => {
    const parser = new DocParser(buildOle({ complex: false, withChart: false, textRegion: 'zeros', tail: 'zeros' }), 1024)
    const data = new Uint8Array((parser as unknown as { buffer: ArrayBuffer }).buffer).subarray(SECTOR * 3, SECTOR * 3 + 8192)
    // 白盒直调私有启发式扫描（无 fcMac → 受 cap 约束路径）
    ;(parser as unknown as { extractParagraphsWithFormat: (d: Uint8Array) => unknown }).extractParagraphsWithFormat(data)
    expect(parser.scanLimitReached).toBe(true)
  })
})
