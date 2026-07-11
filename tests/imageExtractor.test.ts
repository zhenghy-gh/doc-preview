import { describe, it, expect } from 'vitest'
import {
  extractImagesFromStream,
  imagesToDataUrls,
  imageFormatMime,
} from '../src/utils/imageExtractor'

/**
 * Build a minimal but valid PNG: signature + IHDR + IDAT + IEND.
 * Each chunk = length(4 BE) + type(4) + data + crc(4).
 * CRC is computed correctly so findPngEnd walks the chunks cleanly.
 */
function buildMinimalPng(): Uint8Array {
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
  const ihdrData = [
    0x00, 0x00, 0x00, 0x01, // width
    0x00, 0x00, 0x00, 0x01, // height
    0x08, 0x00, 0x00, 0x00, 0x00, // bit depth, color type, compression, filter, interlace
  ]
  const idatData = [0x78, 0x9C, 0x62, 0x00, 0x02, 0x00, 0x00, 0x05, 0x00, 0x01]

  function chunk(type: string, data: number[]): number[] {
    const typeBytes = type.split('').map(c => c.charCodeAt(0))
    const length = data.length
    const lengthBytes = [(length >>> 24) & 0xFF, (length >>> 16) & 0xFF, (length >>> 8) & 0xFF, length & 0xFF]
    // CRC covers type + data
    const crcInput = [...typeBytes, ...data]
    const crc = crc32(crcInput)
    return [...lengthBytes, ...typeBytes, ...data, ...crc]
  }

  function crc32(bytes: number[]): number[] {
    // Standard CRC-32 (PNG polynomial)
    let crc = 0xFFFFFFFF
    const table = new Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      }
      table[n] = c
    }
    for (const b of bytes) {
      crc = (table[(crc ^ b) & 0xFF] ^ (crc >>> 8)) >>> 0
    }
    crc = (crc ^ 0xFFFFFFFF) >>> 0
    return [(crc >>> 24) & 0xFF, (crc >>> 16) & 0xFF, (crc >>> 8) & 0xFF, crc & 0xFF]
  }

  return new Uint8Array([
    ...sig,
    ...chunk('IHDR', ihdrData),
    ...chunk('IDAT', idatData),
    ...chunk('IEND', []),
  ])
}

/** Build a minimal JPEG: FFD8 (SOI) + FFE0 + payload + FFD9 (EOI). */
function buildMinimalJpeg(): Uint8Array {
  return new Uint8Array([
    0xFF, 0xD8,                       // SOI
    0xFF, 0xE0, 0x00, 0x10,           // APP0 marker + length (16)
    0x4A, 0x46, 0x49, 0x46, 0x00,     // JFIF\0
    0x01, 0x01, 0x00, 0x00, 0x01,     // version, density units, X density
    0x00, 0x01, 0x00, 0x00,           // Y density, thumb W/H
    0xFF, 0xD9,                       // EOI
  ])
}

/** Build a minimal BMP: 14-byte file header + 40-byte DIB header + 1 pixel. */
function buildMinimalBmp(): Uint8Array {
  const fileSize = 14 + 40 + 4 // header + DIB + 1 BGRA pixel
  const bytes = new Uint8Array(fileSize)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x42; bytes[1] = 0x4D  // "BM"
  view.setUint32(2, fileSize, true)  // file size
  view.setUint32(10, 14 + 40, true) // pixel data offset
  view.setUint32(14, 40, true)      // DIB header size
  view.setInt32(18, 1, true)        // width
  view.setInt32(22, 1, true)        // height
  view.setUint16(26, 1, true)       // color planes
  view.setUint16(28, 32, true)      // bits per pixel
  return bytes
}

/** Build a minimal GIF87a with a 1x1 image. */
function buildMinimalGif(): Uint8Array {
  return new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x37, 0x61, // GIF87a
    0x01, 0x00, 0x01, 0x00,             // width=1, height=1
    0x00, 0x00, 0x00,                   // packed (no GCT), bg=0, aspect=0
    0x2C,                               // image descriptor
    0x00, 0x00, 0x00, 0x00,             // left, top
    0x01, 0x00, 0x01, 0x00,             // width=1, height=1
    0x00,                               // packed (no LCT)
    0x02,                               // LZW min code size
    0x02, 0x4C, 0x01,                   // sub-block: 2 bytes of LZW data
    0x00,                               // block terminator
    0x3B,                               // trailer
  ])
}

