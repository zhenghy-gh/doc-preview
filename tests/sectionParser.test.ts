import { describe, it, expect } from 'vitest'
import { extractSections } from '../src/utils/sectionParser'

/** 写入 little-endian word (2 bytes) */
function writeWord(buf: number[], offset: number, value: number) {
  buf[offset] = value & 0xFF
  buf[offset + 1] = (value >> 8) & 0xFF
}

/** 写入 little-endian dword (4 bytes) */
function writeDword(buf: number[], offset: number, value: number) {
  buf[offset] = value & 0xFF
  buf[offset + 1] = (value >> 8) & 0xFF
  buf[offset + 2] = (value >> 16) & 0xFF
  buf[offset + 3] = (value >> 24) & 0xFF
}

/**
 * 构造 PlcfSed + SEPX 测试数据。
 *
 * @param cpEnd 节结束 CP
 * @param fcSepx SEPX 在 WordDocument 流中的偏移
 * @param sepxGrpprl SEPX 的 grpprl 字节序列
 */
function buildSectionData(
  cpEnd: number,
  fcSepx: number,
  sepxGrpprl: number[],
): { tableData: Uint8Array; wordDocData: Uint8Array; fcPlcfSed: number; lcbPlcfSed: number } {
  // PlcfSed: 1 个节 → 2 个 CP (8 bytes) + 1 个 SED (8 bytes) = 16 bytes
  // 放在偏移 16 处（fcPlcfSed 不能为 0，否则 extractSections 视为无效）
  const fcPlcfSed = 16
  const lcbPlcfSed = 16
  const tableBuf = new Array(fcPlcfSed + lcbPlcfSed).fill(0)
  // aFC[0] = 0
  writeDword(tableBuf, fcPlcfSed + 0, 0)
  // aFC[1] = cpEnd
  writeDword(tableBuf, fcPlcfSed + 4, cpEnd)
  // aSED[0]: fn=0, fcSepx, fnMpr=0
  writeWord(tableBuf, fcPlcfSed + 8, 0)
  writeDword(tableBuf, fcPlcfSed + 10, fcSepx)
  writeWord(tableBuf, fcPlcfSed + 14, 0)

  // WordDocument 流：在 fcSepx 处放置 SEPX
  const sepxSize = 2 + sepxGrpprl.length // cb + grpprl
  const wordDocSize = Math.max(fcSepx + sepxSize, 512)
  const wordBuf = new Array(wordDocSize).fill(0)
  writeWord(wordBuf, fcSepx, sepxGrpprl.length) // cb
  for (let i = 0; i < sepxGrpprl.length; i++) {
    wordBuf[fcSepx + 2 + i] = sepxGrpprl[i]
  }

  return {
    tableData: new Uint8Array(tableBuf),
    wordDocData: new Uint8Array(wordBuf),
    fcPlcfSed,
    lcbPlcfSed,
  }
}

/** 构造一个 word SPRM 条目 (SPRM + 2-byte value) */
function wordSprm(sprm: number, value: number): number[] {
  return [sprm & 0xFF, (sprm >> 8) & 0xFF, value & 0xFF, (value >> 8) & 0xFF]
}

/** 构造一个 byte SPRM 条目 (SPRM + 1-byte value) */
function byteSprm(sprm: number, value: number): number[] {
  return [sprm & 0xFF, (sprm >> 8) & 0xFF, value & 0xFF]
}

