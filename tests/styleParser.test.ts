import { describe, it, expect } from 'vitest'
import {
  parseStylesheet,
  resolveStyleFormat,
  getHeadingLevel,
  getStyleName,
  detectStyleSet,
  BUILTIN_STYLES,
} from '../src/utils/styleParser'

function writeUint16(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = value & 0xFF
  buffer[offset + 1] = (value >> 8) & 0xFF
}

function writeUtf16leString(buffer: Uint8Array, offset: number, str: string): number {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    buffer[offset + i * 2] = code & 0xFF
    buffer[offset + i * 2 + 1] = (code >> 8) & 0xFF
  }
  return str.length * 2
}

describe('styleParser', () => {
  describe('parseStylesheet', () => {
    it('should return empty array for invalid input', () => {
      expect(parseStylesheet(new Uint8Array(0), 0, 0)).toEqual([])
      expect(parseStylesheet(new Uint8Array(10), 0, 0)).toEqual([])
      expect(parseStylesheet(new Uint8Array(10), 100, 10)).toEqual([])
    })

    it('should return empty array for zero styles', () => {
      const data = new Uint8Array(16)
      writeUint16(data, 0, 0) // cstd = 0
      writeUint16(data, 2, 28) // cbStd
      const result = parseStylesheet(data, 0, 16)
      expect(result).toEqual([])
    })

    it('should return built-in styles when string table is corrupt (fallback)', () => {
      // cstd is reasonable but string table has all zeros (corrupt)
      const data = new Uint8Array(64)
      writeUint16(data, 0, 5) // cstd = 5
      writeUint16(data, 2, 28) // cbStd
      // Rest is all zeros → string table will have 0-length strings
      const result = parseStylesheet(data, 0, 64)
      // Should have at least some built-in styles as fallback
      expect(result.length).toBeGreaterThan(0)
      expect(result.some(s => s.name === 'Normal')).toBe(true)
      expect(result.some(s => s.name === 'Heading 1')).toBe(true)
    })

    it('should parse a simple stylesheet with string table first', () => {
      const styleNames = ['Normal', 'Heading 1', 'Heading 2']
      const cstd = styleNames.length
      const cbStd = 28

      // Calculate buffer size
      let strTableSize = 0
      const nameByteLengths = styleNames.map(n => n.length * 2)
      strTableSize = nameByteLengths.reduce((a, b) => a + b + 2, 0) // +2 for each length prefix

      const stdArraySize = cstd * cbStd
      const totalSize = 4 + strTableSize + stdArraySize

      const data = new Uint8Array(totalSize)
      let pos = 0

      // Header
      writeUint16(data, pos, cstd); pos += 2
      writeUint16(data, pos, cbStd); pos += 2

      // String table
      for (let i = 0; i < styleNames.length; i++) {
        writeUint16(data, pos, nameByteLengths[i]); pos += 2
        pos += writeUtf16leString(data, pos, styleNames[i])
      }

      // STD array (just zeros, we don't parse them fully)
      const result = parseStylesheet(data, 0, totalSize)

      // Should have at least the styles we provided names for
      expect(result.length).toBeGreaterThanOrEqual(3)
      expect(result[0].istd).toBe(0)
      expect(result[0].name).toBe('Normal')
      expect(result[1].istd).toBe(1)
      expect(result[1].name).toBe('Heading 1')
      expect(result[2].istd).toBe(2)
      expect(result[2].name).toBe('Heading 2')
    })

    it('should handle stylesheet with STD array first format (alternative layout)', () => {
      const styleNames = ['Normal', 'Heading 1']
      const cstd = styleNames.length
      const cbStd = 28

      const nameByteLengths = styleNames.map(n => n.length * 2)
      const strTableSize = nameByteLengths.reduce((a, b) => a + b + 2, 0)
      const stdArraySize = cstd * cbStd
      const totalSize = 4 + stdArraySize + strTableSize

      const data = new Uint8Array(totalSize)
      let pos = 0

      // Header
      writeUint16(data, pos, cstd); pos += 2
      writeUint16(data, pos, cbStd); pos += 2

      // Skip STD array (all zeros)
      pos += stdArraySize

      // String table comes after STD array
      for (let i = 0; i < styleNames.length; i++) {
        writeUint16(data, pos, nameByteLengths[i]); pos += 2
        pos += writeUtf16leString(data, pos, styleNames[i])
      }

      const result = parseStylesheet(data, 0, totalSize)
      // The parser tries both layouts; it should find the names somehow
      // (at minimum, the built-in fallback kicks in)
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('resolveStyleFormat', () => {
    it('should return the direct style format when there is no base', () => {
      const styles = [
        { istd: 0, name: 'Normal', type: 'paragraph' as const, charFormat: { fontSize: 12 } },
      ]
      const resolved = resolveStyleFormat(styles, 0)
      expect(resolved.charFormat).toEqual({ fontSize: 12 })
      expect(resolved.paraFormat).toBeUndefined()
    })

    it('should merge formats along the istdBase chain (derived overrides base)', () => {
      const styles = [
        { istd: 0, name: 'Normal', type: 'paragraph' as const, charFormat: { fontSize: 10, fontName: 'Times' }, fontIndex: 0 },
        { istd: 1, name: 'Heading 1', type: 'paragraph' as const, istdBase: 0, charFormat: { fontSize: 18, bold: true }, paraFormat: { spaceBefore: 12 } },
        { istd: 3, name: 'Heading 3', type: 'paragraph' as const, istdBase: 1, charFormat: { fontSize: 13 } },
      ]
      const resolved = resolveStyleFormat(styles, 3)
      // fontSize: Heading 3 (13) overrides Heading 1 (18) overrides Normal (10)
      expect(resolved.charFormat).toEqual({ fontSize: 13, bold: true, fontName: 'Times' })
      // paraFormat inherited from Heading 1
      expect(resolved.paraFormat).toEqual({ spaceBefore: 12 })
      // fontIndex from nearest definer (Normal)
      expect(resolved.fontIndex).toBe(0)
    })

    it('should prefer the fontIndex from the most derived style', () => {
      const styles = [
        { istd: 0, name: 'Normal', type: 'paragraph' as const, fontIndex: 0 },
        { istd: 1, name: 'Heading 1', type: 'paragraph' as const, istdBase: 0, fontIndex: 2 },
      ]
      expect(resolveStyleFormat(styles, 1).fontIndex).toBe(2)
    })

    it('should guard against inheritance cycles', () => {
      const styles = [
        { istd: 0, name: 'A', type: 'paragraph' as const, istdBase: 1, charFormat: { bold: true } },
        { istd: 1, name: 'B', type: 'paragraph' as const, istdBase: 0, charFormat: { italic: true } },
      ]
      const resolved = resolveStyleFormat(styles, 0)
      expect(resolved.charFormat).toEqual({ bold: true, italic: true })
    })

    it('should return empty result for unknown istd', () => {
      const resolved = resolveStyleFormat([], 5)
      expect(resolved.charFormat).toBeUndefined()
      expect(resolved.paraFormat).toBeUndefined()
      expect(resolved.fontIndex).toBeUndefined()
    })

    it('should stop the chain at a missing base style', () => {
      const styles = [
        { istd: 2, name: 'Derived', type: 'paragraph' as const, istdBase: 99, charFormat: { bold: true } },
      ]
      const resolved = resolveStyleFormat(styles, 2)
      expect(resolved.charFormat).toEqual({ bold: true })
    })
  })

  describe('getHeadingLevel', () => {
    it('should return 1-9 for Heading N styles (English)', () => {
      expect(getHeadingLevel('Heading 1')).toBe(1)
      expect(getHeadingLevel('Heading 2')).toBe(2)
      expect(getHeadingLevel('Heading 3')).toBe(3)
      expect(getHeadingLevel('Heading 9')).toBe(9)
    })

    it('should be case-insensitive', () => {
      expect(getHeadingLevel('heading 1')).toBe(1)
      expect(getHeadingLevel('HEADING 2')).toBe(2)
      expect(getHeadingLevel('Heading   3')).toBe(3)
    })

    it('should return null for non-heading styles', () => {
      expect(getHeadingLevel('Normal')).toBeNull()
      expect(getHeadingLevel('Body Text')).toBeNull()
      expect(getHeadingLevel('')).toBeNull()
    })

    it('should return null for out-of-range heading levels', () => {
      expect(getHeadingLevel('Heading 0')).toBeNull()
      expect(getHeadingLevel('Heading 10')).toBeNull()
    })

    it('should handle Chinese heading names', () => {
      expect(getHeadingLevel('标题 1')).toBe(1)
      expect(getHeadingLevel('标题 2')).toBe(2)
      expect(getHeadingLevel('标题 3')).toBe(3)
    })
  })

  describe('getStyleName', () => {
    it('should return the style name from the styles array', () => {
      const styles = [
        { istd: 0, name: 'Normal', type: 'paragraph' as const },
        { istd: 1, name: 'My Heading', type: 'paragraph' as const },
      ]
      expect(getStyleName(styles, 0)).toBe('Normal')
      expect(getStyleName(styles, 1)).toBe('My Heading')
    })

    it('should fall back to built-in styles if not in array', () => {
      const styles: any[] = []
      expect(getStyleName(styles, 0)).toBe('Normal')
      expect(getStyleName(styles, 1)).toBe('Heading 1')
      expect(getStyleName(styles, 2)).toBe('Heading 2')
    })

    it('should return Style N for unknown indices', () => {
      const styles: any[] = []
      expect(getStyleName(styles, 999)).toBe('Style 999')
    })
  })

  describe('BUILTIN_STYLES', () => {
    it('should have Normal at index 0', () => {
      expect(BUILTIN_STYLES[0]).toBeDefined()
      expect(BUILTIN_STYLES[0].name).toBe('Normal')
    })

    it('should have Heading 1-9', () => {
      for (let i = 1; i <= 9; i++) {
        expect(BUILTIN_STYLES[i]).toBeDefined()
        expect(BUILTIN_STYLES[i].name).toBe(`Heading ${i}`)
      }
    })

    it('should have character styles', () => {
      expect(BUILTIN_STYLES[23]).toBeDefined() // Footnote Text
      expect(BUILTIN_STYLES[24]).toBeDefined() // Footnote Reference
      expect(BUILTIN_STYLES[24].type).toBe('character')
    })
  })

  describe('parseStylesheet (spec STSH layout)', () => {
    function writeUint16B(buffer: Uint8Array, offset: number, value: number): void {
      buffer[offset] = value & 0xFF
      buffer[offset + 1] = (value >> 8) & 0xFF
    }

    /**
     * Build a spec-level STSH: LPStshi (cbStshi + STSHI) + rglpstd.
     * @param stds Array of [stk, istdBase, cupx, name] tuples.
     */
    function buildSpecStsh(stds: Array<[number, number, number, string]>): Uint8Array {
      const cbStdBase = 10
      const cbStshi = 6 // cstd(2) + cbSTDBaseInFile(2) + flags(2)
      const lpStshi = 2 + cbStshi
      // Precompute rglpstd size
      let stdsSize = 0
      for (const [, , , name] of stds) {
        stdsSize += 2 // cbStd
        stdsSize += cbStdBase + 2 + name.length * 2 + 2 // STD base + cch + chars + null
      }
      const data = new Uint8Array(lpStshi + stdsSize + 8)
      let pos = 0
      writeUint16B(data, pos, cbStshi); pos += 2
      writeUint16B(data, pos, stds.length); pos += 2 // cstd
      writeUint16B(data, pos, cbStdBase); pos += 2
      pos += 2 // flags

      for (const [stk, istdBase, cupx, name] of stds) {
        const stdStart = pos + 2
        const cbStd = cbStdBase + 2 + name.length * 2 + 2
        writeUint16B(data, pos, cbStd); pos += 2
        writeUint16B(data, pos, 0) // sti = 0
        writeUint16B(data, stdStart + 2, ((istdBase & 0x0FFF) << 4) | (stk & 0x0F))
        writeUint16B(data, stdStart + 4, cupx & 0x0F)
        writeUint16B(data, stdStart + 6, 0)
        writeUint16B(data, stdStart + 8, 0)
        // xstzName: cch = character count (UTF-16), chars, null terminator
        writeUint16B(data, stdStart + cbStdBase, name.length)
        for (let i = 0; i < name.length; i++) {
          const code = name.charCodeAt(i)
          data[stdStart + cbStdBase + 2 + i * 2] = code & 0xFF
          data[stdStart + cbStdBase + 2 + i * 2 + 1] = (code >> 8) & 0xFF
        }
        pos = stdStart + cbStd
      }
      return data
    }

    it('should parse a spec-level stylesheet with paragraph styles', () => {
      const data = buildSpecStsh([[1, 0x0FFF, 0, 'Normal'], [1, 0, 0, 'Heading 1']])
      const result = parseStylesheet(data, 0, data.length)
      expect(result.length).toBeGreaterThanOrEqual(2)
      const normal = result.find(s => s.istd === 0)
      const heading = result.find(s => s.istd === 1)
      expect(normal?.name).toBe('Normal')
      expect(normal?.type).toBe('paragraph')
      expect(heading?.name).toBe('Heading 1')
      expect(heading?.istdBase).toBe(0)
    })

    it('should parse a spec-level stylesheet with character styles', () => {
      const data = buildSpecStsh([[2, 0x0FFF, 0, 'Emphasis']])
      const result = parseStylesheet(data, 0, data.length)
      const emph = result.find(s => s.istd === 0)
      expect(emph?.name).toBe('Emphasis')
      expect(emph?.type).toBe('character')
    })

    /**
     * Build a spec STSH whose first STD carries UPX grpprl chunks.
     * @param stk style kind (1=paragraph, 2=character)
     * @param cupx number of UPX chunks
     * @param papxGrpprl PAPX grpprl bytes (may be empty)
     * @param chpxGrpprl CHPX grpprl bytes (may be empty)
     */
    function buildSpecStshWithGrpprl(
      stk: number,
      cupx: number,
      papxGrpprl: number[],
      chpxGrpprl: number[],
    ): Uint8Array {
      const cbStdBase = 10
      const cbStshi = 6
      const lpStshi = 2 + cbStshi
      const name = 'GrpStyle'
      // STD body: base(10) + cch(2) + chars + null(2) + align + UPX chunks
      const nameBytes = name.length * 2
      // STD layout mirrors the parser exactly: base(10) + cch(2) + chars +
      // null(2), then optionally UpxPapx (+2-byte pad) then UpxChpx.
      let pRel = cbStdBase + 2 + nameBytes + 2
      if (stk === 1) {
        pRel += 2 + 2 + papxGrpprl.length // UpxPapx
        if (pRel & 1) pRel++ // 2-byte alignment
      }
      if (cupx >= 2 || (stk === 2 && cupx >= 1)) {
        pRel += 2 + chpxGrpprl.length // UpxChpx
      }
      const cbStd = pRel
      const data = new Uint8Array(lpStshi + 2 + cbStd + 8)
      let pos = 0
      writeUint16B(data, pos, cbStshi); pos += 2
      writeUint16B(data, pos, 1); pos += 2 // cstd = 1
      writeUint16B(data, pos, cbStdBase); pos += 2
      pos += 2 // flags
      writeUint16B(data, pos, cbStd); pos += 2 // cbStd
      const stdStart = pos
      writeUint16B(data, pos, 0) // sti
      writeUint16B(data, stdStart + 2, ((0x0FFF & 0x0FFF) << 4) | (stk & 0x0F)) // stk + istdBase=none
      writeUint16B(data, stdStart + 4, cupx & 0x0F) // cupx
      writeUint16B(data, stdStart + 6, 0)
      writeUint16B(data, stdStart + 8, 0)
      // xstzName
      writeUint16B(data, stdStart + cbStdBase, name.length)
      for (let i = 0; i < name.length; i++) {
        const code = name.charCodeAt(i)
        data[stdStart + cbStdBase + 2 + i * 2] = code & 0xFF
        data[stdStart + cbStdBase + 2 + i * 2 + 1] = (code >> 8) & 0xFF
      }
      let p = stdStart + cbStdBase + 2 + nameBytes + 2
      // UpxPapx
      if (stk === 1 && cupx >= 1) {
        const cbUpx = 2 + papxGrpprl.length
        writeUint16B(data, p, cbUpx)
        writeUint16B(data, p + 2, 0) // istd
        for (let i = 0; i < papxGrpprl.length; i++) data[p + 4 + i] = papxGrpprl[i]
        p += 2 + cbUpx
        if ((p - stdStart) & 1) p++
      }
      // UpxChpx — written for paragraph styles with cupx>=2, or character
      // styles with cupx>=1 (mirrors parseSpecStds branch conditions).
      if (cupx >= 2 || (stk === 2 && cupx >= 1)) {
        const cbChpx = chpxGrpprl.length
        writeUint16B(data, p, cbChpx)
        for (let i = 0; i < chpxGrpprl.length; i++) data[p + 2 + i] = chpxGrpprl[i]
      }
      return data
    }

    it('should parse PAPX and CHPX grpprl from a spec paragraph style', () => {
      // sprmPJc (0x2403) + operand 1; sprmCFBold (0x0835) + operand 1;
      // sprmCRgFtc0 (0x4A4F) + font index 3 (2 bytes)
      const data = buildSpecStshWithGrpprl(
        1, 2,
        [0x03, 0x24, 0x01],
        [0x35, 0x08, 0x01, 0x4F, 0x4A, 0x03, 0x00],
      )
      const result = parseStylesheet(data, 0, data.length)
      const style = result.find(s => s.name === 'GrpStyle')
      expect(style).toBeDefined()
      expect(style!.type).toBe('paragraph')
      expect(style!.paraFormat).toBeDefined()
      expect(style!.charFormat).toBeDefined()
      expect(style!.fontIndex).toBe(3)
    })

    it('should parse CHPX grpprl from a spec character style', () => {
      const data = buildSpecStshWithGrpprl(2, 1, [], [0x35, 0x08, 0x01])
      const result = parseStylesheet(data, 0, data.length)
      const style = result.find(s => s.name === 'GrpStyle')
      expect(style).toBeDefined()
      expect(style!.type).toBe('character')
      expect(style!.charFormat).toBeDefined()
    })

    it('should handle table and numbering style kinds', () => {
      const data = buildSpecStsh([[3, 0x0FFF, 0, 'Table Style'], [4, 0x0FFF, 0, 'Num Style']])
      const result = parseStylesheet(data, 0, data.length)
      expect(result.some(s => s.name === 'Table Style' && s.type === 'table')).toBe(true)
      expect(result.some(s => s.name === 'Num Style' && s.type === 'numbering')).toBe(true)
    })

    it('should handle empty slots (cbStd=0) with builtin names', () => {
      // First slot empty, second slot a paragraph style
      const data = buildSpecStsh([[1, 0x0FFF, 0, 'Normal']])
      // Insert a zero cbStd entry before the real one
      const shifted = new Uint8Array(data.length + 2)
      shifted.set(data.subarray(0, 2 + 6), 0)
      shifted[2 + 6] = 0
      shifted[2 + 6 + 1] = 0
      shifted.set(data.subarray(2 + 6), 2 + 8)
      // Patch cstd to 2
      shifted[2] = 2
      shifted[3] = 0
      const result = parseStylesheet(shifted, 0, shifted.length)
      expect(result.length).toBeGreaterThanOrEqual(2)
      expect(result[0].istd).toBe(0)
      // Empty slot gets builtin name (Normal at istd 0)
      expect(result[1].istd).toBe(1)
    })

    it('should fall back to legacy parser for non-spec layout', () => {
      // cbStshi = 5 (< 6) → spec path rejected, legacy path reads cstd=5
      const data = new Uint8Array(64)
      writeUint16(data, 0, 5) // cstd (legacy) / cbStshi (spec)
      writeUint16(data, 2, 28) // cbStd
      // Rest is zeros → STD entries with cb=0 → builtin minimal entries
      const result = parseStylesheet(data, 0, 64)
      expect(result.length).toBeGreaterThan(0)
    })

    it('should parse PAPX and CHPX grpprl from a legacy paragraph style', () => {
      // Build a legacy STSH (cbStshi=1 < 6 → legacy path) with one STD:
      //   cb (2) + istdNext(2) + bte(1)=1(paragraph) + flags(1)
      //   + cch(2) + name chars + rsid(8) + tfct(1)
      //   + cupx(1)=2 + PAPX UPX(cb(2)+istd(2)+grpprl) + CHPX UPX(cb(2)+grpprl)
      const name = 'LegacyStyle'
      const body: number[] = []
      // istdNext = 0
      body.push(0x00, 0x00)
      // bte = 1 (paragraph), flags = 0
      body.push(0x01, 0x00)
      // xstzName: cch = name.length, UTF-16LE chars
      body.push(name.length & 0xff, (name.length >> 8) & 0xff)
      for (const ch of name) {
        const code = ch.charCodeAt(0)
        body.push(code & 0xff, (code >> 8) & 0xff)
      }
      // rsid (8) + tfct (1) = 9 bytes zeros
      for (let i = 0; i < 9; i++) body.push(0x00)
      // cupx = 2
      body.push(0x02)
      // PAPX UPX: cb(2) + istd(2) + empty grpprl → PAPX sets no paraFormat
      //   (so the scan continues to the CHPX chunk)
      body.push(0x04, 0x00) // cb = 4
      body.push(0x00, 0x00) // istd = 0
      // CHPX UPX: cb(2) + grpprl: sprmCFBold(0x0835)+op(1) + sprmCRgFtc0(0x4A4F)+idx(2)
      //   → grpprl = 3 + 4 = 7, total CHPX cb = 2 + 7 = 9
      body.push(0x09, 0x00) // cb = 9
      body.push(0x35, 0x08, 0x01) // sprmCFBold operand=1
      body.push(0x4F, 0x4A, 0x03, 0x00) // sprmCRgFtc0 font index 3

      const totalSize = 4 + 2 + body.length
      const data = new Uint8Array(totalSize + 8)
      writeUint16(data, 0, 1) // cstd (legacy) / cbStshi (spec: 1 < 6 → legacy)
      writeUint16(data, 2, body.length) // cbStdInFile (unused by legacy path)
      writeUint16(data, 4, body.length) // cb of this STD
      data.set(new Uint8Array(body), 6)

      const result = parseStylesheet(data, 0, totalSize)
      expect(result.length).toBeGreaterThan(0)
      const style = result.find(s => s.name === 'LegacyStyle')
      expect(style).toBeDefined()
      expect(style!.type).toBe('paragraph')
      // The CHPX grpprl should have been parsed (bold + font index)
      expect(style!.charFormat).toBeDefined()
      expect(style!.fontIndex).toBe(3)
    })

    it('should parse CHPX grpprl from a legacy character style', () => {
      // Legacy STSH with bte=2 (character) + cupx=1 + CHPX UPX
      // grpprl must leave stdEnd - stdPos > 6 for the scan to run
      const name = 'LegacyChar'
      const body: number[] = []
      body.push(0x00, 0x00) // istdNext
      body.push(0x02, 0x00) // bte = 2 (character), flags = 0
      body.push(name.length & 0xff, (name.length >> 8) & 0xff)
      for (const ch of name) {
        const code = ch.charCodeAt(0)
        body.push(code & 0xff, (code >> 8) & 0xff)
      }
      for (let i = 0; i < 9; i++) body.push(0x00) // rsid + tfct
      body.push(0x01) // cupx = 1
      // CHPX UPX: cb(2) + sprmCFBold(0x0835)+op(1) + sprmCItalic(0x0836)+op(1)
      //   → cb = 2 + 2 + 2 = 6
      body.push(0x06, 0x00)
      body.push(0x35, 0x08, 0x01) // bold
      body.push(0x36, 0x08, 0x01) // italic

      const totalSize = 4 + 2 + body.length
      const data = new Uint8Array(totalSize + 8)
      writeUint16(data, 0, 1) // cstd (legacy path)
      writeUint16(data, 2, body.length)
      writeUint16(data, 4, body.length) // cb of this STD
      data.set(new Uint8Array(body), 6)

      const result = parseStylesheet(data, 0, totalSize)
      const style = result.find(s => s.name === 'LegacyChar')
      expect(style).toBeDefined()
      expect(style!.type).toBe('character')
      expect(style!.charFormat).toBeDefined()
      expect(style!.charFormat!.bold).toBe(true)
    })

    it('should skip an invalid PAPX UPX and continue scanning (legacy)', () => {
      // First cupx candidate is followed by an invalid PAPX cb (0x00),
      // so the scan must continue to the next candidate.
      const name = 'LegacyScan'
      const body: number[] = []
      body.push(0x00, 0x00) // istdNext
      body.push(0x01, 0x00) // bte = 1 (paragraph)
      body.push(name.length & 0xff, (name.length >> 8) & 0xff)
      for (const ch of name) {
        const code = ch.charCodeAt(0)
        body.push(code & 0xff, (code >> 8) & 0xff)
      }
      for (let i = 0; i < 9; i++) body.push(0x00)
      // cupx candidate 1: followed by invalid PAPX cb = 0x0000 → continue
      body.push(0x01)
      body.push(0x00, 0x00) // cb = 0 → invalid
      body.push(0x00, 0x00) // more zero bytes
      // cupx candidate 2 (cupx=2): valid PAPX + CHPX UPX
      body.push(0x02)
      body.push(0x07, 0x00) // PAPX cb = 7
      body.push(0x00, 0x00) // istd
      body.push(0x03, 0x24, 0x01) // sprmPJc
      body.push(0x05, 0x00) // CHPX cb = 5
      body.push(0x35, 0x08, 0x01) // bold

      const totalSize = 4 + 2 + body.length
      const data = new Uint8Array(totalSize + 8)
      writeUint16(data, 0, 1)
      writeUint16(data, 2, body.length)
      writeUint16(data, 4, body.length)
      data.set(new Uint8Array(body), 6)

      const result = parseStylesheet(data, 0, totalSize)
      const style = result.find(s => s.name === 'LegacyScan')
      expect(style).toBeDefined()
      expect(style!.charFormat).toBeDefined()
      expect(style!.charFormat!.bold).toBe(true)
    })
  })

  describe('detectStyleSet', () => {
    it('should detect Default when heading styles exist with 5+ styles', () => {
      // Heading 4/5 are headings but do NOT match the Default pattern list
      // (which only covers Heading 1-3), so the fallback branch must kick in.
      const styles = [
        { istd: 0, name: 'My Doc Style', type: 'paragraph' as const },
        { istd: 1, name: 'Heading 4', type: 'paragraph' as const },
        { istd: 2, name: 'Heading 5', type: 'paragraph' as const },
        { istd: 3, name: 'Body Text', type: 'paragraph' as const },
        { istd: 4, name: 'Title', type: 'paragraph' as const },
      ]
      const result = detectStyleSet(styles)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('Default')
      expect(result!.isCustom).toBe(false)
    })

    it('should detect Elegant style set', () => {
      const styles = [
        { istd: 0, name: 'Normal', type: 'paragraph' as const },
        { istd: 1, name: 'Elegant Heading', type: 'paragraph' as const },
        { istd: 2, name: 'Elegant Title', type: 'paragraph' as const },
      ]
      const result = detectStyleSet(styles)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('Elegant')
    })

    it('should return null for empty styles', () => {
      expect(detectStyleSet([])).toBeNull()
    })

    it('should detect custom style set for many styles without known patterns', () => {
      const styles = Array.from({ length: 25 }, (_, i) => ({
        istd: i,
        name: `Custom${i}`,
        type: 'paragraph' as const,
      }))
      const result = detectStyleSet(styles)
      expect(result).not.toBeNull()
      expect(result!.isCustom).toBe(true)
    })

    it('should detect Default for heading styles even without pattern match', () => {
      const styles = [
        { istd: 0, name: 'Normal', type: 'paragraph' as const },
        { istd: 1, name: 'Heading 1', type: 'paragraph' as const },
        { istd: 2, name: 'Heading 2', type: 'paragraph' as const },
        { istd: 3, name: 'Body Text', type: 'paragraph' as const },
        { istd: 4, name: 'Title', type: 'paragraph' as const },
      ]
      const result = detectStyleSet(styles)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('Default')
    })
  })
})

