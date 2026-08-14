import { describe, it, expect } from 'vitest'
import { parseChpxRuns, parsePapxRuns, mergeCharFormatForParagraph, parseChpxGrpprlWithFont, parsePapxGrpprl } from '../src/utils/formatParser'

/**
 * Build a PlcfBteChpx test fixture from a list of (cpStart, bold, fontSize) tuples.
 *
 * Layout:
 *   aCP: (n+1) * 4 bytes
 *   aPcb: n * CHPX entries (each: cbOffset(2) + grpprl)
 */
function buildPlcfBteChpx(entries: Array<{ cpStart: number; bold?: boolean; italic?: boolean; fontSize?: number; underline?: boolean; istd?: number }>): Uint8Array {
  const n = entries.length
  // Build the aPcb bytes first so we know offsets.
  const aPcbParts: Uint8Array[] = []
  for (const entry of entries) {
    const prls: number[] = []
    if (entry.istd !== undefined) {
      // sprmCIstd = 0x4A30, 2-byte character style index
      prls.push(0x30, 0x4A, entry.istd & 0xFF, (entry.istd >> 8) & 0xFF)
    }
    if (entry.bold !== undefined) {
      // sprmCFBold = 0x0835, ToggleOperand(1 byte)
      prls.push(0x35, 0x08, entry.bold ? 0x01 : 0x00)
    }
    if (entry.italic !== undefined) {
      // sprmCFItalic = 0x0836
      prls.push(0x36, 0x08, entry.italic ? 0x01 : 0x00)
    }
    if (entry.underline !== undefined) {
      // sprmCKul = 0x2A3E, 1-byte underline style (0 = none, 1 = single)
      prls.push(0x3E, 0x2A, entry.underline ? 0x01 : 0x00)
    }
    if (entry.fontSize !== undefined) {
      // sprmCHps = 0x4A43, 2-byte operand (half-points)
      const hps = entry.fontSize * 2
      prls.push(0x43, 0x4A, hps & 0xFF, (hps >> 8) & 0xFF)
    }
    const grpprlSize = prls.length
    const cbOffset = 2 + grpprlSize
    const chpx = new Uint8Array(cbOffset)
    chpx[0] = cbOffset & 0xFF
    chpx[1] = (cbOffset >> 8) & 0xFF
    for (let i = 0; i < grpprlSize; i++) {
      chpx[2 + i] = prls[i]
    }
    aPcbParts.push(chpx)
  }

  const aPcbLen = aPcbParts.reduce((sum, p) => sum + p.length, 0)
  const totalLen = (n + 1) * 4 + aPcbLen
  const result = new Uint8Array(totalLen)

  // Write aCP array.
  for (let i = 0; i < n; i++) {
    const cp = entries[i].cpStart
    const offset = i * 4
    result[offset] = cp & 0xFF
    result[offset + 1] = (cp >> 8) & 0xFF
    result[offset + 2] = (cp >> 16) & 0xFF
    result[offset + 3] = (cp >> 24) & 0xFF
  }
  // Last CP (we don't have real data; use a synthetic end).
  const lastCp = entries[n - 1].cpStart + 100
  const lastOffset = n * 4
  result[lastOffset] = lastCp & 0xFF
  result[lastOffset + 1] = (lastCp >> 8) & 0xFF
  result[lastOffset + 2] = (lastCp >> 16) & 0xFF
  result[lastOffset + 3] = (lastCp >> 24) & 0xFF

  // Write aPcb.
  let pcbOffset = (n + 1) * 4
  for (const chpx of aPcbParts) {
    result.set(chpx, pcbOffset)
    pcbOffset += chpx.length
  }

  return result
}

/**
 * Build a PlcfBtePapx test fixture.
 * Each entry: { cpStart, alignment, indent, istd, tabs }
 */
