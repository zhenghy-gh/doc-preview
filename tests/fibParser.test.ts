import { describe, it, expect } from 'vitest'
import { parseFib } from '../src/utils/fibParser'

// FibRgFcLcb97 pair indices (MS-DOC §2.5.5). Each pair is 8 bytes
// (4-byte fc + 4-byte lcb). cbRgFcLcb is the count of pairs.
const PAIR = {
  stshf: 1,
  plcfBteChpx: 12,
  plcfBtePapx: 13,
  dop: 31,
  clx: 33,
} as const

function createFibData(options: {
  magic?: number
  fComplex?: number
  fWhichTblStm?: number
  csw?: number
  cslw?: number
  cbRgFcLcb?: number
  fcClx?: number
  lcbClx?: number
  fcPlcfBteChpx?: number
  lcbPlcfBteChpx?: number
  fcPlcfBtePapx?: number
  lcbPlcfBtePapx?: number
  fcDop?: number
  lcbDop?: number
  ccpText?: number
  ccpFtn?: number
  ccpHdd?: number
  ccpAtn?: number
  ccpEdn?: number
  ccpTxbx?: number
  ccpHdrTxbx?: number
}): Uint8Array {
  const magic = options.magic ?? 0xa5ec
  const fComplex = options.fComplex ?? 0
  const fWhichTblStm = options.fWhichTblStm ?? 0
  // Spec-mandated defaults: csw=0x0E (14), cslw=0x16 (22).
  const csw = options.csw ?? 14
  const cslw = options.cslw ?? 22
  // cbRgFcLcb is a PAIR count. Word97 uses 0x005D (93) pairs.
  const cbRgFcLcb = options.cbRgFcLcb ?? 93

  // MS-DOC FIB layout:
  //   FibBase:    32 bytes
  //   csw:         2 bytes
  //   FibRgW97:    csw * 2 bytes
  //   cslw:        2 bytes
  //   FibRgLw97:   cslw * 4 bytes
  //   cbRgFcLcb:   2 bytes
  //   rgFcLcbBlob: cbRgFcLcb * 8 bytes
  const fibRgWSize = csw * 2
  const fibRgLwSize = cslw * 4
  const blobSize = cbRgFcLcb * 8

  const totalSize = 32 + 2 + fibRgWSize + 2 + fibRgLwSize + 2 + blobSize
  const data = new Uint8Array(totalSize)

  // wIdent (magic)
  data[0] = magic & 0xff
  data[1] = (magic >> 8) & 0xff

  // nFib (version)
  data[2] = 0x00
  data[3] = 0x01

  // fFlags at byte 10-11:
  //   bit 2 (mask 0x0004, byte 10 bit 2): fComplex
  //   bit 9 (mask 0x0200, byte 11 bit 1): fWhichTblStm
  if (fComplex & 0x01) data[10] |= 0x04
  if (fWhichTblStm & 0x01) data[11] |= 0x02

  // csw at offset 32
  data[32] = csw & 0xff
  data[33] = (csw >> 8) & 0xff

  // FibRgW97 spans csw * 2 bytes starting at offset 34 (left as zeros).

  // cslw immediately follows FibRgW97 (no reserved padding).
  const cslwOffset = 34 + fibRgWSize
  data[cslwOffset] = cslw & 0xff
  data[cslwOffset + 1] = (cslw >> 8) & 0xff

  const setDword = (off: number, val: number) => {
    data[off] = val & 0xff
    data[off + 1] = (val >> 8) & 0xff
    data[off + 2] = (val >> 16) & 0xff
    data[off + 3] = (val >> 24) & 0xff
  }

  // FibRgLw97 starts immediately after cslw (2 bytes).
  // Layout: cbMac(+0) reserved(+4) reserved(+8) ccpText(+12) ccpFtn(+16)
  //         ccpHdd(+20) ccpMcr(+24) ccpAtn(+28) ccpEdn(+32) ccpTxbx(+36) ccpHdrTxbx(+40)
  const rgLwStart = cslwOffset + 2
  if (options.ccpText !== undefined) setDword(rgLwStart + 12, options.ccpText)
  if (options.ccpFtn !== undefined) setDword(rgLwStart + 16, options.ccpFtn)
  if (options.ccpHdd !== undefined) setDword(rgLwStart + 20, options.ccpHdd)
  if (options.ccpAtn !== undefined) setDword(rgLwStart + 28, options.ccpAtn)
  if (options.ccpEdn !== undefined) setDword(rgLwStart + 32, options.ccpEdn)
  if (options.ccpTxbx !== undefined) setDword(rgLwStart + 36, options.ccpTxbx)
  if (options.ccpHdrTxbx !== undefined) setDword(rgLwStart + 40, options.ccpHdrTxbx)

  // cbRgFcLcb immediately follows FibRgLw97.
  const cbOffset = rgLwStart + fibRgLwSize
  data[cbOffset] = cbRgFcLcb & 0xff
  data[cbOffset + 1] = (cbRgFcLcb >> 8) & 0xff

  // rgFcLcbBlob follows cbRgFcLcb. Each field is at pairIndex * 8.
  const blobOffset = cbOffset + 2
  const setPair = (pair: number, fc?: number, lcb?: number) => {
    if (fc !== undefined) setDword(blobOffset + pair * 8, fc)
    if (lcb !== undefined) setDword(blobOffset + pair * 8 + 4, lcb)
  }
  setPair(PAIR.clx, options.fcClx, options.lcbClx)
  setPair(PAIR.plcfBteChpx, options.fcPlcfBteChpx, options.lcbPlcfBteChpx)
  setPair(PAIR.plcfBtePapx, options.fcPlcfBtePapx, options.lcbPlcfBtePapx)
  setPair(PAIR.dop, options.fcDop, options.lcbDop)

  return data
}

