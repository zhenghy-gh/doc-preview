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

  it('should return empty when fcPlcfSed is 0', () => {
    const result = extractSections(new Uint8Array(64), new Uint8Array(64), 0, 16)
    expect(result).toEqual([])
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
})