describe('extractSections', () => {
  it('should return empty for empty table data', () => {
    const result = extractSections(new Uint8Array(0), new Uint8Array(0), 0, 0)
    expect(result).toEqual([])
  })

  it('should return empty when fcPlcfSed is negative', () => {
    const result = extractSections(new Uint8Array(64), new Uint8Array(64), -1, 16)
    expect(result).toEqual([])
  })

  it('should parse sections when fcPlcfSed is 0 (table start)', () => {
    // PlcfSed at offset 0: 1 section → 2 CPs + 1 SED, then SEPX in wordDocData
    const tableData = new Uint8Array(32)
    writeDword(tableData, 0, 0) // aFC[0]
    writeDword(tableData, 4, 40) // aFC[1]
    writeWord(tableData, 8, 0)
    writeDword(tableData, 10, 0x100) // fcSepx
    writeWord(tableData, 14, 0)

    const wordDocData = new Uint8Array(0x200)
    writeWord(wordDocData, 0x100, 4) // cb = 4
    const grpprl = [...wordSprm(0xB002, 11906)] // A4 width
    for (let i = 0; i < grpprl.length; i++) wordDocData[0x102 + i] = grpprl[i]

    const sections = extractSections(tableData, wordDocData, 0, 16)
    expect(sections).toHaveLength(1)
    expect(sections[0].pageWidthPt).toBe(595.3)
  })

  it('should parse a single section with A4 page size', () => {
    // A4: 11906 × 16838 twips
    const grpprl = [
      ...wordSprm(0xB002, 11906), // sprmSXaPage
      ...wordSprm(0xB003, 16838), // sprmSYaPage
    ]
    const { tableData, wordDocData, fcPlcfSed, lcbPlcfSed } = buildSectionData(100, 0x200, grpprl)
    const sections = extractSections(tableData, wordDocData, fcPlcfSed, lcbPlcfSed)

    expect(sections).toHaveLength(1)
    expect(sections[0].index).toBe(0)
    expect(sections[0].cpStart).toBe(0)
    expect(sections[0].cpEnd).toBe(100)
    expect(sections[0].pageWidthPt).toBeCloseTo(595.3, 0)
    expect(sections[0].pageHeightPt).toBeCloseTo(841.9, 0)
  })

  it('should parse page margins', () => {
    const grpprl = [
      ...wordSprm(0xB004, 1800), // sprmSDxaLeft = 1800 twips = 90pt
      ...wordSprm(0xB005, 1800), // sprmSDxaRight
      ...wordSprm(0xB006, 1440), // sprmSDyaTop = 1440 twips = 72pt
      ...wordSprm(0xB007, 1440), // sprmSDyaBottom
    ]
    const { tableData, wordDocData, fcPlcfSed, lcbPlcfSed } = buildSectionData(50, 0x100, grpprl)
    const sections = extractSections(tableData, wordDocData, fcPlcfSed, lcbPlcfSed)

    expect(sections[0].marginLeftPt).toBe(90)
    expect(sections[0].marginRightPt).toBe(90)
    expect(sections[0].marginTopPt).toBe(72)
    expect(sections[0].marginBottomPt).toBe(72)
  })

  it('should parse orientation and break type', () => {
    const grpprl = [
      ...byteSprm(0x3009, 1), // sprmSBOrientation = 1 (landscape)
      ...byteSprm(0x300A, 3), // sprmSBkc = 3 (continuous)
    ]
    const { tableData, wordDocData, fcPlcfSed, lcbPlcfSed } = buildSectionData(30, 0x100, grpprl)
    const sections = extractSections(tableData, wordDocData, fcPlcfSed, lcbPlcfSed)

    expect(sections[0].orientation).toBe('landscape')
    expect(sections[0].breakType).toBe('continuous')
  })

  it('should parse portrait orientation when value is 0', () => {
    const grpprl = [...byteSprm(0x3009, 0)]
    const { tableData, wordDocData, fcPlcfSed, lcbPlcfSed } = buildSectionData(30, 0x100, grpprl)
    const sections = extractSections(tableData, wordDocData, fcPlcfSed, lcbPlcfSed)

    expect(sections[0].orientation).toBe('portrait')
  })

  it('should parse columns and column spacing', () => {
    const grpprl = [
      ...wordSprm(0x500B, 2),    // sprmSCcolumns = 2
      ...wordSprm(0x500C, 720),  // sprmSDxaColumns = 720 twips = 36pt
    ]
    const { tableData, wordDocData, fcPlcfSed, lcbPlcfSed } = buildSectionData(30, 0x100, grpprl)
    const sections = extractSections(tableData, wordDocData, fcPlcfSed, lcbPlcfSed)

    expect(sections[0].columnCount).toBe(2)
    expect(sections[0].columnSpacingPt).toBe(36)
  })

  it('should parse page start number', () => {
    const grpprl = [...wordSprm(0x300C, 5)] // sprmSPgnStart = 5
    const { tableData, wordDocData, fcPlcfSed, lcbPlcfSed } = buildSectionData(30, 0x100, grpprl)
    const sections = extractSections(tableData, wordDocData, fcPlcfSed, lcbPlcfSed)

    expect(sections[0].pageStart).toBe(5)
  })

  it('should return empty section props when fcSepx is 0xFFFFFFFF', () => {
    // 无 SEPX 的情况。fcPlcfSed 必须非 0。
    const fcPlcfSed = 16
    const tableBuf = new Array(fcPlcfSed + 16).fill(0)
    writeDword(tableBuf, fcPlcfSed + 0, 0)
    writeDword(tableBuf, fcPlcfSed + 4, 50)
    writeWord(tableBuf, fcPlcfSed + 8, 0)
    writeDword(tableBuf, fcPlcfSed + 10, 0xFFFFFFFF) // fcSepx = 0xFFFFFFFF
    writeWord(tableBuf, fcPlcfSed + 14, 0)

    const sections = extractSections(
      new Uint8Array(tableBuf),
      new Uint8Array(256),
      fcPlcfSed, 16,
    )
    expect(sections).toHaveLength(1)
    expect(sections[0].pageWidthPt).toBeUndefined()
    expect(sections[0].orientation).toBeUndefined()
  })

  it('should parse gutter', () => {
    const grpprl = [...wordSprm(0xB008, 360)] // sprmSDxaGutter = 360 twips = 18pt
    const { tableData, wordDocData, fcPlcfSed, lcbPlcfSed } = buildSectionData(30, 0x100, grpprl)
    const sections = extractSections(tableData, wordDocData, fcPlcfSed, lcbPlcfSed)

    expect(sections[0].gutterPt).toBe(18)
  })

  describe('Word 6/95 legacy section SPRMs', () => {
    it('should parse legacy page size and margins (0xB01F-0xB022, 0x9023-0x9024)', () => {
      // Letter: width 12240 twips (612pt), height 15840 twips (792pt)
      // margins: L/R 1800 twips (90pt), T/B 1440 twips (72pt), gutter 0
      const grpprl = [
        ...wordSprm(0xB01F, 12240), // legacy XA_PAGE
        ...wordSprm(0xB020, 15840), // legacy YA_PAGE
        ...wordSprm(0xB021, 1800),  // legacy DXA_LEFT
        ...wordSprm(0xB022, 1800),  // legacy DXA_RIGHT
        ...wordSprm(0x9023, 1440),  // legacy DYA_TOP
        ...wordSprm(0x9024, 1440),  // legacy DYA_BOTTOM
        ...wordSprm(0xB025, 0),     // legacy DXA_GUTTER
      ]
      const { tableData, wordDocData, fcPlcfSed, lcbPlcfSed } = buildSectionData(30, 0x100, grpprl)
      const sections = extractSections(tableData, wordDocData, fcPlcfSed, lcbPlcfSed)

      expect(sections[0].pageWidthPt).toBe(612)
      expect(sections[0].pageHeightPt).toBe(792)
      expect(sections[0].marginLeftPt).toBe(90)
      expect(sections[0].marginRightPt).toBe(90)
      expect(sections[0].marginTopPt).toBe(72)
      expect(sections[0].marginBottomPt).toBe(72)
      expect(sections[0].gutterPt).toBe(0)
    })

    it('should parse legacy break type alongside modern ones', () => {
      const grpprl = [
        ...byteSprm(0x300A, 2), // sprmSBkc = oddPage
        ...wordSprm(0xB01F, 12240),
      ]
      const { tableData, wordDocData, fcPlcfSed, lcbPlcfSed } = buildSectionData(30, 0x100, grpprl)
      const sections = extractSections(tableData, wordDocData, fcPlcfSed, lcbPlcfSed)

      expect(sections[0].breakType).toBe('oddPage')
      expect(sections[0].pageWidthPt).toBe(612)
    })

    it('should mix modern and legacy SPRMs in one SEPX', () => {
      const grpprl = [
        ...wordSprm(0xB002, 11906), // modern XA_PAGE (A4 width)
        ...wordSprm(0x9024, 1134),  // legacy DYA_BOTTOM
      ]
      const { tableData, wordDocData, fcPlcfSed, lcbPlcfSed } = buildSectionData(30, 0x100, grpprl)
      const sections = extractSections(tableData, wordDocData, fcPlcfSed, lcbPlcfSed)

      expect(sections[0].pageWidthPt).toBe(595.3)
      expect(sections[0].marginBottomPt).toBe(56.7)
    })
  })
})

