import { describe, it, expect } from 'vitest'
import { parseFontTable } from '../src/utils/fontParser'

/** Write a little-endian u16. */
function writeU16(data: Uint8Array, off: number, v: number) {
  data[off] = v & 0xff
  data[off + 1] = (v >> 8) & 0xff
}

/**
 * Build an STTB Ffn table with the given font names.
 * Each FFN: cbFfn(1) + flags(3) + weight(2) + chs(1) + ixchSzAlt(1)
 *   + panose(10) + fs(2) + xszFfn(UTF-16LE, null-terminated)
 * Fixed header before the name = 1+3+2+1+1+10+2 = 20 bytes, but the name
 * offset is pos+18 per the parser's convention (cbFfn byte included).
 */
function buildFontTable(names: string[]): Uint8Array {
  // FFN: cbFfn(1) + flags(3) + weight(2) + chs(1) + ixchSzAlt(1)
  //   + panose(10) + fs(2) = 19 bytes header, then xszFfn (UTF-16LE + NUL)
  const headerSize = 19
  const entries: Uint8Array[] = []
  for (const name of names) {
    const nameBytes = name.length * 2 + 2
    const cbFfn = headerSize + nameBytes
    const entry = new Uint8Array(cbFfn)
    entry[0] = cbFfn
    // xszFfn starts at offset 18 (parser reads name at pos + 18)
    for (let i = 0; i < name.length; i++) {
      const code = name.charCodeAt(i)
      entry[18 + i * 2] = code & 0xff
      entry[18 + i * 2 + 1] = (code >> 8) & 0xff
    }
    // null terminator (already zero)
    entries.push(entry)
  }

  const total = 2 + entries.reduce((s, e) => s + e.length, 0)
  const buf = new Uint8Array(total)
  writeU16(buf, 0, names.length) // cFfn
  let off = 2
  for (const e of entries) {
    buf.set(e, off)
    off += e.length
  }
  return buf
}

describe('fontParser', () => {
  it('should return empty array for invalid parameters', () => {
    expect(parseFontTable(new Uint8Array(0), 0, 0)).toEqual([])
    expect(parseFontTable(new Uint8Array(10), 5, 10)).toEqual([]) // fc+lcb > length
    expect(parseFontTable(new Uint8Array(10), -1, 5)).toEqual([])
  })

  it('should return empty array when the count field is missing', () => {
    expect(parseFontTable(new Uint8Array([0x01]), 0, 1)).toEqual([])
  })

  it('should reject an absurd font count', () => {
    const data = new Uint8Array(10)
    writeU16(data, 0, 1001) // cFfn > 1000
    expect(parseFontTable(data, 0, 10)).toEqual([])
  })

  it('should parse font names', () => {
    const buf = buildFontTable(['Times New Roman', 'Arial'])
    const fonts = parseFontTable(buf, 0, buf.length)
    expect(fonts).toEqual(['Times New Roman', 'Arial'])
  })

  it('should parse CJK font names', () => {
    const buf = buildFontTable(['宋体', '黑体'])
    const fonts = parseFontTable(buf, 0, buf.length)
    expect(fonts).toEqual(['宋体', '黑体'])
  })

  it('should parse a font table embedded at a non-zero offset', () => {
    const inner = buildFontTable(['Calibri'])
    const prefix = new Uint8Array(20)
    const combined = new Uint8Array(prefix.length + inner.length)
    combined.set(prefix, 0)
    combined.set(inner, prefix.length)
    const fonts = parseFontTable(combined, prefix.length, inner.length)
    expect(fonts).toEqual(['Calibri'])
  })

  it('should skip malformed entries with a generated name', () => {
    // cFfn = 2: first entry valid, second entry too short (cbFfn < 19)
    const good = buildFontTable(['Good'])
    const goodEntry = good.subarray(2) // strip the cFfn header
    const bad = new Uint8Array([5, 0, 0, 0, 0, 0]) // cbFfn=5 too short
    const combined = new Uint8Array(2 + goodEntry.length + bad.length)
    writeU16(combined, 0, 2)
    combined.set(goodEntry, 2)
    combined.set(bad, 2 + goodEntry.length)
    const fonts = parseFontTable(combined, 0, combined.length)
    expect(fonts[0]).toBe('Good')
    // The malformed entry is skipped (pos += 1), leaving no room for more
    expect(fonts.length).toBe(1)
  })

  it('should skip out-of-bounds entries', () => {
    // cFfn = 1 but the entry claims more bytes than available
    const data = new Uint8Array(10)
    writeU16(data, 0, 1)
    data[2] = 50 // cbFfn = 50 > remaining
    const fonts = parseFontTable(data, 0, 10)
    expect(fonts).toEqual([])
  })
})
