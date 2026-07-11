import { logger } from './logger'

/** Character counts for each story in the document (FibRgLw rgCcp). */
export interface RgCcp {
  /** Main document body. */
  ccpText: number
  /** Footnotes. */
  ccpFtn: number
  /** Headers and footers. */
  ccpHdd: number
  /** Macro subdocument. */
  ccpMcr: number
  /** Comments (annotations). */
  ccpAtn: number
  /** Endnotes. */
  ccpEdn: number
  /** Text boxes. */
  ccpTxbx: number
  /** Header text boxes. */
  ccpHdrTxbx: number
}

export interface FibData {
  fcClx: number
  lcbClx: number
  fcMin: number
  fcMac: number
  fComplex: boolean
  fibBase: number
  /** True → use 1Table stream; False → use 0Table stream. */
  fWhichTblStm: boolean
  /** Per-story character counts from FibRgLw (rgCcp). */
  rgCcp: RgCcp
  /** Offset of PlcfBteChpx in table stream (character properties). */
  fcPlcfBteChpx: number
  /** Length of PlcfBteChpx. */
  lcbPlcfBteChpx: number
  /** Offset of PlcfBtePapx in table stream (paragraph properties). */
  fcPlcfBtePapx: number
  /** Length of PlcfBtePapx. */
  lcbPlcfBtePapx: number
  /** Offset of stylesheet (STTBF) in table stream. */
  fcStshf: number
  /** Length of stylesheet. */
  lcbStshf: number
  /** Offset of font table (STTB Ffn) in table stream. */
  fcSttbfFfn: number
  /** Length of font table. */
  lcbSttbfFfn: number
  /** Offset of List Table (LST) in table stream. */
  fcLst: number
  /** Length of List Table. */
  lcbLst: number
  /** Offset of PlcfLfo in table stream. */
  fcPlcfLfo: number
  /** Length of PlcfLfo. */
  lcbPlcfLfo: number
  /** Offset of PlcfFldMom (field positions in main text) in table stream. */
  fcPlcfFldMom: number
  /** Length of PlcfFldMom. */
  lcbPlcfFldMom: number
  /** Offset of DOP (Document Properties) in table stream. */
  fcDop: number
  /** Length of DOP. */
  lcbDop: number
}

/** Empty rgCcp used for early-return fallbacks. */
const EMPTY_RGCCP: RgCcp = {
  ccpText: 0,
  ccpFtn: 0,
  ccpHdd: 0,
  ccpMcr: 0,
  ccpAtn: 0,
  ccpEdn: 0,
  ccpTxbx: 0,
  ccpHdrTxbx: 0,
}

