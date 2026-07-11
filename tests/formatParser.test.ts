import { describe, it, expect } from 'vitest'
import { parseChpxRuns, parsePapxRuns, mergeCharFormatForParagraph } from '../src/utils/formatParser'

/**
 * Build a PlcfBteChpx test fixture from a list of (cpStart, bold, fontSize) tuples.
 *
 * Layout:
 *   aCP: (n+1) * 4 bytes
 *   aPcb: n * CHPX entries (each: cbOffset(2) + grpprl)
 */
function buildPlcfBteChpx(entries: Array<{ cpStart: number; bold?: boolean; italic?: boolean; fontSize?: number; underline?: boolean }>): Uint8Array {
  const n = entries.length
  // Build the aPcb bytes first so we know offsets.
  const aPcbParts: Uint8Array[] = []
  for (const entry of entries) {
    const prls: number[] = []
    if (entry.bold !== undefined) {
      // sprmCFBold = 0x0801, ToggleOperand(1 byte)
      prls.push(0x01, 0x08, entry.bold ? 0x01 : 0x00)
    }
    if (entry.italic !== undefined) {
      prls.push(0x02, 0x08, entry.italic ? 0x01 : 0x00)
    }
    if (entry.underline !== undefined) {
      // sprmCFUnderline = 0x0815, 1-byte operand
      prls.push(0x15, 0x08, entry.underline ? 0x01 : 0x00)
    }
    if (entry.fontSize !== undefined) {
      // sprmHps = 0x0816, 2-byte operand (half-points)
      const hps = entry.fontSize * 2
      prls.push(0x16, 0x08, hps & 0xFF, (hps >> 8) & 0xFF)
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
      // sprmPJc = 0x2401, 1-byte operand
      const jc = entry.alignment === 'left' ? 0
        : entry.alignment === 'center' ? 1
          : entry.alignment === 'right' ? 2
            : 3
      prls.push(0x01, 0x24, jc)
    }
    if (entry.indent !== undefined) {
      // sprmPDxaLeft = 0x2402, 2-byte signed operand (twips)
      const twips = Math.round(entry.indent * 20)
      prls.push(0x02, 0x24, twips & 0xFF, (twips >> 8) & 0xFF)
    }
    if (entry.tabs !== undefined && entry.tabs.length > 0) {
      // sprmPDxaTab = 0x2417, variable-length (spra=6)
      // Format: first byte = length of remaining data (excluding first byte)
      // Each tab: dxaTab(2) + jcTab(1) + tlc(1) = 4 bytes
      const tabCount = entry.tabs.length
      const tabDataSize = tabCount * 4
      const lengthByte = tabDataSize // This is the first byte value (length of rest)
      prls.push(0x17, 0x24, lengthByte) // SPRM + length indicator
      for (const tabPt of entry.tabs) {
        const twips = Math.round(tabPt * 20)
        prls.push(twips & 0xFF, (twips >> 8) & 0xFF, 0x00, 0x00) // dxaTab + jcTab(0) + tlc(0)
      }
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
})
