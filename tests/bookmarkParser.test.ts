import { describe, it, expect } from 'vitest'
import { extractBookmarks } from '../src/utils/bookmarkParser'

/** Write a little-endian u32 into a buffer. */
function writeU32(data: Uint8Array, off: number, v: number) {
  data[off] = v & 0xff
  data[off + 1] = (v >> 8) & 0xff
  data[off + 2] = (v >> 16) & 0xff
  data[off + 3] = (v >> 24) & 0xff
}

/** Write a little-endian u16 into a buffer. */
function writeU16(data: Uint8Array, off: number, v: number) {
  data[off] = v & 0xff
  data[off + 1] = (v >> 8) & 0xff
}

/**
 * Build a table stream with PlcfBkf, PlcfBkl and SttbfBkmk side by side.
 * Returns the buffer plus the offsets of each section.
 */
function buildBookmarkTable(options: {
  bkfCps: number[]
  bkfBklIndices: number[]
  bklCps: number[]
  names: string[]
  utf16Names?: boolean
}): { buffer: Uint8Array; fcBkf: number; lcbBkf: number; fcBkl: number; lcbBkl: number; fcSttb: number; lcbSttb: number } {
  const { bkfCps, bkfBklIndices, bklCps, names, utf16Names = true } = options

  // PlcfBkf: (n+1) CPs + n BKF(4 bytes each)
  const n = bkfBklIndices.length
  const bkfSize = (n + 1) * 4 + n * 4
  // PlcfBkl: (m+1) CPs + m BKL(4 bytes each)
  const m = bklCps.length - 1
  const bklSize = (m + 1) * 4 + m * 4
  // SttbfBkmk: fExtend(2) + cbSttb(2) + [cch(2) + chars + terminator]...
  let sttbSize = 4
  for (const name of names) {
    sttbSize += 2 + (utf16Names ? (name.length + 1) * 2 : name.length + 1)
  }

  const fcBkf = 0
  const fcBkl = bkfSize
  const fcSttb = bkfSize + bklSize
  const buffer = new Uint8Array(bkfSize + bklSize + sttbSize + 8)

  // PlcfBkf: aFC[]
  let off = fcBkf
  for (const cp of bkfCps) { writeU32(buffer, off, cp); off += 4 }
  // aBKF[]
  for (const idx of bkfBklIndices) {
    writeU16(buffer, off, idx)
    off += 4 // 4 bytes per BKF (ibkl + reserved)
  }

  // PlcfBkl: aFC[] + aBKL[]
  off = fcBkl
  for (const cp of bklCps) { writeU32(buffer, off, cp); off += 4 }
  for (let i = 0; i < m; i++) { writeU32(buffer, off, 0); off += 4 }

  // SttbfBkmk
  off = fcSttb
  writeU16(buffer, off, utf16Names ? 0xFFFF : 0x0000)
  off += 2
  writeU16(buffer, off, names.length)
  off += 2
  for (const name of names) {
    writeU16(buffer, off, name.length + 1) // cch includes terminator
    off += 2
    if (utf16Names) {
      for (const ch of name) { writeU16(buffer, off, ch.charCodeAt(0)); off += 2 }
      writeU16(buffer, off, 0); off += 2 // terminator
    } else {
      for (const ch of name) { buffer[off] = ch.charCodeAt(0); off += 1 }
      buffer[off] = 0; off += 1
    }
  }

  return {
    buffer,
    fcBkf, lcbBkf: bkfSize,
    fcBkl, lcbBkl: bklSize,
    fcSttb, lcbSttb: sttbSize,
  }
}