function buildPlcfBtePapx(entries: Array<{ cpStart: number; alignment?: 'left' | 'center' | 'right' | 'justify'; indent?: number; istd?: number; tabs?: number[] }>): Uint8Array {
  const n = entries.length
  const aPcbParts: Uint8Array[] = []

  for (const entry of entries) {
    const prls: number[] = []
    if (entry.alignment !== undefined) {
      // sprmPJc80 = 0x2403, 1-byte operand
      const jc = entry.alignment === 'left' ? 0
        : entry.alignment === 'center' ? 1
          : entry.alignment === 'right' ? 2
            : 3
      prls.push(0x03, 0x24, jc)
    }
    if (entry.indent !== undefined) {
      // sprmPDxaLeft = 0x840F, 2-byte signed operand (twips)
      const twips = Math.round(entry.indent * 20)
      prls.push(0x0F, 0x84, twips & 0xFF, (twips >> 8) & 0xFF)
    }
    if (entry.tabs !== undefined && entry.tabs.length > 0) {
      // sprmPChgTabsPapx = 0xC60D, variable-length (spra=6)
      // PChgTabsPapxOperand: cb + cTabsDel(1) + rgdxaDel + cTabsAdd(1) + rgdxaAdd(2×a) + rgtbdAdd(1×a)
      const tabCount = entry.tabs.length
      const cb = 1 + 1 + tabCount * 2 + tabCount // cTabsDel + cTabsAdd + rgdxaAdd + rgtbdAdd
      prls.push(0x0D, 0xC6, cb)
      prls.push(0x00) // cTabsDel = 0
      prls.push(tabCount & 0xFF) // cTabsAdd
      for (const tabPt of entry.tabs) {
        const twips = Math.round(tabPt * 20)
        prls.push(twips & 0xFF, (twips >> 8) & 0xFF) // rgdxaAdd
      }
      for (let i = 0; i < tabCount; i++) prls.push(0x00) // rgtbdAdd (left/none)
    }
    const grpprlSize = prls.length
    const istd = entry.istd ?? 0
    const cbOffset = 4 + grpprlSize // cbOffset(2) + istd(2) + grpprl
    const papx = new Uint8Array(cbOffset)
    papx[0] = cbOffset & 0xFF
    papx[1] = (cbOffset >> 8) & 0xFF
    papx[2] = istd & 0xFF
    papx[3] = (istd >> 8) & 0xFF
    for (let i = 0; i < grpprlSize; i++) {
      papx[4 + i] = prls[i]
    }
    aPcbParts.push(papx)
  }

  const aPcbLen = aPcbParts.reduce((sum, p) => sum + p.length, 0)
  const totalLen = (n + 1) * 4 + aPcbLen
  const result = new Uint8Array(totalLen)

  for (let i = 0; i < n; i++) {
    const cp = entries[i].cpStart
    const offset = i * 4
    result[offset] = cp & 0xFF
    result[offset + 1] = (cp >> 8) & 0xFF
    result[offset + 2] = (cp >> 16) & 0xFF
    result[offset + 3] = (cp >> 24) & 0xFF
  }
  const lastCp = entries[n - 1].cpStart + 50
  const lastOffset = n * 4
  result[lastOffset] = lastCp & 0xFF
  result[lastOffset + 1] = (lastCp >> 8) & 0xFF
  result[lastOffset + 2] = (lastCp >> 16) & 0xFF
  result[lastOffset + 3] = (lastCp >> 24) & 0xFF

  let pcbOffset = (n + 1) * 4
  for (const papx of aPcbParts) {
    result.set(papx, pcbOffset)
    pcbOffset += papx.length
  }

  return result
}

