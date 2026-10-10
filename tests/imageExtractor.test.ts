import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { OleParser } from '../src/utils/oleParser'
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

    it('should handle a JPEG with byte-stuffed 0xFF00 inside the scan data', () => {
      // SOI + SOS + entropy data containing FF 00 (escaped) + EOI
      const jpeg = new Uint8Array([
        0xFF, 0xD8,             // SOI
        0xFF, 0xDA, 0x00, 0x08, // SOS marker + length
        0x01, 0x01, 0x00, 0x00, // component fields (4 bytes)
        0x11, 0x22,             // entropy data
        0xFF, 0x00,             // byte-stuffed 0xFF (escaped, not a marker)
        0x33, 0x44,             // more entropy
        0xFF, 0xD9,             // EOI
      ])
      const images = extractImagesFromStream(jpeg)
      expect(images.length).toBe(1)
      expect(images[0].format).toBe('jpeg')
      // EOI found — slice ends at the EOI
      expect(images[0].data[images[0].data.length - 1]).toBe(0xD9)
    })

    it('should handle a JPEG with filler 0xFF bytes before a marker', () => {
      const jpeg = new Uint8Array([
        0xFF, 0xD8,             // SOI
        0xFF, 0xFF, 0xE0,       // filler FF + APP0 marker
        0x00, 0x04,             // APP0 length
        0x12, 0x34,             // payload
        0xFF, 0xD9,             // EOI
      ])
      const images = extractImagesFromStream(jpeg)
      expect(images.length).toBe(1)
      expect(images[0].data[images[0].data.length - 1]).toBe(0xD9)
    })

    it('should fall back to full slice for a truncated JPEG with SOS but no EOI', () => {
      // SOI + SOS + entropy data, truncated (no EOI) — findJpegEnd returns
      // data.length as a best-effort slice.
      const jpeg = new Uint8Array([
        0xFF, 0xD8,
        0xFF, 0xDA, 0x00, 0x08,
        0x01, 0x01, 0x00, 0x00,
        0x11, 0x22, 0x33,
      ])
      const images = extractImagesFromStream(jpeg)
      expect(images.length).toBe(1)
      expect(images[0].format).toBe('jpeg')
      expect(images[0].data.length).toBe(jpeg.length)
    })

    it('should handle a JPEG with standalone markers (RST/DNL)', () => {
      // SOI + DNL (0xDC standalone w/ length) + EOI
      const jpeg = new Uint8Array([
        0xFF, 0xD8,
        0xFF, 0xDC, 0x00, 0x04, // DNL marker + length
        0x00, 0x01,
        0xFF, 0xD9,
      ])
      const images = extractImagesFromStream(jpeg)
      expect(images.length).toBe(1)
      expect(images[0].data[images[0].data.length - 1]).toBe(0xD9)
    })

    it('should skip a JPEG with a segment whose length is invalid', () => {
      const jpeg = new Uint8Array([
        0xFF, 0xD8,
        0xFF, 0xE0, 0x00, 0x01, // APP0 with invalid length < 2
        0xFF, 0xD9,
      ])
      const images = extractImagesFromStream(jpeg)
      expect(images.length).toBe(0)
    })

    it('should extract a GIF with a global color table', () => {
      // GIF87a with GCT flag set and a 2-color (2-entry) table
      // packed = 0x80 → N=0 → 2^(0+1) = 2 entries × 3 bytes = 6 bytes
      const gif = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x37, 0x61,
        0x01, 0x00, 0x01, 0x00,
        0x80, // packed: GCT flag, N=0
        0x00, 0x00,
        // GCT: 2 entries × 3 bytes
        0xFF, 0x00, 0x00,
        0x00, 0xFF, 0x00,
        0x2C, // image descriptor
        0x00, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x01, 0x00,
        0x00,
        0x02,
        0x02, 0x4C, 0x01,
        0x00,
        0x3B, // trailer
      ])
      const images = extractImagesFromStream(gif)
      expect(images.length).toBe(1)
      expect(images[0].format).toBe('gif')
      expect(images[0].data[images[0].data.length - 1]).toBe(0x3B)
    })

    it('should extract a GIF with an extension block', () => {
      // GIF89a with a comment extension (0x21 0xFE) before the image
      const gif = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
        0x01, 0x00, 0x01, 0x00,
        0x00, 0x00, 0x00,
        0x21, 0xFE,             // extension introducer + comment label
        0x03, 0x41, 0x42, 0x43, // sub-block: "ABC"
        0x00,                   // block terminator
        0x2C,
        0x00, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x01, 0x00,
        0x00,
        0x02,
        0x02, 0x4C, 0x01,
        0x00,
        0x3B,
      ])
      const images = extractImagesFromStream(gif)
      expect(images.length).toBe(1)
      expect(images[0].format).toBe('gif')
      expect(images[0].data[images[0].data.length - 1]).toBe(0x3B)
    })

    it('should extract a GIF with a local color table', () => {
      // Image descriptor with LCT flag set, packed = 0x80 → N=0 → 2 entries
      const gif = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x37, 0x61,
        0x01, 0x00, 0x01, 0x00,
        0x00, 0x00, 0x00,
        0x2C,
        0x00, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x01, 0x00,
        0x80, // packed: LCT flag, N=0
        0xFF, 0x00, 0x00,
        0x00, 0xFF, 0x00,
        0x02,
        0x02, 0x4C, 0x01,
        0x00,
        0x3B,
      ])
      const images = extractImagesFromStream(gif)
      expect(images.length).toBe(1)
      expect(images[0].format).toBe('gif')
      expect(images[0].data[images[0].data.length - 1]).toBe(0x3B)
    })

    it('should skip a GIF with an unknown block type', () => {
      const gif = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x37, 0x61,
        0x01, 0x00, 0x01, 0x00,
        0x00, 0x00, 0x00,
        0x7F, // invalid block type (not 0x21, 0x2C, or 0x3B)
        0x3B,
      ])
      const images = extractImagesFromStream(gif)
      expect(images.length).toBe(0)
    })

    it('should skip a GIF with an unterminated image data block', () => {
      const gif = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x37, 0x61,
        0x01, 0x00, 0x01, 0x00,
        0x00, 0x00, 0x00,
        0x2C,
        0x00, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x01, 0x00,
        0x00,
        0x02,
        0x02, 0x4C, 0x01,
        // no block terminator, no trailer
      ])
      const images = extractImagesFromStream(gif)
      expect(images.length).toBe(0)
    })

    it('should skip a PNG with more than 10000 chunks (defensive cap)', () => {
      // Signature + a chunk whose length would require walking past the cap.
      // Build a stream of tiny IEND-less chunks; findPngEnd's cap returns -1.
      const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
      const bytes: number[] = [...sig]
      // 10001 zero-length 'ABCD' chunks — parser must stop at the cap
      for (let i = 0; i < 10001; i++) {
        bytes.push(0, 0, 0, 0, 0x41, 0x42, 0x43, 0x44, 0, 0, 0, 0)
      }
      const images = extractImagesFromStream(new Uint8Array(bytes))
      expect(images.length).toBe(0)
    })

    it('should handle a JPEG with 0xFF00 inside a segment payload', () => {
      // APP0 segment whose payload contains FF 00 — must not be treated as marker
      const jpeg = new Uint8Array([
        0xFF, 0xD8,
        0xFF, 0xE0, 0x00, 0x06, // APP0 length 6
        0xFF, 0x00, 0x12, 0x34, // payload with stuffed FF
        0xFF, 0xD9,
      ])
      const images = extractImagesFromStream(jpeg)
      expect(images.length).toBe(1)
      expect(images[0].data[images[0].data.length - 1]).toBe(0xD9)
    })

    it('should handle multiple filler 0xFF bytes inside scan data', () => {
      const jpeg = new Uint8Array([
        0xFF, 0xD8,
        0xFF, 0xDA, 0x00, 0x08,
        0x01, 0x01, 0x00, 0x00,
        0x11,
        0xFF, 0xFF, 0xFF, 0xD9, // multiple filler FFs then EOI
      ])
      const images = extractImagesFromStream(jpeg)
      expect(images.length).toBe(1)
      expect(images[0].data[images[0].data.length - 1]).toBe(0xD9)
    })

    it('should skip a JPEG with standalone marker and invalid following length', () => {
      // RST0 (0xD0) is standalone, then a marker with a too-short buffer
      const jpeg = new Uint8Array([
        0xFF, 0xD8,
        0xFF, 0xD0, // standalone RST0
        0xFF, 0xE0, // APP0 without enough bytes for length
        0xFF, 0xD9,
      ])
      const images = extractImagesFromStream(jpeg)
      expect(images.length).toBe(0)
    })

    it('should handle non-marker bytes after a standalone marker (main loop increment)', () => {
      // SOI + RST0 (FF D0) + non-FF byte + EOI — after skipping the
      // standalone marker the parser must step past the non-FF byte.
      const jpeg = new Uint8Array([
        0xFF, 0xD8,
        0xFF, 0xD0, // standalone RST0
        0x01, 0x02, // non-FF bytes
        0xFF, 0xD9,
      ])
      const images = extractImagesFromStream(jpeg)
      expect(images.length).toBe(1)
      expect(images[0].data[images[0].data.length - 1]).toBe(0xD9)
    })

    it('should handle 0xFF00 escaped byte in the top-level scan after SOS', () => {
      // SOS then entropy with FF 00 (escaped) — outer loop sees FF 00 and skips
      const jpeg = new Uint8Array([
        0xFF, 0xD8,
        0xFF, 0xDA, 0x00, 0x08,
        0x01, 0x01, 0x00, 0x00,
        0x11, 0x22,
        0xFF, 0x00, // escaped FF in entropy
        0x33,
        0xFF, 0xD9, // EOI
      ])
      const images = extractImagesFromStream(jpeg)
      expect(images.length).toBe(1)
      expect(images[0].data[images[0].data.length - 1]).toBe(0xD9)
    })

    it('should bail out of a GIF with too many blocks (defensive cap)', () => {
      // Build a GIF with a trailer that the parser never reaches because the
      // block walk runs past maxIterations — practically it will hit the
      // end-of-data return first; construct a long chain of extension blocks
      // without a trailer.
      const bytes: number[] = [
        0x47, 0x49, 0x46, 0x38, 0x37, 0x61,
        0x01, 0x00, 0x01, 0x00,
        0x00, 0x00, 0x00,
      ]
      // ~2000 comment extension blocks (each 8 bytes) — parser walks them all
      // then hits end-of-data and returns -1
      for (let i = 0; i < 2000; i++) {
        bytes.push(0x21, 0xFE, 0x02, 0x41, 0x42, 0x00)
      }
      const images = extractImagesFromStream(new Uint8Array(bytes))
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

describe('imageExtractor byte-stuffed markers', () => {
  it('skips 0xFF00 byte-stuffing while scanning JPEG', () => {
    const data = new Uint8Array([0xFF, 0xD8, 0xFF, 0x00, 0xFF, 0xD9, 0x00, 0x00])
    const images = extractImagesFromStream(data)
    expect(images.length).toBe(1)
    expect(images[0].format).toBe('jpeg')
    expect(images[0].data.length).toBe(6)
  })
})

// Round 125：由 git show HEAD:src/utils/imageExtractor.ts 中改动前的 findJpegEnd
// 逐行转写；只重命名函数并将 JPEG_SOI.length 固定为 2（FFD8 的常量边界），
// 保留逐字节熵扫描，不调用生产末端扫描，也不共享新的 indexOf 跳跃逻辑。
function referenceFindJpegEnd(data: Uint8Array, start: number): number {
  let offset = start + 2
  let sosOffset = -1   // SOS 标记位置，用于截断回退

  while (offset + 1 < data.length) {
    if (data[offset] === 0xFF) {
      // 跳过填充的 0xFF 字节。
      let marker = data[offset + 1]
      while (marker === 0xFF && offset + 2 < data.length) {
        offset++
        marker = data[offset + 1]
      }

      // 0xFF00 是熵数据中的转义字节，不是标记。
      if (marker === 0x00) {
        offset += 2
        continue
      }

      if (marker === 0xD9) {
        return offset + 2
      }

      // SOS 标记之后是熵编码数据。
      if (marker === 0xDA) {
        sosOffset = offset
        // 跳过 SOS 的长度字段及载荷。
        if (offset + 3 >= data.length) break
        const segLen = (data[offset + 2] << 8) | data[offset + 3]
        if (segLen < 2) break
        offset += 2 + segLen
        // 逐字节寻找下一个标记：0xFF 后跟非 0x00、非 0xFF 字节。
        while (offset + 1 < data.length) {
          if (data[offset] === 0xFF) {
            let next = data[offset + 1]
            // 跳过填充的 0xFF。
            while (next === 0xFF && offset + 2 < data.length) {
              offset++
              next = data[offset + 1]
            }
            // 0xFF00 是转义的 0xFF 字节，不是标记。
            if (next === 0x00) {
              offset += 2
              continue
            }
            // 找到真实标记，交回外层循环处理。
            break
          }
          offset++
        }
        // 下一轮重新进入标记处理。
        continue
      }

      // 无长度载荷的独立标记。
      if (marker === 0xD0 || marker === 0xD1 || marker === 0xD2 || marker === 0xD3 ||
          marker === 0xD4 || marker === 0xD5 || marker === 0xD6 || marker === 0xD7 ||
          marker === 0x01) {
        offset += 2
        continue
      }
      // 其他标记携带两字节长度（含长度字段本身）。
      if (offset + 3 >= data.length) break
      const segLen = (data[offset + 2] << 8) | data[offset + 3]
      if (segLen < 2) break
      offset += 2 + segLen
    } else {
      offset++
    }
  }

  // 看见 SOS 但没有 EOI 时，以当前视图末端作为截断回退。
  if (sosOffset >= 0) {
    return data.length
  }

  return -1
}

function expectJpegEndsMatchOracle(data: Uint8Array): number {
  const images = extractImagesFromStream(data).filter(image => image.format === 'jpeg')
  for (const image of images) {
    expect(image.data.buffer).toBe(data.buffer)
    const start = image.data.byteOffset - data.byteOffset
    expect(start + image.data.length).toBe(referenceFindJpegEnd(data, start))
    expect(image.data).toEqual(data.subarray(start, referenceFindJpegEnd(data, start)))
  }
  return images.length
}

const JPEG_SOS_HEADER = [
  0xFF, 0xD8,
  0xFF, 0xDA, 0x00, 0x08,
  0x01, 0x01, 0x00, 0x00, 0x3F, 0x00,
]

const JPEG_ENTROPY_BOUNDARIES = [
  { name: '连续FF填充后EOI', entropy: [0x11, 0xFF, 0xFF, 0xFF, 0xD9, 0x22], end: 5 },
  { name: 'FF00转义后EOI', entropy: [0xFF, 0x00, 0x11, 0xFF, 0xD9, 0x22], end: 5 },
  { name: '连续FF后00转义', entropy: [0x11, 0xFF, 0xFF, 0x00, 0x22, 0xFF, 0xD9, 0x33], end: 7 },
  { name: '无EOI的普通熵数据截断', entropy: [0x11, 0x22], end: 2 },
  { name: '末尾单FF截断', entropy: [0x11, 0xFF], end: 2 },
  { name: '末尾连续FF截断', entropy: [0xFF, 0xFF], end: 2 },
  { name: '末尾FF00截断', entropy: [0x11, 0xFF, 0x00], end: 3 },
  { name: 'SOS后无熵数据', entropy: [], end: 0 },
  { name: '多SOS扫描', entropy: [0x11, 0xFF, 0xDA, 0x00, 0x02, 0x22, 0xFF, 0x00, 0x33, 0xFF, 0xD9, 0x44], end: 11 },
  { name: 'RST和TEM独立标记', entropy: [0x11, 0xFF, 0xD0, 0x22, 0xFF, 0xD7, 0xFF, 0x01, 0x33, 0xFF, 0xD9, 0x44], end: 11 },
  { name: '长非FF熵区后EOI', entropy: [...new Array<number>(4096).fill(0x11), 0xFF, 0xD9, 0x22], end: 4098 },
]

describe('Round 125 JPEG熵扫描与HEAD逐字节oracle等价性', () => {
  it('27份真实DOC/DOT的Data和WordDocument流逐个JPEG末端相同且确有产出', () => {
    const docs = new URL('../docs/', import.meta.url)
    const files = readdirSync(docs).filter(name => /\.(doc|dot)$/.test(name)).sort()
    expect(files).toHaveLength(27)
    let jpegCount = 0
    let streamCount = 0
    for (const name of files) {
      const bytes = readFileSync(new URL(name, docs))
      const ole = new OleParser(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const header = ole.parseHeader()
      const directory = ole.getDirectorySectors(header, ole.getFatSectors(header))
      const entries = directory.filter(entry => entry.objectType === 2 &&
        (entry.name === 'Data' || entry.name === 'WordDocument'))
      expect(entries.some(entry => entry.name === 'WordDocument')).toBe(true)
      for (const entry of entries) {
        const stream = ole.readStream(entry).data
        jpegCount += expectJpegEndsMatchOracle(stream)
        streamCount++
      }
    }
    expect(streamCount).toBe(45)
    expect(jpegCount).toBe(7)
  })

  it('SOS后的全部65536种两字节熵数据与旧oracle相同且每种都产出JPEG', () => {
    const data = new Uint8Array([...JPEG_SOS_HEADER, 0, 0, 0x11, 0xFF, 0xD9])
    let jpegCount = 0
    for (let pair = 0; pair < 65536; pair++) {
      data[JPEG_SOS_HEADER.length] = pair >>> 8
      data[JPEG_SOS_HEADER.length + 1] = pair & 0xFF
      const expectedEnd = referenceFindJpegEnd(data, 0)
      expect(expectedEnd).toBeGreaterThan(0)
      const images = extractImagesFromStream(data)
      expect(images).toHaveLength(1)
      expect(images[0].format).toBe('jpeg')
      expect(images[0].data.length).toBe(expectedEnd)
      expect(images[0].data).toEqual(data.subarray(0, expectedEnd))
      jpegCount += images.length
    }
    expect(jpegCount).toBe(65536)
  })

  it.each(JPEG_ENTROPY_BOUNDARIES)('$name给出确定的非空产出和末端', ({ entropy, end }) => {
    const data = new Uint8Array([...JPEG_SOS_HEADER, ...entropy])
    expect(expectJpegEndsMatchOracle(data)).toBe(1)
    const images = extractImagesFromStream(data)
    expect(images[0].data.length).toBe(JPEG_SOS_HEADER.length + end)
  })

  it('SOS长度字段截断、过小或越界仍与旧oracle一致并实际回退产出', () => {
    const cases = [
      new Uint8Array([0x11, 0x11, 0x11, 0x11, 0xFF, 0xD8, 0xFF, 0xDA, 0x00]),
      new Uint8Array([0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x01, 0x11, 0x22]),
      new Uint8Array([0xFF, 0xD8, 0xFF, 0xDA, 0xFF, 0xFF, 0x11, 0x22]),
    ]
    for (const data of cases) {
      expect(expectJpegEndsMatchOracle(data)).toBe(1)
      const images = extractImagesFromStream(data)
      const start = images[0].data.byteOffset - data.byteOffset
      expect(start + images[0].data.length).toBe(data.length)
    }
  })

  it('非零byteOffset视图以自身边界为准且非零JPEG起点末端相同', () => {
    for (const byteOffset of [1, 2, 3, 7]) {
      for (const complete of [false, true]) {
        const prefix = [0x11, 0x22, 0x33]
        const content = new Uint8Array([
          ...prefix, ...JPEG_SOS_HEADER, 0x11, 0xFF, 0x00, 0x22,
          ...(complete ? [0xFF, 0xD9, 0x33] : [0xFF]),
        ])
        const backing = new Uint8Array(byteOffset + content.length + 4)
        backing.fill(0xFF, 0, byteOffset)
        backing.set(content, byteOffset)
        // 视图外的EOI不能结束视图内截断的JPEG。
        backing.set([0xFF, 0xD9, 0xFF, 0xD9], byteOffset + content.length)
        const data = backing.subarray(byteOffset, byteOffset + content.length)
        expect(data.byteOffset).toBe(byteOffset)
        expect(expectJpegEndsMatchOracle(data)).toBe(1)
        const images = extractImagesFromStream(data)
        expect(images[0].data.byteOffset).toBe(byteOffset + prefix.length)
        expect(images[0].data.length).toBe(content.length - prefix.length - (complete ? 1 : 0))
      }
    }
  })
})
