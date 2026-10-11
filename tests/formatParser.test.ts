import { describe, it, expect } from 'vitest'
import { parseChpxRuns, parsePapxRuns, mergeCharFormatForParagraph, parseChpxGrpprlWithFont, parsePapxGrpprl, parseChpxRunsFromFkp, parsePapxRunsFromFkp } from '../src/utils/formatParser'
import type { ChpxRun, PapxRun, PieceFcRange } from '../src/utils/formatParser'
import type { CharacterFormat } from '../src/utils/docFormat'
import { deepStrictEqual } from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { readUint16, readUint32 } from '../src/utils/binaryReader'
import { OleParser } from '../src/utils/oleParser'
import { parseFib } from '../src/utils/fibParser'
import { parseClxPieces } from '../src/utils/docparser/pieceTable'

/**
 * Build a PlcfBteChpx test fixture from a list of (cpStart, bold, fontSize) tuples.
 *
 * Layout:
 *   aCP: (n+1) * 4 bytes
 *   aPcb: n * CHPX entries (each: cbOffset(2) + grpprl)
 */
function buildPlcfBteChpx(entries: Array<{ cpStart: number; bold?: boolean; italic?: boolean; fontSize?: number; underline?: boolean; istd?: number; isSpecial?: boolean; fcPic?: number }>): Uint8Array {
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
    if (entry.isSpecial) {
      // sprmCFSpec = 0x0855, toggle
      prls.push(0x55, 0x08, 0x01)
    }
    if (entry.fcPic !== undefined) {
      // sprmCPicLocation = 0x6A03, 4-byte
      prls.push(0x03, 0x6A, entry.fcPic & 0xFF, (entry.fcPic >> 8) & 0xFF, (entry.fcPic >> 16) & 0xFF, (entry.fcPic >> 24) & 0xFF)
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
function buildPlcfBtePapx(entries: Array<{ cpStart: number; alignment?: 'left' | 'center' | 'right' | 'justify'; indent?: number; istd?: number; tabs?: number[]; ilvl?: number }>): Uint8Array {
  const n = entries.length
  const aPcbParts: Uint8Array[] = []

  for (const entry of entries) {
    const prls: number[] = []
    if (entry.ilvl !== undefined) {
      // sprmPIlvl = 0x260A, 1-byte list level
      prls.push(0x0A, 0x26, entry.ilvl)
    }
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

describe('formatParser highlight palette and toggle-off branches', () => {
  function parseGrpprl(prls: number[]): ReturnType<typeof parseChpxGrpprlWithFont> {
    return parseChpxGrpprlWithFont(new Uint8Array(prls), 0, prls.length)
  }

  it('should map every highlight code 1-15 to its palette color', () => {
    const palette: Record<number, string> = {
      1: '#FFFF00', 2: '#00FF00', 3: '#00FFFF', 4: '#FF00FF', 5: '#0000FF',
      6: '#FF0000', 7: '#000080', 8: '#008080', 9: '#008000', 10: '#800080',
      11: '#800000', 12: '#808000', 13: '#808080', 14: '#C0C0C0', 15: '#000000',
    }
    for (const [code, color] of Object.entries(palette)) {
      const r = parseGrpprl([0x0C, 0x2A, Number(code)])
      expect(r.format.highlight).toBe(color)
    }
  })

  it('should fall back to yellow for out-of-range highlight codes', () => {
    const r = parseGrpprl([0x0C, 0x2A, 0x63]) // 99
    expect(r.format.highlight).toBe('#FFFF00')
  })

  it('should parse strikethrough and hidden toggle-off operands', () => {
    const r = parseGrpprl([
      0x37, 0x08, 0x00, // sprmCFStrike off
      0x3C, 0x08, 0x00, // sprmCFVanish off
    ])
    expect(r.format.strikethrough).toBe(false)
    expect(r.format.hidden).toBe(false)
  })
})

describe('formatParser revision sprms without a leading mark toggle', () => {
  function parseGrpprl(prls: number[]): ReturnType<typeof parseChpxGrpprlWithFont> {
    return parseChpxGrpprlWithFont(new Uint8Array(prls), 0, prls.length)
  }

  it('should create an insert revision from a bare sprmCIbstRMark', () => {
    const r = parseGrpprl([0x04, 0x48, 0x07, 0x00])
    expect(r.revision).toEqual({ type: 'insert', authorIndex: 7 })
  })

  it('should create an insert revision from a bare sprmCDttmRMark', () => {
    const dttm = 0xAABBCCDD
    const r = parseGrpprl([0x05, 0x68, dttm & 0xFF, (dttm >> 8) & 0xFF, (dttm >> 16) & 0xFF, (dttm >> 24) & 0xFF])
    expect(r.revision).toEqual({ type: 'insert', timestamp: dttm })
  })

  it('should ignore a zero sprmCDttmRMark when no revision exists', () => {
    const r = parseGrpprl([0x05, 0x68, 0, 0, 0, 0])
    expect(r.revision).toBeUndefined()
  })

  it('should create a delete revision from a bare sprmCIbstRMarkDel', () => {
    const r = parseGrpprl([0x63, 0x48, 0x04, 0x00])
    expect(r.revision).toEqual({ type: 'delete', authorIndex: 4 })
  })

  it('should create a delete revision from a bare sprmCDttmRMarkDel', () => {
    const dttm = 0x11223344
    const r = parseGrpprl([0x64, 0x68, dttm & 0xFF, (dttm >> 8) & 0xFF, (dttm >> 16) & 0xFF, (dttm >> 24) & 0xFF])
    expect(r.revision).toEqual({ type: 'delete', timestamp: dttm })
  })

  it('should ignore a zero sprmCDttmRMarkDel when no revision exists', () => {
    const r = parseGrpprl([0x64, 0x68, 0, 0, 0, 0])
    expect(r.revision).toBeUndefined()
  })
})

describe('formatParser plcf walk sanity branches', () => {
  it('should reject a PlcfBteChpx whose first CP exceeds the sanity limit', () => {
    const data = new Uint8Array(32)
    new DataView(data.buffer).setUint32(0, 0x01000000, true) // > 0x00FFFFFF
    expect(parseChpxRuns(data, 0, 32)).toEqual([])
  })

  it('should reject a PlcfBteChpx when CPs are not strictly increasing', () => {
    const data = new Uint8Array(32)
    const dv = new DataView(data.buffer)
    dv.setUint32(0, 10, true)
    dv.setUint32(4, 10, true) // not > previous
    expect(parseChpxRuns(data, 0, 32)).toEqual([])
  })

  it('should reject a PlcfBteChpx with a malformed aPcb chain (cb < 2)', () => {
    const data = new Uint8Array(32)
    const dv = new DataView(data.buffer)
    dv.setUint32(0, 0, true)
    dv.setUint32(4, 50, true)
    dv.setUint16(8, 1, true) // cbOffset = 1 → invalid
    expect(parseChpxRuns(data, 0, 32)).toEqual([])
  })

  it('should reject a PlcfBtePapx whose first CP exceeds the sanity limit', () => {
    const data = new Uint8Array(32)
    new DataView(data.buffer).setUint32(0, 0x01000000, true)
    expect(parsePapxRuns(data, 0, 32)).toEqual([])
  })

  it('should reject a PlcfBtePapx when CPs are not strictly increasing', () => {
    const data = new Uint8Array(32)
    const dv = new DataView(data.buffer)
    dv.setUint32(0, 10, true)
    dv.setUint32(4, 5, true) // decreasing
    expect(parsePapxRuns(data, 0, 32)).toEqual([])
  })

  it('should reject a PlcfBtePapx with a malformed aPcb chain (cb < 4)', () => {
    const data = new Uint8Array(32)
    const dv = new DataView(data.buffer)
    dv.setUint32(0, 0, true)
    dv.setUint32(4, 50, true)
    dv.setUint16(8, 3, true) // below PAPX minimum
    expect(parsePapxRuns(data, 0, 32)).toEqual([])
  })

  it('should propagate isSpecial and fcPic from CHPX grpprls into runs', () => {
    const data = buildPlcfBteChpx([
      { cpStart: 0, isSpecial: true, fcPic: 0x0A0B0C0D },
    ])
    const runs = parseChpxRuns(data, 0, data.length)
    expect(runs).toHaveLength(1)
    expect(runs[0].isSpecial).toBe(true)
    expect(runs[0].fcPic).toBe(0x0A0B0C0D)
  })

  it('should propagate ilvl from PAPX grpprls into runs', () => {
    const data = buildPlcfBtePapx([
      { cpStart: 0, alignment: 'left', ilvl: 2 },
    ])
    const runs = parsePapxRuns(data, 0, data.length)
    expect(runs).toHaveLength(1)
    expect(runs[0].ilvl).toBe(2)
  })
})

describe('formatParser PAPX SPRM edge cases', () => {
  function parsePapx(prls: number[]): ReturnType<typeof parsePapxGrpprl> {
    return parsePapxGrpprl(new Uint8Array(prls), 0, prls.length)
  }

  it('should map alignment value 4 (distribute) to justify', () => {
    const r = parsePapx([0x03, 0x24, 0x04])
    expect(r.format.alignment).toBe('justify')
  })

  it('should parse paragraph shading via SHD80 icoBack', () => {
    // sprmPShd80 = 0x442D (2-byte). SHD80: icoBack = bits 5-9.
    // icoBack=6 (red) → shd = 6 << 5 = 0xC0
    const r = parsePapx([0x2D, 0x44, 0xC0, 0x00])
    expect(r.format.backgroundColor).toBe('#FF0000')
  })

  it('should skip paragraph shading when icoBack is out of range', () => {
    // icoBack=17 → shd = 17 << 5 = 0x220 (bit 9 spills into ipat, still decodes to 17)
    const r = parsePapx([0x2D, 0x44, 0x20, 0x02])
    expect(r.format.backgroundColor).toBeUndefined()
  })

  it('should break on a sprmPChgTabsPapx operand shorter than 3 bytes', () => {
    // spra=6: operandSize = 1 + cb. cb=0 → operandSize=1 < 3
    const r = parsePapx([0x0D, 0xC6, 0x00])
    expect(r.format.tabs).toBeUndefined()
  })

  it('should break when sprmPChgTabsPapx cAdd lands past the operand end', () => {
    // cb=2 (operandSize=3), cTabsDel=5 → cAddOffset = +2+10 = past opEnd
    const r = parsePapx([0x0D, 0xC6, 0x02, 0x05])
    expect(r.format.tabs).toBeUndefined()
  })

  it('should stop adding tabs when the add array is truncated', () => {
    // cb=5（operandSize=6）: [cb=5, cTabsDel=0, cTabsAdd=2, tab1lo, tab1hi, pad]
    // 声称 2 个 tab 但只放得下 1 个 → 第 2 次循环 tabOffset+2 > opEnd 中断
    const r = parsePapx([0x0D, 0xC6, 0x05, 0x00, 0x02, 0x10, 0x0E, 0x00])
    expect(r.format.tabs).toEqual([180]) // 0x0E10 = 3600 twips = 180pt
  })

  it('should break on sprmPChgTabs with the complex cb=255 form', () => {
    const r = parsePapx([0x15, 0xC6, 0xFF])
    expect(r.format.tabs).toBeUndefined()
  })

  it('should break on a sprmPChgTabs operand shorter than 3 bytes', () => {
    const r = parsePapx([0x15, 0xC6, 0x00])
    expect(r.format.tabs).toBeUndefined()
  })

  it('should create a table from sprmPItap depth without sprmPFInTable', () => {
    // sprmPItap = 0x6649, 4-byte depth = 2
    const r = parsePapx([0x49, 0x66, 0x02, 0x00, 0x00, 0x00])
    expect(r.table).toEqual({ inTable: true, depth: 2 })
  })

  it('should map sprmTJc90 value 0 to left justification', () => {
    const r = parsePapx([0x00, 0x54, 0x00, 0x00])
    expect(r.table).toEqual({ inTable: true, justification: 'left' })
  })

  it('should return no cells when the TDefTable itcMac overflows the payload', () => {
    // sprmTDefTable = 0xD608, spra=6: operandSize = 1+cb.
    // cb=3（operandSize=4）完整给出: [cb=3, skip, itcMac=10] → rgdxa 需 22 字节，rgtcStart 越过 payloadEnd
    const r = parsePapx([0x08, 0xD6, 0x03, 0x00, 0x0A, 0x00])
    expect(r.table).toBeUndefined()
  })

  it('should mark fFirstMerged cells as horizontal merge restart', () => {
    // 1 列表格，operand 布局 [len, skip, itcMac, rgdxa×2, TC×20]：
    // cb=26 → operandSize=27，grpprl 总长 2+27=29
    const prls: number[] = [0x08, 0xD6, 26, 0, 1, 0, 0, 0xE8, 3]
    const tc = new Uint8Array(20)
    tc[0] = 0x01 // fFirstMerged
    prls.push(...Array.from(tc))
    const r = parsePapx(prls)
    expect(r.table?.cells).toHaveLength(1)
    expect(r.table?.cells[0].horizontalMerge).toBe('restart')
  })
})

describe('formatParser mergeCharFormatForParagraph counting thresholds', () => {
  it('should set smallCaps/allCaps above the 50% threshold', () => {
    const runs = [
      { cpStart: 0, cpEnd: 6, format: { smallCaps: true, allCaps: true } },
      { cpStart: 6, cpEnd: 10, format: {} },
    ] as ReturnType<typeof parseChpxRuns>
    const merged = mergeCharFormatForParagraph(runs, 0, 10)
    expect(merged.smallCaps).toBe(true)
    expect(merged.allCaps).toBe(true)
  })

  it('should not set smallCaps below the 50% threshold', () => {
    const runs = [
      { cpStart: 0, cpEnd: 4, format: { smallCaps: true } },
      { cpStart: 4, cpEnd: 10, format: {} },
    ] as ReturnType<typeof parseChpxRuns>
    const merged = mergeCharFormatForParagraph(runs, 0, 10)
    expect(merged.smallCaps).toBeUndefined()
  })

  it('should set strikethrough above the 30% threshold', () => {
    const runs = [
      { cpStart: 0, cpEnd: 4, format: { strikethrough: true } },
      { cpStart: 4, cpEnd: 10, format: {} },
    ] as ReturnType<typeof parseChpxRuns>
    const merged = mergeCharFormatForParagraph(runs, 0, 10)
    expect(merged.strikethrough).toBe(true)
  })

  it('should resolve the font name from the font index table first', () => {
    const runs = [
      { cpStart: 0, cpEnd: 10, format: {}, fontIndex: 1 },
    ] as ReturnType<typeof parseChpxRuns>
    const merged = mergeCharFormatForParagraph(runs, 0, 10, ['宋体', '黑体'])
    expect(merged.fontName).toBe('黑体')
  })

  it('should fall back to a run-level fontName when the index table misses', () => {
    const runs = [
      { cpStart: 0, cpEnd: 10, format: { fontName: '楷体' }, fontIndex: 9 },
    ] as ReturnType<typeof parseChpxRuns>
    const merged = mergeCharFormatForParagraph(runs, 0, 10, ['宋体'])
    expect(merged.fontName).toBe('楷体')
  })

  it('should apply a resolved character style beneath direct CHPX overrides', () => {
    const runs = [
      { cpStart: 0, cpEnd: 10, format: { bold: true }, istd: 3 },
    ] as ReturnType<typeof parseChpxRuns>
    const styles = new Map([[3, { italic: true }]])
    const merged = mergeCharFormatForParagraph(runs, 0, 10, undefined, styles)
    expect(merged.bold).toBe(true)
    expect(merged.italic).toBe(true)
  })
})

// Round 131：以下四个函数从e09fa49逐行复制，仅函数重命名和去export。
// 共用边界仅为字节读取及未改动的grpprl解析；FC转换/bin/FKP遍历不调用候选。
function round131FcRangeToCpRangesOracle(
  fcStart: number,
  fcEnd: number,
  pieces: PieceFcRange[],
): Array<{ cpStart: number; cpEnd: number }> {
  const out: Array<{ cpStart: number; cpEnd: number }> = []
  for (const p of pieces) {
    const bytesPerChar = p.compressed ? 1 : 2
    const pieceFcEnd = p.fcStart + (p.cpEnd - p.cpStart) * bytesPerChar
    const s = Math.max(fcStart, p.fcStart)
    const e = Math.min(fcEnd, pieceFcEnd)
    if (e <= s) continue
    const cpS = p.cpStart + Math.floor((s - p.fcStart) / bytesPerChar)
    const cpE = p.cpStart + Math.ceil((e - p.fcStart) / bytesPerChar)
    if (cpE > cpS) out.push({ cpStart: cpS, cpEnd: cpE })
  }
  return out
}

/** Read the bin table (PlcBteChpx/PlcBtePapx) and return FKP page numbers with their FC ranges. */
function round131ParseBinTableOracle(
  tableData: Uint8Array,
  fc: number,
  lcb: number,
): Array<{ fcStart: number; fcEnd: number; pn: number }> {
  if (lcb < 12 || fc < 0 || fc + lcb > tableData.length) return []
  // n = (lcb - 4) / 8; tolerate trailing padding by flooring.
  const n = Math.floor((lcb - 4) / 8)
  if (n <= 0 || n > 100000) return []

  const entries: Array<{ fcStart: number; fcEnd: number; pn: number }> = []
  for (let i = 0; i < n; i++) {
    const fcStart = readUint32(tableData, fc + i * 4)
    const fcEnd = readUint32(tableData, fc + (i + 1) * 4)
    if (fcEnd <= fcStart) return [] // aFC must be strictly increasing
    const pnRaw = readUint32(tableData, fc + (n + 1) * 4 + i * 4)
    const pn = pnRaw & 0x3FFFFF
    entries.push({ fcStart, fcEnd, pn })
  }
  return entries
}

/**
 * Parse CHPX runs the spec-level way: bin table → ChpxFkp pages → grpprls,
 * FC ranges converted to CPs via the piece table.
 *
 * @param tableData - The table stream (0Table/1Table).
 * @param wordDocData - The WordDocument stream (FKPs live here).
 * @param fc/lcb - fcPlcfBteChpx / lcbPlcfBteChpx from the FIB.
 * @param pieces - Full piece table for FC→CP conversion.
 */
function round131ParseChpxRunsFromFkpOracle(
  tableData: Uint8Array,
  wordDocData: Uint8Array,
  fc: number,
  lcb: number,
  pieces: PieceFcRange[],
): ChpxRun[] {
  if (pieces.length === 0) return []
  const bins = round131ParseBinTableOracle(tableData, fc, lcb)
  if (bins.length === 0) return []

  const runs: ChpxRun[] = []
  for (const bin of bins) {
    const base = bin.pn * 512
    if (base + 512 > wordDocData.length) continue
    const crun = wordDocData[base + 511]
    // rgfc needs (crun+1)*4 bytes and rgb needs crun bytes; all must fit
    // before the crun byte itself.
    if (crun === 0 || (crun + 1) * 4 + crun > 511) continue

    for (let i = 0; i < crun; i++) {
      const fcStart = readUint32(wordDocData, base + i * 4)
      const fcEnd = readUint32(wordDocData, base + (i + 1) * 4)
      if (fcEnd <= fcStart) continue
      const rgb = wordDocData[base + (crun + 1) * 4 + i]
      if (rgb === 0) continue // no CHPX → inherits from paragraph style
      const chpxOffset = base + rgb * 2
      if (chpxOffset >= base + 511) continue
      const cb = wordDocData[chpxOffset]
      if (cb === 0 || chpxOffset + 1 + cb > base + 512) continue

      const { format, fontIndex, revision, isSpecial, fcPic, istd } =
        parseChpxGrpprlWithFont(wordDocData, chpxOffset + 1, cb)
      if (Object.keys(format).length === 0 && fontIndex === undefined &&
          !revision && !isSpecial && fcPic === undefined && istd === undefined) continue

      for (const cpRange of round131FcRangeToCpRangesOracle(fcStart, fcEnd, pieces)) {
        const run: ChpxRun = { cpStart: cpRange.cpStart, cpEnd: cpRange.cpEnd, format, fontIndex, revision }
        if (isSpecial) run.isSpecial = true
        if (fcPic !== undefined) run.fcPic = fcPic
        if (istd !== undefined) run.istd = istd
        runs.push(run)
      }
    }
  }

  runs.sort((a, b) => a.cpStart - b.cpStart || a.cpEnd - b.cpEnd)
  return runs
}

/**
 * Parse PAPX runs the spec-level way: bin table → PapxFkp pages → grpprls,
 * FC ranges converted to CPs via the piece table.
 */
function round131ParsePapxRunsFromFkpOracle(
  tableData: Uint8Array,
  wordDocData: Uint8Array,
  fc: number,
  lcb: number,
  pieces: PieceFcRange[],
): PapxRun[] {
  if (pieces.length === 0) return []
  const bins = round131ParseBinTableOracle(tableData, fc, lcb)
  if (bins.length === 0) return []

  const runs: PapxRun[] = []
  for (const bin of bins) {
    const base = bin.pn * 512
    if (base + 512 > wordDocData.length) continue
    const cpara = wordDocData[base + 511]
    // rgfc: (cpara+1)*4 bytes; rgbx (BxPap): 13 bytes each.
    if (cpara === 0 || (cpara + 1) * 4 + cpara * 13 > 511) continue

    for (let i = 0; i < cpara; i++) {
      const fcStart = readUint32(wordDocData, base + i * 4)
      const fcEnd = readUint32(wordDocData, base + (i + 1) * 4)
      if (fcEnd <= fcStart) continue
      const bOffset = wordDocData[base + (cpara + 1) * 4 + i * 13]
      if (bOffset === 0) continue // no PAPX → style defaults
      let papxOffset = base + bOffset * 2
      if (papxOffset >= base + 511) continue

      // PapxInFkp: cb (1 byte). cb != 0 → payload 2*cb-1 bytes; cb == 0 →
      // read cb' (next byte), payload 2*cb' bytes. Payload = istd(2) + grpprl.
      const cb = wordDocData[papxOffset]
      let payloadLen: number
      if (cb === 0) {
        const cbPrime = wordDocData[papxOffset + 1]
        payloadLen = cbPrime * 2
        papxOffset += 2
      } else {
        payloadLen = cb * 2 - 1
        papxOffset += 1
      }
      if (payloadLen < 2 || papxOffset + payloadLen > base + 512) continue

      const istd = readUint16(wordDocData, papxOffset)
      const grpprlLen = payloadLen - 2
      const { format, ilvl, ilst, ilfo, table } =
        parsePapxGrpprl(wordDocData, papxOffset + 2, grpprlLen)

      for (const cpRange of round131FcRangeToCpRangesOracle(fcStart, fcEnd, pieces)) {
        const run: PapxRun = { cpStart: cpRange.cpStart, cpEnd: cpRange.cpEnd, format, istd }
        if (ilvl !== undefined) run.ilvl = ilvl
        if (ilst !== undefined) run.ilst = ilst
        if (ilfo !== undefined) run.ilfo = ilfo
        if (table) run.table = table
        runs.push(run)
      }
    }
  }

  runs.sort((a, b) => a.cpStart - b.cpStart || a.cpEnd - b.cpEnd)
  return runs
}

const round131Kinds = ['chpx', 'papx'] as const
type Round131Kind = typeof round131Kinds[number]

function round131Bin(start = 1001, end = 1011, pn = 1): Uint8Array {
  const data = new Uint8Array(12)
  const view = new DataView(data.buffer)
  view.setUint32(0, start, true)
  view.setUint32(4, end, true)
  view.setUint32(8, pn, true)
  return data
}

// 合成布局参考fkpParser.test.ts，仅构造输入，不包含候选FC转换逻辑。
function round131Fkp(kind: Round131Kind, prls: number[] = [0x35, 0x08, 1], start = 1001, end = 1011, cbPrime = false): Uint8Array {
  const data = new Uint8Array(1024)
  const view = new DataView(data.buffer)
  view.setUint32(512, start, true)
  view.setUint32(516, end, true)
  data[520] = 100
  data[1023] = 1
  if (kind === 'chpx') {
    data[712] = prls.length
    data.set(prls, 713)
  } else {
    const payload = [37, 0, ...prls]
    if (cbPrime) {
      if (payload.length % 2) payload.push(0)
      data[712] = 0
      data[713] = payload.length / 2
      data.set(payload, 714)
    } else {
      if (payload.length % 2 === 0) payload.push(0)
      data[712] = (payload.length + 1) / 2
      data.set(payload, 713)
    }
  }
  return data
}

function round131Assert(kind: Round131Kind, table: Uint8Array, word: Uint8Array, pieces: PieceFcRange[], fc = 0, lcb = table.length): ChpxRun[] | PapxRun[] {
  const beforeTable = table.slice()
  const beforeWord = word.slice()
  const beforePieces = pieces.map(piece => ({ ...piece }))
  const candidate = kind === 'chpx' ? parseChpxRunsFromFkp : parsePapxRunsFromFkp
  const oracle = kind === 'chpx' ? round131ParseChpxRunsFromFkpOracle : round131ParsePapxRunsFromFkpOracle
  const actual = candidate(table, word, fc, lcb, pieces)
  const old = oracle(table, word, fc, lcb, pieces)
  deepStrictEqual(actual, old)
  expect(JSON.stringify(actual)).toBe(JSON.stringify(old))
  actual.forEach((run, i) => expect(Object.keys(run)).toEqual(Object.keys(old[i])))
  for (let i = 0; i < actual.length; i++) {
    for (let j = i + 1; j < actual.length; j++) {
      expect(actual[i].format === actual[j].format).toBe(old[i].format === old[j].format)
      if (kind === 'chpx') {
        expect((actual[i] as ChpxRun).revision === (actual[j] as ChpxRun).revision)
          .toBe((old[i] as ChpxRun).revision === (old[j] as ChpxRun).revision)
      } else {
        expect((actual[i] as PapxRun).table === (actual[j] as PapxRun).table)
          .toBe((old[i] as PapxRun).table === (old[j] as PapxRun).table)
      }
    }
  }
  deepStrictEqual(table, beforeTable)
  deepStrictEqual(word, beforeWord)
  deepStrictEqual(pieces, beforePieces)
  return actual
}

const round131Pieces: PieceFcRange[] = [
  { cpStart: 50, cpEnd: 54, fcStart: 1004, compressed: false },
  { cpStart: 0, cpEnd: 5, fcStart: 1000, compressed: true },
  { cpStart: 20, cpEnd: 26, fcStart: 1002, compressed: true },
  { cpStart: 70, cpEnd: 70, fcStart: 1005, compressed: true },
  { cpStart: 80, cpEnd: 85, fcStart: 1011, compressed: true },
  { cpStart: 90, cpEnd: 95, fcStart: 996, compressed: true },
]

const round131FullChpx = [
  0x35, 0x08, 1, 0x4F, 0x4A, 2, 0,
  0x01, 0x08, 1, 0x04, 0x48, 3, 0,
  0x55, 0x08, 1, 0x03, 0x6A, 0, 0, 0, 0, 0x30, 0x4A, 0, 0,
]
const round131FullPapx = [
  0x03, 0x24, 1, 0x0A, 0x26, 0, 0x0E, 0x46, 0, 0,
  0x0B, 0x46, 0, 0, 0x16, 0x24, 1, 0x49, 0x66, 2, 0, 0, 0,
]

// 完整属性及序列化顺序护栏；真实样本引用拓扑按对象组检查，避免O(runs²)。
function round131RealAssert(kind: Round131Kind, table: Uint8Array, word: Uint8Array, pieces: PieceFcRange[], fc: number, lcb: number): number {
  const candidate = kind === 'chpx' ? parseChpxRunsFromFkp : parsePapxRunsFromFkp
  const oracle = kind === 'chpx' ? round131ParseChpxRunsFromFkpOracle : round131ParsePapxRunsFromFkpOracle
  const actual = candidate(table, word, fc, lcb, pieces)
  const old = oracle(table, word, fc, lcb, pieces)
  deepStrictEqual(actual, old)
  expect(JSON.stringify(actual)).toBe(JSON.stringify(old))
  const topology = (runs: (ChpxRun | PapxRun)[], key: 'format' | 'revision' | 'table') => {
    const ids = new Map<unknown, number>()
    return runs.map(run => {
      const value = (run as unknown as Record<string, unknown>)[key]
      if (!ids.has(value)) ids.set(value, ids.size)
      return ids.get(value)
    })
  }
  for (const key of ['format', kind === 'chpx' ? 'revision' : 'table'] as const) {
    deepStrictEqual(topology(actual, key), topology(old, key))
  }
  for (let i = 0; i < actual.length; i++) deepStrictEqual(Object.keys(actual[i]), Object.keys(old[i]))
  return actual.length
}

describe('Round 131 FKP最终run直接构造与独立旧oracle护栏', () => {
  it('27份真实样本两种FKP完整对象、JSON键顺序及引用共享拓扑一致，均有非空产出', () => {
    const docs = new URL('../docs/', import.meta.url)
    const files = readdirSync(docs).filter(name => /\.(doc|dot)$/.test(name)).sort()
    expect(files).toHaveLength(27)
    const totals = { chpx: 0, papx: 0 }
    const nonEmpty = { chpx: 0, papx: 0 }
    for (const name of files) {
      const bytes = readFileSync(new URL(name, docs))
      const ole = new OleParser(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const header = ole.parseHeader()
      const directory = ole.getDirectorySectors(header, ole.getFatSectors(header))
      const word = ole.findWordDocumentStream(directory)?.data
      expect(word, name).toBeDefined()
      if (!word) throw new Error(`缺少WordDocument：${name}`)
      const fib = parseFib(word)
      expect(fib, name).not.toBeNull()
      if (!fib) throw new Error(`缺少FIB：${name}`)
      const table = ole.findTableStream(directory, fib.fWhichTblStm ? 1 : 0)?.data ?? new Uint8Array(0)
      const pieces = parseClxPieces({ maxTotalChars: 10 * 1024 * 1024, readUint16, readUint32 }, table.subarray(fib.fcClx, fib.fcClx + fib.lcbClx))
        .map(p => ({ cpStart: p.cpStart, cpEnd: p.cpEnd, fcStart: p.fcValue, compressed: p.fCompressed }))
      for (const kind of round131Kinds) {
        const fc = kind === 'chpx' ? fib.fcPlcfBteChpx : fib.fcPlcfBtePapx
        const lcb = kind === 'chpx' ? fib.lcbPlcfBteChpx : fib.lcbPlcfBtePapx
        const count = round131RealAssert(kind, table, word, pieces, fc, lcb)
        totals[kind] += count
        if (count > 0) nonEmpty[kind]++
      }
    }
    expect(totals.chpx).toBeGreaterThan(0)
    expect(totals.papx).toBeGreaterThan(0)
    expect(nonEmpty.chpx).toBeGreaterThan(0)
    expect(nonEmpty.papx).toBeGreaterThan(0)
  })

  it.each(round131Kinds)('%s 多piece乱序、overlap、空piece、相切及UTF16奇数结束边界', kind => {
    const prls = kind === 'chpx' ? round131FullChpx : round131FullPapx
    const runs = round131Assert(kind, round131Bin(), round131Fkp(kind, prls), round131Pieces)
    expect(runs.map(run => [run.cpStart, run.cpEnd])).toEqual([[1, 5], [20, 26], [50, 54]])
    expect(runs).toHaveLength(3)
    expect(runs[0].format).toBe(runs[1].format)
    expect(runs[1].format).toBe(runs[2].format)
    if (kind === 'chpx') {
      const chpx = runs as ChpxRun[]
      expect(Object.keys(chpx[0])).toEqual(['cpStart', 'cpEnd', 'format', 'fontIndex', 'revision', 'isSpecial', 'fcPic', 'istd'])
      expect(chpx[0].fontIndex).toBe(2)
      expect(chpx[0].revision).toEqual({ type: 'insert', authorIndex: 3 })
      expect(chpx[0].revision).toBe(chpx[2].revision)
      expect(chpx[0].isSpecial).toBe(true)
      expect(chpx[0].fcPic).toBe(0)
      expect(chpx[0].istd).toBe(0)
    } else {
      const papx = runs as PapxRun[]
      expect(Object.keys(papx[0])).toEqual(['cpStart', 'cpEnd', 'format', 'istd', 'ilvl', 'ilst', 'ilfo', 'table'])
      expect(papx[0].istd).toBe(37)
      expect([papx[0].ilvl, papx[0].ilst, papx[0].ilfo]).toEqual([0, 0, 0])
      expect(papx[0].table).toEqual({ inTable: true, depth: 2 })
      expect(papx[0].table).toBe(papx[2].table)
    }
  })

  it.each(round131Kinds)('%s UTF16奇数起止字节分别floor和ceil且一字节范围不能丢弃', kind => {
    const pieces = [{ cpStart: 10, cpEnd: 20, fcStart: 1000, compressed: false }]
    for (const [start, end, expected] of [[1001, 1003, [10, 12]], [1001, 1002, [10, 11]], [1002, 1003, [11, 12]]]) {
      const runs = round131Assert(kind, round131Bin(start as number, end as number), round131Fkp(kind, kind === 'chpx' ? [0x35, 0x08, 1] : [0x03, 0x24, 1], start as number, end as number), pieces)
      expect(runs.map(run => [run.cpStart, run.cpEnd])).toEqual([expected])
    }
  })

  it('CHPX optional缺席仍保留fontIndex/revision自有undefined键，只有istd也须非空', () => {
    const runs = round131Assert('chpx', round131Bin(), round131Fkp('chpx'), round131Pieces) as ChpxRun[]
    expect(Object.keys(runs[0])).toEqual(['cpStart', 'cpEnd', 'format', 'fontIndex', 'revision'])
    expect(Object.hasOwn(runs[0], 'fontIndex')).toBe(true)
    expect(Object.hasOwn(runs[0], 'revision')).toBe(true)
    expect(Object.hasOwn(runs[0], 'istd')).toBe(false)
    const onlyStyle = round131Assert('chpx', round131Bin(), round131Fkp('chpx', [0x30, 0x4A, 37, 0]), round131Pieces)
    expect(onlyStyle).toHaveLength(3)
    expect((onlyStyle[0] as ChpxRun).istd).toBe(37)
    expect(onlyStyle[0].format).toEqual({})
  })

  it.each([false, true])('PAPX cbPrime=%s optional缺席及空format保持istd', cbPrime => {
    const runs = round131Assert('papx', round131Bin(), round131Fkp('papx', [], 1001, 1011, cbPrime), round131Pieces)
    expect(runs).toHaveLength(3)
    expect(Object.keys(runs[0])).toEqual(['cpStart', 'cpEnd', 'format', 'istd'])
    expect(runs[0].format).toEqual({})
    expect((runs[0] as PapxRun).istd).toBe(37)
  })

  it.each(round131Kinds)('%s 多FKP run稳定sort同CP范围保持输入run次序而不合并引用', kind => {
    const data = new Uint8Array(1536)
    data.set(round131Fkp(kind, kind === 'chpx' ? [0x35, 0x08, 1] : [0x03, 0x24, 1]))
    data.set(round131Fkp(kind, kind === 'chpx' ? [0x36, 0x08, 1] : [0x03, 0x24, 2]).subarray(512), 1024)
    const table = new Uint8Array(20)
    const view = new DataView(table.buffer)
    for (const [offset, value] of [[0, 1000], [4, 1010], [8, 1020], [12, 1], [16, 2]]) view.setUint32(offset, value, true)
    const runs = round131Assert(kind, table, data, [round131Pieces[1]])
    expect(runs).toHaveLength(2)
    expect(runs[0].format).not.toBe(runs[1].format)
    expect(runs[0].format).toEqual(kind === 'chpx' ? { bold: true } : { alignment: 'center' })
    expect(runs[1].format).toEqual(kind === 'chpx' ? { italic: true } : { alignment: 'right' })
  })

  it.each(round131Kinds)('%s 输入不变且跨调用反映可变piece内容，不缓存旧范围', kind => {
    const table = round131Bin()
    const word = round131Fkp(kind)
    const pieces = round131Pieces.map(piece => ({ ...piece }))
    const tableBefore = table.slice()
    const wordBefore = word.slice()
    const piecesBefore = structuredClone(pieces)
    const first = round131Assert(kind, table, word, pieces)
    deepStrictEqual(table, tableBefore)
    deepStrictEqual(word, wordBefore)
    deepStrictEqual(pieces, piecesBefore)
    pieces[0].cpStart += 100
    pieces[0].cpEnd += 100
    const second = round131Assert(kind, table, word, pieces)
    expect(second.map(run => [run.cpStart, run.cpEnd])).toEqual([[1, 5], [20, 26], [150, 154]])
    expect(first.map(run => [run.cpStart, run.cpEnd])).toEqual([[1, 5], [20, 26], [50, 54]])
  })

  it.each(round131Kinds)('%s 穷尽0..16起止偏移及两种编码的578组FC范围', kind => {
    let cases = 0
    for (const compressed of [true, false]) {
      const pieces = [{ cpStart: 10, cpEnd: 16, fcStart: 1004, compressed }]
      for (let start = 0; start <= 16; start++) {
        for (let end = 0; end <= 16; end++) {
          const fcStart = 1000 + start
          const fcEnd = 1000 + end
          const runs = round131Assert(kind, round131Bin(), round131Fkp(kind, undefined, fcStart, fcEnd), pieces)
          const width = compressed ? 1 : 2
          const left = Math.max(fcStart, 1004)
          const right = Math.min(fcEnd, 1004 + 6 * width)
          const expected = right > left ? [[10 + Math.floor((left - 1004) / width), 10 + Math.ceil((right - 1004) / width)]] : []
          deepStrictEqual(runs.map(run => [run.cpStart, run.cpEnd]), expected)
          cases++
        }
      }
    }
    expect(cases).toBe(578)
  })

  it.each(round131Kinds)('%s bin范围不用于裁剪FKP且pn高位被mask及尾部padding容忍', kind => {
    const table = new Uint8Array(15)
    table.set(round131Bin(2000, 2010, 0xFFC00001))
    expect(round131Assert(kind, table, round131Fkp(kind), round131Pieces)).toHaveLength(3)
  })

  it.each(round131Kinds)('%s 无piece、无overlap、空FC、倒退FC及空CP均不产出', kind => {
    const table = round131Bin()
    for (const pieces of [[], [round131Pieces[3]], [round131Pieces[4]], [round131Pieces[5]], [{ cpStart: 1, cpEnd: 0, fcStart: 1000, compressed: true }]]) {
      expect(round131Assert(kind, table, round131Fkp(kind), pieces)).toEqual([])
    }
    for (const [start, end] of [[1001, 1001], [1011, 1001]]) {
      expect(round131Assert(kind, table, round131Fkp(kind, undefined, start, end), round131Pieces)).toEqual([])
    }
  })

  it.each(round131Kinds)('%s 坏bin范围、过短bin、过多bin及越界页均为空', kind => {
    const word = round131Fkp(kind)
    for (const [fc, lcb] of [[-1, 12], [0, 0], [0, 11], [1, 12], [0, 13]]) {
      expect(round131Assert(kind, round131Bin(), word, round131Pieces, fc, lcb)).toEqual([])
    }
    for (const table of [round131Bin(1001, 1001), round131Bin(1011, 1001), round131Bin(1001, 1011, 99), new Uint8Array(800012)]) {
      expect(round131Assert(kind, table, word, round131Pieces)).toEqual([])
    }
    expect(round131Assert(kind, round131Bin(), word.subarray(0, 1023), round131Pieces)).toEqual([])
  })

  it.each(round131Kinds)('%s FKP零run、计数溢出、零offset及payload截断边界', kind => {
    for (const count of [0, 255]) {
      const word = round131Fkp(kind)
      word[1023] = count
      expect(round131Assert(kind, round131Bin(), word, round131Pieces)).toEqual([])
    }
    const noOffset = round131Fkp(kind)
    noOffset[520] = 0
    expect(round131Assert(kind, round131Bin(), noOffset, round131Pieces)).toEqual([])
    const overflow = round131Fkp(kind)
    overflow[520] = 255
    overflow[1022] = 255
    expect(round131Assert(kind, round131Bin(), overflow, round131Pieces)).toEqual([])
    const zeroPayload = round131Fkp(kind)
    zeroPayload[712] = 0
    zeroPayload[713] = 0
    expect(round131Assert(kind, round131Bin(), zeroPayload, round131Pieces)).toEqual([])
    if (kind === 'chpx') {
      expect(round131Assert(kind, round131Bin(), round131Fkp(kind, [0x4B, 0x48, 0x10, 0]), round131Pieces)).toEqual([])
    } else {
      const short = round131Fkp(kind)
      short[712] = 1
      expect(round131Assert(kind, round131Bin(), short, round131Pieces)).toEqual([])
    }
  })
})

// Round 132继承e09fa49独立旧oracle；共用的SPRM解析未变化。
describe('Round 132 FKP相邻检测跳过稳定sort护栏', () => {
  it('27份真实文档直接调用FKP与独立旧oracle一致且66355条输出非空', () => {
    const docs = new URL('../docs/', import.meta.url)
    const files = readdirSync(docs).filter(name => /\.(doc|dot)$/.test(name)).sort()
    expect(files).toHaveLength(27)
    const totals = { chpx: 0, papx: 0 }
    for (const name of files) {
      const bytes = readFileSync(new URL(name, docs))
      const ole = new OleParser(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const header = ole.parseHeader()
      const directory = ole.getDirectorySectors(header, ole.getFatSectors(header))
      const word = ole.findWordDocumentStream(directory)?.data
      if (!word) throw new Error(`缺少WordDocument：${name}`)
      const fib = parseFib(word)
      if (!fib) throw new Error(`缺少FIB：${name}`)
      const table = ole.findTableStream(directory, fib.fWhichTblStm ? 1 : 0)?.data ?? new Uint8Array(0)
      const pieces = parseClxPieces({ maxTotalChars: 10 * 1024 * 1024, readUint16, readUint32 }, table.subarray(fib.fcClx, fib.fcClx + fib.lcbClx))
        .map(p => ({ cpStart: p.cpStart, cpEnd: p.cpEnd, fcStart: p.fcValue, compressed: p.fCompressed }))
      for (const kind of round131Kinds) {
        const fc = kind === 'chpx' ? fib.fcPlcfBteChpx : fib.fcPlcfBtePapx
        const lcb = kind === 'chpx' ? fib.lcbPlcfBteChpx : fib.lcbPlcfBtePapx
        totals[kind] += round131RealAssert(kind, table, word, pieces, fc, lcb)
      }
    }
    // 直接两种FKP入口包含DocParser快速路径未调用的47条CHPX。
    expect(totals).toEqual({ chpx: 26698, papx: 39657 })
  })
  const prlsFor = (kind: Round131Kind) => kind === 'chpx'
    ? [[0x35, 0x08, 1], [0x36, 0x08, 1], [0x3E, 0x2A, 1]]
    : [[0x03, 0x24, 1], [0x03, 0x24, 2], [0x03, 0x24, 0]]
  const formatsFor = (kind: Round131Kind) => kind === 'chpx'
    ? [{ bold: true }, { italic: true }, { underline: true }]
    : [{ alignment: 'center' }, { alignment: 'right' }, { alignment: 'left' }]
  const ranges = (runs: ChpxRun[] | PapxRun[]) => runs.map(run => [run.cpStart, run.cpEnd])

  // 三个相邻FC run分别拥有独立payload，不能靠相同format掩盖稳定tie次序。
  function multiRunFkp(kind: Round131Kind): Uint8Array {
    const prls = prlsFor(kind)
    const data = round131Fkp(kind, prls[0], 1001, 1003)
    const view = new DataView(data.buffer)
    for (let i = 0; i <= prls.length; i++) view.setUint32(512 + i * 4, 1001 + i * 2, true)
    for (let i = 0; i < prls.length; i++) {
      data[512 + (prls.length + 1) * 4 + i * (kind === 'chpx' ? 1 : 13)] = 100 + i * 16
      data.set(round131Fkp(kind, prls[i]).subarray(712, 744), 712 + i * 32)
    }
    data[1023] = prls.length
    return data
  }

  it.each(round131Kinds)('%s 已排序pieces保留正序，压缩与UTF16均有四条输出', kind => {
    for (const compressed of [true, false]) {
      const pieces = [0, 10, 20, 30].map(cpStart => ({ cpStart, cpEnd: cpStart + 3, fcStart: 1001, compressed }))
      const runs = round131Assert(kind, round131Bin(), round131Fkp(kind, prlsFor(kind)[0]), pieces)
      expect(runs).toHaveLength(4)
      expect(ranges(runs)).toEqual([[0, 3], [10, 13], [20, 23], [30, 33]])
      expect(runs.map(run => run.format)).toEqual(Array(4).fill(formatsFor(kind)[0]))
    }
  })

  it.each(round131Kinds)('%s 完全反序pieces必须回退完整排序', kind => {
    const pieces = [30, 20, 10, 0].map(cpStart => ({ cpStart, cpEnd: cpStart + 3, fcStart: 1001, compressed: true }))
    const runs = round131Assert(kind, round131Bin(), round131Fkp(kind, prlsFor(kind)[0]), pieces)
    expect(runs).toHaveLength(4)
    expect(ranges(runs)).toEqual([[0, 3], [10, 13], [20, 23], [30, 33]])
  })

  it.each(round131Kinds)('%s 同cpStart时cpEnd既检测逆序也决定二级排序', kind => {
    for (const ends of [[13, 16, 20], [20, 16, 13], [13, 20, 16]]) {
      const pieces = ends.map(cpEnd => ({ cpStart: 10, cpEnd, fcStart: 1001, compressed: true }))
      const runs = round131Assert(kind, round131Bin(), round131Fkp(kind, prlsFor(kind)[0]), pieces)
      expect(runs).toHaveLength(3)
      expect(ranges(runs)).toEqual([[10, 13], [10, 16], [10, 20]])
    }
  })

  it.each(round131Kinds)('%s cpStart优先级不能被较小cpEnd覆盖', kind => {
    const pieces = [
      { cpStart: 5, cpEnd: 6, fcStart: 1001, compressed: true },
      { cpStart: 0, cpEnd: 10, fcStart: 1001, compressed: true },
      { cpStart: 3, cpEnd: 4, fcStart: 1001, compressed: true },
    ]
    const runs = round131Assert(kind, round131Bin(), round131Fkp(kind, prlsFor(kind)[0]), pieces)
    expect(runs).toHaveLength(3)
    expect(ranges(runs)).toEqual([[0, 10], [3, 4], [5, 6]])
  })

  it.each(round131Kinds)('%s 多run FKP已排序同key保持三个不同format的输入次序', kind => {
    const pieces = [1001, 1003, 1005].map(fcStart => ({ cpStart: 20, cpEnd: 22, fcStart, compressed: true }))
    const runs = round131Assert(kind, round131Bin(1001, 1007), multiRunFkp(kind), pieces)
    expect(runs).toHaveLength(3)
    expect(ranges(runs)).toEqual([[20, 22], [20, 22], [20, 22]])
    expect(runs.map(run => run.format)).toEqual(formatsFor(kind))
    expect(new Set(runs.map(run => run.format)).size).toBe(3)
  })

  it.each(round131Kinds)('%s 多run FKP跨run逆序回退后同key仍稳定且保留format引用', kind => {
    const pieces = [
      ...[1001, 1003, 1005].map(fcStart => ({ cpStart: 20, cpEnd: 22, fcStart, compressed: true })),
      { cpStart: 0, cpEnd: 2, fcStart: 1003, compressed: true },
    ]
    const runs = round131Assert(kind, round131Bin(1001, 1007), multiRunFkp(kind), pieces)
    const [first, second, third] = formatsFor(kind)
    expect(runs).toHaveLength(4)
    expect(ranges(runs)).toEqual([[0, 2], [20, 22], [20, 22], [20, 22]])
    expect(runs.map(run => run.format)).toEqual([second, first, second, third])
    expect(runs[0].format).toBe(runs[2].format)
    expect(new Set(runs.map(run => run.format)).size).toBe(3)
  })

  it.each(round131Kinds)('%s 跨bin引用FKP页次序乱序必须恢复CP及format次序', kind => {
    const table = new Uint8Array(28)
    const view = new DataView(table.buffer)
    for (const [offset, value] of [[0, 1001], [4, 1003], [8, 1005], [12, 1007], [16, 2], [20, 1], [24, 3]]) {
      view.setUint32(offset, value, true)
    }
    const word = new Uint8Array(2048)
    const pieces: PieceFcRange[] = []
    for (let i = 0; i < 3; i++) {
      word.set(round131Fkp(kind, prlsFor(kind)[i], 1001 + i * 2, 1003 + i * 2).subarray(512), (i + 1) * 512)
      pieces.push({ cpStart: i * 10, cpEnd: i * 10 + 2, fcStart: 1001 + i * 2, compressed: true })
    }
    const runs = round131Assert(kind, table, word, pieces)
    expect(runs).toHaveLength(3)
    expect(ranges(runs)).toEqual([[0, 2], [10, 12], [20, 22]])
    expect(runs.map(run => run.format)).toEqual(formatsFor(kind))
  })

  it.each(round131Kinds)('%s 唯一逆序出现在最后一对时不可提前结束检测', kind => {
    const pieces = [0, 10, 20, 30, 25].map(cpStart => ({ cpStart, cpEnd: cpStart + 2, fcStart: 1001, compressed: true }))
    const runs = round131Assert(kind, round131Bin(), round131Fkp(kind, prlsFor(kind)[0]), pieces)
    expect(runs).toHaveLength(5)
    expect(ranges(runs)).toEqual([[0, 2], [10, 12], [20, 22], [25, 27], [30, 32]])
  })

  it.each(round131Kinds)('%s 空和单输出边界，以及冻结pieces重复调用均不修改输入', kind => {
    const table = round131Bin()
    const word = round131Fkp(kind, prlsFor(kind)[0])
    const tableBefore = table.slice()
    const wordBefore = word.slice()
    for (const starts of [[], [10], [30, 10, 20]]) {
      const pieces = starts.map(cpStart => Object.freeze({ cpStart, cpEnd: cpStart + 2, fcStart: 1001, compressed: true }))
      Object.freeze(pieces)
      const first = round131Assert(kind, table, word, pieces)
      const second = round131Assert(kind, table, word, pieces)
      expect(first).toHaveLength(starts.length)
      expect(second).toHaveLength(starts.length)
      const expected = starts.length === 3 ? [[10, 12], [20, 22], [30, 32]] : starts.length === 1 ? [[10, 12]] : []
      expect(ranges(first)).toEqual(expected)
      expect(ranges(second)).toEqual(expected)
      deepStrictEqual(first, second)
      if (first.length) {
        expect(first[0].format).toEqual(formatsFor(kind)[0])
        expect(first[0]).not.toBe(second[0])
        expect(first[0].format).not.toBe(second[0].format)
      }
    }
    deepStrictEqual(table, tableBefore)
    deepStrictEqual(word, wordBefore)
  })

  it.each(round131Kinds)('%s 公开pieces中的NaN和正负Infinity保持旧oracle过滤及有效run排序', kind => {
    for (const field of ['cpStart', 'cpEnd', 'fcStart'] as const) {
      for (const value of [NaN, Infinity, -Infinity]) {
        const pieces = [
          { cpStart: 10, cpEnd: 14, fcStart: 1001, compressed: true },
          { cpStart: 20, cpEnd: 24, fcStart: 1001, compressed: true, [field]: value },
          { cpStart: 0, cpEnd: 4, fcStart: 1001, compressed: true },
        ]
        const runs = round131Assert(kind, round131Bin(), round131Fkp(kind, prlsFor(kind)[0]), pieces)
        const expected = field === 'cpEnd' && value === Infinity ? [[0, 4], [10, 14], [20, 30]] : [[0, 4], [10, 14]]
        expect(runs).toHaveLength(expected.length)
        expect(ranges(runs)).toEqual(expected)
        expect(runs.map(run => run.format)).toEqual(Array(expected.length).fill(formatsFor(kind)[0]))
      }
    }
  })
})

// Round134：逐字复制HEAD旧函数，仅去掉export并改函数名，控制脚本机器核对。
// 普通对象差分之外，固定getter/Proxy读取次数和异常语义，防止重采纳已否决的短路交换。
function round134OldMergeCharFormatForParagraph(
  runs: ChpxRun[],
  cpStart: number,
  cpEnd: number,
  fontNames?: string[],
  styleFormats?: ReadonlyMap<number, Partial<CharacterFormat>>,
): Partial<CharacterFormat> {
  const totalChars = cpEnd - cpStart
  if (totalChars <= 0 || runs.length === 0) return {}

  // Collect properties from runs that overlap the paragraph.
  let boldCount = 0
  let italicCount = 0
  let underlineCount = 0
  let strikethroughCount = 0
  let superscriptCount = 0
  let subscriptCount = 0
  let smallCapsCount = 0
  let allCapsCount = 0
  let fontSizeSum = 0
  let fontSizeCount = 0
  let firstColor: string | undefined
  let firstHighlight: string | undefined
  let firstFontName: string | undefined

  // runs are sorted by cpStart and cpEnd (aCP is strictly increasing), so binary-search
  // the first run that can overlap [cpStart, cpEnd) and stop as soon as runs move past
  // the paragraph. This turns the per-paragraph cost from O(runs) into O(log runs +
  // overlapping), avoiding the O(paragraphs * runs) blow-up on text-heavy documents.
  let lo = 0
  let hi = runs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (runs[mid].cpEnd > cpStart) hi = mid
    else lo = mid + 1
  }
  for (let ri = lo; ri < runs.length; ri++) {
    const run = runs[ri]
    if (run.cpStart >= cpEnd) break
    const overlapStart = run.cpStart > cpStart ? run.cpStart : cpStart
    const overlapEnd = run.cpEnd < cpEnd ? run.cpEnd : cpEnd
    if (overlapEnd <= overlapStart) continue
    const len = overlapEnd - overlapStart
    const styleFormat = run.istd !== undefined ? styleFormats?.get(run.istd) : undefined
    const format = styleFormat ? { ...styleFormat, ...run.format } : run.format
    if (format.bold) boldCount += len
    if (format.italic) italicCount += len
    if (format.underline) underlineCount += len
    if (format.strikethrough) strikethroughCount += len
    if (format.superscript) superscriptCount += len
    if (format.subscript) subscriptCount += len
    if (format.smallCaps) smallCapsCount += len
    if (format.allCaps) allCapsCount += len
    if (format.fontSize !== undefined) {
      fontSizeSum += format.fontSize * len
      fontSizeCount += len
    }
    if (format.color && !firstColor) firstColor = format.color
    if (format.highlight && !firstHighlight) firstHighlight = format.highlight
    // Font name from font index
    if (run.fontIndex !== undefined && fontNames && !firstFontName) {
      const fontName = fontNames[run.fontIndex]
      if (fontName) firstFontName = fontName
    }
    if (!firstFontName && format.fontName) firstFontName = format.fontName
  }

  const result: Partial<CharacterFormat> = {}
  if (boldCount > totalChars * 0.5) result.bold = true
  if (italicCount > totalChars * 0.3) result.italic = true
  if (underlineCount > totalChars * 0.3) result.underline = true
  if (strikethroughCount > totalChars * 0.3) result.strikethrough = true
  if (superscriptCount > totalChars * 0.3) result.superscript = true
  if (subscriptCount > totalChars * 0.3) result.subscript = true
  if (smallCapsCount > totalChars * 0.5) result.smallCaps = true
  if (allCapsCount > totalChars * 0.5) result.allCaps = true
  if (fontSizeCount > totalChars * 0.5 && fontSizeCount > 0) {
    result.fontSize = Math.round(fontSizeSum / fontSizeCount)
  }
  if (firstColor) result.color = firstColor
  if (firstHighlight) result.highlight = firstHighlight
  if (firstFontName) result.fontName = firstFontName

  return result
}

function round134Assert(
  runs: ChpxRun[], cpStart: number, cpEnd: number,
  fontNames?: string[], styleFormats?: ReadonlyMap<number, Partial<CharacterFormat>>,
): Partial<CharacterFormat> {
  const before = structuredClone({ runs, fontNames, styles: styleFormats ? [...styleFormats] : undefined })
  const runRefs = runs.slice()
  const formatRefs = runs.map(run => run.format)
  const styleRefs = styleFormats ? [...styleFormats.values()] : undefined
  const expected = round134OldMergeCharFormatForParagraph(runs, cpStart, cpEnd, fontNames, styleFormats)
  const actual = mergeCharFormatForParagraph(runs, cpStart, cpEnd, fontNames, styleFormats)
  deepStrictEqual(actual, expected)
  expect(Object.keys(actual)).toEqual(Object.keys(expected))
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
  deepStrictEqual({ runs, fontNames, styles: styleFormats ? [...styleFormats] : undefined }, before)
  for (let i = 0; i < runs.length; i++) {
    expect(runs[i]).toBe(runRefs[i])
    expect(runs[i].format).toBe(formatRefs[i])
    expect(actual).not.toBe(runs[i].format)
  }
  if (styleFormats) {
    for (const [i, format] of [...styleFormats.values()].entries()) expect(format).toBe(styleRefs![i])
  }
  return actual
}

const round134Run = (cpStart: number, cpEnd: number, format: Partial<CharacterFormat>, extra: Partial<ChpxRun> = {}): ChpxRun =>
  ({ cpStart, cpEnd, format, ...extra })

describe('Round134 段落首个颜色与高亮短路的普通数据对象等价护栏', () => {
  it('完整结果与固定JSON键序保留全部摘要字段，不泄露无关样式字段', () => {
    const format: Partial<CharacterFormat> = {
      bold: true, italic: true, underline: true, strikethrough: true,
      superscript: true, subscript: true, smallCaps: true, allCaps: true,
      fontSize: 13.5, color: '#123456', highlight: '#ABCDEF', fontName: '段落字体',
      hidden: true, outline: true, shadow: true, letterSpacing: 2,
    }
    const actual = round134Assert([round134Run(0, 10, format)], 0, 10)
    expect(actual).toEqual({
      bold: true, italic: true, underline: true, strikethrough: true,
      superscript: true, subscript: true, smallCaps: true, allCaps: true,
      fontSize: 14, color: '#123456', highlight: '#ABCDEF', fontName: '段落字体',
    })
    expect(Object.keys(actual)).toEqual(['bold', 'italic', 'underline', 'strikethrough', 'superscript', 'subscript', 'smallCaps', 'allCaps', 'fontSize', 'color', 'highlight', 'fontName'])
  })

  it('颜色和高亮分别选择首次truthy，后续更长run也不能覆盖', () => {
    const runs = [
      round134Run(0, 1, { color: '', highlight: '#first-highlight' }),
      round134Run(1, 2, { color: '#first-color', highlight: '#second-highlight' }),
      round134Run(2, 100, { color: '#last-color', highlight: '#last-highlight' }),
    ]
    expect(round134Assert(runs, 0, 100)).toEqual({ color: '#first-color', highlight: '#first-highlight' })
  })

  it('缺失、显式undefined和空色空高亮均不占据首个有效值且全空时不输出键', () => {
    const runs = [round134Run(0, 2, {}), round134Run(2, 4, { color: undefined, highlight: undefined }), round134Run(4, 6, { color: '', highlight: '' })]
    expect(round134Assert(runs, 0, 6)).toEqual({})
    runs.push(round134Run(6, 8, { color: '#valid', highlight: '#valid-highlight' }))
    expect(round134Assert(runs, 0, 8)).toEqual({ color: '#valid', highlight: '#valid-highlight' })
  })

  it('半开overlap边界忽略相接与零长run，裁剪后首值和权重仍正确', () => {
    const runs = [
      round134Run(0, 10, { color: '#outside-before', highlight: '#outside-before' }),
      round134Run(10, 10, { color: '#zero', highlight: '#zero' }),
      round134Run(10, 12, { color: '#inside', highlight: '#inside-highlight', bold: true, fontSize: 10 }),
      round134Run(12, 20, { color: '#later', highlight: '#later-highlight', fontSize: 20 }),
      round134Run(20, 30, { color: '#outside-after', highlight: '#outside-after' }),
    ]
    expect(round134Assert(runs, 10, 20)).toEqual({ fontSize: 18, color: '#inside', highlight: '#inside-highlight' })
    expect(round134Assert(runs, 11, 13)).toEqual({ fontSize: 15, color: '#inside', highlight: '#inside-highlight' })
    expect(round134Assert(runs, 30, 40)).toEqual({})
  })

  it('字符直接格式覆盖样式，false和显式undefined抹掉样式，空字符串允许后续值', () => {
    const styles = new Map<number, Partial<CharacterFormat>>([[7, { bold: true, fontSize: 18, color: '#style', highlight: '#style-highlight', fontName: '样式字体' }]])
    const runs = [
      round134Run(0, 6, { bold: false, fontSize: undefined, color: undefined, highlight: '', fontName: undefined }, { istd: 7 }),
      round134Run(6, 10, { color: '#direct', highlight: '#direct-highlight' }, { istd: 7 }),
    ]
    expect(round134Assert(runs, 0, 10, undefined, styles)).toEqual({ color: '#direct', highlight: '#direct-highlight', fontName: '样式字体' })
    expect(round134Assert([round134Run(0, 10, { color: '#direct', highlight: '#direct-highlight' }, { istd: 7 })], 0, 10, undefined, styles))
      .toEqual({ bold: true, fontSize: 18, color: '#direct', highlight: '#direct-highlight', fontName: '样式字体' })
  })

  it('512组字段组合交叉覆盖truthy布尔、样式优先级、颜色高亮及字号权重', () => {
    for (let mask = 0; mask < 512; mask++) {
      const booleans = ['bold', 'italic', 'underline', 'strikethrough', 'superscript', 'subscript', 'smallCaps', 'allCaps'] as const
      const format: Partial<CharacterFormat> = {}
      for (const [i, key] of booleans.entries()) format[key] = (mask & (1 << i)) !== 0
      format.color = [undefined, '', '#first', '#other'][mask % 4]
      format.highlight = [undefined, '#highlight', '', '#alternate'][(mask >> 2) % 4]
      format.fontSize = [undefined, 0, 11.5, 24][(mask >> 4) % 4]
      const styles = new Map<number, Partial<CharacterFormat>>([[3, { bold: true, italic: true, color: '#style', highlight: '#style-highlight', fontSize: 16 }]])
      const runs = [
        round134Run(0, 4, format, { istd: mask & 256 ? 3 : undefined }),
        round134Run(4, 10, { color: '#fallback', highlight: '#fallback-highlight', fontSize: 20, fontName: '回退字体' }),
      ]
      round134Assert(runs, 0, 10, undefined, styles)
      round134Assert(runs, 3, 7, [], styles)
    }
  })

  it('30%与50%严格阈值、缺失字号和加权四舍五入不受首值短路影响', () => {
    const keys = ['bold', 'italic', 'underline', 'strikethrough', 'superscript', 'subscript', 'smallCaps', 'allCaps'] as const
    for (const key of keys) {
      const threshold = ['bold', 'smallCaps', 'allCaps'].includes(key) ? 5 : 3
      for (const length of [threshold, threshold + 1]) {
        const actual = round134Assert([round134Run(0, length, { [key]: true, color: '#first', highlight: '#first-highlight' })], 0, 10)
        expect(actual[key]).toBe(length > threshold ? true : undefined)
      }
    }
    expect(round134Assert([round134Run(0, 5, { fontSize: 13 })], 0, 10)).toEqual({})
    expect(round134Assert([round134Run(0, 3, { fontSize: 10 }), round134Run(3, 6, { fontSize: 15 })], 0, 10)).toEqual({ fontSize: 13 })
  })

  it('字体索引优先与缺失样式回退保持完整输出，冻结输入及重复调用不改变引用', () => {
    const styles = new Map<number, Partial<CharacterFormat>>([[0, Object.freeze({ color: '#style', highlight: '#style-highlight' })]])
    const runs = [
      Object.freeze(round134Run(0, 2, Object.freeze({ fontName: '', color: '', highlight: '' }), { fontIndex: -1, istd: 99 })),
      Object.freeze(round134Run(2, 8, Object.freeze({ fontName: '直接字体' }), { fontIndex: 1, istd: 0 })),
    ]
    const names = ['', '索引字体']
    Object.freeze(runs)
    Object.freeze(names)
    const first = round134Assert(runs, 0, 8, names, styles)
    const second = round134Assert(runs, 0, 8, names, styles)
    expect(first).toEqual({ color: '#style', highlight: '#style-highlight', fontName: '索引字体' })
    expect(first).not.toBe(second)
  })

  it('跨调用修改普通run、样式和字体数组立即可见，首值状态不跨段落缓存', () => {
    const runs = [round134Run(0, 5, { color: '#before', highlight: '#before-highlight' }, { fontIndex: 0, istd: 1 }), round134Run(5, 10, { color: '#tail', highlight: '#tail-highlight' })]
    const names = ['旧字体']
    const styles = new Map<number, Partial<CharacterFormat>>([[1, { bold: true }]])
    expect(round134Assert(runs, 0, 5, names, styles)).toEqual({ bold: true, color: '#before', highlight: '#before-highlight', fontName: '旧字体' })
    runs[0].format.color = ''
    runs[0].format.highlight = undefined
    names[0] = '新字体'
    styles.set(1, { italic: true })
    expect(round134Assert(runs, 0, 10, names, styles)).toEqual({ italic: true, color: '#tail', highlight: '#tail-highlight', fontName: '新字体' })
    expect(round134Assert(runs, 5, 10, names, styles)).toEqual({ color: '#tail', highlight: '#tail-highlight' })
  })

  it('27份真实FKP字符run汇总与独立旧oracle一致且产出非空', () => {
    const docs = new URL('../docs/', import.meta.url)
    const files = readdirSync(docs).filter(name => /\.(doc|dot)$/.test(name)).sort()
    expect(files).toHaveLength(27)
    let totalRuns = 0
    let calls = 0
    let nonempty = 0
    for (const name of files) {
      const bytes = readFileSync(new URL(name, docs))
      const ole = new OleParser(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const header = ole.parseHeader()
      const directory = ole.getDirectorySectors(header, ole.getFatSectors(header))
      const word = ole.findWordDocumentStream(directory)?.data
      if (!word) throw new Error(`缺少WordDocument：${name}`)
      const fib = parseFib(word)
      if (!fib) throw new Error(`缺少FIB：${name}`)
      const table = ole.findTableStream(directory, fib.fWhichTblStm ? 1 : 0)?.data ?? new Uint8Array(0)
      const pieces = parseClxPieces({ maxTotalChars: 10 * 1024 * 1024, readUint16, readUint32 }, table.subarray(fib.fcClx, fib.fcClx + fib.lcbClx))
        .map(p => ({ cpStart: p.cpStart, cpEnd: p.cpEnd, fcStart: p.fcValue, compressed: p.fCompressed }))
      const runs = parseChpxRunsFromFkp(table, word, fib.fcPlcfBteChpx, fib.lcbPlcfBteChpx, pieces)
      totalRuns += runs.length
      // 每个真实文档前100个run的单run段落范围，不冒称覆盖实际33702次段落调用。
      for (const run of runs.slice(0, 100)) {
        const actual = round134Assert([run], run.cpStart, run.cpEnd)
        calls++
        if (Object.keys(actual).length) nonempty++
      }
    }
    expect(totalRuns).toBe(26698)
    expect(calls).toBeGreaterThan(0)
    expect(nonempty).toBeGreaterThan(0)
  })

  it('getter与Proxy保留后续颜色高亮读取次数及异常，拒绝短路顺序交换', () => {
    for (const proxy of [false, true]) {
      const makeRuns = () => {
        const reads = { color: 0, highlight: 0 }
        const later = proxy
          ? new Proxy({ color: '#later', highlight: '#later-highlight' }, {
            get(target, key, receiver) {
              if (key === 'color' || key === 'highlight') reads[key]++
              return Reflect.get(target, key, receiver)
            },
          })
          : {
            get color() { reads.color++; return '#later' },
            get highlight() { reads.highlight++; return '#later-highlight' },
          }
        return { runs: [round134Run(0, 1, { color: '#first', highlight: '#first-highlight' }), round134Run(1, 2, later)], reads }
      }
      const oldInput = makeRuns()
      const newInput = makeRuns()
      const expected = round134OldMergeCharFormatForParagraph(oldInput.runs, 0, 2)
      const actual = mergeCharFormatForParagraph(newInput.runs, 0, 2)
      deepStrictEqual(actual, expected)
      expect(oldInput.reads).toEqual({ color: 1, highlight: 1 })
      // 已否决的短路顺序交换会变成0次；当前实现和慢等价控制必须保留读取。
      expect(newInput.reads).toEqual(oldInput.reads)
    }
    const sentinel = new Error('后续getter异常不属于普通数据对象承诺')
    const runs = [round134Run(0, 1, { color: '#first' }), round134Run(1, 2, { get color(): string { throw sentinel } })]
    expect(() => round134OldMergeCharFormatForParagraph(runs, 0, 2)).toThrow(sentinel)
    // 公开函数不得静默跳过调用方后续getter异常。
    expect(() => mergeCharFormatForParagraph(runs, 0, 2)).toThrow(sentinel)
  })

  it('空、反向与非有限段落范围保持旧结果，非法format异常不污染后续普通调用', () => {
    const runs = [round134Run(0, 10, { color: '#color', highlight: '#highlight', fontSize: 12 })]
    for (const [start, end] of [[0, 0], [10, 0], [NaN, 10], [0, NaN], [-Infinity, 10], [0, Infinity], [Infinity, Infinity]]) round134Assert(runs, start, end)
    expect(round134Assert([], 0, 10)).toEqual({})
    const invalid = [round134Run(0, 10, null as unknown as Partial<CharacterFormat>)]
    for (const merge of [round134OldMergeCharFormatForParagraph, mergeCharFormatForParagraph]) {
      expect(() => merge(invalid, 0, 10)).toThrow(TypeError)
      expect(merge(invalid, 0, 0)).toEqual({})
      expect(merge(invalid, 10, 20)).toEqual({})
    }
    expect(round134Assert(runs, 0, 10)).toEqual({ fontSize: 12, color: '#color', highlight: '#highlight' })
  })
})
