import { describe, it, expect } from 'vitest'
import { dttmToTimestamp, parseSttbfRMark, parseRmrk } from '../src/utils/revisionParser'

/**
 * Build a DTTM 4-byte value from date components (MS-DOC §2.3.1 layout).
 *   bits 0-5: minutes, 6-10: hours, 11-15: day, 16-19: month, 20-30: year-1900
 */
function buildDttm(year: number, month: number, day: number, hours: number, minutes: number): number {
  const yr = (year - 1900) & 0x7FF
  return (minutes & 0x3F)
    | ((hours & 0x1F) << 6)
    | ((day & 0x1F) << 11)
    | ((month & 0xF) << 16)
    | (yr << 20)
}

/**
 * Build a Unicode STTB (SttbfRMark) from a list of author names.
 * Layout: fExtend(2)=0xFFFF + cbSttb(2) + [cbString(2) + UTF-16LE chars]...
 */
function buildUnicodeSttb(authors: string[]): Uint8Array {
  const parts: Uint8Array[] = []
  // fExtend = 0xFFFF (Unicode)
  parts.push(new Uint8Array([0xFF, 0xFF]))
  // cbSttb = number of strings
  const cbSttb = authors.length
  parts.push(new Uint8Array([cbSttb & 0xFF, (cbSttb >> 8) & 0xFF]))
  for (const name of authors) {
    const chars = [...name]
    const cbString = chars.length
    parts.push(new Uint8Array([cbString & 0xFF, (cbString >> 8) & 0xFF]))
    const strBytes = new Uint8Array(cbString * 2)
    for (let i = 0; i < chars.length; i++) {
      const code = chars[i].charCodeAt(0)
      strBytes[i * 2] = code & 0xFF
      strBytes[i * 2 + 1] = (code >> 8) & 0xFF
    }
    parts.push(strBytes)
  }
  const total = parts.reduce((s, p) => s + p.length, 0)
  const result = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    result.set(p, off)
    off += p.length
  }
  return result
}

