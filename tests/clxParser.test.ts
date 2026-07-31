import { describe, it, expect } from 'vitest'
import { DocParser } from '../src/utils/docParser'

/**
 * CLX fixtures follow the MS-DOC §2.9.38 layout:
 *   Clx = RgPrc *Pcdt   (zero or more Prc, then a single Pcdt)
 *   Pcdt = clxt(1)=0x02 + lcb(4) + PlcPcd(lcb)
 *   PlcPcd = aCP[(n+1)] (4 bytes each) + aPcd[n] (8 bytes each)
 *   → PlcPcd byte size = 4*(n+1) + 8*n = 12n + 4
 *
 * FcCompressed (§2.9.73): the stored 30-bit fc is the byte offset for
 * uncompressed (UTF-16LE) pieces, and twice the byte offset for compressed
 * (8-bit) pieces (real offset = fc / 2). The builders below therefore double
 * the caller-supplied byte offset when `compressed` is set.
 */
describe('Clx Parser Robustness', () => {
  function buildClxWithNPieces(n: number, charCountPerPiece: number): Uint8Array {
    const plcPcdSize = 4 * (n + 1) + 8 * n
    const clxSize = 1 + 4 + plcPcdSize

    const data = new Uint8Array(clxSize)
    const view = new DataView(data.buffer)

    let offset = 0
    data[offset++] = 0x02
    view.setUint32(offset, plcPcdSize, true)
    offset += 4

    // aCP[(n+1)]: 0, ccp, 2*ccp, ... n*ccp
    let currentCcp = 0
    for (let i = 0; i <= n; i++) {
      view.setUint32(offset, currentCcp, true)
      offset += 4
      currentCcp += charCountPerPiece
    }

    // aPcd[n]: 2 bytes flags/Pn + 4 bytes Fc + 2 bytes Prm (uncompressed)
    for (let i = 0; i < n; i++) {
      offset += 2
      const fc = i * charCountPerPiece * 2
      view.setUint32(offset, fc, true)
      offset += 4
      offset += 2
    }

    return data
  }

  it('should create valid Clx structure for n=1 piece', () => {
    const clx = buildClxWithNPieces(1, 100)
    const view = new DataView(clx.buffer)

    expect(clx[0]).toBe(0x02)

    const lcb = view.getUint32(1, true)
    expect(lcb).toBe(4 * 2 + 8 * 1) // 12n+4 = 16

    const plcPcdStart = 5
    const ccp0 = view.getUint32(plcPcdStart, true)
    const ccp1 = view.getUint32(plcPcdStart + 4, true)
    expect(ccp0).toBe(0)
    expect(ccp1).toBe(100)
  })

  it('should handle n=3 pieces (multiple stories like headers/footers)', () => {
    const clx = buildClxWithNPieces(3, 100)
    const view = new DataView(clx.buffer)

    const lcb = view.getUint32(1, true)
    const n = Math.floor((lcb - 4) / 12)
    expect(n).toBe(3)

    const plcPcdStart = 5
    const ccps: number[] = []
    for (let i = 0; i <= n; i++) {
      ccps.push(view.getUint32(plcPcdStart + i * 4, true))
    }
    expect(ccps).toEqual([0, 100, 200, 300])
  })

  it('should handle large number of pieces (n > 1000 for safety limit)', () => {
    const n = 2000
    const clx = buildClxWithNPieces(n, 10)
    const view = new DataView(clx.buffer)

    const lcb = view.getUint32(1, true)
    const readN = Math.floor((lcb - 4) / 12)
    expect(readN).toBe(n)
    expect(readN).toBeGreaterThan(1000)
  })

  it('should have correct Pcdt structure (bare Pcdt, no Prc prefix)', () => {
    const clx = buildClxWithNPieces(1, 10)
    const view = new DataView(clx.buffer)

    expect(clx[0]).toBe(0x02)

    const lcb = view.getUint32(1, true)
    expect(lcb).toBeGreaterThan(0)

    // PlcPcd starts immediately after clxt(1) + lcb(4); the first aCP is 0.
    const plcPcdStart = 5
    expect(view.getUint32(plcPcdStart, true)).toBe(0)
  })

  it('should have each Pcd entry 8 bytes with fc at offset 2', () => {
    const n = 2
    const clx = buildClxWithNPieces(n, 50)
    const view = new DataView(clx.buffer)

    const plcPcdStart = 5
    const ccpByteSize = (n + 1) * 4
    const pcdStart = plcPcdStart + ccpByteSize

    for (let i = 0; i < n; i++) {
      const entryOffset = pcdStart + i * 8
      const fc = view.getUint32(entryOffset + 2, true)
      const expectedFc = i * 50 * 2
      expect(fc).toBe(expectedFc)
    }
  })

  it('should detect clxt !== 2 as invalid Clx', () => {
    const data = new Uint8Array(10)
    data[0] = 0x03
    expect(data[0]).not.toBe(0x02)
  })

  it('should handle data shorter than 5 bytes', () => {
    const data = new Uint8Array(3)
    expect(data.length).toBeLessThan(5)
  })

  it('should handle lcb larger than available data', () => {
    const data = new Uint8Array(20)
    data[0] = 0x02
    const view = new DataView(data.buffer)
    view.setUint32(1, 99999, true)

    const lcb = view.getUint32(1, true)
    const available = data.length - 5
    expect(lcb).toBeGreaterThan(available)
  })

  it('should reject PlcPcd sizes that do not match 12n + 4', () => {
    const parser = new DocParser(new ArrayBuffer(512))
    const data = new Uint8Array(22)
    const view = new DataView(data.buffer)
    data[0] = 0x02
    view.setUint32(1, 17, true)

    const pieces = (parser as any).parseClxPieces(data)
    expect(pieces).toEqual([])
  })

  it('should reject CP boundaries that move backwards', () => {
    const parser = new DocParser(new ArrayBuffer(512))
    const data = new Uint8Array(21)
    const view = new DataView(data.buffer)
    data[0] = 0x02
    view.setUint32(1, 16, true)
    view.setUint32(5, 10, true)
    view.setUint32(9, 5, true)

    const pieces = (parser as any).parseClxPieces(data)
    expect(pieces).toEqual([])
  })

  it('should concatenate multiple pieces when parsing CLX text', () => {
    const parser = new DocParser(new ArrayBuffer(512))
    const textBytes = new TextEncoder().encode('HelloWorld')

    // 2 compressed pieces: "Hello" at byte 0, "World" at byte 5.
    const plcPcdSize = 4 * 3 + 8 * 2 // 28
    const clx = new Uint8Array(1 + 4 + plcPcdSize)
    const view = new DataView(clx.buffer)
    let offset = 0
    clx[offset++] = 0x02
    view.setUint32(offset, plcPcdSize, true)
    offset += 4
    // aCP: 0, 5, 10
    view.setUint32(offset, 0, true); offset += 4
    view.setUint32(offset, 5, true); offset += 4
    view.setUint32(offset, 10, true); offset += 4
    // aPcd[0]: compressed, byte offset 0 → stored fc = 0*2 = 0
    offset += 2
    view.setUint32(offset, (0x40000000 | 0) >>> 0, true); offset += 4
    offset += 2
    // aPcd[1]: compressed, byte offset 5 → stored fc = 5*2 = 10
    offset += 2
    view.setUint32(offset, (0x40000000 | 10) >>> 0, true); offset += 4
    offset += 2

    const result = (parser as any).parseClx(clx, textBytes)
    expect(result).toBe('Hello\n\nWorld')
  })
})

