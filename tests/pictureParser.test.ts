import { describe, it, expect } from 'vitest'
import { parsePicfAt, extractPicturesFromDataStream, picturesToDataUrls } from '../src/utils/pictureParser'

// Minimal GIF89a: 1x1, no global color table, one image + trailer
function buildMinimalGif(): Uint8Array {
  const bytes: number[] = []
  bytes.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61) // GIF89a
  bytes.push(0x01, 0x00) // logical screen width
  bytes.push(0x01, 0x00) // logical screen height
  bytes.push(0x00) // packed: no global color table
  bytes.push(0x00) // background color
  bytes.push(0x00) // aspect ratio
  bytes.push(0x2c) // image descriptor
  bytes.push(0x00, 0x00, 0x00, 0x00) // left/top
  bytes.push(0x01, 0x00, 0x01, 0x00) // width/height
  bytes.push(0x00) // packed: no local color table
  bytes.push(0x02) // LZW min code size
  bytes.push(0x02, 0x44, 0x01) // data sub-block
  bytes.push(0x00) // block terminator
  bytes.push(0x3b) // trailer
  return new Uint8Array(bytes)
}

// Minimal BMP: 1x1 24-bit
function buildMinimalBmp(): Uint8Array {
  const bytes: number[] = []
  bytes.push(0x42, 0x4d) // 'BM'
  const fileSize = 54 + 4 // header + 1 pixel (3 bytes) padded to 4
  bytes.push(fileSize & 0xff, (fileSize >> 8) & 0xff, (fileSize >> 16) & 0xff, (fileSize >> 24) & 0xff)
  bytes.push(0, 0, 0, 0) // reserved
  bytes.push(54, 0, 0, 0) // pixel data offset
  bytes.push(40, 0, 0, 0) // DIB header size
  bytes.push(1, 0, 0, 0) // width
  bytes.push(1, 0, 0, 0) // height
  bytes.push(1, 0) // planes
  bytes.push(24, 0) // bpp
  bytes.push(0, 0, 0, 0) // compression
  bytes.push(4, 0, 0, 0) // image size
  bytes.push(0, 0, 0, 0) // x ppm
  bytes.push(0, 0, 0, 0) // y ppm
  bytes.push(0, 0, 0, 0) // colors used
  bytes.push(0, 0, 0, 0) // important colors
  bytes.push(0, 0, 0, 0) // pixel
  return new Uint8Array(bytes)
}

// Minimal JPEG: SOI + APP0 + SOF + SOS + EOI
function buildMinimalJpeg(): Uint8Array {
  const bytes: number[] = []
  bytes.push(0xff, 0xd8) // SOI
  bytes.push(0xff, 0xe0) // APP0
  bytes.push(0x00, 0x10) // length 16
  bytes.push(0x4a, 0x46, 0x49, 0x46, 0x00) // 'JFIF\0'
  bytes.push(0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00) // JFIF data
  bytes.push(0xff, 0xd9) // EOI
  return new Uint8Array(bytes)
}

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

    it('extracts a raw GIF without PICF envelope', () => {
      const gif = buildMinimalGif()
      // extractPicturesFromDataStream requires >= 64 bytes of input
      const data = new Uint8Array(Math.max(gif.length + 20, 80))
      data.set(gif, 10)

      const results = extractPicturesFromDataStream(data)
      const gifResult = results.find(r => r.format === 'gif')
      expect(gifResult).toBeDefined()
      expect(gifResult!.data.length).toBeGreaterThan(10)
    })

    it('extracts a raw BMP without PICF envelope', () => {
      const bmp = buildMinimalBmp()
      const data = new Uint8Array(Math.max(bmp.length + 20, 80))
      data.set(bmp, 10)

      const results = extractPicturesFromDataStream(data)
      const bmpResult = results.find(r => r.format === 'bmp')
      expect(bmpResult).toBeDefined()
    })

    it('extracts a raw JPEG without PICF envelope', () => {
      const jpeg = buildMinimalJpeg()
      const data = new Uint8Array(Math.max(jpeg.length + 20, 80))
      data.set(jpeg, 10)

      const results = extractPicturesFromDataStream(data)
      const jpegResult = results.find(r => r.format === 'jpeg')
      expect(jpegResult).toBeDefined()
      expect(jpegResult!.data[jpegResult!.data.length - 2]).toBe(0xff)
      expect(jpegResult!.data[jpegResult!.data.length - 1]).toBe(0xd9)
    })

    it('parses GIF wrapped in PICF envelope', () => {
      const gif = buildMinimalGif()
      const picf = buildPicfEnvelope(0x000f, 30, 30, gif)

      const results = extractPicturesFromDataStream(picf)
      const gifResult = results.find(r => r.format === 'gif')
      expect(gifResult).toBeDefined()
      expect(gifResult!.widthPx).toBe(30)
      expect(gifResult!.heightPx).toBe(30)
    })

    it('parses BMP wrapped in PICF envelope', () => {
      const bmp = buildMinimalBmp()
      const picf = buildPicfEnvelope(0x0003, 40, 40, bmp)

      const results = extractPicturesFromDataStream(picf)
      const bmpResult = results.find(r => r.format === 'bmp')
      expect(bmpResult).toBeDefined()
      expect(bmpResult!.widthPx).toBe(40)
    })

    it('parses JPEG wrapped in PICF envelope with EOI detection', () => {
      const jpeg = buildMinimalJpeg()
      const picf = buildPicfEnvelope(0x0008, 50, 50, jpeg)

      const results = extractPicturesFromDataStream(picf)
      const jpegResult = results.find(r => r.format === 'jpeg')
      expect(jpegResult).toBeDefined()
      // EOI should be found, trimming the picf trailing zeros
      expect(jpegResult!.data[jpegResult!.data.length - 1]).toBe(0xd9)
    })

    it('does not produce data URLs for unknown formats', () => {
      const pics = [
        { format: 'png' as const, data: new Uint8Array([1, 2, 3]), type: 'png' as const, dataOffset: 0 },
        { format: 'unknown' as const, data: new Uint8Array([4, 5]), type: 'unknown' as const, dataOffset: 1 },
      ]
      const urls = picturesToDataUrls(pics)
      expect(urls).toHaveLength(1)
      expect(urls[0]).toContain('data:image/png;base64,')
    })
  })
})
