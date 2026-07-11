/**
 * MS-DOC picture (PICF / FCPic) structure parser.
 *
 * Word 97-2003 stores embedded pictures inside the `Data` stream. Each
 * picture is referenced from the main text via a special character (0x01)
 * whose CHP contains an `fcPic` pointer into a PICF structure in the Data
 * stream. The PICF header describes the picture's dimensions, type, and
 * offset/length of the actual image bytes.
 *
 * Structure (simplified, per MS-DOC §2.9.87 / §2.9.88):
 *
 *   FCPic (4 bytes):
 *     lcb (4 bytes, uint32): total byte count of the PICF that follows
 *
 *   PICF (variable):
 *     Header (66 bytes):
 *       mm (2 bytes): picture metafile type (0x0008 = JPEG, 0x000A = PNG, etc.)
 *       xExt (2 bytes): width in units defined by mm
 *       yExt (2 bytes): height
 *       ... (other fields we don't currently need)
 *
 *     The image data follows after the header. Its size is
 *     lcb - 68 (FCPic 4 + PICF header 64 = 68... actually lcb - sizeof(PICF header)).
 *
 * Since the full PICF structure is complex and varies by picture type, we
 * take a pragmatic approach: scan for well-known image magic numbers inside
 * the Data stream, and for each match try to verify that it sits inside a
 * valid PICF envelope. When PICF can be parsed, we extract dimensions and
 * picture type; when it can't, we fall back to the raw magic-scan result so
 * the image is still visible.
 */

import { extractImagesFromStream, imageFormatMime, type ImageFormat } from './imageExtractor'

export type PictureType =
  | 'jpeg'
  | 'png'
  | 'bmp'
  | 'gif'
  | 'wmf'
  | 'emf'
  | 'unknown'

export interface ParsedPicture {
  format: ImageFormat | 'unknown'
  data: Uint8Array
  dataUrl?: string
  type: PictureType
  widthPx?: number
  heightPx?: number
  /** True if the picture is floating (has a shape anchor) rather than inline. */
  floating?: boolean
  /** Offset in the Data stream where the image bytes start (for correlation). */
  dataOffset: number
}

const MM_PNG = 0x000A
const MM_JPEG = 0x0008
const MM_BMP = 0x0003
const MM_GIF = 0x000F
const MM_EMF = 0x0004
const MM_WMF = 0x0002

const PICF_HEADER_SIZE = 68

function readUint16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.length) return 0
  return data[offset] | (data[offset + 1] << 8)
}

function readUint32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) return 0
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  )
}

function mmToPictureType(mm: number): PictureType {
  switch (mm) {
    case MM_JPEG:
      return 'jpeg'
    case MM_PNG:
      return 'png'
    case MM_BMP:
      return 'bmp'
    case MM_GIF:
      return 'gif'
    case MM_EMF:
      return 'emf'
    case MM_WMF:
      return 'wmf'
    default:
      return 'unknown'
  }
}

function pictureTypeToFormat(type: PictureType): ImageFormat | 'unknown' {
  if (type === 'jpeg' || type === 'png' || type === 'bmp' || type === 'gif') {
    return type
  }
  return 'unknown'
}