describe('extractSections variable-length SEPX operands', () => {
  it('stops when a variable-length operand offset is past EOF', () => {
    // PlcfSed (16 bytes at offset 16) pointing at a SEPX whose grpprl is
    // exactly the spra=6 sprm 0xC000 with no operand bytes left.
    const fcPlcfSed = 16
    const fcSepx = 8
    const tableBuf = new Array(fcPlcfSed + 16).fill(0)
    writeDword(tableBuf, fcPlcfSed + 0, 0)
    writeDword(tableBuf, fcPlcfSed + 4, 100)
    writeWord(tableBuf, fcPlcfSed + 8, 0)
    writeDword(tableBuf, fcPlcfSed + 10, fcSepx)
    writeWord(tableBuf, fcPlcfSed + 14, 0)
    // SEPX at fcSepx: cb=2, grpprl = [0x00, 0xC0] (sprm 0xC000)
    const wordBuf = [0, 0, 0, 0, 0, 0, 0, 0, 0x02, 0x00, 0x00, 0xC0]
    const sections = extractSections(
      new Uint8Array(tableBuf),
      new Uint8Array(wordBuf),
      fcPlcfSed,
      16,
    )
    expect(sections.length).toBe(1)
    expect(sections[0].pageWidthPt).toBeUndefined()
  })

  it('reads a variable-length operand length when bytes remain', () => {
    const fcPlcfSed = 16
    const fcSepx = 8
    const tableBuf = new Array(fcPlcfSed + 16).fill(0)
    writeDword(tableBuf, fcPlcfSed + 0, 0)
    writeDword(tableBuf, fcPlcfSed + 4, 100)
    writeWord(tableBuf, fcPlcfSed + 8, 0)
    writeDword(tableBuf, fcPlcfSed + 10, fcSepx)
    writeWord(tableBuf, fcPlcfSed + 14, 0)
    // One trailing byte after the 0xC000 sprm: length prefix 0xAA.
    const wordBuf = [0, 0, 0, 0, 0, 0, 0, 0, 0x02, 0x00, 0x00, 0xC0, 0xAA]
    const sections = extractSections(
      new Uint8Array(tableBuf),
      new Uint8Array(wordBuf),
      fcPlcfSed,
      16,
    )
    expect(sections.length).toBe(1)
  })
})