describe('revisionParser', () => {
  describe('dttmToTimestamp', () => {
    it('should return undefined for DTTM=0 (no timestamp)', () => {
      expect(dttmToTimestamp(0)).toBeUndefined()
    })

    it('should convert a valid DTTM to Unix milliseconds', () => {
      // 2024-03-15 14:30
      const dttm = buildDttm(2024, 3, 15, 14, 30)
      const ts = dttmToTimestamp(dttm)
      expect(ts).toBeDefined()
      const date = new Date(ts!)
      expect(date.getFullYear()).toBe(2024)
      expect(date.getMonth()).toBe(2) // 0-based: March = 2
      expect(date.getDate()).toBe(15)
      expect(date.getHours()).toBe(14)
      expect(date.getMinutes()).toBe(30)
    })

    it('should handle year 1900 (year-1900=0)', () => {
      const dttm = buildDttm(1900, 1, 1, 0, 0)
      const ts = dttmToTimestamp(dttm)
      expect(ts).toBeDefined()
      const date = new Date(ts!)
      expect(date.getFullYear()).toBe(1900)
    })

    it('should return undefined for invalid month (>12)', () => {
      const dttm = buildDttm(2024, 13, 15, 14, 30)
      expect(dttmToTimestamp(dttm)).toBeUndefined()
    })

    it('should return undefined for invalid day (>31)', () => {
      const dttm = buildDttm(2024, 3, 32, 14, 30)
      expect(dttmToTimestamp(dttm)).toBeUndefined()
    })

    it('should return undefined for invalid hours (>23)', () => {
      const dttm = buildDttm(2024, 3, 15, 25, 30)
      expect(dttmToTimestamp(dttm)).toBeUndefined()
    })

    it('should return undefined for invalid minutes (>59)', () => {
      const dttm = buildDttm(2024, 3, 15, 14, 60)
      expect(dttmToTimestamp(dttm)).toBeUndefined()
    })
  })

  describe('parseSttbfRMark', () => {
    it('should return empty array for invalid input', () => {
      expect(parseSttbfRMark(new Uint8Array(0), 0, 0)).toEqual([])
      expect(parseSttbfRMark(new Uint8Array(100), -1, 10)).toEqual([])
      expect(parseSttbfRMark(new Uint8Array(100), 0, 200)).toEqual([])
    })

    it('should return empty array when lcb is 0', () => {
      expect(parseSttbfRMark(new Uint8Array(100), 0, 0)).toEqual([])
    })

    it('should parse a Unicode STTB with multiple authors', () => {
      const sttb = buildUnicodeSttb(['Alice', 'Bob', '张三'])
      const authors = parseSttbfRMark(sttb, 0, sttb.length)
      expect(authors).toEqual(['Alice', 'Bob', '张三'])
    })

    it('should parse a Unicode STTB with a single author', () => {
      const sttb = buildUnicodeSttb(['John Doe'])
      const authors = parseSttbfRMark(sttb, 0, sttb.length)
      expect(authors).toEqual(['John Doe'])
    })

    it('should parse an empty author table (cbSttb=0)', () => {
      const sttb = buildUnicodeSttb([])
      const authors = parseSttbfRMark(sttb, 0, sttb.length)
      expect(authors).toEqual([])
    })

    it('should handle STTB embedded at a non-zero offset', () => {
      const sttb = buildUnicodeSttb(['Alice', 'Bob'])
      const prefix = new Uint8Array(50)
      const combined = new Uint8Array(prefix.length + sttb.length)
      combined.set(prefix, 0)
      combined.set(sttb, prefix.length)
      const authors = parseSttbfRMark(combined, prefix.length, sttb.length)
      expect(authors).toEqual(['Alice', 'Bob'])
    })

    it('should return empty array when cbSttb is absurdly large', () => {
      // fExtend=0xFFFF + cbSttb=50000 (exceeds sanity check)
      const data = new Uint8Array([0xFF, 0xFF, 0xC8, 0x32])
      expect(parseSttbfRMark(data, 0, data.length)).toEqual([])
    })

    it('should handle truncated string data gracefully', () => {
      // Build STTB claiming 3 authors but only provide data for 1.5
      const parts: Uint8Array[] = [
        new Uint8Array([0xFF, 0xFF]),       // fExtend
        new Uint8Array([0x03, 0x00]),       // cbSttb = 3
        new Uint8Array([0x03, 0x00]),       // cbString = 3 ("Bob")
        new Uint8Array([0x42, 0x00, 0x6F, 0x00, 0x62, 0x00]), // "Bob" UTF-16LE
        new Uint8Array([0x05, 0x00]),       // cbString = 5, but no data follows
      ]
      const total = parts.reduce((s, p) => s + p.length, 0)
      const data = new Uint8Array(total)
      let off = 0
      for (const p of parts) { data.set(p, off); off += p.length }
      const authors = parseSttbfRMark(data, 0, data.length)
      // Should have parsed "Bob" then stopped at the truncated second entry
      expect(authors.length).toBe(1)
      expect(authors[0]).toBe('Bob')
    })
  })

  describe('parseRmrk', () => {
    it('should return null for data too short (< 6 bytes)', () => {
      expect(parseRmrk(new Uint8Array([1, 2, 3, 4, 5]), 0)).toBeNull()
      expect(parseRmrk(new Uint8Array(0), 0)).toBeNull()
    })

    it('should return null for negative offset', () => {
      expect(parseRmrk(new Uint8Array(10), -1)).toBeNull()
    })

    it('should parse author index and timestamp from a 6-byte RMRK', () => {
      // authorIndex=5, DTTM for 2024-03-15 14:30
      const dttm = buildDttm(2024, 3, 15, 14, 30)
      const data = new Uint8Array(6)
      data[0] = 5          // authorIndex low byte
      data[1] = 0          // authorIndex high byte
      data[2] = dttm & 0xFF
      data[3] = (dttm >> 8) & 0xFF
      data[4] = (dttm >> 16) & 0xFF
      data[5] = (dttm >> 24) & 0xFF
      const rmrk = parseRmrk(data, 0)
      expect(rmrk).not.toBeNull()
      expect(rmrk!.authorIndex).toBe(5)
      expect(rmrk!.timestamp).toBeDefined()
      const date = new Date(rmrk!.timestamp!)
      expect(date.getFullYear()).toBe(2024)
      expect(date.getMonth()).toBe(2)
      expect(date.getDate()).toBe(15)
    })

    it('should return undefined timestamp when DTTM is 0', () => {
      const data = new Uint8Array(6)
      data[0] = 3
      data[1] = 0
      // DTTM = 0 (bytes 2-5 all 0)
      const rmrk = parseRmrk(data, 0)
      expect(rmrk).not.toBeNull()
      expect(rmrk!.authorIndex).toBe(3)
      expect(rmrk!.timestamp).toBeUndefined()
    })

    it('should parse RMRK at a non-zero offset', () => {
      const dttm = buildDttm(2020, 6, 1, 9, 15)
      const data = new Uint8Array(20)
      const offset = 10
      data[offset] = 12
      data[offset + 1] = 0
      data[offset + 2] = dttm & 0xFF
      data[offset + 3] = (dttm >> 8) & 0xFF
      data[offset + 4] = (dttm >> 16) & 0xFF
      data[offset + 5] = (dttm >> 24) & 0xFF
      const rmrk = parseRmrk(data, offset)
      expect(rmrk).not.toBeNull()
      expect(rmrk!.authorIndex).toBe(12)
      expect(rmrk!.timestamp).toBeDefined()
      const date = new Date(rmrk!.timestamp!)
      expect(date.getFullYear()).toBe(2020)
      expect(date.getMonth()).toBe(5) // June = 5
    })
  })
})