describe('formatParser', () => {
  describe('parseChpxRuns', () => {
    it('should return empty array for invalid input', () => {
      expect(parseChpxRuns(new Uint8Array(0), 0, 0)).toEqual([])
      expect(parseChpxRuns(new Uint8Array(100), -1, 10)).toEqual([])
      expect(parseChpxRuns(new Uint8Array(100), 0, 200)).toEqual([])
    })

    it('should parse a single CHPX run with bold', () => {
      const data = buildPlcfBteChpx([
        { cpStart: 0, bold: true },
      ])
      const runs = parseChpxRuns(data, 0, data.length)
      expect(runs.length).toBe(1)
      expect(runs[0].cpStart).toBe(0)
      expect(runs[0].cpEnd).toBe(100)
      expect(runs[0].format.bold).toBe(true)
    })

    it('should parse multiple CHPX runs with different formats', () => {
      const data = buildPlcfBteChpx([
        { cpStart: 0, bold: true, fontSize: 24 },
        { cpStart: 10, italic: true },
        { cpStart: 20, underline: true, fontSize: 12 },
      ])
      const runs = parseChpxRuns(data, 0, data.length)
      expect(runs.length).toBe(3)
      expect(runs[0].cpStart).toBe(0)
      expect(runs[0].cpEnd).toBe(10)
      expect(runs[0].format.bold).toBe(true)
      expect(runs[0].format.fontSize).toBe(24)
      expect(runs[1].cpStart).toBe(10)
      expect(runs[1].cpEnd).toBe(20)
      expect(runs[1].format.italic).toBe(true)
      expect(runs[2].cpStart).toBe(20)
      expect(runs[2].format.underline).toBe(true)
      expect(runs[2].format.fontSize).toBe(12)
    })

    it('should handle CHPX with no format overrides (empty grpprl)', () => {
      const data = buildPlcfBteChpx([
        { cpStart: 0 },
      ])
      const runs = parseChpxRuns(data, 0, data.length)
      expect(runs.length).toBe(1)
      expect(runs[0].format.bold).toBeUndefined()
      expect(runs[0].format.italic).toBeUndefined()
    })

    it('should parse correctly when wrapped in a larger buffer', () => {
      const inner = buildPlcfBteChpx([
        { cpStart: 0, bold: true },
        { cpStart: 50, italic: true },
      ])
      const prefix = new Uint8Array(100)
      const suffix = new Uint8Array(50)
      const combined = new Uint8Array(prefix.length + inner.length + suffix.length)
      combined.set(prefix, 0)
      combined.set(inner, prefix.length)
      combined.set(suffix, prefix.length + inner.length)

      const runs = parseChpxRuns(combined, prefix.length, inner.length)
      expect(runs.length).toBe(2)
      expect(runs[0].format.bold).toBe(true)
      expect(runs[1].format.italic).toBe(true)
    })

    it('should capture the character style index (sprmCIstd)', () => {
      const data = buildPlcfBteChpx([
        { cpStart: 0, istd: 37, underline: true }, // Hyperlink style + own underline
        { cpStart: 10, bold: true },               // no istd
      ])
      const runs = parseChpxRuns(data, 0, data.length)
      expect(runs.length).toBe(2)
      expect(runs[0].istd).toBe(37)
      expect(runs[0].format.underline).toBe(true)
      expect(runs[1].istd).toBeUndefined()
      expect(runs[1].format.bold).toBe(true)
    })
  })

  describe('mergeCharFormatForParagraph', () => {
    it('should apply a resolved character style before direct CHPX overrides', () => {
      const styleFormats = new Map([
        [105, { bold: true, italic: true, color: '#336699' }],
      ])
      const merged = mergeCharFormatForParagraph([
        { cpStart: 0, cpEnd: 10, istd: 105, format: { italic: false } },
      ], 0, 10, undefined, styleFormats)

      expect(merged.bold).toBe(true)
      expect(merged.italic).toBeUndefined()
      expect(merged.color).toBe('#336699')
    })
  })

  describe('parsePapxRuns', () => {
    it('should return empty array for invalid input', () => {
      expect(parsePapxRuns(new Uint8Array(0), 0, 0)).toEqual([])
      expect(parsePapxRuns(new Uint8Array(100), -1, 10)).toEqual([])
    })

    it('should parse a single PAPX run with alignment', () => {
      const data = buildPlcfBtePapx([
        { cpStart: 0, alignment: 'center' },
      ])
      const runs = parsePapxRuns(data, 0, data.length)
      expect(runs.length).toBe(1)
      expect(runs[0].format.alignment).toBe('center')
      expect(runs[0].istd).toBe(0)
    })

    it('should parse multiple PAPX runs with different properties', () => {
      const data = buildPlcfBtePapx([
        { cpStart: 0, alignment: 'center', istd: 1 },
        { cpStart: 50, alignment: 'justify', indent: 20 },
        { cpStart: 100, alignment: 'right' },
      ])
      const runs = parsePapxRuns(data, 0, data.length)
      expect(runs.length).toBe(3)
      expect(runs[0].format.alignment).toBe('center')
      expect(runs[0].istd).toBe(1)
      expect(runs[1].format.alignment).toBe('justify')
      expect(runs[1].format.indent).toBe(20)
      expect(runs[2].format.alignment).toBe('right')
    })

    it('should parse tab stops from sprmPDxaTab', () => {
      const data = buildPlcfBtePapx([
        { cpStart: 0, tabs: [36, 72, 144] }, // 制表位位置（磅）
      ])
      const runs = parsePapxRuns(data, 0, data.length)
      expect(runs.length).toBe(1)
      expect(runs[0].format.tabs).toBeDefined()
      expect(runs[0].format.tabs!.length).toBe(3)
      expect(runs[0].format.tabs![0]).toBeCloseTo(36, 1)
      expect(runs[0].format.tabs![1]).toBeCloseTo(72, 1)
      expect(runs[0].format.tabs![2]).toBeCloseTo(144, 1)
    })

    it('should parse paragraph with alignment and tabs', () => {
      const data = buildPlcfBtePapx([
        { cpStart: 0, alignment: 'center', tabs: [48, 96] },
        { cpStart: 50, alignment: 'right', tabs: [120] },
      ])
      const runs = parsePapxRuns(data, 0, data.length)
      expect(runs.length).toBe(2)
      expect(runs[0].format.alignment).toBe('center')
      expect(runs[0].format.tabs!.length).toBe(2)
      expect(runs[0].format.tabs![0]).toBeCloseTo(48, 1)
      expect(runs[1].format.alignment).toBe('right')
      expect(runs[1].format.tabs!.length).toBe(1)
      expect(runs[1].format.tabs![0]).toBeCloseTo(120, 1)
    })

    it('should handle PAPX without tabs', () => {
      const data = buildPlcfBtePapx([
        { cpStart: 0, alignment: 'left' },
        { cpStart: 50, alignment: 'center', tabs: [72] },
        { cpStart: 100, alignment: 'right' },
      ])
      const runs = parsePapxRuns(data, 0, data.length)
      expect(runs.length).toBe(3)
      expect(runs[0].format.tabs).toBeUndefined()
      expect(runs[1].format.tabs!.length).toBe(1)
      expect(runs[2].format.tabs).toBeUndefined()
    })
  })

  describe('mergeCharFormatForParagraph', () => {
    it('should return empty object for no runs', () => {
      expect(mergeCharFormatForParagraph([], 0, 100)).toEqual({})
    })

    it('should return empty object for invalid range', () => {
      const runs = parseChpxRuns(buildPlcfBteChpx([{ cpStart: 0, bold: true }]), 0, 100)
      expect(mergeCharFormatForParagraph(runs, 100, 100)).toEqual({})
    })

    it('should merge bold from overlapping run', () => {
      const data = buildPlcfBteChpx([
        { cpStart: 0, bold: true, fontSize: 16 },
      ])
      const runs = parseChpxRuns(data, 0, data.length)
      const merged = mergeCharFormatForParagraph(runs, 0, 50)
      expect(merged.bold).toBe(true)
      expect(merged.fontSize).toBe(16)
    })

    it('should not set bold when minority of characters are bold', () => {
      const data = buildPlcfBteChpx([
        { cpStart: 0, bold: false },
        { cpStart: 10, bold: true },
        { cpStart: 20, bold: false },
      ])
      const runs = parseChpxRuns(data, 0, data.length)
      const merged = mergeCharFormatForParagraph(runs, 0, 100)
      expect(merged.bold).toBeUndefined()
    })
  })

  describe('parseChpxGrpprlWithFont (SPRM coverage)', () => {
    function parseGrpprl(prls: number[]): ReturnType<typeof parseChpxGrpprlWithFont> {
      return parseChpxGrpprlWithFont(new Uint8Array(prls), 0, prls.length)
    }

    it('should parse strikethrough, outline, shadow, smallCaps, allCaps, hidden', () => {
      const r = parseGrpprl([
        0x37, 0x08, 0x01, // sprmCFStrike (0x0837) on
        0x38, 0x08, 0x01, // sprmCFOutline (0x0838) on
        0x39, 0x08, 0x01, // sprmCFShadow (0x0839) on
        0x3A, 0x08, 0x01, // sprmCFSmallCaps (0x083A) on
        0x3B, 0x08, 0x01, // sprmCFCaps (0x083B) on
        0x3C, 0x08, 0x01, // sprmCFVanish (0x083C) on
      ])
      expect(r.format.strikethrough).toBe(true)
      expect(r.format.outline).toBe(true)
      expect(r.format.shadow).toBe(true)
      expect(r.format.smallCaps).toBe(true)
      expect(r.format.allCaps).toBe(true)
      expect(r.format.hidden).toBe(true)
    })

    it('should parse toggle-off operands', () => {
      const r = parseGrpprl([
        0x35, 0x08, 0x00, // bold off
        0x36, 0x08, 0x00, // italic off
      ])
      expect(r.format.bold).toBe(false)
      expect(r.format.italic).toBe(false)
    })

    it('should parse double strikethrough and superscript/subscript', () => {
      const r = parseGrpprl([
        0x53, 0x2A, 0x01, // sprmCDStrike (0x2A53)
        0x45, 0x48, 0x05, 0x00, // sprmCHpsPos (0x4845) = +5 (superscript)
      ])
      expect(r.format.strikethrough).toBe(true)
      expect(r.format.superscript).toBe(true)
    })

    it('should parse subscript from negative HpsPos and ISS', () => {
      const r1 = parseGrpprl([0x45, 0x48, 0xFB, 0xFF]) // -5 → subscript
      expect(r1.format.subscript).toBe(true)
      const r2 = parseGrpprl([0x48, 0x2A, 0x02]) // ISS=2 → subscript
      expect(r2.format.subscript).toBe(true)
      const r3 = parseGrpprl([0x48, 0x2A, 0x01]) // ISS=1 → superscript
      expect(r3.format.superscript).toBe(true)
    })

    it('should parse text color from ICO palette and COLORREF', () => {
      const r1 = parseGrpprl([0x42, 0x2A, 0x06]) // ICO=6 → red
      expect(r1.format.color).toBe('#FF0000')
      const r2 = parseGrpprl([0x70, 0x68, 0x10, 0x20, 0x30, 0x00]) // COLORREF rgb(16,32,48)
      expect(r2.format.color).toBe('rgb(16, 32, 48)')
      const r3 = parseGrpprl([0x70, 0x68, 0x10, 0x20, 0x30, 0xFF]) // fAuto=0xFF → skip
      expect(r3.format.color).toBeUndefined()
    })

    it('should parse highlight colors', () => {
      const r = parseGrpprl([0x0C, 0x2A, 0x01]) // highlight yellow
      expect(r.format.highlight).toBe('#FFFF00')
      const r0 = parseGrpprl([0x0C, 0x2A, 0x00]) // highlight none
      expect(r0.format.highlight).toBeUndefined()
    })

    it('should parse letter spacing and font indexes', () => {
      const r = parseGrpprl([
        0x40, 0x88, 0x64, 0x00, // sprmCDxaSpace (0x8840) = 100 twips → 5pt
        0x4F, 0x4A, 0x02, 0x00, // ftc0 = 2
        0x50, 0x4A, 0x05, 0x00, // ftc1 = 5
      ])
      expect(r.format.letterSpacing).toBe(5)
      expect(r.fontIndex).toBe(2) // ASCII font wins
    })

    it('should parse East Asian font index when ASCII is absent', () => {
      const r = parseGrpprl([
        0x51, 0x4A, 0x07, 0x00, // ftc2 = 7
        0x50, 0x4A, 0x05, 0x00, // ftc1 = 5
      ])
      expect(r.fontIndex).toBe(5) // ftc1 before ftc2
    })

    it('should parse revisions (insert/delete with author and timestamp)', () => {
      const dttm = 0x12345678
      const r = parseGrpprl([
        0x01, 0x08, 0x01, // sprmCFRMark on
        0x04, 0x48, 0x03, 0x00, // ibstRMark = 3
        0x05, 0x68, dttm & 0xFF, (dttm >> 8) & 0xFF, (dttm >> 16) & 0xFF, (dttm >> 24) & 0xFF,
      ])
      expect(r.revision).toEqual({ type: 'insert', authorIndex: 3, timestamp: dttm })
    })

    it('should parse delete revisions', () => {
      const r = parseGrpprl([
        0x00, 0x08, 0x01, // sprmCFRMarkDel on
        0x63, 0x48, 0x02, 0x00, // ibstRMarkDel = 2
      ])
      expect(r.revision).toEqual({ type: 'delete', authorIndex: 2 })
    })

    it('should parse special chars and picture locations', () => {
      const r = parseGrpprl([
        0x55, 0x08, 0x01, // sprmCFSpec on
        0x03, 0x6A, 0x78, 0x56, 0x34, 0x12, // fcPic = 0x12345678
      ])
      expect(r.isSpecial).toBe(true)
      expect(r.fcPic).toBe(0x12345678)
    })

    it('should parse kerning (consumed, no effect) and malformed SPRMs', () => {
      const r = parseGrpprl([0x4B, 0x48, 0x10, 0x00]) // sprmCHpsKern
      expect(r.format).toEqual({})
      // Truncated SPRM (1 byte) — no crash
      const r2 = parseGrpprl([0x35])
      expect(r2.format).toEqual({})
    })
  })

  describe('parsePapxGrpprl (PAPX SPRM coverage)', () => {
    function parsePapx(prls: number[]): ReturnType<typeof parsePapxGrpprl> {
      return parsePapxGrpprl(new Uint8Array(prls), 0, prls.length)
    }

    it('should parse page break, right indent, first line indent, spacing', () => {
      const r = parsePapx([
        0x07, 0x24, 0x01, // sprmPPageBreakBefore (0x2407) on
        0x0E, 0x84, 0x64, 0x00, // sprmPDxaRight (0x840E) = 100 twips
        0x11, 0x84, 0xC8, 0x00, // sprmPDxaLeft1 (0x8411) = 200 twips
        0x13, 0xA4, 0xE8, 0x03, // sprmPDyaBefore (0xA413) = 1000 twips
        0x14, 0xA4, 0xF4, 0x01, // sprmPDyaAfter (0xA414) = 500 twips
      ])
      expect(r.format.pageBreakBefore).toBe(true)
      expect(r.format.rightIndent).toBeCloseTo(5) // 100/20
      expect(r.format.firstLineIndent).toBeCloseTo(10)
      expect(r.format.spaceBefore).toBeCloseTo(50)
      expect(r.format.spaceAfter).toBeCloseTo(25)
    })

    it('should parse line spacing (LSPD)', () => {
      // sprmPDyaLine (0x6412): dyaLine(2) + fMultLinespace(2)
      const r = parsePapx([0x12, 0x64, 0xF4, 0x01, 0x01, 0x00])
      expect(r.format.lineSpacing).toBeDefined()
    })

    it('should parse outline level, list level, and list format overrides', () => {
      const r = parsePapx([
        0x40, 0x26, 0x02, // sprmPOutlineLvl = 2
        0x0A, 0x26, 0x01, // sprmPIlvl = 1
        0x0B, 0x46, 0x05, 0x00, // sprmPIlfo = 5
      ])
      expect(r.format.outlineLevel).toBe(2)
      expect(r.ilvl).toBe(1)
      expect(r.ilfo).toBe(5)
    })

    it('should parse table flags and depth', () => {
      const r = parsePapx([
        0x16, 0x24, 0x01, // sprmPFInTable on
        0x17, 0x24, 0x01, // sprmPFInnerTableCell on
        0x49, 0x66, 0x02, 0x00, 0x00, 0x00, // sprmPItap = 2
      ])
      expect(r.table).toBeDefined()
      expect(r.table!.inTable).toBe(true)
      expect(r.table!.depth).toBe(2)
    })

    it('should parse table justification', () => {
      // sprmTJC90 (0x5400): 2-byte justification
      const r = parsePapx([0x00, 0x54, 0x01, 0x00])
      expect(r.table).toBeDefined()
      expect(r.table!.justification).toBe('center')
    })

    it('should parse legacy list fields', () => {
      const r = parsePapx([
        0x0D, 0x46, 0x03, 0x00, // sprmPIlvlLegacy (0x460D)
        0x0E, 0x46, 0x07, 0x00, // sprmPIlstLegacy (0x460E)
        0x0F, 0x46, 0x02, 0x00, // sprmPIlfoLegacy (0x460F)
      ])
      expect(r.ilvl).toBe(3)
      expect(r.ilst).toBe(7)
      expect(r.ilfo).toBe(2)
    })

    it('should parse paragraph borders', () => {
      // sprmPBrcTop (0x6424): 4 bytes — width(1), type(1), ico(1), pad(1)
      const r = parsePapx([0x24, 0x64, 0x08, 0x01, 0x06, 0x00])
      expect(r.format.borders).toBeDefined()
      expect(r.format.borders!.top).toEqual({ colorIndex: 6, lineWidth: 8, borderType: 1 })
    })

    it('should parse tab stops from sprmPChgTabs (0xC615)', () => {
      // spra=6 variable: cb(1)=4 + cTabsDel(1)=0 + cTabsAdd(1)=1
      //   + rgdxaAdd(2)=40tw + rgtbdAdd(1)=0
      const r = parsePapx([0x15, 0xC6, 0x04, 0x00, 0x01, 0x28, 0x00, 0x00])
      expect(r.format.tabs).toEqual([2])
    })

    it('should parse table definition cells', () => {
      // sprmTDefTable (0xD608): cb16(2) + payload
      // payload = itcMac(1) + rgdxa(2×(1+1)=4) + rgtc(1×20=20) = 25 bytes
      // cb16 = payload + 1 = 26 = 0x1A → operandSize = 2 + 25 = 27
      const prls = [0x08, 0xD6, 0x1A, 0x00, 0x01, 0x00, 0x00, 0xF4, 0x01]
      // rgdxa: 2 entries × 2 bytes = 4 (left edge + right edge)
      prls.push(0x00, 0x00, 0x64, 0x00)
      // rgtc: 1 TC80 entry, 20 bytes (grfTc + 4×BRC80)
      for (let i = 0; i < 20; i++) prls.push(0x00)
      const r = parsePapx(prls)
      expect(r.table).toBeDefined()
      expect(r.table!.cells).toBeDefined()
      expect(r.table!.cells!.length).toBe(1)
      expect(r.table!.cells![0].verticalMerge).toBe('none')
    })

    it('should parse table definition with merge flags', () => {
      // payload = itcMac(1) + rgdxa(3×2=6) + rgtc(2×20=40) = 47 → cb16 = 48
      const prls = [0x08, 0xD6, 0x30, 0x00]
      prls.push(0x02) // itcMac = 2
      // rgdxa: 3 entries × 2 bytes
      prls.push(0x00, 0x00, 0x64, 0x00, 0xC8, 0x00)
      // TC[0]: grfTc = fVertMerge (0x20)
      prls.push(0x20, 0x00)
      for (let i = 0; i < 18; i++) prls.push(0x00)
      // TC[1]: plain
      for (let i = 0; i < 20; i++) prls.push(0x00)
      const r = parsePapx(prls)
      expect(r.table).toBeDefined()
      expect(r.table!.cells![0].verticalMerge).toBe('continue')
      expect(r.table!.cells![1].verticalMerge).toBe('none')
    })

    it('should parse table borders', () => {
      // sprmTTableBorders (0xD605): cb(2) + 6×BRC80(4) → cb=25
      const brc = [0x08, 0x01, 0x01, 0x00]
      const prls = [0x05, 0xD6, 0x19, 0x00, ...brc, ...brc, ...brc, ...brc, ...brc, ...brc]
      const r = parsePapx(prls)
      expect(r.table).toBeDefined()
      expect(r.table!.borders).toBeDefined()
    })
  })
})

