import { describe, it, expect } from 'vitest'
import { parseFib } from '../src/utils/fibParser'

function createFibData(options: {
  magic?: number
  fComplex?: number
  fWhichTblStm?: number
  csw?: number
  cslw?: number
  cbRgFcLcb?: number
  fcMin?: number
  fcMac?: number
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
  const csw = options.csw ?? 0
  const cslw = options.cslw ?? 0
  const cbRgFcLcb = options.cbRgFcLcb ?? 16

  // FibBase: 32 bytes
  // csw: 2 bytes
  // FibRgW: (csw+1) * 2 bytes
  // cslw: 4 bytes
  // FibRgLw: (cslw+1) * 4 bytes
  // cbRgFcLcb: 2 bytes
  // rgFcLcbBlob: cbRgFcLcb * 8 bytes

  const fibRgWSize = (csw + 1) * 2
  const fibRgLwSize = (cslw + 1) * 4
  const blobSize = cbRgFcLcb * 8

  const totalSize = 32 + 2 + fibRgWSize + 4 + fibRgLwSize + 2 + blobSize
  const data = new Uint8Array(totalSize)

  // Set magic
  data[0] = magic & 0xff
  data[1] = (magic >> 8) & 0xff

  // Set nFib (version)
  data[2] = 0x00
  data[3] = 0x01

  // Set fFlags at byte 10-11:
  //   bit 2 of word (mask 0x0004, byte 10 bit 2): fComplex
  //   bit 9 of word (mask 0x0200, byte 11 bit 1): fWhichTblStm
  if (fComplex & 0x01) data[10] |= 0x04
  if (fWhichTblStm & 0x01) data[11] |= 0x02

  // Set csw at offset 32
  data[32] = csw & 0xff
  data[33] = (csw >> 8) & 0xff

  // FibRgW starts at 34, filled with zeros (csw+1 words)

  // cslw at offset 34 + fibRgWSize
  const cslwOffset = 34 + fibRgWSize
  data[cslwOffset] = cslw & 0xff
  data[cslwOffset + 1] = (cslw >> 8) & 0xff
  data[cslwOffset + 2] = (cslw >> 16) & 0xff
  data[cslwOffset + 3] = (cslw >> 24) & 0xff

  // FibRgLw starts at cslwOffset + 4
  // Layout: cbMac(4) + reserved(4) + reserved(4) + ccpText(4) + ccpFtn(4) +
  //         ccpHdd(4) + ccpMcr(4) + ccpAtn(4) + ccpEdn(4) + ccpTxbx(4) + ccpHdrTxbx(4)
  const rgCcpStart = cslwOffset + 4
  const setDword = (off: number, val: number) => {
    data[off] = val & 0xff
    data[off + 1] = (val >> 8) & 0xff
    data[off + 2] = (val >> 16) & 0xff
    data[off + 3] = (val >> 24) & 0xff
  }
  if (options.ccpText !== undefined) setDword(rgCcpStart + 12, options.ccpText)
  if (options.ccpFtn !== undefined) setDword(rgCcpStart + 16, options.ccpFtn)
  if (options.ccpHdd !== undefined) setDword(rgCcpStart + 20, options.ccpHdd)
  if (options.ccpAtn !== undefined) setDword(rgCcpStart + 28, options.ccpAtn)
  if (options.ccpEdn !== undefined) setDword(rgCcpStart + 32, options.ccpEdn)
  if (options.ccpTxbx !== undefined) setDword(rgCcpStart + 36, options.ccpTxbx)
  if (options.ccpHdrTxbx !== undefined) setDword(rgCcpStart + 40, options.ccpHdrTxbx)

  // cbRgFcLcb at offset cslwOffset + 4 + fibRgLwSize
  const cbOffset = cslwOffset + 4 + fibRgLwSize
  data[cbOffset] = cbRgFcLcb & 0xff
  data[cbOffset + 1] = (cbRgFcLcb >> 8) & 0xff

  // rgFcLcbBlob at cbOffset + 2
  const blobOffset = cbOffset + 2

  if (options.fcMin !== undefined) setDword(blobOffset, options.fcMin)
  if (options.fcMac !== undefined) setDword(blobOffset + 8, options.fcMac)
  if (options.fcClx !== undefined) setDword(blobOffset + 14 * 4, options.fcClx)
  if (options.lcbClx !== undefined) setDword(blobOffset + 15 * 4, options.lcbClx)
  if (options.fcPlcfBteChpx !== undefined) setDword(blobOffset + 28 * 4, options.fcPlcfBteChpx)
  if (options.lcbPlcfBteChpx !== undefined) setDword(blobOffset + 29 * 4, options.lcbPlcfBteChpx)
  if (options.fcPlcfBtePapx !== undefined) setDword(blobOffset + 30 * 4, options.fcPlcfBtePapx)
  if (options.lcbPlcfBtePapx !== undefined) setDword(blobOffset + 31 * 4, options.lcbPlcfBtePapx)
  // fcDop/lcbDop at 4-byte index 62/63 (byte offset 248/252)
  if (options.fcDop !== undefined) setDword(blobOffset + 62 * 4, options.fcDop)
  if (options.lcbDop !== undefined) setDword(blobOffset + 63 * 4, options.lcbDop)

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
    const data = createFibData({
      fComplex: 0,
      fcMin: 0x100,
      fcMac: 0x500,
    })
    const result = parseFib(data)
    expect(result).not.toBeNull()
    expect(result!.fComplex).toBe(false)
    expect(result!.fcMin).toBe(0x100)
    expect(result!.fcMac).toBe(0x500)
  })

  it('should parse valid FIB with fComplex=1 (8-bit)', () => {
    const data = createFibData({
      fComplex: 1,
      fcMin: 0x200,
      fcMac: 0x800,
    })
    const result = parseFib(data)
    expect(result).not.toBeNull()
    expect(result!.fComplex).toBe(true)
    expect(result!.fcMin).toBe(0x200)
    expect(result!.fcMac).toBe(0x800)
  })

  it('should return only fComplex when cbRgFcLcb is too small', () => {
    const data = createFibData({ cbRgFcLcb: 1, fcMin: 0x100 })
    const result = parseFib(data)
    expect(result).not.toBeNull()
    expect(result!.fcMin).toBe(0)
    expect(result!.fcMac).toBe(0)
  })

  it('should parse fcClx and lcbClx when cbRgFcLcb >= 16', () => {
    const data = createFibData({
      fcMin: 0x100,
      fcMac: 0x500,
      fcClx: 0x300,
      lcbClx: 0x50,
    })
    const result = parseFib(data)
    expect(result).not.toBeNull()
    expect(result!.fcClx).toBe(0x300)
    expect(result!.lcbClx).toBe(0x50)
  })

  it('should apply 0x3FFFFFFF mask to fcMin/fcMac', () => {
    const data = createFibData({
      fcMin: 0xFFFFFFFF,
      fcMac: 0xDEADBEEF,
    })
    const result = parseFib(data)
    expect(result).not.toBeNull()
    expect(result!.fcMin).toBe(0xFFFFFFFF & 0x3FFFFFFF)
    expect(result!.fcMac).toBe(0xDEADBEEF & 0x3FFFFFFF)
  })

  it('should return only fComplex when csw leaves FibRgW out of range', () => {
    // Create a minimal valid FIB then truncate it to make FibRgW out of range
    const data = createFibData({ fComplex: 1, fcMin: 0x100 })
    // Truncate buffer so FibRgW (after csw) is out of range.
    // Our default csw=0 → FibRgW starts at 34, length 2 bytes. Truncate to 35 bytes.
    const truncated = data.slice(0, 35)
    const result = parseFib(truncated)
    expect(result).not.toBeNull()
    expect(result!.fComplex).toBe(true)
    expect(result!.fcMin).toBe(0)
    expect(result!.fcMac).toBe(0)
  })

  it('should return only fComplex when cslw leaves FibRgLw out of range', () => {
    // cslw default is 0, so FibRgLw needs (0+1)*4 = 4 bytes.
    // If we set cslw to something large, FibRgLw extends past the buffer.
    const data = createFibData({ cslw: 0xFFFF, fComplex: 0 })
    // Truncate to just past cslw reading point (34 + 2 + 4 = 40 bytes)
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

  it('should default fcClx and lcbClx to 0 when cbRgFcLcb < 16', () => {
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
        cbRgFcLcb: 32,
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
        cbRgFcLcb: 32,
        fcPlcfBtePapx: 0x2000,
        lcbPlcfBtePapx: 0x600,
      })
      const result = parseFib(data)
      expect(result).not.toBeNull()
      expect(result!.fcPlcfBtePapx).toBe(0x2000)
      expect(result!.lcbPlcfBtePapx).toBe(0x600)
    })

    it('should default to 0 when cbRgFcLcb is too small', () => {
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
        cbRgFcLcb: 32,
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
    it('should parse fcDop and lcbDop when cbRgFcLcb >= 64', () => {
      const data = createFibData({
        cbRgFcLcb: 64,
        fcDop: 0x4000,
        lcbDop: 0xC4,
      })
      const result = parseFib(data)
      expect(result).not.toBeNull()
      expect(result!.fcDop).toBe(0x4000)
      expect(result!.lcbDop).toBe(0xC4)
    })

    it('should default fcDop and lcbDop to 0 when cbRgFcLcb < 64', () => {
      const data = createFibData({
        cbRgFcLcb: 32,
        fcDop: 0x4000,
        lcbDop: 0xC4,
      })
      const result = parseFib(data)
      expect(result).not.toBeNull()
      expect(result!.fcDop).toBe(0)
      expect(result!.lcbDop).toBe(0)
    })

    it('should apply 0x3FFFFFFF mask to fcDop', () => {
      const data = createFibData({
        cbRgFcLcb: 64,
        fcDop: 0xFFFFFFFF,
      })
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
