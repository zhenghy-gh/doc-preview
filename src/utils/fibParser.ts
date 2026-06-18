import { logger } from './logger'

export interface FibData {
  fcClx: number
  lcbClx: number
  fcMin: number
  fcMac: number
  fComplex: boolean
  fibBase: number
}

/**
 * Parse the File Information Block (FIB) from a WordDocument stream.
 *
 * The FIB structure follows the Word 97-2003 binary format:
 *   FibBase (32 bytes) → csw → FibRgW → cslw → FibRgLw → cbRgFcLcb → rgFcLcbBlob
 *
 * Key offsets:
 *   - byte 12 bit 0: fComplex (1=8-bit compressed, 0=UTF-16LE)
 *   - offset 32: csw (count of FibRgW words)
 *   - offset 34: FibRgW starts (csw+1 words)
 *   - after FibRgW: cslw (4 bytes)
 *   - after cslw: FibRgLw (cslw+1 dwords)
 *   - after FibRgLw: cbRgFcLcb (2 bytes)
 *   - after cbRgFcLcb: rgFcLcbBlob (pairs of fc/lcb)
 */
export function parseFib(data: Uint8Array): FibData | null {
  if (data.length < 32) {
    logger.warn('数据太短，无法解析FIB')
    return null
  }

  const magic = data[0] | (data[1] << 8)
  if (magic !== 0xa5ec && magic !== 0xa5eb) {
    logger.warn(`无效的FIB magic: 0x${magic.toString(16)}`)
    return null
  }

  logger.log(`FIB magic: 0x${magic.toString(16)}`)

  try {
    // nFib = word at offset 2
    // fComplex = byte 12, bit 0 (1=8-bit compressed, 0=UTF-16LE)
    const fComplex = data[12] & 0x01

    // csw at offset 32
    const csw = data[32] | (data[33] << 8)

    // FibRgW: after csw (offset 34), (csw + 1) words
    const fibRgWEnd = 34 + (csw + 1) * 2
    if (fibRgWEnd + 4 > data.length) {
      logger.warn('FIB FibRgW超出范围，仅使用fComplex标志')
      return { fcMin: 0, fcMac: 0, fcClx: 0, lcbClx: 0, fComplex: fComplex === 1, fibBase: 32 }
    }

    // cslw at fibRgWEnd (4 bytes)
    const cslw = readDwordAt(data, fibRgWEnd)

    // FibRgLw: after cslw, (cslw + 1) dwords
    const fibRgLwEnd = fibRgWEnd + 4 + (cslw + 1) * 4
    if (fibRgLwEnd + 2 > data.length) {
      logger.warn('FIB FibRgLw超出范围，仅使用fComplex标志')
      return { fcMin: 0, fcMac: 0, fcClx: 0, lcbClx: 0, fComplex: fComplex === 1, fibBase: 32 }
    }

    // cbRgFcLcb at fibRgLwEnd (2 bytes word)
    const cbRgFcLcb = data[fibRgLwEnd] | (data[fibRgLwEnd + 1] << 8)

    // rgFcLcbBlob starts after cbRgFcLcb
    const blobStart = fibRgLwEnd + 2
    const blobSize = cbRgFcLcb * 8

    if (blobStart + blobSize > data.length || cbRgFcLcb < 2) {
      logger.warn(`FIB blob太小(cbRgFcLcb=${cbRgFcLcb})，仅使用fComplex=${fComplex}`)
      return { fcMin: 0, fcMac: 0, fcClx: 0, lcbClx: 0, fComplex: fComplex === 1, fibBase: 32 }
    }

    // rgFcLcbBlob interleaved: [fcMin, lcbMin, fcMac, lcbMac, fcClx, lcbClx, ...]
    const fcMin = readDwordAt(data, blobStart) & 0x3FFFFFFF
    const fcMac = readDwordAt(data, blobStart + 8) & 0x3FFFFFFF

    let fcClx = 0
    let lcbClx = 0
    if (cbRgFcLcb >= 16) {
      fcClx = readDwordAt(data, blobStart + 14 * 4) & 0x3FFFFFFF
      lcbClx = readDwordAt(data, blobStart + 15 * 4)
    }

    logger.log(`nFib=${data[2] | (data[3] << 8)} fComplex=${fComplex} fcMin=0x${fcMin.toString(16)} fcMac=0x${fcMac.toString(16)}`)
    logger.log(`fcClx=0x${fcClx.toString(16)} lcbClx=${lcbClx}`)

    return { fcClx, lcbClx, fcMin, fcMac, fComplex: fComplex === 1, fibBase: 32 }
  } catch (error) {
    logger.error(`FIB解析错误: ${error}`)
    return null
  }
}

function readDwordAt(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) |
          (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}