/**
 * Parse the File Information Block (FIB) from a WordDocument stream.
 *
 * The FIB structure follows the Word 97-2003 binary format:
 *   FibBase (32 bytes) → csw → FibRgW → cslw → FibRgLw → cbRgFcLcb → rgFcLcbBlob
 *
 * Key offsets:
 *   - byte 10 (fFlags word): bit 2 = fComplex (1=8-bit compressed, 0=UTF-16LE)
 *   - byte 11 (fFlags high byte): bit 1 (= word bit 9) = fWhichTblStm
 *   - offset 32: csw (count of FibRgW words)
 *   - offset 34: FibRgW starts (csw+1 words)
 *   - after FibRgW: cslw (4 bytes)
 *   - after cslw: FibRgLw (cslw+1 dwords) — contains cbMac + rgCcp
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
    // fFlags is a 16-bit field at offset 10.
    //   bit 2 (mask 0x0004): fComplex (1=8-bit compressed, 0=UTF-16LE)
    //   bit 9 (mask 0x0200): fWhichTblStm (1=1Table, 0=0Table)
    const fFlags = data[10] | (data[11] << 8)
    const fComplex = (fFlags & 0x0004) !== 0
    const fWhichTblStm = (fFlags & 0x0200) !== 0

    // csw at offset 32
    const csw = data[32] | (data[33] << 8)

    // FibRgW: after csw (offset 34), (csw + 1) words
    const fibRgWEnd = 34 + (csw + 1) * 2
    if (fibRgWEnd + 4 > data.length) {
      logger.warn('FIB FibRgW超出范围，仅使用fFlags标志')
      return {
        fcMin: 0, fcMac: 0, fcClx: 0, lcbClx: 0,
        fComplex, fWhichTblStm, fibBase: 32, rgCcp: { ...EMPTY_RGCCP },
        fcPlcfBteChpx: 0, lcbPlcfBteChpx: 0,
        fcPlcfBtePapx: 0, lcbPlcfBtePapx: 0,
        fcStshf: 0, lcbStshf: 0,
        fcSttbfFfn: 0, lcbSttbfFfn: 0,
        fcLst: 0, lcbLst: 0,
        fcPlcfLfo: 0, lcbPlcfLfo: 0,
        fcPlcfFldMom: 0, lcbPlcfFldMom: 0,
        fcDop: 0, lcbDop: 0,
      }
    }

    // cslw at fibRgWEnd (4 bytes: 2-byte count + 2-byte reserved)
    const cslw = readDwordAt(data, fibRgWEnd)

    // FibRgLw: after cslw, (cslw + 1) dwords
    const fibRgLwEnd = fibRgWEnd + 4 + (cslw + 1) * 4
    if (fibRgLwEnd + 2 > data.length) {
      logger.warn('FIB FibRgLw超出范围，仅使用fFlags标志')
      return {
        fcMin: 0, fcMac: 0, fcClx: 0, lcbClx: 0,
        fComplex, fWhichTblStm, fibBase: 32, rgCcp: { ...EMPTY_RGCCP },
        fcPlcfBteChpx: 0, lcbPlcfBteChpx: 0,
        fcPlcfBtePapx: 0, lcbPlcfBtePapx: 0,
        fcStshf: 0, lcbStshf: 0,
        fcSttbfFfn: 0, lcbSttbfFfn: 0,
        fcLst: 0, lcbLst: 0,
        fcPlcfLfo: 0, lcbPlcfLfo: 0,
        fcPlcfFldMom: 0, lcbPlcfFldMom: 0,
        fcDop: 0, lcbDop: 0,
      }
    }

    // Parse FibRgLw97's rgCcp values. Layout (relative to fibRgWEnd + 4):
    //   +0  cbMac
    //   +4  reserved1
    //   +8  reserved2
    //   +12 ccpText
    //   +16 ccpFtn
    //   +20 ccpHdd
    //   +24 ccpMcr
    //   +28 ccpAtn
    //   +32 ccpEdn
    //   +36 ccpTxbx
    //   +40 ccpHdrTxbx
    const rgCcpStart = fibRgWEnd + 4
    const rgCcp: RgCcp = {
      ccpText: readDwordAt(data, rgCcpStart + 12),
      ccpFtn: readDwordAt(data, rgCcpStart + 16),
      ccpHdd: readDwordAt(data, rgCcpStart + 20),
      ccpMcr: readDwordAt(data, rgCcpStart + 24),
      ccpAtn: readDwordAt(data, rgCcpStart + 28),
      ccpEdn: readDwordAt(data, rgCcpStart + 32),
      ccpTxbx: readDwordAt(data, rgCcpStart + 36),
      ccpHdrTxbx: readDwordAt(data, rgCcpStart + 40),
    }

    // cbRgFcLcb at fibRgLwEnd (2 bytes word)
    const cbRgFcLcb = data[fibRgLwEnd] | (data[fibRgLwEnd + 1] << 8)

    // rgFcLcbBlob starts after cbRgFcLcb
    const blobStart = fibRgLwEnd + 2
    const blobSize = cbRgFcLcb * 8

    if (blobStart + blobSize > data.length || cbRgFcLcb < 2) {
      logger.warn(`FIB blob太小(cbRgFcLcb=${cbRgFcLcb})，仅使用fFlags=${fComplex}`)
      return {
        fcMin: 0, fcMac: 0, fcClx: 0, lcbClx: 0,
        fComplex, fWhichTblStm, fibBase: 32, rgCcp,
        fcPlcfBteChpx: 0, lcbPlcfBteChpx: 0,
        fcPlcfBtePapx: 0, lcbPlcfBtePapx: 0,
        fcStshf: 0, lcbStshf: 0,
        fcSttbfFfn: 0, lcbSttbfFfn: 0,
        fcLst: 0, lcbLst: 0,
        fcPlcfLfo: 0, lcbPlcfLfo: 0,
        fcPlcfFldMom: 0, lcbPlcfFldMom: 0,
        fcDop: 0, lcbDop: 0,
      }
    }

    // rgFcLcbBlob interleaved: [fcMin, lcbMin, fcMac, lcbMac, ..., fcClx, lcbClx, ...]
    const fcMin = readDwordAt(data, blobStart) & 0x3FFFFFFF
    const fcMac = readDwordAt(data, blobStart + 8) & 0x3FFFFFFF

    let fcClx = 0
    let lcbClx = 0
    if (cbRgFcLcb >= 16) {
      fcClx = readDwordAt(data, blobStart + 14 * 4) & 0x3FFFFFFF
      lcbClx = readDwordAt(data, blobStart + 15 * 4)
    }

    let fcPlcfBteChpx = 0
    let lcbPlcfBteChpx = 0
    let fcPlcfBtePapx = 0
    let lcbPlcfBtePapx = 0
    let fcStshf = 0
    let lcbStshf = 0
    let fcSttbfFfn = 0
    let lcbSttbfFfn = 0
    let fcLst = 0
    let lcbLst = 0
    let fcPlcfLfo = 0
    let lcbPlcfLfo = 0
    let fcPlcfFldMom = 0
    let lcbPlcfFldMom = 0
    let fcDop = 0
    let lcbDop = 0
    if (cbRgFcLcb >= 16) {
      fcPlcfBteChpx = readDwordAt(data, blobStart + 28 * 4) & 0x3FFFFFFF
      lcbPlcfBteChpx = readDwordAt(data, blobStart + 29 * 4)
      fcPlcfBtePapx = readDwordAt(data, blobStart + 30 * 4) & 0x3FFFFFFF
      lcbPlcfBtePapx = readDwordAt(data, blobStart + 31 * 4)
      // fcPlcfFldMom/lcbPlcfFldMom: field positions in main text (index 10/11)
      if (cbRgFcLcb >= 12) {
        fcPlcfFldMom = readDwordAt(data, blobStart + 10 * 4) & 0x3FFFFFFF
        lcbPlcfFldMom = readDwordAt(data, blobStart + 11 * 4)
      }
      // fcStshf/lcbStshf: stylesheet location in table stream (index 16/17)
      if (cbRgFcLcb >= 18) {
        fcStshf = readDwordAt(data, blobStart + 16 * 4) & 0x3FFFFFFF
        lcbStshf = readDwordAt(data, blobStart + 17 * 4)
      }
      // fcSttbfFfn/lcbSttbfFfn: font table location in table stream (index 22/23)
      if (cbRgFcLcb >= 24) {
        fcSttbfFfn = readDwordAt(data, blobStart + 22 * 4) & 0x3FFFFFFF
        lcbSttbfFfn = readDwordAt(data, blobStart + 23 * 4)
      }
      // fcLst/lcbLst: list table location in table stream (index 62/63)
      if (cbRgFcLcb >= 64) {
        fcLst = readDwordAt(data, blobStart + 62 * 4) & 0x3FFFFFFF
        lcbLst = readDwordAt(data, blobStart + 63 * 4)
      }
      // fcPlcfLfo/lcbPlcfLfo: list format override table (index 66/67)
      if (cbRgFcLcb >= 68) {
        fcPlcfLfo = readDwordAt(data, blobStart + 66 * 4) & 0x3FFFFFFF
        lcbPlcfLfo = readDwordAt(data, blobStart + 67 * 4)
      }
      // fcDop/lcbDop: Document Properties (DOP) in table stream.
      // Per MS-DOC §2.5.6 FibRgFcLcb97, fcDop/lcbDop sit at 4-byte index 62/63
      // (byte offset 248/252). When cbRgFcLcb >= 64 we can safely read this pair.
      if (cbRgFcLcb >= 64) {
        fcDop = readDwordAt(data, blobStart + 62 * 4) & 0x3FFFFFFF
        lcbDop = readDwordAt(data, blobStart + 63 * 4)
      }
    }

    logger.log(
      `nFib=${data[2] | (data[3] << 8)} fComplex=${fComplex} fWhichTblStm=${fWhichTblStm} ` +
      `fcMin=0x${fcMin.toString(16)} fcMac=0x${fcMac.toString(16)}`
    )
    logger.log(
      `fcClx=0x${fcClx.toString(16)} lcbClx=${lcbClx} ` +
      `ccpText=${rgCcp.ccpText} ccpFtn=${rgCcp.ccpFtn} ccpHdd=${rgCcp.ccpHdd} ` +
      `ccpAtn=${rgCcp.ccpAtn} ccpEdn=${rgCcp.ccpEdn}`
    )
    logger.log(
      `fcPlcfBteChpx=0x${fcPlcfBteChpx.toString(16)} lcbPlcfBteChpx=${lcbPlcfBteChpx} ` +
      `fcPlcfBtePapx=0x${fcPlcfBtePapx.toString(16)} lcbPlcfBtePapx=${lcbPlcfBtePapx} ` +
      `fcStshf=0x${fcStshf.toString(16)} lcbStshf=${lcbStshf} ` +
      `fcSttbfFfn=0x${fcSttbfFfn.toString(16)} lcbSttbfFfn=${lcbSttbfFfn} ` +
      `fcLst=0x${fcLst.toString(16)} lcbLst=${lcbLst} ` +
      `fcPlcfLfo=0x${fcPlcfLfo.toString(16)} lcbPlcfLfo=${lcbPlcfLfo} ` +
      `fcPlcfFldMom=0x${fcPlcfFldMom.toString(16)} lcbPlcfFldMom=${lcbPlcfFldMom} ` +
      `fcDop=0x${fcDop.toString(16)} lcbDop=${lcbDop}`
    )

    return {
      fcClx, lcbClx, fcMin, fcMac, fComplex, fWhichTblStm, fibBase: 32, rgCcp,
      fcPlcfBteChpx, lcbPlcfBteChpx, fcPlcfBtePapx, lcbPlcfBtePapx,
      fcStshf, lcbStshf, fcSttbfFfn, lcbSttbfFfn,
      fcLst, lcbLst, fcPlcfLfo, lcbPlcfLfo,
      fcPlcfFldMom, lcbPlcfFldMom,
      fcDop, lcbDop,
    }
  } catch (error) {
    logger.error(`FIB解析错误: ${error}`)
    return null
  }
}

function readDwordAt(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) |
          (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}