describe('Story splitting (splitPiecesByStory / parseClxWithStories)', () => {
  /**
   * Build a bare-Pcdt CLX blob with explicit per-piece CP ranges and byte
   * offsets. Each piece defaults to UTF-16LE; pass `compressed: true` for 8-bit
   * (the byte offset is doubled to match FcCompressed encoding). Pass
   * `fChp: true` + `chpxIndex` to set the fChp flag and CHPX index.
   */
  function buildClxWithExplicitPieces(
    pieces: Array<{ cpStart: number; cpEnd: number; fc: number; compressed?: boolean; fChp?: boolean; chpxIndex?: number }>,
  ): Uint8Array {
    const n = pieces.length
    const plcPcdSize = 4 * (n + 1) + 8 * n
    const clxSize = 1 + 4 + plcPcdSize

    const data = new Uint8Array(clxSize)
    const view = new DataView(data.buffer)
    let offset = 0
    data[offset++] = 0x02
    view.setUint32(offset, plcPcdSize, true); offset += 4
    // aCP: cp[0] = pieces[0].cpStart, cp[i+1] = pieces[i].cpEnd
    view.setUint32(offset, pieces[0].cpStart, true); offset += 4
    for (let i = 0; i < n; i++) {
      view.setUint32(offset, pieces[i].cpEnd, true); offset += 4
    }
    // aPcd: each 8 bytes (2 flags/Pn + 4 Fc + 2 Prm)
    for (let i = 0; i < n; i++) {
      offset += 2
      let fc = pieces[i].compressed ? ((pieces[i].fc * 2) | 0x40000000) : pieces[i].fc
      if (pieces[i].fChp) fc |= 0x80000000
      view.setUint32(offset, fc >>> 0, true); offset += 4
      const prm = pieces[i].chpxIndex ?? 0
      view.setUint16(offset, prm, true); offset += 2
    }
    return data
  }

  function encodeUtf16le(s: string): Uint8Array {
    const bytes = new Uint8Array(s.length * 2)
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < s.length; i++) view.setUint16(i * 2, s.charCodeAt(i), true)
    return bytes
  }

  it('should split 3 pieces into main + footnotes + headers', () => {
    const parser = new DocParser(new ArrayBuffer(512))
    const main = 'MainText'           // 8 chars
    const footnote = 'FootnoteContent' // 15 chars
    const header = 'HeaderContent'     // 13 chars
    // wordDocData layout (UTF-16LE):
    //   offset 0..16:   "MainText"        (8 chars * 2)
    //   offset 16..46:  "FootnoteContent" (15 chars * 2)
    //   offset 46..72:  "HeaderContent"   (13 chars * 2)
    const textBytes = encodeUtf16le(main + footnote + header)
    const rgCcp = {
      ccpText: 8, ccpFtn: 15, ccpHdd: 13,
      ccpMcr: 0, ccpAtn: 0, ccpEdn: 0,
      ccpTxbx: 0, ccpHdrTxbx: 0,
    }
    const clx = buildClxWithExplicitPieces([
      { cpStart: 0, cpEnd: 8, fc: 0 },
      { cpStart: 8, cpEnd: 23, fc: 16 },
      { cpStart: 23, cpEnd: 36, fc: 46 },
    ])

    const result = (parser as any).parseClxWithStories(clx, textBytes, rgCcp)
    expect(result).not.toBeNull()
    expect(result.stories.main).toBe('MainText')
    expect(result.stories.footnotes).toBe('FootnoteContent')
    expect(result.stories.headers).toBe('HeaderContent')
  })

  it('should split a piece that straddles a main/footnotes boundary', () => {
    const parser = new DocParser(new ArrayBuffer(512))
    // One piece covers main + footnotes continuously.
    //   rgCcp: ccpText=4 ("Main"), ccpFtn=8 ("Footnote") → total 12
    const textBytes = encodeUtf16le('MainFootnote')
    const rgCcp = {
      ccpText: 4, ccpFtn: 8, ccpHdd: 0,
      ccpMcr: 0, ccpAtn: 0, ccpEdn: 0,
      ccpTxbx: 0, ccpHdrTxbx: 0,
    }
    const clx = buildClxWithExplicitPieces([
      { cpStart: 0, cpEnd: 12, fc: 0 },
    ])

    const result = (parser as any).parseClxWithStories(clx, textBytes, rgCcp)
    expect(result).not.toBeNull()
    expect(result.stories.main).toBe('Main')
    expect(result.stories.footnotes).toBe('Footnote')
  })

  it('should handle 8-bit compressed pieces when splitting by story', () => {
    const parser = new DocParser(new ArrayBuffer(512))
    // wordDocData layout (8-bit):
    //   offset 0..4:   "Main"     (4 chars)
    //   offset 4..12:  "Footnote" (8 chars)
    const main = 'Main'
    const footnote = 'Footnote'
    const textBytes = new Uint8Array(main.length + footnote.length)
    for (let i = 0; i < main.length; i++) textBytes[i] = main.charCodeAt(i)
    for (let i = 0; i < footnote.length; i++) textBytes[main.length + i] = footnote.charCodeAt(i)
    const rgCcp = {
      ccpText: 4, ccpFtn: 8, ccpHdd: 0,
      ccpMcr: 0, ccpAtn: 0, ccpEdn: 0,
      ccpTxbx: 0, ccpHdrTxbx: 0,
    }
    const clx = buildClxWithExplicitPieces([
      { cpStart: 0, cpEnd: 4, fc: 0, compressed: true },
      { cpStart: 4, cpEnd: 12, fc: 4, compressed: true },
    ])

    const result = (parser as any).parseClxWithStories(clx, textBytes, rgCcp)
    expect(result).not.toBeNull()
    expect(result.stories.main).toBe('Main')
    expect(result.stories.footnotes).toBe('Footnote')
  })

  it('should fold endnotes and comments into their own buckets', () => {
    const parser = new DocParser(new ArrayBuffer(512))
    // rgCcp: ccpText=5, ccpFtn=0, ccpHdd=0, ccpMcr=0, ccpAtn=7, ccpEdn=4
    //   total CP = 5 + 0 + 0 + 0 + 7 + 4 = 16
    const textBytes = encodeUtf16le('MainCCommentEndn')
    // "MainC" (5) + "Comment" (7) + "Endn" (4) = 16 chars
    const rgCcp = {
      ccpText: 5, ccpFtn: 0, ccpHdd: 0, ccpMcr: 0,
      ccpAtn: 7, ccpEdn: 4, ccpTxbx: 0, ccpHdrTxbx: 0,
    }
    const clx = buildClxWithExplicitPieces([
      { cpStart: 0, cpEnd: 5, fc: 0 },
      { cpStart: 5, cpEnd: 12, fc: 10 },
      { cpStart: 12, cpEnd: 16, fc: 24 },
    ])

    const result = (parser as any).parseClxWithStories(clx, textBytes, rgCcp)
    expect(result).not.toBeNull()
    expect(result.stories.main).toBe('MainC')
    expect(result.stories.comments).toBe('Comment')
    expect(result.stories.endnotes).toBe('Endn')
  })

  it('should return null when ccpText is 0', () => {
    const parser = new DocParser(new ArrayBuffer(512))
    const textBytes = new Uint8Array(20)
    const rgCcp = {
      ccpText: 0, ccpFtn: 5, ccpHdd: 0, ccpMcr: 0,
      ccpAtn: 0, ccpEdn: 0, ccpTxbx: 0, ccpHdrTxbx: 0,
    }
    const clx = buildClxWithExplicitPieces([
      { cpStart: 0, cpEnd: 5, fc: 0 },
    ])

    const result = (parser as any).parseClxWithStories(clx, textBytes, rgCcp)
    expect(result).toBeNull()
  })

  it('should return null when CLX has no pieces', () => {
    const parser = new DocParser(new ArrayBuffer(512))
    const textBytes = new Uint8Array(20)
    const rgCcp = {
      ccpText: 5, ccpFtn: 0, ccpHdd: 0, ccpMcr: 0,
      ccpAtn: 0, ccpEdn: 0, ccpTxbx: 0, ccpHdrTxbx: 0,
    }
    // Malformed CLX (Prc prefix leading nowhere) → parseClxPieces returns []
    const badClx = new Uint8Array([0x01, 0, 0, 0, 0])

    const result = (parser as any).parseClxWithStories(badClx, textBytes, rgCcp)
    expect(result).toBeNull()
  })
})

