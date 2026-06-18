import { describe, it, expect } from 'vitest'
import { parseFib } from '../src/utils/fibParser'

function createFibData(options: {
  magic?: number
  fComplex?: number
  csw?: number
  cslw?: number
  cbRgFcLcb?: number
  fcMin?: number
  fcMac?: number
  fcClx?: number
  lcbClx?: number
}): Uint8Array {
  const magic = options.magic ?? 0xa5ec
  const fComplex = options.fComplex ?? 0
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

  // Set fComplex at byte 12, bit 0
  data[12] = fComplex & 0x01

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

  // FibRgLw starts at cslwOffset + 4, filled with zeros

  // cbRgFcLcb at offset cslwOffset + 4 + fibRgLwSize
  const cbOffset = cslwOffset + 4 + fibRgLwSize
  data[cbOffset] = cbRgFcLcb & 0xff
  data[cbOffset + 1] = (cbRgFcLcb >> 8) & 0xff

  // rgFcLcbBlob at cbOffset + 2
  const blobOffset = cbOffset + 2
  const setDword = (off: number, val: number) => {
    data[off] = val & 0xff
    data[off + 1] = (val >> 8) & 0xff
    data[off + 2] = (val >> 16) & 0xff
    data[off + 3] = (val >> 24) & 0xff
  }

  if (options.fcMin !== undefined) setDword(blobOffset, options.fcMin)
  if (options.fcMac !== undefined) setDword(blobOffset + 8, options.fcMac)
  if (options.fcClx !== undefined) setDword(blobOffset + 14 * 4, options.fcClx)
  if (options.lcbClx !== undefined) setDword(blobOffset + 15 * 4, options.lcbClx)

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
})