describe('bookmarkParser', () => {
  it('should return empty array for empty table data', () => {
    expect(extractBookmarks(new Uint8Array(0), 0, 0, 0, 0, 0, 0)).toEqual([])
  })

  it('should return empty array when PlcfBkf is empty', () => {
    const data = new Uint8Array(64)
    expect(extractBookmarks(data, 0, 0, 20, 20, 40, 20)).toEqual([])
  })

  it('should extract bookmarks with names and ranges (fc=0 at table start)', () => {
    const { buffer, fcBkf, lcbBkf, fcBkl, lcbBkl, fcSttb, lcbSttb } = buildBookmarkTable({
      bkfCps: [0, 10, 30],
      bkfBklIndices: [0, 1],
      bklCps: [10, 20, 40],
      names: ['FirstBookmark', 'SecondBookmark'],
    })
    const bookmarks = extractBookmarks(buffer, fcBkf, lcbBkf, fcBkl, lcbBkl, fcSttb, lcbSttb)
    expect(bookmarks).toHaveLength(2)
    expect(bookmarks[0]).toEqual({ name: 'FirstBookmark', cpStart: 0, cpEnd: 10 })
    expect(bookmarks[1]).toEqual({ name: 'SecondBookmark', cpStart: 10, cpEnd: 20 })
  })

  it('should associate cpEnd through bklIndex', () => {
    // bkl index 1 → the second end CP (30); n=1 needs 2 CPs in PlcfBkf
    const { buffer, fcBkf, lcbBkf, fcBkl, lcbBkl, fcSttb, lcbSttb } = buildBookmarkTable({
      bkfCps: [5, 6],
      bkfBklIndices: [1],
      bklCps: [10, 30],
      names: ['Jump'],
    })
    const bookmarks = extractBookmarks(buffer, fcBkf, lcbBkf, fcBkl, lcbBkl, fcSttb, lcbSttb)
    expect(bookmarks[0].cpEnd).toBe(30)
  })

  it('should fall back to cpStart when bklIndex is out of range', () => {
    const { buffer, fcBkf, lcbBkf, fcBkl, lcbBkl, fcSttb, lcbSttb } = buildBookmarkTable({
      bkfCps: [7, 8],
      bkfBklIndices: [5], // out of range
      bklCps: [10],
      names: ['Broken'],
    })
    const bookmarks = extractBookmarks(buffer, fcBkf, lcbBkf, fcBkl, lcbBkl, fcSttb, lcbSttb)
    expect(bookmarks[0].cpEnd).toBe(7)
  })

  it('should skip invalid ranges (cpStart > cpEnd)', () => {
    const { buffer, fcBkf, lcbBkf, fcBkl, lcbBkl, fcSttb, lcbSttb } = buildBookmarkTable({
      bkfCps: [20, 21],
      bkfBklIndices: [0],
      bklCps: [5, 6], // end (5) before start (20)
      names: ['Bad'],
    })
    const bookmarks = extractBookmarks(buffer, fcBkf, lcbBkf, fcBkl, lcbBkl, fcSttb, lcbSttb)
    expect(bookmarks).toHaveLength(0)
  })

  it('should use generated names when the name table is missing', () => {
    const { buffer, fcBkf, lcbBkf, fcBkl, lcbBkl } = buildBookmarkTable({
      bkfCps: [0, 10],
      bkfBklIndices: [0],
      bklCps: [10],
      names: [],
    })
    const bookmarks = extractBookmarks(buffer, fcBkf, lcbBkf, fcBkl, lcbBkl, 0, 0)
    expect(bookmarks).toHaveLength(1)
    expect(bookmarks[0].name).toBe('书签0')
  })

  it('should parse 8-bit (non-UTF16) name tables', () => {
    const { buffer, fcBkf, lcbBkf, fcBkl, lcbBkl, fcSttb, lcbSttb } = buildBookmarkTable({
      bkfCps: [0, 10],
      bkfBklIndices: [0],
      bklCps: [10],
      names: ['Legacy'],
      utf16Names: false,
    })
    const bookmarks = extractBookmarks(buffer, fcBkf, lcbBkf, fcBkl, lcbBkl, fcSttb, lcbSttb)
    expect(bookmarks[0].name).toBe('Legacy')
  })

  it('should parse CJK bookmark names', () => {
    const { buffer, fcBkf, lcbBkf, fcBkl, lcbBkl, fcSttb, lcbSttb } = buildBookmarkTable({
      bkfCps: [0, 10],
      bkfBklIndices: [0],
      bklCps: [10],
      names: ['第一章'],
    })
    const bookmarks = extractBookmarks(buffer, fcBkf, lcbBkf, fcBkl, lcbBkl, fcSttb, lcbSttb)
    expect(bookmarks[0].name).toBe('第一章')
  })

  it('should fall back to generated names for empty name strings', () => {
    // Empty name in the STTB is falsy → falls back to '书签N'
    const { buffer, fcBkf, lcbBkf, fcBkl, lcbBkl, fcSttb, lcbSttb } = buildBookmarkTable({
      bkfCps: [0, 10],
      bkfBklIndices: [0],
      bklCps: [10],
      names: [''],
    })
    const bookmarks = extractBookmarks(buffer, fcBkf, lcbBkf, fcBkl, lcbBkl, fcSttb, lcbSttb)
    expect(bookmarks).toHaveLength(1)
    expect(bookmarks[0].name).toBe('书签0')
  })

  it('should ignore invalid fc/lcb parameters', () => {
    const { buffer } = buildBookmarkTable({
      bkfCps: [0, 10],
      bkfBklIndices: [0],
      bklCps: [10],
      names: ['X'],
    })
    // fc=0 / lcb=0 → empty results
    expect(extractBookmarks(buffer, 0, 0, 0, 0, 0, 0)).toEqual([])
    // out-of-bounds fc+lcb → empty results
    expect(extractBookmarks(buffer, 1000, 100, 1000, 100, 1000, 100)).toEqual([])
  })
})
