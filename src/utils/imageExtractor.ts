/**
 * Image extraction from a .doc file's `Data` stream (and, as a fallback, the
 * WordDocument stream).
 *
 * Word 97-2003 stores embedded pictures as binary blobs inside the `Data`
 * stream. Each picture is referenced from the document text via a special
 * character (0x01 / 0x08) and a CHP `fcPic` pointer into a PICF structure
 * in the Data stream. Parsing PICF/FCPic requires the CHP table, which this
 * project does not yet read.
 *
 * As a pragmatic fallback, this module scans the Data stream for well-known
 * image-format magic numbers (PNG / JPEG / BMP / GIF) and slices out each
 * image using the format's own length / boundary markers. This recovers
 * most embedded raster images without touching the CHP table.
 *
 * WMF / EMF are intentionally skipped: their magic numbers are weak
 * (`01 00 00 00` for EMF is extremely common) and would produce many false
 * positives. They can be added later once PICF parsing is in place.
 */

/** MIME type / format tag for an extracted image. */
export type ImageFormat = 'png' | 'jpeg' | 'bmp' | 'gif'

/** An extracted image: format tag + raw bytes. */
export interface ExtractedImage {
  format: ImageFormat
  /** Raw image bytes (without any container wrapping). */
  data: Uint8Array
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
const JPEG_SOI = [0xFF, 0xD8]
const GIF_SIGNATURE_87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] // GIF87a
const GIF_SIGNATURE_89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] // GIF89a

function bytesEqual(data: Uint8Array, offset: number, signature: number[]): boolean {
  if (offset + signature.length > data.length) return false
  for (let i = 0; i < signature.length; i++) {
    if (data[offset + i] !== signature[i]) return false
  }
  return true
}

/**
 * Slice a PNG starting at `start`. PNG is a sequence of chunks, each:
 *   length (4 bytes BE) + type (4 bytes) + data + crc (4 bytes)
 * The image ends with an IEND chunk. We scan chunks until IEND is found.
 * Returns the end offset (exclusive), or -1 if the structure looks invalid.
 */
function findPngEnd(data: Uint8Array, start: number): number {
  // Skip the 8-byte signature.
  let offset = start + PNG_SIGNATURE.length
  // Defensive cap to avoid infinite loops on corrupt data.
  const maxChunks = 10000
  for (let i = 0; i < maxChunks; i++) {
    if (offset + 8 > data.length) return -1
    const length = (data[offset] << 24) | (data[offset + 1] << 16) |
                   (data[offset + 2] << 8) | data[offset + 3]
    const type = String.fromCharCode(data[offset + 4], data[offset + 5],
                                     data[offset + 6], data[offset + 7])
    // Length is a 32-bit BE unsigned; sanity-check it.
    if (length < 0 || length > data.length) return -1
    // Each chunk: 4 (length) + 4 (type) + length (data) + 4 (crc)
    const chunkEnd = offset + 12 + length
    if (chunkEnd > data.length) return -1
    if (type === 'IEND') return chunkEnd
    offset = chunkEnd
  }
  return -1
}

/**
 * Slice a JPEG starting at `start`. JPEG begins with FFD8 (SOI) and ends
 * with FFD9 (EOI). We scan for the EOI marker; this handles the common
 * case where the JPEG is stored as a single self-contained stream.
 */
function findJpegEnd(data: Uint8Array, start: number): number {
  let offset = start + JPEG_SOI.length
  while (offset + 1 < data.length) {
    if (data[offset] === 0xFF) {
      // Skip filler 0xFF bytes.
      let marker = data[offset + 1]
      while (marker === 0xFF && offset + 2 < data.length) {
        offset++
        marker = data[offset + 1]
      }
      if (marker === 0xD9) {
        return offset + 2
      }
      // Standalone markers (no length payload).
      if (marker === 0xD0 || marker === 0xD1 || marker === 0xD2 || marker === 0xD3 ||
          marker === 0xD4 || marker === 0xD5 || marker === 0xD6 || marker === 0xD7 ||
          marker === 0x01) {
        offset += 2
        continue
      }
      // Other markers carry a 2-byte length (including the length bytes).
      if (offset + 3 >= data.length) return -1
      const segLen = (data[offset + 2] << 8) | data[offset + 3]
      if (segLen < 2) return -1
      offset += 2 + segLen
    } else {
      offset++
    }
  }
  return -1
}

/**
 * Slice a BMP starting at `start`. The BMP file header stores the total
 * file size at offset +2..+5 (little-endian uint32). We trust it after a
 * sanity check.
 */