describe('formatParser extra SPRM branches', () => {
  function parseGrpprl(prls: number[]): ReturnType<typeof parseChpxGrpprlWithFont> {
    return parseChpxGrpprlWithFont(new Uint8Array(prls), 0, prls.length)
  }

  it('should clear outline and shadow on toggle 0', () => {
    const r = parseGrpprl([0x38, 0x08, 0x00, 0x39, 0x08, 0x00])
    expect(r.format.outline).toBe(false)
    expect(r.format.shadow).toBe(false)
  })

  it('should create an insert revision from sprmCFRMark', () => {
    const r = parseGrpprl([0x01, 0x08, 0x01])
    expect(r.revision).toEqual({ type: 'insert' })
  })

  it('should create a delete revision from sprmCFRMarkDel and DTTM', () => {
    const r = parseGrpprl([0x00, 0x08, 0x01, 0x64, 0x68, 0x04, 0x03, 0x02, 0x01])
    expect(r.revision).toEqual({ type: 'delete', timestamp: 0x01020304 })
  })

  it('should parse istd and in-table SPRMs from a Papx grpprl', () => {
    const r = parsePapxGrpprl(new Uint8Array([0x00, 0x46, 0x01, 0x00, 0x16, 0x24, 0x01]), 0, 7)
    expect(r.table).toEqual({ inTable: true })
  })
})

describe('formatParser revision and table branches', () => {
  function parseGrpprl(prls: number[]): ReturnType<typeof parseChpxGrpprlWithFont> {
    return parseChpxGrpprlWithFont(new Uint8Array(prls), 0, prls.length)
  }

  it('should downgrade an insert revision to delete on sprmCFRMarkDel', () => {
    const r = parseGrpprl([0x01, 0x08, 0x01, 0x00, 0x08, 0x01])
    expect(r.revision).toEqual({ type: 'delete' })
  })

  it('should keep an existing table object when TTP follows inTable', () => {
    const r = parsePapxGrpprl(new Uint8Array([0x17, 0x24, 0x01, 0x16, 0x24, 0x01]), 0, 6)
    expect(r.table).toEqual({ inTable: true })
  })

  it('should map table justification value 2 to right', () => {
    const r = parsePapxGrpprl(new Uint8Array([0x00, 0x54, 0x02, 0x00]), 0, 4)
    expect(r.table).toEqual({ inTable: true, justification: 'right' })
  })
})