describe('extractSections unknown SPRM', () => {
  it('skips unknown section SPRMs via the default case', () => {
    const { tableData, wordDocData, fcPlcfSed, lcbPlcfSed } = buildSectionData(100, 20, [0x00, 0x01, 0x05])
    const sections = extractSections(tableData, wordDocData, fcPlcfSed, lcbPlcfSed)
    expect(sections.length).toBe(1)
  })
})

describe('extractSections defensive branches', () => {
  it('reads a 3-byte operand for spra=7 SPRMs', () => {
    // sprm 0xE001: spra = (0xE001 >> 13) & 7 = 7 → 3 字节操作数
    const grpprl = [
      ...wordSprm(0xB002, 11906), // A4 width 先解析
      0x01, 0xE0, 0xAA, 0xBB, 0xCC, // spra=7 条目占 5 字节，应被完整跳过
      ...wordSprm(0xB003, 16838), // A4 height 仍能解析
    ]
    const { tableData, wordDocData, fcPlcfSed, lcbPlcfSed } = buildSectionData(100, 0x100, grpprl)
    const sections = extractSections(tableData, wordDocData, fcPlcfSed, lcbPlcfSed)
    expect(sections[0].pageWidthPt).toBeCloseTo(595.3, 0)
    expect(sections[0].pageHeightPt).toBeCloseTo(841.9, 0)
  })

  it('returns empty when the PlcfSed range exceeds the table stream', () => {
    const tableData = new Uint8Array(20) // fc=16 + lcb=16 > 20
    const sections = extractSections(tableData, new Uint8Array(256), 16, 16)
    expect(sections).toEqual([])
  })

  it('returns empty when lcbPlcfSed is too small for one SED entry', () => {
    // lcb=4 → n = floor(0/12) = 0
    const sections = extractSections(new Uint8Array(64), new Uint8Array(256), 16, 4)
    expect(sections).toEqual([])
  })

  it('returns empty for empty WordDocument stream', () => {
    const { tableData, fcPlcfSed, lcbPlcfSed } = buildSectionData(100, 0x100, [0x00, 0x01, 0x05])
    const sections = extractSections(tableData, new Uint8Array(0), fcPlcfSed, lcbPlcfSed)
    expect(sections).toEqual([])
  })

  it('returns empty section props when the SEPX cb is zero', () => {
    const { tableData, wordDocData, fcPlcfSed, lcbPlcfSed } = buildSectionData(100, 0x100, [])
    const sections = extractSections(tableData, wordDocData, fcPlcfSed, lcbPlcfSed)
    expect(sections).toHaveLength(1)
    expect(sections[0].pageWidthPt).toBeUndefined()
  })

  it('returns empty section props when the SEPX grpprl runs past the WordDocument stream', () => {
    // 自定义小 buffer：fcSepx=100, cb=10 → 100+2+10 = 112 > 105
    const fcPlcfSed = 16
    const tableBuf = new Array(fcPlcfSed + 16).fill(0)
    writeDword(tableBuf, fcPlcfSed + 0, 0)
    writeDword(tableBuf, fcPlcfSed + 4, 50)
    writeWord(tableBuf, fcPlcfSed + 8, 0)
    writeDword(tableBuf, fcPlcfSed + 10, 100)
    writeWord(tableBuf, fcPlcfSed + 14, 0)

    const wordBuf = new Array(105).fill(0)
    writeWord(wordBuf, 100, 10) // cb = 10 但流只剩 5 字节

    const sections = extractSections(new Uint8Array(tableBuf), new Uint8Array(wordBuf), fcPlcfSed, 16)
    expect(sections).toHaveLength(1)
    expect(sections[0].pageWidthPt).toBeUndefined()
  })

  it('falls back to nextPage for an out-of-range bkc value', () => {
    const grpprl = [...byteSprm(0x300A, 9)] // 超出 0-3 映射表
    const { tableData, wordDocData, fcPlcfSed, lcbPlcfSed } = buildSectionData(30, 0x100, grpprl)
    const sections = extractSections(tableData, wordDocData, fcPlcfSed, lcbPlcfSed)
    expect(sections[0].breakType).toBe('nextPage')
  })

  it('skips header-distance / page-number-format / even-columns SPRMs without side effects', () => {
    const grpprl = [
      ...wordSprm(0xB000, 720),  // sprmSDyaHdrTop（暂不提取）
      ...wordSprm(0xB001, 720),  // sprmSDyaHdrBottom
      ...byteSprm(0x300B, 1),    // sprmSNfcPgn
      ...byteSprm(0x300F, 1),    // sprmSFEvenly
      ...wordSprm(0xB002, 11906), // 后续条目仍正常解析
    ]
    const { tableData, wordDocData, fcPlcfSed, lcbPlcfSed } = buildSectionData(30, 0x100, grpprl)
    const sections = extractSections(tableData, wordDocData, fcPlcfSed, lcbPlcfSed)
    expect(sections[0].pageWidthPt).toBeCloseTo(595.3, 0)
    expect(sections[0].marginTopPt).toBeUndefined()
    expect(sections[0].pageStart).toBeUndefined()
  })
})