function findBmpEnd(data: Uint8Array, start: number): number {
  if (start + 6 > data.length) return -1
  const size = data[start + 2] | (data[start + 3] << 8) |
               (data[start + 4] << 16) | (data[start + 5] << 24)
  // Sanity: BMP files have a 14-byte file header + DIB header (≥40 bytes).
  if (size < 54 || size > data.length - start) return -1
  return start + size
}

/**
 * Slice a GIF starting at `start`. GIF logical screen descriptor stores
 * width/height at +6..+9 and a packed byte at +10. The actual end of the
 * stream is marked by a 0x3B trailer. We scan for the trailer, with a
 * defensive cap.
 */
function findGifEnd(data: Uint8Array, start: number): number {
  // GIF header is 6 bytes; logical screen descriptor is 7 bytes.
  let offset = start + 13
  // Skip the global color table if present.
  if (start + 10 < data.length) {
    const packed = data[start + 10]
    const hasGct = (packed & 0x80) !== 0
    if (hasGct) {
      const gctSize = 3 * (1 << ((packed & 0x07) + 1))
      offset += gctSize
    }
  }
  // Walk blocks until the trailer (0x3B).
  const maxIterations = 1000000
  for (let i = 0; i < maxIterations; i++) {
    if (offset >= data.length) return -1
    const block = data[offset]
    if (block === 0x3B) return offset + 1
    if (block === 0x21) {
      // Extension introducer: skip extension type + sub-blocks.
      offset += 2 // 0x21 + label
      while (offset < data.length) {
        const subLen = data[offset]
        offset++
        if (subLen === 0) break
        offset += subLen
      }
    } else if (block === 0x2C) {
      // Image descriptor: 10 bytes (0x2C + left/top/width/height/packed).
      offset += 10
      if (offset > data.length) return -1
      const packed = data[offset - 1]
      const hasLct = (packed & 0x80) !== 0
      if (hasLct) {
        const lctSize = 3 * (1 << ((packed & 0x07) + 1))
        offset += lctSize
      }
      // LZW minimum code size byte.
      offset++
      while (offset < data.length) {
        const subLen = data[offset]
        offset++
        if (subLen === 0) break
        offset += subLen
      }
    } else {
      // Unknown block — bail.
      return -1
    }
  }
  return -1
}

/**
 * Scan `data` for embedded images and return each as `{ format, data }`.
 *
 * The scan walks the buffer once, and at each position checks for one of
 * the supported magic signatures. When a match is found, the corresponding
 * end-finder is used to slice the image bytes; the scan then resumes from
 * the end offset (so overlapping images are not double-counted).
 *
 * Returns an empty array if no images are found.
 */
export function extractImagesFromStream(data: Uint8Array): ExtractedImage[] {
  if (!data || data.length < 8) return []

  const images: ExtractedImage[] = []
  let i = 0

  while (i < data.length) {
    // PNG
    if (bytesEqual(data, i, PNG_SIGNATURE)) {
      const end = findPngEnd(data, i)
      if (end > i) {
        images.push({ format: 'png', data: data.subarray(i, end) })
        i = end
        continue
      }
    }
    // JPEG
    if (bytesEqual(data, i, JPEG_SOI) && i + 2 < data.length && data[i + 2] === 0xFF) {
      const end = findJpegEnd(data, i)
      if (end > i) {
        images.push({ format: 'jpeg', data: data.subarray(i, end) })
        i = end
        continue
      }
    }
    // GIF (87a or 89a)
    if (bytesEqual(data, i, GIF_SIGNATURE_87) || bytesEqual(data, i, GIF_SIGNATURE_89)) {
      const end = findGifEnd(data, i)
      if (end > i) {
        images.push({ format: 'gif', data: data.subarray(i, end) })
        i = end
        continue
      }
    }
    // BMP
    if (data[i] === 0x42 && data[i + 1] === 0x4D) {
      const end = findBmpEnd(data, i)
      if (end > i) {
        images.push({ format: 'bmp', data: data.subarray(i, end) })
        i = end
        continue
      }
    }
    i++
  }

  return images
}

/** MIME type for each supported format. */
export function imageFormatMime(format: ImageFormat): string {
  switch (format) {
    case 'png': return 'image/png'
    case 'jpeg': return 'image/jpeg'
    case 'bmp': return 'image/bmp'
    case 'gif': return 'image/gif'
  }
}

/** Convert extracted images to data URLs for inline rendering. */
export function imagesToDataUrls(images: ExtractedImage[]): string[] {
  return images.map(img => {
    let binary = ''
    const bytes = img.data
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
      binary += String.fromCharCode.apply(null, Array.from(slice) as unknown as number[])
    }
    return `data:${imageFormatMime(img.format)};base64,${btoa(binary)}`
  })
}