describe('imageExtractor', () => {
  describe('extractImagesFromStream', () => {
    it('should return empty array for null/empty input', () => {
      expect(extractImagesFromStream(new Uint8Array(0))).toEqual([])
      expect(extractImagesFromStream(new Uint8Array(4))).toEqual([])
    })

    it('should extract a PNG from the stream', () => {
      const png = buildMinimalPng()
      const images = extractImagesFromStream(png)
      expect(images.length).toBe(1)
      expect(images[0].format).toBe('png')
      expect(images[0].data.length).toBe(png.length)
    })

    it('should extract a JPEG from the stream', () => {
      const jpeg = buildMinimalJpeg()
      const images = extractImagesFromStream(jpeg)
      expect(images.length).toBe(1)
      expect(images[0].format).toBe('jpeg')
      expect(images[0].data.length).toBe(jpeg.length)
    })

    it('should extract a BMP from the stream', () => {
      const bmp = buildMinimalBmp()
      const images = extractImagesFromStream(bmp)
      expect(images.length).toBe(1)
      expect(images[0].format).toBe('bmp')
      expect(images[0].data.length).toBe(bmp.length)
    })

    it('should extract a GIF from the stream', () => {
      const gif = buildMinimalGif()
      const images = extractImagesFromStream(gif)
      expect(images.length).toBe(1)
      expect(images[0].format).toBe('gif')
      expect(images[0].data.length).toBe(gif.length)
    })

    it('should extract multiple images from a stream with padding between them', () => {
      const png = buildMinimalPng()
      const jpeg = buildMinimalJpeg()
      const padding = new Uint8Array([0x00, 0x00, 0x00, 0x00])
      const combined = new Uint8Array(png.length + padding.length + jpeg.length)
      combined.set(png, 0)
      combined.set(padding, png.length)
      combined.set(jpeg, png.length + padding.length)

      const images = extractImagesFromStream(combined)
      expect(images.length).toBe(2)
      expect(images[0].format).toBe('png')
      expect(images[1].format).toBe('jpeg')
    })

    it('should not false-positive on random binary data', () => {
      const random = new Uint8Array(256)
      for (let i = 0; i < random.length; i++) random[i] = (i * 7) & 0xFF
      // Ensure no magic happens to align — should yield zero images.
      const images = extractImagesFromStream(random)
      expect(images.length).toBe(0)
    })

    it('should skip a PNG whose chunk structure is broken', () => {
      const png = buildMinimalPng()
      // Truncate before IEND — findPngEnd should return -1.
      const truncated = png.subarray(0, png.length - 12)
      const images = extractImagesFromStream(truncated)
      expect(images.length).toBe(0)
    })

    it('should skip a JPEG without EOI marker', () => {
      const jpeg = buildMinimalJpeg()
      const truncated = jpeg.subarray(0, jpeg.length - 2)
      const images = extractImagesFromStream(truncated)
      expect(images.length).toBe(0)
    })

    it('should skip a BMP with an invalid size field', () => {
      const bmp = buildMinimalBmp()
      // Corrupt the size field to be smaller than the minimum.
      const view = new DataView(bmp.buffer)
      view.setUint32(2, 10, true)
      const images = extractImagesFromStream(bmp)
      expect(images.length).toBe(0)
    })
  })

  describe('imageFormatMime', () => {
    it('should return the correct MIME type for each format', () => {
      expect(imageFormatMime('png')).toBe('image/png')
      expect(imageFormatMime('jpeg')).toBe('image/jpeg')
      expect(imageFormatMime('bmp')).toBe('image/bmp')
      expect(imageFormatMime('gif')).toBe('image/gif')
    })
  })

  describe('imagesToDataUrls', () => {
    it('should convert images to data URLs', () => {
      const png = buildMinimalPng()
      const images = extractImagesFromStream(png)
      const urls = imagesToDataUrls(images)
      expect(urls.length).toBe(1)
      expect(urls[0]).toMatch(/^data:image\/png;base64,/)
    })

    it('should produce a data URL that round-trips to the original bytes', () => {
      const png = buildMinimalPng()
      const images = extractImagesFromStream(png)
      const urls = imagesToDataUrls(images)
      const base64 = urls[0].substring(urls[0].indexOf(',') + 1)
      const decoded = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
      expect(decoded.length).toBe(png.length)
      for (let i = 0; i < png.length; i++) {
        expect(decoded[i]).toBe(png[i])
      }
    })

    it('should return an empty array for no images', () => {
      expect(imagesToDataUrls([])).toEqual([])
    })
  })
})
