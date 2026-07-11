import { describe, it, expect } from 'vitest'
import { parsePlcfFld, extractHyperlinks } from '../src/utils/fieldParser'

function writeUint32(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = value & 0xFF
  buffer[offset + 1] = (value >> 8) & 0xFF
  buffer[offset + 2] = (value >> 16) & 0xFF
  buffer[offset + 3] = (value >> 24) & 0xFF
}

function writeUtf16le(buffer: Uint8Array, offset: number, str: string): number {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    buffer[offset + i * 2] = code & 0xFF
    buffer[offset + i * 2 + 1] = (code >> 8) & 0xFF
  }
  return str.length * 2
}

describe('fieldParser', () => {
  describe('parsePlcfFld', () => {
    it('should return empty array for zero-length input', () => {
      expect(parsePlcfFld(new Uint8Array(0), 0, 0)).toEqual([])
    })

    it('should return empty array for too-small input', () => {
      expect(parsePlcfFld(new Uint8Array(8), 0, 8)).toEqual([])
    })

    it('should parse a single field entry', () => {
      // Create PlcfFld with 1 field entry (but actually needs 3 for begin/sep/end)
      // For simplicity, test with 3 entries
      const n = 3
      const totalSize = (n + 1) * 4 + n * 2 // 16 + 6 = 22
      const buf = new Uint8Array(totalSize)
      let pos = 0

      // CPs: 0, 10, 20, 30
      writeUint32(buf, pos, 0); pos += 4
      writeUint32(buf, pos, 10); pos += 4
      writeUint32(buf, pos, 20); pos += 4
      writeUint32(buf, pos, 30); pos += 4

      // FLD entries
      buf[pos++] = 0x13 // ch = begin
      buf[pos++] = 37   // flt = HYPERLINK
      buf[pos++] = 0x14 // ch = sep
      buf[pos++] = 0
      buf[pos++] = 0x15 // ch = end
      buf[pos++] = 0

      const result = parsePlcfFld(buf, 0, totalSize)
      expect(result.length).toBe(3)
      expect(result[0]).toEqual({ cp: 0, ch: 0x13, flt: 37 })
      expect(result[1]).toEqual({ cp: 10, ch: 0x14, flt: 0 })
      expect(result[2]).toEqual({ cp: 20, ch: 0x15, flt: 0 })
    })

    it('should respect fc offset', () => {
      const n = 1
      const totalSize = (n + 1) * 4 + n * 2 // 8 + 2 = 10
      const buf = new Uint8Array(totalSize + 10)
      let pos = 5

      writeUint32(buf, pos, 100); pos += 4
      writeUint32(buf, pos, 200); pos += 4
      buf[pos++] = 0x13
      buf[pos++] = 37

      const result = parsePlcfFld(buf, 5, totalSize)
      expect(result.length).toBe(1)
      expect(result[0].cp).toBe(100)
    })
  })

  describe('extractHyperlinks', () => {
    it('should return empty array for empty field list', () => {
      expect(extractHyperlinks([], '')).toEqual([])
    })

    it('should extract a HYPERLINK field', () => {
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 37 },  // begin
        { cp: 35, ch: 0x14, flt: 0 },  // sep (after instruction)
        { cp: 50, ch: 0x15, flt: 0 },  // end
      ]

      // Instruction: 'HYPERLINK "https://example.com"' = 34 chars
      // CP range: 1 to 35 (skip 0x13 at cp=0)
      const textBytes = new Uint8Array(120)
      const instr = 'HYPERLINK "https://example.com"'
      // Write at CP=1 (byte offset 2)
      writeUtf16le(textBytes, 2, instr)

      // Result text at CP=36 to 50
      const result = extractHyperlinks(fldEntries, 'Click here', textBytes)
      expect(result.length).toBe(1)
      expect(result[0].flt).toBe(37)
      expect(result[0].url).toBe('https://example.com')
    })

    it('should skip non-HYPERLINK fields', () => {
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 19 },  // begin (PAGE field)
        { cp: 5, ch: 0x14, flt: 0 },   // sep
        { cp: 10, ch: 0x15, flt: 0 },  // end
      ]

      const result = extractHyperlinks(fldEntries, 'Page 1', new Uint8Array(20))
      expect(result.length).toBe(0)
    })

    it('should handle malformed field triples gracefully', () => {
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 37 },
        { cp: 10, ch: 0x15, flt: 0 }, // Wrong: should be 0x14
        { cp: 20, ch: 0x14, flt: 0 },
      ]

      const result = extractHyperlinks(fldEntries, 'text', new Uint8Array(50))
      expect(result.length).toBe(0)
    })

    it('should extract multiple HYPERLINK fields', () => {
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 37 },
        { cp: 25, ch: 0x14, flt: 0 },
        { cp: 35, ch: 0x15, flt: 0 },
        { cp: 40, ch: 0x13, flt: 37 },
        { cp: 60, ch: 0x14, flt: 0 },
        { cp: 70, ch: 0x15, flt: 0 },
      ]

      const textBytes = new Uint8Array(160)
      writeUtf16le(textBytes, 2, 'HYPERLINK "http://a.com"')
      writeUtf16le(textBytes, 82, 'HYPERLINK "http://b.com"')

      const result = extractHyperlinks(fldEntries, 'Link1Link2', textBytes)
      expect(result.length).toBe(2)
    })
  })
})