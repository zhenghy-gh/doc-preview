import { describe, it, expect } from 'vitest'
import { parseListTable, getListFormat, parsePlcfLfo, getListFormatFromLfo } from '../src/utils/listParser'
import type { ListEntry, LfoEntry } from '../src/utils/listParser'

// ---- Helpers ----

function writeUint16(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = value & 0xFF
  buffer[offset + 1] = (value >> 8) & 0xFF
}

function writeUint32(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = value & 0xFF
  buffer[offset + 1] = (value >> 8) & 0xFF
  buffer[offset + 2] = (value >> 16) & 0xFF
  buffer[offset + 3] = (value >> 24) & 0xFF
}

function writeInt16(buffer: Uint8Array, offset: number, value: number): void {
  if (value < 0) value = 0x10000 + value
  writeUint16(buffer, offset, value)
}

function writeUtf16leString(buffer: Uint8Array, offset: number, str: string): number {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    buffer[offset + i * 2] = code & 0xFF
    buffer[offset + i * 2 + 1] = (code >> 8) & 0xFF
  }
  return str.length * 2
}

/**
 * Build a minimal LST entry (simple list, 1 level).
 *
 * LST entry layout:
 *   lsid (4) + tplc (4) + rgistd (18) + fSimpleList (1) + reserved (1) = 28 bytes
 *   Then 1 LVLF structure (for simple list):
 *     iStartAt (2) + nfc (1) + flags (1) + lxchFollow (1) + rgxchNum (32) = 37 bytes
 *     cbGrpprlChpx (1) + cbGrpprlPapx (1) + reserved (1) = 3 bytes → offset 40
 *     grpprlChpx (cbGrpprlChpx bytes)
 *     grpprlPapx (cbGrpprlPapx bytes)
 *     numberText: length (2) + UTF-16LE chars
 */
function buildSimpleLstEntry(
  lsid: number,
  nfc: number,
  startAt: number,
  numberText: string = '',
  papxSprms: Array<{ sprm: number; value: number }> = [],
): Uint8Array {
  // Calculate sizes
  const grpprlChpxSize = 0
  const grpprlPapxSize = papxSprms.length * 4 // each SPRM: 2 byte code + 2 byte operand
  const numTextChars = numberText.length
  const numTextBytes = 2 + numTextChars * 2
  const lvlfSize = 40 + grpprlChpxSize + grpprlPapxSize + numTextBytes

  const totalSize = 28 + lvlfSize
  const buf = new Uint8Array(totalSize)
  let pos = 0

  // LST header
  writeUint32(buf, pos, lsid); pos += 4
  writeUint32(buf, pos, 0); pos += 4 // tplc
  // rgistd: 9 x 2 bytes = 18 bytes of zeros
  pos += 18
  buf[pos++] = 1 // fSimpleList = true
  buf[pos++] = 0 // reserved

  // LVLF
  writeUint16(buf, pos, startAt); pos += 2 // iStartAt
  buf[pos++] = nfc // nfc
  buf[pos++] = 0   // flags
  buf[pos++] = 1   // lxchFollow (tab)
  pos += 32 // rgxchNum (skip)

  // cbGrpprlChpx, cbGrpprlPapx, reserved
  buf[pos++] = grpprlChpxSize
  buf[pos++] = grpprlPapxSize
  buf[pos++] = 0 // reserved

  // grpprlPapx
  for (const sprm of papxSprms) {
    writeUint16(buf, pos, sprm.sprm); pos += 2
    writeInt16(buf, pos, sprm.value); pos += 2
  }

  // Number text
  writeUint16(buf, pos, numTextChars); pos += 2
  writeUtf16leString(buf, pos, numberText); pos += numTextChars * 2

  return buf
}

/**
 * Build a multi-level LST entry (9 levels).
 */
function buildMultiLevelLstEntry(
  lsid: number,
  nfcs: number[],
  startAt: number = 1,
): Uint8Array {
  const grpprlChpxSize = 0
  const grpprlPapxSize = 0
  const numTextBytes = 2 // length = 0, no chars
  const lvlfSize = 40 + grpprlChpxSize + grpprlPapxSize + numTextBytes

  const totalSize = 28 + lvlfSize * 9
  const buf = new Uint8Array(totalSize)
  let pos = 0

  // LST header
  writeUint32(buf, pos, lsid); pos += 4
  writeUint32(buf, pos, 0); pos += 4 // tplc
  pos += 18 // rgistd
  buf[pos++] = 0 // fSimpleList = false
  buf[pos++] = 0 // reserved

  // 9 LVLF structures
  for (let lvl = 0; lvl < 9; lvl++) {
    const nfc = nfcs[lvl] ?? 0
    writeUint16(buf, pos, startAt); pos += 2 // iStartAt
    buf[pos++] = nfc // nfc
    buf[pos++] = 0   // flags
    buf[pos++] = 1   // lxchFollow
    pos += 32 // rgxchNum

    buf[pos++] = grpprlChpxSize
    buf[pos++] = grpprlPapxSize
    buf[pos++] = 0 // reserved

    // Number text: length = 0
    writeUint16(buf, pos, 0); pos += 2
  }

  return buf
}

