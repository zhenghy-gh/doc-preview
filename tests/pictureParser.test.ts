import { describe, it, expect } from 'vitest'
import { parsePicfAt, extractPicturesFromDataStream, picturesToDataUrls, parseJpegDimensions, parsePngDimensions } from '../src/utils/pictureParser'

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

    it('handles EMF and WMF mm types (unknown format, magic fallback)', () => {
      // EMF (mm=4): weak signature — format stays unknown but parse succeeds
      const emfData = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x50, 0x00, 0x00, 0x00])
      const emfPicf = buildPicfEnvelope(0x0004, 100, 80, emfData)
      const emfResult = parsePicfAt(emfPicf, 0)
      expect(emfResult).not.toBeNull()
      expect(emfResult!.type).toBe('emf')

      // WMF (mm=2): placeholder metafile (0xD7CDC69A)
      const wmfData = new Uint8Array([0xD7, 0xCD, 0xC6, 0x9A, 0x00, 0x00, 0x00, 0x00])
      const wmfPicf = buildPicfEnvelope(0x0002, 100, 80, wmfData)
      const wmfResult = parsePicfAt(wmfPicf, 0)
      expect(wmfResult).not.toBeNull()
      expect(wmfResult!.type).toBe('wmf')
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

    it('should not set dimensions when xExt or yExt is zero', () => {
      const png = buildMinimalPng()
      const picf = buildPicfEnvelope(0x000a, 0, 80, png)
      const result = parsePicfAt(picf, 0)
      expect(result).not.toBeNull()
      expect(result!.widthPx).toBeUndefined()
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

describe('parseJpegDimensions', () => {
  /** SOI + SOF0 + payload + EOI with explicit width/height. */
  function buildJpegWithSof(width: number, height: number): Uint8Array {
    const bytes: number[] = [
      0xFF, 0xD8,             // SOI
      0xFF, 0xE0, 0x00, 0x10, // APP0
      0x4A, 0x46, 0x49, 0x46, 0x00,
      0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0xFF, 0xC0, 0x00, 0x11, // SOF0, length 17
      0x08,                   // precision
      (height >> 8) & 0xFF, height & 0xFF,
      (width >> 8) & 0xFF, width & 0xFF,
      0x03,                   // components
      0x01, 0x22, 0x00,       // comp 1
      0x02, 0x11, 0x01,       // comp 2
      0x03, 0x11, 0x01,       // comp 3
      0xFF, 0xD9,             // EOI
    ]
    return new Uint8Array(bytes)
  }

  it('should parse width and height from SOF0', () => {
    const jpeg = buildJpegWithSof(640, 480)
    const dims = parseJpegDimensions(jpeg)
    expect(dims).toEqual({ width: 640, height: 480 })
  })

  it('should handle SOF after APP segments', () => {
    const jpeg = buildJpegWithSof(800, 600)
    const dims = parseJpegDimensions(jpeg)
    expect(dims).toEqual({ width: 800, height: 600 })
  })

  it('should return null for non-JPEG data', () => {
    expect(parseJpegDimensions(new Uint8Array([1, 2, 3, 4]))).toBeNull()
    expect(parseJpegDimensions(new Uint8Array(0))).toBeNull()
  })

  it('should return null when SOS appears before any SOF', () => {
    const jpeg = new Uint8Array([
      0xFF, 0xD8,
      0xFF, 0xDA, 0x00, 0x08, // SOS
      0x01, 0x01, 0x00, 0x00,
      0xFF, 0xD9,
    ])
    expect(parseJpegDimensions(jpeg)).toBeNull()
  })

  it('should return null for truncated data', () => {
    const jpeg = buildJpegWithSof(100, 100)
    expect(parseJpegDimensions(jpeg.subarray(0, 10))).toBeNull()
  })

  it('should accept the maximum representable uint16 dimension', () => {
    const jpeg = buildJpegWithSof(65535, 65535)
    const dims = parseJpegDimensions(jpeg)
    expect(dims).toEqual({ width: 65535, height: 65535 })
  })

  it('should recover dimensions for raw JPEG extraction', () => {
    const jpeg = buildJpegWithSof(320, 240)
    const data = new Uint8Array(Math.max(jpeg.length + 20, 80))
    data.set(jpeg, 10)
    const results = extractPicturesFromDataStream(data)
    const jpegResult = results.find(r => r.format === 'jpeg')
    expect(jpegResult).toBeDefined()
    expect(jpegResult!.widthPx).toBe(320)
    expect(jpegResult!.heightPx).toBe(240)
  })
})

describe('parsePngDimensions', () => {
  /** Build a PNG signature + IHDR + IEND with explicit width/height. */
  function buildPngWithIhdr(width: number, height: number): Uint8Array {
    const bytes: number[] = [
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, // IHDR length
      0x49, 0x48, 0x44, 0x52, // "IHDR"
      (width >>> 24) & 0xFF, (width >>> 16) & 0xFF, (width >>> 8) & 0xFF, width & 0xFF,
      (height >>> 24) & 0xFF, (height >>> 16) & 0xFF, (height >>> 8) & 0xFF, height & 0xFF,
      0x08, 0x02, 0x00, 0x00, 0x00, // bit depth, color type, etc.
      0x00, 0x00, 0x00, 0x00, // IHDR CRC (any value)
      0x00, 0x00, 0x00, 0x00, // IEND length
      0x49, 0x45, 0x4E, 0x44, // "IEND"
      0x00, 0x00, 0x00, 0x00, // IEND CRC
    ]
    return new Uint8Array(bytes)
  }

  it('should parse width and height from IHDR', () => {
    const png = buildPngWithIhdr(1024, 768)
    const dims = parsePngDimensions(png)
    expect(dims).toEqual({ width: 1024, height: 768 })
  })

  it('should return null for non-PNG data', () => {
    expect(parsePngDimensions(new Uint8Array([1, 2, 3, 4]))).toBeNull()
    expect(parsePngDimensions(new Uint8Array(10))).toBeNull()
  })

  it('should return null when IHDR is missing', () => {
    const png = buildPngWithIhdr(100, 100)
    png[12] = 0x00 // corrupt chunk type
    expect(parsePngDimensions(png)).toBeNull()
  })

  it('should recover dimensions for raw PNG extraction', () => {
    const png = buildPngWithIhdr(64, 48)
    const data = new Uint8Array(Math.max(png.length + 20, 80))
    data.set(png, 10)
    const results = extractPicturesFromDataStream(data)
    const pngResult = results.find(r => r.format === 'png')
    expect(pngResult).toBeDefined()
    expect(pngResult!.widthPx).toBe(64)
    expect(pngResult!.heightPx).toBe(48)
  })
})

describe('pictureParser edge paths', () => {
  // Build a Data stream: 4-byte FCPic lcb + 68-byte PICF header + payload.
  // Image bytes start at offset 72.
  function buildPicfDataStream(mm: number, xExt: number, yExt: number, payload: number[]): Uint8Array {
    const header = new Array<number>(68).fill(0)
    header[0] = mm & 0xff
    header[1] = (mm >> 8) & 0xff
    header[2] = xExt & 0xff
    header[3] = (xExt >> 8) & 0xff
    header[4] = yExt & 0xff
    header[5] = (yExt >> 8) & 0xff
    const body = header.concat(payload)
    const lcb = body.length
    return new Uint8Array([lcb & 0xff, (lcb >> 8) & 0xff, (lcb >> 16) & 0xff, (lcb >> 24) & 0xff].concat(body))
  }

  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  // Minimal JPEG with a SOF0: SOI + SOF(17 bytes) + EOI
  function jpegWithSof(height: number, width: number): number[] {
    const bytes: number[] = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]
    bytes.push((height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff) // SOF stores dimensions big-endian
    for (let i = 0; i < 9; i++) bytes.push(0x01)
    bytes.push(0xff, 0xd9)
    return bytes
  }

  it('detects a PNG signature at imgStart when the mm type is unknown', () => {
    const stream = buildPicfDataStream(0x0001, 100, 100, PNG_SIG.concat([0x00, 0x00, 0x00, 0x00]))
    const pic = parsePicfAt(stream, 0)
    expect(pic).not.toBeNull()
    expect(pic!.format).toBe('png')
    expect(pic!.data.length).toBeGreaterThanOrEqual(8)
  })

  it('rejects a JPEG-looking start whose third byte is not 0xFF', () => {
    // FF D8 followed by a non-marker byte must not be classified as JPEG.
    const stream = buildPicfDataStream(0x0001, 100, 100, [0xff, 0xd8, 0x00, 0x01, 0x02, 0x03])
    const pic = parsePicfAt(stream, 0)
    expect(pic).not.toBeNull()
    expect(pic!.format).toBe('unknown')
  })

  it('detects JPEG with filler FF bytes and APP segments', () => {
    // FF D8 FF FF E0 00 10 + 16 APP0 bytes + FF D9
    const payload: number[] = [0xff, 0xd8, 0xff, 0xff, 0xe0, 0x00, 0x10]
    for (let i = 0; i < 16; i++) payload.push(0x11)
    payload.push(0xff, 0xd9)
    const stream = buildPicfDataStream(0x0001, 100, 100, payload)
    const pic = parsePicfAt(stream, 0)
    expect(pic).not.toBeNull()
    expect(pic!.format).toBe('jpeg')
  })

  it('skips standalone RST markers while scanning JPEG', () => {
    const stream = buildPicfDataStream(0x0008, 100, 100, [0xff, 0xd8, 0xff, 0xd0, 0xff, 0xd9])
    const pic = parsePicfAt(stream, 0)
    expect(pic).not.toBeNull()
    expect(pic!.format).toBe('jpeg')
  })

  it('handles a GIF with a global color table', () => {
    const gct = new Array<number>(768).fill(0)
    const payload: number[] = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00, 0x01, 0x00, 0x87, 0x00, 0x00]
    const stream = buildPicfDataStream(0x000f, 100, 100, payload.concat(gct, [0x3b]))
    const pic = parsePicfAt(stream, 0)
    expect(pic).not.toBeNull()
    expect(pic!.format).toBe('gif')
  })

  it('skips GIF extension blocks', () => {
    // Graphic control extension: 0x21 0xF9 0x04 <4 bytes> 0x00, then trailer
    const payload: number[] = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]
    payload.push(0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3b)
    const stream = buildPicfDataStream(0x000f, 100, 100, payload)
    const pic = parsePicfAt(stream, 0)
    expect(pic).not.toBeNull()
    expect(pic!.format).toBe('gif')
  })

  it('skips a GIF image descriptor with a local color table', () => {
    const lct = new Array<number>(768).fill(0)
    // 0x2C descriptor: left/top(4) + width/height(4) + packed=0x87 (LCT flag)
    const payload: number[] = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]
    payload.push(0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x87)
    payload.push(...lct, 0x00, 0x3b)
    const stream = buildPicfDataStream(0x000f, 100, 100, payload)
    const pic = parsePicfAt(stream, 0)
    expect(pic).not.toBeNull()
    expect(pic!.format).toBe('gif')
  })

  it('rejects a GIF with an invalid block inside', () => {
    const payload: number[] = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]
    payload.push(0x01, 0x02, 0x03)
    const stream = buildPicfDataStream(0x000f, 100, 100, payload)
    const pic = parsePicfAt(stream, 0)
    expect(pic).not.toBeNull()
    expect(pic!.format).toBe('gif')
  })

  it('recovers JPEG pixel dimensions from SOF when xExt/yExt are zero', () => {
    const stream = buildPicfDataStream(0x0008, 0, 0, jpegWithSof(1, 2))
    const pic = parsePicfAt(stream, 0)
    expect(pic).not.toBeNull()
    expect(pic!.widthPx).toBe(2)
    expect(pic!.heightPx).toBe(1)
  })

  it('parseJpegDimensions: skips filler FF bytes before the marker', () => {
    const dims = parseJpegDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x02, 0x01, 0x01, 0x01, 0xff, 0xd9]))
    expect(dims).toEqual({ width: 2, height: 1 })
  })

  it('parseJpegDimensions: skips standalone markers before the SOF', () => {
    const dims = parseJpegDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xd0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x02, 0x01, 0x01, 0x01, 0xff, 0xd9]))
    expect(dims).toEqual({ width: 2, height: 1 })
  })

  it('parseJpegDimensions: returns null when the SOF height is zero', () => {
    const dims = parseJpegDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x00, 0x00, 0x02, 0x01, 0x01, 0x01, 0xff, 0xd9]))
    expect(dims).toBeNull()
  })

  it('parsePngDimensions: returns null when the IHDR width is zero', () => {
    const bytes: number[] = PNG_SIG.concat([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00])
    const dims = parsePngDimensions(new Uint8Array(bytes))
    expect(dims).toBeNull()
  })
})

describe('pictureParser partial match', () => {
  it('keeps scanning after a partial signature match inside the stream', () => {
    // A fake PNG start (last signature byte wrong) followed by a real PNG.
    // findImageIndexInStream must notice the byte mismatch and keep going.
    const real = buildMinimalPng()
    const fakeStart: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00]
    // Make findPngEnd bail out on the fake start: chunk length exceeds data.
    fakeStart.push(0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00)
    const stream = new Uint8Array(fakeStart.length + real.length)
    stream.set(fakeStart, 0)
    stream.set(real, fakeStart.length)
    const pics = extractPicturesFromDataStream(stream)
    expect(pics.length).toBe(1)
    expect(pics[0].format).toBe('png')
  })
})