describe('parseFib', () => {
  it('should return null for data too short', () => {
    expect(parseFib(new Uint8Array(10))).toBeNull()
  })

  it('should return null for invalid magic', () => {
    const data = createFibData({ magic: 0x1234 })
    expect(parseFib(data)).toBeNull()
  })

  it('should parse valid FIB with fComplex=0 (UTF-16LE)', () => {
    const data = createFibData({ fComplex: 0 })
    const result = parseFib(data)
    expect(result).not.toBeNull()
    expect(result!.fComplex).toBe(false)
    // fcMin/fcMac are legacy Word 6/95 fields, always 0 in Word 97+ parsing.
    expect(result!.fcMin).toBe(0)
    expect(result!.fcMac).toBe(0)
  })

  it('should parse valid FIB with fComplex=1 (8-bit)', () => {
    const data = createFibData({ fComplex: 1 })
    const result = parseFib(data)
    expect(result).not.toBeNull()
    expect(result!.fComplex).toBe(true)
    expect(result!.fcMin).toBe(0)
    expect(result!.fcMac).toBe(0)
  })

  it('should return fallback (fcClx=0) when cbRgFcLcb is too small', () => {
    const data = createFibData({ cbRgFcLcb: 1, fcClx: 0x300 })
    const result = parseFib(data)
    expect(result).not.toBeNull()
    expect(result!.fcClx).toBe(0)
    expect(result!.lcbClx).toBe(0)
  })

  it('should parse fcClx and lcbClx from pair index 33', () => {
    const data = createFibData({
      fcClx: 0x300,
      lcbClx: 0x50,
    })
    const result = parseFib(data)
    expect(result).not.toBeNull()
    expect(result!.fcClx).toBe(0x300)
    expect(result!.lcbClx).toBe(0x50)
  })

  it('should keep legacy fcMin/fcMac at 0 regardless of blob content', () => {
    const data = createFibData({ fcClx: 0x300, lcbClx: 0x50 })
    const result = parseFib(data)
    expect(result).not.toBeNull()
    expect(result!.fcMin).toBe(0)
    expect(result!.fcMac).toBe(0)
  })

  it('should apply 0x3FFFFFFF mask to fcClx', () => {
    const data = createFibData({ fcClx: 0xFFFFFFFF })
    const result = parseFib(data)
    expect(result).not.toBeNull()
    expect(result!.fcClx).toBe(0xFFFFFFFF & 0x3FFFFFFF)
  })

  it('should return only fComplex when csw leaves FibRgW out of range', () => {
    // Default csw=14 → FibRgW ends at 34 + 28 = 62. Truncate below that.
    const data = createFibData({ fComplex: 1 })
    const truncated = data.slice(0, 35)
    const result = parseFib(truncated)
    expect(result).not.toBeNull()
    expect(result!.fComplex).toBe(true)
    expect(result!.fcMin).toBe(0)
    expect(result!.fcMac).toBe(0)
  })

  it('should return only fComplex when buffer leaves FibRgLw out of range', () => {
    const data = createFibData({ cslw: 0xFFFF, fComplex: 0 })
    const truncated = data.slice(0, 40)
    const result = parseFib(truncated)
    expect(result).not.toBeNull()
    expect(result!.fComplex).toBe(false)
    expect(result!.fcMin).toBe(0)
  })

  it('should accept both magic variants (0xa5ec and 0xa5eb)', () => {
    const data1 = createFibData({ magic: 0xa5ec })
    const data2 = createFibData({ magic: 0xa5eb })
    expect(parseFib(data1)).not.toBeNull()
    expect(parseFib(data2)).not.toBeNull()
  })

  it('should default fcClx and lcbClx to 0 when pair index exceeds cbRgFcLcb', () => {
    // cbRgFcLcb=8 pairs, fcClx lives at pair 33 → out of range → 0.
    const data = createFibData({ cbRgFcLcb: 8 })
    const result = parseFib(data)
    expect(result).not.toBeNull()
    expect(result!.fcClx).toBe(0)
    expect(result!.lcbClx).toBe(0)
  })

  describe('fWhichTblStm', () => {
    it('should default to false (use 0Table) when bit 9 is clear', () => {
      const data = createFibData({ fWhichTblStm: 0 })
      const result = parseFib(data)
      expect(result).not.toBeNull()
      expect(result!.fWhichTblStm).toBe(false)
    })

    it('should parse fWhichTblStm=true when bit 9 is set', () => {
      const data = createFibData({ fWhichTblStm: 1 })
      const result = parseFib(data)
      expect(result).not.toBeNull()
      expect(result!.fWhichTblStm).toBe(true)
    })

    it('should preserve fWhichTblStm even when FibRgW is out of range', () => {
      const data = createFibData({ fWhichTblStm: 1, fComplex: 1 })
      const truncated = data.slice(0, 35)
      const result = parseFib(truncated)
      expect(result).not.toBeNull()
      expect(result!.fWhichTblStm).toBe(true)
      expect(result!.fComplex).toBe(true)
    })
  })

  describe('rgCcp', () => {
    it('should parse ccpText from FibRgLw', () => {
      const data = createFibData({ ccpText: 12345 })
      const result = parseFib(data)
      expect(result).not.toBeNull()
      expect(result!.rgCcp.ccpText).toBe(12345)
    })

    it('should parse all story counts', () => {
      const data = createFibData({
        ccpText: 1000,
        ccpFtn: 50,
        ccpHdd: 200,
        ccpAtn: 30,
        ccpEdn: 40,
        ccpTxbx: 60,
        ccpHdrTxbx: 70,
      })
      const result = parseFib(data)
      expect(result).not.toBeNull()
      expect(result!.rgCcp).toEqual({
        ccpText: 1000,
        ccpFtn: 50,
        ccpHdd: 200,
        ccpMcr: 0,
        ccpAtn: 30,
        ccpEdn: 40,
        ccpTxbx: 60,
        ccpHdrTxbx: 70,
      })
    })

    it('should default rgCcp to zeros when FibRgLw is out of range', () => {
      const data = createFibData({ ccpText: 12345, cslw: 0xFFFF })
      const truncated = data.slice(0, 40)
      const result = parseFib(truncated)
      expect(result).not.toBeNull()
      expect(result!.rgCcp.ccpText).toBe(0)
      expect(result!.rgCcp.ccpHdd).toBe(0)
    })

    it('should expose total character count across stories via sum', () => {
      const data = createFibData({
        ccpText: 1000,
        ccpFtn: 50,
        ccpHdd: 200,
        ccpAtn: 30,
        ccpEdn: 40,
        ccpTxbx: 60,
        ccpHdrTxbx: 70,
      })
      const result = parseFib(data)!
      const total = result.rgCcp.ccpText + result.rgCcp.ccpFtn + result.rgCcp.ccpHdd +
        result.rgCcp.ccpMcr + result.rgCcp.ccpAtn + result.rgCcp.ccpEdn +
        result.rgCcp.ccpTxbx + result.rgCcp.ccpHdrTxbx
      expect(total).toBe(1450)
    })
  })

  describe('fcPlcfBteChpx / fcPlcfBtePapx', () => {
    it('should parse fcPlcfBteChpx and lcbPlcfBteChpx', () => {
      const data = createFibData({
        fcPlcfBteChpx: 0x1000,
        lcbPlcfBteChpx: 0x500,
      })
      const result = parseFib(data)
      expect(result).not.toBeNull()
      expect(result!.fcPlcfBteChpx).toBe(0x1000)
      expect(result!.lcbPlcfBteChpx).toBe(0x500)
    })

    it('should parse fcPlcfBtePapx and lcbPlcfBtePapx', () => {
      const data = createFibData({
        fcPlcfBtePapx: 0x2000,
        lcbPlcfBtePapx: 0x600,
      })
      const result = parseFib(data)
      expect(result).not.toBeNull()
      expect(result!.fcPlcfBtePapx).toBe(0x2000)
      expect(result!.lcbPlcfBtePapx).toBe(0x600)
    })

    it('should default to 0 when pair index exceeds cbRgFcLcb', () => {
      const data = createFibData({
        cbRgFcLcb: 8,
        fcPlcfBteChpx: 0x1000,
        fcPlcfBtePapx: 0x2000,
      })
      const result = parseFib(data)
      expect(result).not.toBeNull()
      expect(result!.fcPlcfBteChpx).toBe(0)
      expect(result!.lcbPlcfBteChpx).toBe(0)
      expect(result!.fcPlcfBtePapx).toBe(0)
      expect(result!.lcbPlcfBtePapx).toBe(0)
    })

    it('should apply 0x3FFFFFFF mask to fc fields', () => {
      const data = createFibData({
        fcPlcfBteChpx: 0xFFFFFFFF,
        fcPlcfBtePapx: 0xDEADBEEF,
      })
      const result = parseFib(data)
      expect(result).not.toBeNull()
      expect(result!.fcPlcfBteChpx).toBe(0xFFFFFFFF & 0x3FFFFFFF)
      expect(result!.fcPlcfBtePapx).toBe(0xDEADBEEF & 0x3FFFFFFF)
    })
  })

  describe('fcDop / lcbDop', () => {
    it('should parse fcDop and lcbDop from pair index 31', () => {
      const data = createFibData({
        fcDop: 0x4000,
        lcbDop: 0xC4,
      })
      const result = parseFib(data)
      expect(result).not.toBeNull()
      expect(result!.fcDop).toBe(0x4000)
      expect(result!.lcbDop).toBe(0xC4)
    })

    it('should default fcDop and lcbDop to 0 when pair index exceeds cbRgFcLcb', () => {
      const data = createFibData({
        cbRgFcLcb: 16,
        fcDop: 0x4000,
        lcbDop: 0xC4,
      })
      const result = parseFib(data)
      expect(result).not.toBeNull()
      expect(result!.fcDop).toBe(0)
      expect(result!.lcbDop).toBe(0)
    })

    it('should apply 0x3FFFFFFF mask to fcDop', () => {
      const data = createFibData({ fcDop: 0xFFFFFFFF })
      const result = parseFib(data)
      expect(result).not.toBeNull()
      expect(result!.fcDop).toBe(0xFFFFFFFF & 0x3FFFFFFF)
    })

    it('should have fcDop/lcbDop = 0 in early-return fallbacks', () => {
      // Trigger the FibRgW out-of-range fallback by making data too short
      const data = new Uint8Array(36)
      data[0] = 0xEC
      data[1] = 0xA5
      // csw at offset 32 = large value to push FibRgW beyond data.length
      data[32] = 0xFF
      data[33] = 0xFF
      const result = parseFib(data)
      expect(result).not.toBeNull()
      expect(result!.fcDop).toBe(0)
      expect(result!.lcbDop).toBe(0)
    })
  })
})