function bytesEqual(data: Uint8Array, offset: number, signature: number[]): boolean {
  if (offset + signature.length > data.length) return false
  for (let i = 0; i < signature.length; i++) {
    if (data[offset + i] !== signature[i]) return false
  }
  return true
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SOI = [0xff, 0xd8]
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
const BMP_SIG = [0x42, 0x4d] // 'BM'

function detectImageFormat(data: Uint8Array, offset: number): ImageFormat | null {
  if (bytesEqual(data, offset, PNG_SIGNATURE)) return 'png'
  if (
    bytesEqual(data, offset, JPEG_SOI) &&
    offset + 2 < data.length &&
    data[offset + 2] === 0xff
  )
    return 'jpeg'
  if (bytesEqual(data, offset, GIF87) || bytesEqual(data, offset, GIF89)) return 'gif'
  if (bytesEqual(data, offset, BMP_SIG)) return 'bmp'
  return null
}

/**
 * Find the end of a JPEG starting at `start` (must point at FFD8).
 * Returns end offset (exclusive), or -1 if not found.
 */
function findJpegEnd(data: Uint8Array, start: number, maxLen: number): number {
  const limit = Math.min(start + maxLen, data.length)
  let offset = start + 2
  while (offset + 1 < limit) {
    if (data[offset] !== 0xff) {
      offset++
      continue
    }
    let marker = data[offset + 1]
    while (marker === 0xff && offset + 2 < limit) {
      offset++
      marker = data[offset + 1]
    }
    if (marker === 0xd9) return offset + 2
    if (
      marker === 0xd0 ||
      marker === 0xd1 ||
      marker === 0xd2 ||
      marker === 0xd3 ||
      marker === 0xd4 ||
      marker === 0xd5 ||
      marker === 0xd6 ||
      marker === 0xd7 ||
      marker === 0x01
    ) {
      offset += 2
      continue
    }
    if (offset + 3 >= limit) return -1
    const segLen = (data[offset + 2] << 8) | data[offset + 3]
    if (segLen < 2) return -1
    offset += 2 + segLen
  }
  return -1
}

/**
 * Find the end of a PNG starting at `start` (must point at PNG signature).
 * Returns end offset (exclusive), or -1 if not found.
 */
function findPngEnd(data: Uint8Array, start: number, maxLen: number): number {
  const limit = Math.min(start + maxLen, data.length)
  let offset = start + 8
  for (let i = 0; i < 10000; i++) {
    if (offset + 8 > limit) return -1
    const length =
      (data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]
    if (length < 0 || length > limit - offset) return -1
    const type = String.fromCharCode(
      data[offset + 4],
      data[offset + 5],
      data[offset + 6],
      data[offset + 7],
    )
    const chunkEnd = offset + 12 + length
    if (chunkEnd > limit) return -1
    if (type === 'IEND') return chunkEnd
    offset = chunkEnd
  }
  return -1
}

/**
 * Find the end of a BMP starting at `start` (must point at 'BM' signature).
 * Returns end offset (exclusive), or -1 if not valid.
 */
function findBmpEnd(data: Uint8Array, start: number, maxLen: number): number {
  if (start + 6 > data.length) return -1
  const size = readUint32(data, start + 2)
  if (size < 54 || size > maxLen || start + size > data.length) return -1
  return start + size
}

/**
 * Find the end of a GIF starting at `start`.
 * Returns end offset (exclusive), or -1 if not found.
 */
function findGifEnd(data: Uint8Array, start: number, maxLen: number): number {
  const limit = Math.min(start + maxLen, data.length)
  if (start + 13 > limit) return -1
  const packed = data[start + 10]
  let offset = start + 13
  if ((packed & 0x80) !== 0) {
    const gctSize = 3 * (1 << ((packed & 0x07) + 1))
    offset += gctSize
  }
  for (let i = 0; i < 1000000; i++) {
    if (offset >= limit) return -1
    const block = data[offset]
    if (block === 0x3b) return offset + 1
    if (block === 0x21) {
      offset += 2
      while (offset < limit) {
        const subLen = data[offset]
        offset++
        if (subLen === 0) break
        offset += subLen
      }
    } else if (block === 0x2c) {
      offset += 10
      if (offset > limit) return -1
      const packed2 = data[offset - 1]
      if ((packed2 & 0x80) !== 0) {
        const lctSize = 3 * (1 << ((packed2 & 0x07) + 1))
        offset += lctSize
      }
      offset++
      while (offset < limit) {
        const subLen = data[offset]
        offset++
        if (subLen === 0) break
        offset += subLen
      }
    } else {
      return -1
    }
  }
  return -1
}

function findImageEnd(
  data: Uint8Array,
  start: number,
  format: ImageFormat,
  maxLen: number,
): number {
  switch (format) {
    case 'png':
      return findPngEnd(data, start, maxLen)
    case 'jpeg':
      return findJpegEnd(data, start, maxLen)
    case 'bmp':
      return findBmpEnd(data, start, maxLen)
    case 'gif':
      return findGifEnd(data, start, maxLen)
  }
}

/**
 * Try to parse a PICF envelope starting at `picfOffset` in the Data stream.
 *
 * A valid PICF is preceded by a 4-byte FCPic (`lcb` total length). We check
 * that `lcb` is reasonable and that the `mm` field matches one of the known
 * picture metafile types.
 *
 * Returns info about the picture (including image data), or null if the
 * structure doesn't look like a valid PICF.
 */
export function parsePicfAt(
  dataStream: Uint8Array,
  fcPic: number,
): ParsedPicture | null {
  if (fcPic < 0 || fcPic + 8 > dataStream.length) return null

  const lcb = readUint32(dataStream, fcPic)
  if (lcb < PICF_HEADER_SIZE || lcb > dataStream.length - fcPic) return null
  if (lcb > 50 * 1024 * 1024) return null

  const picfStart = fcPic + 4
  const mm = readUint16(dataStream, picfStart)
  const type = mmToPictureType(mm)

  const xExt = readUint16(dataStream, picfStart + 2)
  const yExt = readUint16(dataStream, picfStart + 4)

  const picfEnd = fcPic + 4 + lcb

  let imgStart = picfStart + PICF_HEADER_SIZE
  let imgEnd = picfEnd

  let format: ImageFormat | 'unknown' = pictureTypeToFormat(type)
  if (format === 'unknown') {
    const detected = detectImageFormat(dataStream, imgStart)
    if (detected) format = detected
  }

  if (format !== 'unknown') {
    const found = findImageEnd(dataStream, imgStart, format, lcb)
    if (found > 0) imgEnd = found
  }

  if (imgEnd <= imgStart || imgEnd > dataStream.length) return null

  const imgData = dataStream.subarray(imgStart, imgEnd)

  const result: ParsedPicture = {
    format,
    data: imgData,
    type,
    dataOffset: imgStart,
  }

  if (xExt > 0 && yExt > 0) {
    result.widthPx = xExt
    result.heightPx = yExt
  }

  return result
}

/**
 * Scan the Data stream for embedded pictures, trying PICF envelope detection
 * first and falling back to magic-number scanning.
 *
 * Returns an array of parsed pictures. Each picture's image bytes are wrapped
 * in the most plausible format we can determine.
 */
export function extractPicturesFromDataStream(dataStream: Uint8Array): ParsedPicture[] {
  if (!dataStream || dataStream.length < 64) return []

  const results: ParsedPicture[] = []
  const seenOffsets = new Set<number>()

  const rawImages = extractImagesFromStream(dataStream)
  if (rawImages.length === 0) return []

  let scanOffset = 0
  for (const img of rawImages) {
    const idx = findImageIndexInStream(dataStream, img.data, scanOffset)
    if (idx < 0) continue
    scanOffset = idx + img.data.length

    const picfOffset = findPrecedingPicf(dataStream, idx)
    if (picfOffset >= 0 && !seenOffsets.has(picfOffset)) {
      const pic = parsePicfAt(dataStream, picfOffset)
      if (pic) {
        seenOffsets.add(picfOffset)
        results.push(pic)
        continue
      }
    }

    if (!seenOffsets.has(idx)) {
      seenOffsets.add(idx)
      results.push({
        format: img.format,
        data: img.data,
        type: img.format as PictureType,
        dataOffset: idx,
      })
    }
  }

  return results
}

function findImageIndexInStream(
  stream: Uint8Array,
  img: Uint8Array,
  startFrom: number,
): number {
  if (img.length === 0) return -1
  const firstByte = img[0]
  for (let i = startFrom; i < stream.length - img.length + 1; i++) {
    if (stream[i] !== firstByte) continue
    let match = true
    for (let j = 1; j < Math.min(img.length, 16); j++) {
      if (stream[i + j] !== img[j]) {
        match = false
        break
      }
    }
    if (match) return i
  }
  return -1
}

function findPrecedingPicf(dataStream: Uint8Array, imgOffset: number): number {
  const maxHeaderSize = 256
  const start = Math.max(0, imgOffset - maxHeaderSize)
  for (let i = start; i < imgOffset - 4; i++) {
    const lcb = readUint32(dataStream, i)
    if (lcb < PICF_HEADER_SIZE || lcb > imgOffset - i + 1024) continue
    if (lcb > 50 * 1024 * 1024) continue
    const picfStart = i + 4
    const mm = readUint16(dataStream, picfStart)
    if (mm < 1 || mm > 20) continue
    const type = mmToPictureType(mm)
    if (type === 'unknown') continue
    if (imgOffset < picfStart + PICF_HEADER_SIZE) continue
    return i
  }
  return -1
}

export function picturesToDataUrls(pictures: ParsedPicture[]): string[] {
  return pictures
    .filter(p => p.format !== 'unknown')
    .map(p => {
      let binary = ''
      const bytes = p.data
      const chunkSize = 0x8000
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
        binary += String.fromCharCode.apply(
          null,
          Array.from(slice) as unknown as number[],
        )
      }
      return `data:${imageFormatMime(p.format as ImageFormat)};base64,${btoa(binary)}`
    })
}