// ---- Tests ----

describe('listParser', () => {
  describe('parseListTable', () => {
    it('should return empty array for zero-length input', () => {
      expect(parseListTable(new Uint8Array(0), 0, 0)).toEqual([])
    })

    it('should return empty array for out-of-bounds offset', () => {
      expect(parseListTable(new Uint8Array(10), 100, 5)).toEqual([])
    })

    it('should parse a simple list with decimal numbering', () => {
      const entry = buildSimpleLstEntry(0x00000001, 0, 1) // nfc=0 → decimal
      const data = new Uint8Array(entry.length + 10)
      data.set(entry, 5) // offset by 5 to test fc parameter

      const result = parseListTable(data, 5, entry.length)
      expect(result.length).toBe(1)
      expect(result[0].lsid).toBe(0x00000001)
      expect(result[0].fSimpleList).toBe(true)
      expect(result[0].levels.length).toBe(1)
      expect(result[0].levels[0].nfc).toBe('decimal')
      expect(result[0].levels[0].startAt).toBe(1)
      expect(result[0].levels[0].isBullet).toBe(false)
    })

    it('should parse a bullet list (nfc=23 → disc)', () => {
      const entry = buildSimpleLstEntry(0x00000002, 23, 1) // nfc=23 → disc (bullet)
      const data = new Uint8Array(entry.length)
      data.set(entry, 0)

      const result = parseListTable(data, 0, entry.length)
      expect(result.length).toBe(1)
      expect(result[0].levels[0].nfc).toBe('disc')
      expect(result[0].levels[0].isBullet).toBe(true)
    })

    it('should parse a multi-level list with 9 levels', () => {
      const nfcs = [0, 4, 2, 0, 4, 2, 23, 23, 23] // decimal, lower-alpha, lower-roman, ...
      const entry = buildMultiLevelLstEntry(0x00000003, nfcs)
      const data = new Uint8Array(entry.length)
      data.set(entry, 0)

      const result = parseListTable(data, 0, entry.length)
      expect(result.length).toBe(1)
      expect(result[0].lsid).toBe(0x00000003)
      expect(result[0].fSimpleList).toBe(false)
      expect(result[0].levels.length).toBe(9)
      expect(result[0].levels[0].nfc).toBe('decimal')
      expect(result[0].levels[1].nfc).toBe('lower-alpha')
      expect(result[0].levels[2].nfc).toBe('lower-roman')
      expect(result[0].levels[6].nfc).toBe('disc')
    })

    it('should parse multiple LST entries', () => {
      const entry1 = buildSimpleLstEntry(0x00000001, 0, 1)  // decimal
      const entry2 = buildSimpleLstEntry(0x00000002, 23, 1) // bullet

      const data = new Uint8Array(entry1.length + entry2.length)
      data.set(entry1, 0)
      data.set(entry2, entry1.length)

      const result = parseListTable(data, 0, data.length)
      expect(result.length).toBe(2)
      expect(result[0].lsid).toBe(0x00000001)
      expect(result[1].lsid).toBe(0x00000002)
      expect(result[0].levels[0].nfc).toBe('decimal')
      expect(result[1].levels[0].nfc).toBe('disc')
    })

    it('should parse LVLF with indent SPRMs in grpprlPapx', () => {
      const papxSprms = [
        { sprm: 0x2402, value: 720 },  // sprmPDxaLeft = 720 twips (0.5 inch)
        { sprm: 0x2403, value: -360 },  // sprmPDxaLeft1 = -360 twips (hanging indent)
      ]
      const entry = buildSimpleLstEntry(0x00000004, 0, 1, '', papxSprms)
      const data = new Uint8Array(entry.length)
      data.set(entry, 0)

      const result = parseListTable(data, 0, entry.length)
      expect(result.length).toBe(1)
      expect(result[0].levels[0].dxaIndent).toBe(720)
      expect(result[0].levels[0].dxaFirstLine).toBe(-360)
    })

    it('should parse LVLF with number text', () => {
      const entry = buildSimpleLstEntry(0x00000005, 0, 1, '%1.')
      const data = new Uint8Array(entry.length)
      data.set(entry, 0)

      const result = parseListTable(data, 0, entry.length)
      expect(result.length).toBe(1)
      expect(result[0].levels[0].numberText).toBe('%1.')
    })

    it('should handle CJK numbering formats', () => {
      // nfc=10 → cjk-ideographic
      const entry = buildSimpleLstEntry(0x00000006, 10, 1)
      const data = new Uint8Array(entry.length)
      data.set(entry, 0)

      const result = parseListTable(data, 0, entry.length)
      expect(result[0].levels[0].nfc).toBe('cjk-ideographic')
    })

    it('should handle circle bullet format (nfc=24)', () => {
      const entry = buildSimpleLstEntry(0x00000007, 24, 1)
      const data = new Uint8Array(entry.length)
      data.set(entry, 0)

      const result = parseListTable(data, 0, entry.length)
      expect(result[0].levels[0].nfc).toBe('circle')
      expect(result[0].levels[0].isBullet).toBe(true)
    })

    it('should handle square bullet format (nfc=25)', () => {
      const entry = buildSimpleLstEntry(0x00000008, 25, 1)
      const data = new Uint8Array(entry.length)
      data.set(entry, 0)

      const result = parseListTable(data, 0, entry.length)
      expect(result[0].levels[0].nfc).toBe('square')
      expect(result[0].levels[0].isBullet).toBe(true)
    })

    it('should handle unknown nfc values gracefully', () => {
      const entry = buildSimpleLstEntry(0x00000009, 99, 1)
      const data = new Uint8Array(entry.length)
      data.set(entry, 0)

      const result = parseListTable(data, 0, entry.length)
      expect(result[0].levels[0].nfc).toBe('nfc-99')
    })
  })

  describe('getListFormat', () => {
    const lists: ListEntry[] = [
      {
        lsid: 1, tplc: 0, fSimpleList: true,
        levels: [{ nfc: 'decimal', startAt: 1, numberText: '', isBullet: false, dxaIndent: 0, dxaFirstLine: 0 }],
      },
      {
        lsid: 2, tplc: 0, fSimpleList: false,
        levels: [
          { nfc: 'decimal', startAt: 1, numberText: '', isBullet: false, dxaIndent: 0, dxaFirstLine: 0 },
          { nfc: 'lower-alpha', startAt: 1, numberText: '', isBullet: false, dxaIndent: 720, dxaFirstLine: -360 },
          { nfc: 'lower-roman', startAt: 1, numberText: '', isBullet: false, dxaIndent: 1440, dxaFirstLine: -360 },
          { nfc: 'disc', startAt: 1, numberText: '', isBullet: true, dxaIndent: 2160, dxaFirstLine: -360 },
        ],
      },
    ]

    it('should return null for invalid ilst', () => {
      expect(getListFormat(lists, -1)).toBeNull()
      expect(getListFormat(lists, 99)).toBeNull()
    })

    it('should return ordered list format for decimal nfc', () => {
      const fmt = getListFormat(lists, 0, 0)
      expect(fmt).not.toBeNull()
      expect(fmt!.listType).toBe('ordered')
      expect(fmt!.listStyle).toBe('decimal')
      expect(fmt!.listLevel).toBe(0)
    })

    it('should return unordered list format for bullet nfc', () => {
      const fmt = getListFormat(lists, 1, 3) // level 3 is disc
      expect(fmt).not.toBeNull()
      expect(fmt!.listType).toBe('unordered')
      expect(fmt!.listStyle).toBe('disc')
      expect(fmt!.listLevel).toBe(3)
    })

    it('should return correct format for multi-level list at level 1', () => {
      const fmt = getListFormat(lists, 1, 1)
      expect(fmt).not.toBeNull()
      expect(fmt!.listType).toBe('ordered')
      expect(fmt!.listStyle).toBe('lower-alpha')
      expect(fmt!.listLevel).toBe(1)
    })

    it('should fallback to level 0 for out-of-range level', () => {
      const fmt = getListFormat(lists, 0, 5) // list 0 has only 1 level
      expect(fmt).not.toBeNull()
      expect(fmt!.listStyle).toBe('decimal')
      expect(fmt!.listLevel).toBe(0)
    })

    it('should return null for empty list table', () => {
      expect(getListFormat([], 0)).toBeNull()
    })

    it('should default level to 0 when not specified', () => {
      const fmt = getListFormat(lists, 0)
      expect(fmt).not.toBeNull()
      expect(fmt!.listLevel).toBe(0)
    })
  })

  describe('parsePlcfLfo', () => {
    function buildPlcfLfo(lfoEntries: Array<{ lsid: number; clfoLvl: number }>): Uint8Array {
      const n = lfoEntries.length
      // PLC: (n+1) CPs (4 bytes each) + n LFOs (8 bytes each)
      const totalSize = (n + 1) * 4 + n * 8
      const buf = new Uint8Array(totalSize)
      let pos = 0

      // Write CPs (simple ascending)
      for (let i = 0; i <= n; i++) {
        writeUint32(buf, pos, i * 10)
        pos += 4
      }

      // Write LFOs
      for (const lfo of lfoEntries) {
        writeUint32(buf, pos, lfo.lsid); pos += 4
        buf[pos++] = lfo.clfoLvl
        buf[pos++] = 0 // unused
        buf[pos++] = 0
        buf[pos++] = 0
      }

      return buf
    }

    it('should return empty array for zero-length input', () => {
      expect(parsePlcfLfo(new Uint8Array(0), 0, 0)).toEqual([])
    })

    it('should return empty array for too-small input', () => {
      expect(parsePlcfLfo(new Uint8Array(10), 0, 10)).toEqual([])
    })

    it('should parse a single LFO entry', () => {
      const data = buildPlcfLfo([{ lsid: 0xDEADBEEF, clfoLvl: 3 }])
      const result = parsePlcfLfo(data, 0, data.length)
      expect(result.length).toBe(1)
      expect(result[0].lsid).toBe(0xDEADBEEF)
      expect(result[0].clfoLvl).toBe(3)
    })

    it('should parse multiple LFO entries', () => {
      const data = buildPlcfLfo([
        { lsid: 0x11111111, clfoLvl: 1 },
        { lsid: 0x22222222, clfoLvl: 2 },
        { lsid: 0x33333333, clfoLvl: 9 },
      ])
      const result = parsePlcfLfo(data, 0, data.length)
      expect(result.length).toBe(3)
      expect(result[0].lsid).toBe(0x11111111)
      expect(result[1].lsid).toBe(0x22222222)
      expect(result[2].clfoLvl).toBe(9)
    })

    it('should respect fc offset', () => {
      const data = buildPlcfLfo([{ lsid: 0xAAAA, clfoLvl: 1 }])
      const padded = new Uint8Array(data.length + 10)
      padded.set(data, 5)
      const result = parsePlcfLfo(padded, 5, data.length)
      expect(result.length).toBe(1)
      expect(result[0].lsid).toBe(0xAAAA)
    })
  })

  describe('getListFormatFromLfo', () => {
    const lists: ListEntry[] = [
      {
        lsid: 0x100, tplc: 0, fSimpleList: true,
        levels: [{ nfc: 'decimal', startAt: 1, numberText: '', isBullet: false, dxaIndent: 0, dxaFirstLine: 0 }],
      },
      {
        lsid: 0x200, tplc: 0, fSimpleList: true,
        levels: [{ nfc: 'disc', startAt: 1, numberText: '', isBullet: true, dxaIndent: 720, dxaFirstLine: 0 }],
      },
    ]

    const lfos: LfoEntry[] = [
      { lsid: 0x100, clfoLvl: 0 }, // LFO[0] → LST with lsid 0x100
      { lsid: 0x200, clfoLvl: 0 }, // LFO[1] → LST with lsid 0x200
    ]

    it('should return null for invalid ilfo (0)', () => {
      expect(getListFormatFromLfo(lists, lfos, 0)).toBeNull()
    })

    it('should return null for out-of-range ilfo', () => {
      expect(getListFormatFromLfo(lists, lfos, 99)).toBeNull()
    })

    it('should resolve LFO[0] to ordered list', () => {
      const fmt = getListFormatFromLfo(lists, lfos, 1) // ilfo=1 (1-based)
      expect(fmt).not.toBeNull()
      expect(fmt!.listType).toBe('ordered')
      expect(fmt!.listStyle).toBe('decimal')
    })

    it('should resolve LFO[1] to bullet list', () => {
      const fmt = getListFormatFromLfo(lists, lfos, 2) // ilfo=2
      expect(fmt).not.toBeNull()
      expect(fmt!.listType).toBe('unordered')
      expect(fmt!.listStyle).toBe('disc')
    })

    it('should return null if LFO lsid does not match any LST entry', () => {
      const badLfos: LfoEntry[] = [{ lsid: 0x999, clfoLvl: 0 }]
      expect(getListFormatFromLfo(lists, badLfos, 1)).toBeNull()
    })

    it('should return null for empty LFO table', () => {
      expect(getListFormatFromLfo(lists, [], 1)).toBeNull()
    })
  })
})