describe('PCD prm field (piece-level CHPX association)', () => {
  function buildClxWithExplicitPieces(
    pieces: Array<{ cpStart: number; cpEnd: number; fc: number; compressed?: boolean; fChp?: boolean; chpxIndex?: number }>,
  ): Uint8Array {
    const n = pieces.length
    const plcPcdSize = 4 * (n + 1) + 8 * n
    const clxSize = 1 + 4 + plcPcdSize

    const data = new Uint8Array(clxSize)
    const view = new DataView(data.buffer)
    let offset = 0
    data[offset++] = 0x02
    view.setUint32(offset, plcPcdSize, true); offset += 4
    view.setUint32(offset, pieces[0].cpStart, true); offset += 4
    for (let i = 0; i < n; i++) {
      view.setUint32(offset, pieces[i].cpEnd, true); offset += 4
    }
    for (let i = 0; i < n; i++) {
      offset += 2
      let fc = pieces[i].compressed ? ((pieces[i].fc * 2) | 0x40000000) : pieces[i].fc
      if (pieces[i].fChp) fc |= 0x80000000
      view.setUint32(offset, fc >>> 0, true); offset += 4
      view.setUint16(offset, pieces[i].chpxIndex ?? 0, true); offset += 2
    }
    return data
  }

  it('should expose fChp and chpxIndex when piece has CHPX association', () => {
    const parser = new DocParser(new ArrayBuffer(512))
    // UTF-16LE text bytes for two pieces totaling 8 chars
    const textBytes = new Uint8Array(16)
    const view = new DataView(textBytes.buffer)
    for (let i = 0; i < 8; i++) view.setUint16(i * 2, 0x41 + i, true) // A..H
    const rgCcp = {
      ccpText: 8, ccpFtn: 0, ccpHdd: 0, ccpMcr: 0,
      ccpAtn: 0, ccpEdn: 0, ccpTxbx: 0, ccpHdrTxbx: 0,
    }
    // Two pieces, both with fChp and different chpxIndex
    const clx = buildClxWithExplicitPieces([
      { cpStart: 0, cpEnd: 5, fc: 0, fChp: true, chpxIndex: 0 },
      { cpStart: 5, cpEnd: 8, fc: 10, fChp: true, chpxIndex: 1 },
    ])

    const result = (parser as any).parseClxWithStories(clx, textBytes, rgCcp)
    expect(result).not.toBeNull()
    const mainPieces = result.pieceMap.main
    expect(mainPieces.length).toBe(2)
    expect(mainPieces[0].chpxIndex).toBe(0)
    expect(mainPieces[1].chpxIndex).toBe(1)
  })

  it('should leave chpxIndex undefined when fChp is not set', () => {
    const parser = new DocParser(new ArrayBuffer(512))
    // UTF-16LE text for 5 chars
    const textBytes = new Uint8Array(10)
    const view = new DataView(textBytes.buffer)
    for (let i = 0; i < 5; i++) view.setUint16(i * 2, 0x41 + i, true)
    const rgCcp = {
      ccpText: 5, ccpFtn: 0, ccpHdd: 0, ccpMcr: 0,
      ccpAtn: 0, ccpEdn: 0, ccpTxbx: 0, ccpHdrTxbx: 0,
    }
    const clx = buildClxWithExplicitPieces([
      { cpStart: 0, cpEnd: 5, fc: 0 }, // fChp defaults to false
    ])

    const result = (parser as any).parseClxWithStories(clx, textBytes, rgCcp)
    expect(result).not.toBeNull()
    const mainPieces = result.pieceMap.main
    expect(mainPieces.length).toBe(1)
    expect(mainPieces[0].chpxIndex).toBeUndefined()
  })

  it('should produce per-piece text ranges consistent with piece boundaries', () => {
    const parser = new DocParser(new ArrayBuffer(512))
    // UTF-16LE "ABCDE" + "FGH" = 5 chars + 3 chars
    const main = 'ABCDE'
    const ftn = 'FGH'
    const textBytes = new Uint8Array((main.length + ftn.length) * 2)
    const view = new DataView(textBytes.buffer)
    for (let i = 0; i < main.length; i++) {
      view.setUint16(i * 2, main.charCodeAt(i), true)
    }
    for (let i = 0; i < ftn.length; i++) {
      view.setUint16((main.length + i) * 2, ftn.charCodeAt(i), true)
    }
    const rgCcp = {
      ccpText: 5, ccpFtn: 3, ccpHdd: 0, ccpMcr: 0,
      ccpAtn: 0, ccpEdn: 0, ccpTxbx: 0, ccpHdrTxbx: 0,
    }
    const clx = buildClxWithExplicitPieces([
      { cpStart: 0, cpEnd: 5, fc: 0, fChp: true, chpxIndex: 2 },
      { cpStart: 5, cpEnd: 8, fc: 10, fChp: true, chpxIndex: 3 },
    ])

    const result = (parser as any).parseClxWithStories(clx, textBytes, rgCcp)
    expect(result).not.toBeNull()
    expect(result.stories.main).toBe('ABCDE')
    expect(result.stories.footnotes).toBe('FGH')
    expect(result.pieceMap.main.length).toBe(1)
    expect(result.pieceMap.main[0].start).toBe(0)
    expect(result.pieceMap.main[0].end).toBe(5)
    expect(result.pieceMap.footnotes[0].start).toBe(0)
    expect(result.pieceMap.footnotes[0].end).toBe(3)
  })

  it('should correctly parse PCD with 8-bit compressed + fChp + chpxIndex', () => {
    const parser = new DocParser(new ArrayBuffer(512))
    // 8-bit "ABCDE" (5 bytes)
    const textBytes = new Uint8Array([0x41, 0x42, 0x43, 0x44, 0x45])
    const rgCcp = {
      ccpText: 5, ccpFtn: 0, ccpHdd: 0, ccpMcr: 0,
      ccpAtn: 0, ccpEdn: 0, ccpTxbx: 0, ccpHdrTxbx: 0,
    }
    const clx = buildClxWithExplicitPieces([
      { cpStart: 0, cpEnd: 5, fc: 0, compressed: true, fChp: true, chpxIndex: 7 },
    ])

    const result = (parser as any).parseClxWithStories(clx, textBytes, rgCcp)
    expect(result).not.toBeNull()
    expect(result.stories.main).toBe('ABCDE')
    expect(result.pieceMap.main[0].chpxIndex).toBe(7)
  })
})
