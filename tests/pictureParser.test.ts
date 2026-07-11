import { describe, it, expect } from 'vitest'
import { parsePicfAt, extractPicturesFromDataStream } from '../src/utils/pictureParser'

// Build a minimal 1x1 PNG: 8-byte signature + IHDR + IDAT + IEND
function buildMinimalPng(): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

  const ihdrData = new Uint8Array(13)
  const dv = new DataView(ihdrData.buffer)
  dv.setUint32(0, 1) // width
  dv.setUint32(4, 1) // height
  ihdrData[8] = 8 // bit depth
  ihdrData[9] = 2 // color type: RGB
  // compression=0, filter=0, interlace=0 (already 0)

  const ihdrCrc = crc32([0x49, 0x48, 0x44, 0x52, ...Array.from(ihdrData)])

  const idatData = new Uint8Array([0x78, 0x9c, 0x63, 0x64, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x04, 0x00, 0x01])
  const idatCrc = crc32([0x49, 0x44, 0x41, 0x54, ...Array.from(idatData)])

  const iendCrc = crc32([0x49, 0x45, 0x4e, 0x44])

  const parts: number[] = [...signature]

  // IHDR chunk
  parts.push(0, 0, 0, 13) // length
  parts.push(0x49, 0x48, 0x44, 0x52) // 'IHDR'
  parts.push(...Array.from(ihdrData))
  parts.push((ihdrCrc >> 24) & 0xff, (ihdrCrc >> 16) & 0xff, (ihdrCrc >> 8) & 0xff, ihdrCrc & 0xff)

  // IDAT chunk
  parts.push(0, 0, 0, idatData.length) // length
  parts.push(0x49, 0x44, 0x41, 0x54) // 'IDAT'
  parts.push(...Array.from(idatData))
  parts.push((idatCrc >> 24) & 0xff, (idatCrc >> 16) & 0xff, (idatCrc >> 8) & 0xff, idatCrc & 0xff)

  // IEND chunk
  parts.push(0, 0, 0, 0) // length
  parts.push(0x49, 0x45, 0x4e, 0x44) // 'IEND'
  parts.push((iendCrc >> 24) & 0xff, (iendCrc >> 16) & 0xff, (iendCrc >> 8) & 0xff, iendCrc & 0xff)

  return new Uint8Array(parts)
}

function crc32(data: number[]): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function buildPicfEnvelope(mm: number, xExt: number, yExt: number, imageData: Uint8Array): Uint8Array {
  const headerSize = 68
  const picfSize = headerSize + imageData.length
  const totalSize = 4 + picfSize // FCPic (4) + PICF

  const buf = new Uint8Array(totalSize)
  const dv = new DataView(buf.buffer)

  dv.setUint32(0, picfSize, true) // lcb (FCPic)

  const picfOffset = 4
  dv.setUint16(picfOffset, mm, true) // mm
  dv.setUint16(picfOffset + 2, xExt, true) // xExt
  dv.setUint16(picfOffset + 4, yExt, true) // yExt

  buf.set(imageData, picfOffset + headerSize)

  return buf
}

describe('pictureParser', () => {
  describe('parsePicfAt', () => {
    it('parses a valid PICF with PNG image', () => {
      const png = buildMinimalPng()
      const picf = buildPicfEnvelope(0x000a, 100, 80, png)

      const result = parsePicfAt(picf, 0)

      expect(result).not.toBeNull()
      expect(result!.format).toBe('png')
      expect(result!.type).toBe('png')
      expect(result!.widthPx).toBe(100)
      expect(result!.heightPx).toBe(80)
      expect(result!.data.length).toBeGreaterThan(0)
      expect(result!.data[0]).toBe(0x89)
      expect(result!.data[1]).toBe(0x50)
    })

    it('returns null for negative offset', () => {
      const png = buildMinimalPng()
      const picf = buildPicfEnvelope(0x000a, 100, 80, png)
      expect(parsePicfAt(picf, -1)).toBeNull()
    })

    it('returns null for offset beyond buffer', () => {
      const png = buildMinimalPng()
      const picf = buildPicfEnvelope(0x000a, 100, 80, png)
      expect(parsePicfAt(picf, picf.length + 10)).toBeNull()
    })

    it('returns null for unreasonably large lcb', () => {
      const buf = new Uint8Array(100)
      const dv = new DataView(buf.buffer)
      dv.setUint32(0, 100 * 1024 * 1024, true) // 100 MB, larger than buffer
      expect(parsePicfAt(buf, 0)).toBeNull()
    })

    it('handles JPEG mm type', () => {
      const jpegData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9])
      const picf = buildPicfEnvelope(0x0008, 200, 150, jpegData)

      const result = parsePicfAt(picf, 0)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('jpeg')
      expect(result!.widthPx).toBe(200)
      expect(result!.heightPx).toBe(150)
    })

    it('preserves dataOffset', () => {
      const png = buildMinimalPng()
      const picf = buildPicfEnvelope(0x000a, 10, 10, png)

      const result = parsePicfAt(picf, 0)
      expect(result).not.toBeNull()
      expect(result!.dataOffset).toBe(4 + 68) // FCPic(4) + PICF header(68)
    })
  })

  describe('extractPicturesFromDataStream', () => {
    it('returns empty array for short data', () => {
      expect(extractPicturesFromDataStream(new Uint8Array(10))).toEqual([])
    })

    it('returns empty array for data with no images', () => {
      const data = new Uint8Array(100).fill(0xaa)
      expect(extractPicturesFromDataStream(data)).toEqual([])
    })

    it('extracts a PNG wrapped in PICF envelope', () => {
      const png = buildMinimalPng()
      const picf = buildPicfEnvelope(0x000a, 50, 50, png)

      const results = extractPicturesFromDataStream(picf)

      expect(results.length).toBeGreaterThan(0)
      const pngResult = results.find(r => r.format === 'png')
      expect(pngResult).toBeDefined()
      expect(pngResult!.type).toBe('png')
    })

    it('extracts raw PNG without PICF envelope (fallback)', () => {
      const png = buildMinimalPng()
      const data = new Uint8Array(png.length + 20)
      data.fill(0, 0, 10)
      data.set(png, 10)
      data.fill(0, 10 + png.length)

      const results = extractPicturesFromDataStream(data)

      expect(results.length).toBeGreaterThan(0)
      const pngResult = results.find(r => r.format === 'png')
      expect(pngResult).toBeDefined()
    })
  })
})
