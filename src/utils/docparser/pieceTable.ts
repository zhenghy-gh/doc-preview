/**
 * pieceTable —— Piece Table 解析子域（T4-P1 A 块 · contract-split-r1 §2.1 pieceTable.ts）
 *
 * 自 clxReader.ts 正式归位（move-only，符号名锚）：Piece / parseClxPieces。
 * ClxBasicCtx 为本域最小上下文面（clxReader.ClxContext 结构化扩展自它）。
 * 纯度：禁 import vue/.vue、禁反向 import ../docParser（契约 §2.2 规则 2）。
 */
import { logger } from '../logger'

/** 本域最小上下文面（clxReader.ClxContext 的结构化基集） */
export interface ClxBasicCtx {
  maxTotalChars: number
  readUint16(data: Uint8Array, offset: number): number
  readUint32(data: Uint8Array, offset: number): number
}

export interface Piece {
  /** Global character position where this piece starts. */
  cpStart: number
  /** Global character position where this piece ends (exclusive). */
  cpEnd: number
  /** Raw file offset in the WordDocument stream (fc & 0x3FFFFFFF). */
  fcValue: number
  /** True = 8-bit compressed; False = UTF-16LE. */
  fCompressed: boolean
  /** True = this piece has an associated CHPX (accessed via chpxIndex). */
  fChp: boolean
  /** Index into the PlcfBteChpx when fChp is true (else undefined). */
  chpxIndex?: number
  /** Character count (cpEnd - cpStart). */
  charCount: number
}

export function parseClxPieces(ctx: ClxBasicCtx, clxData: Uint8Array): Piece[] {
    if (clxData.length < 5) return []

    // Walk the CLX (MS-DOC §2.9.38: Clx = RgPrc *Pcdt). Zero or more Prc
    // entries — each clxtPrc(1 byte)=0x01, cbGrpprl(2 bytes), grpprl(cbGrpprl
    // bytes) — may precede the single Pcdt. Skip any Prc prefix.
    let offset = 0
    while (offset < clxData.length && clxData[offset] === 0x01) {
      if (offset + 3 > clxData.length) return []
      const cbGrpprl = ctx.readUint16(clxData, offset + 1)
      const nextOffset = offset + 3 + cbGrpprl
      if (nextOffset > clxData.length) {
        logger.warn(`CLX RgPrc 越界: offset=${offset}, cbGrpprl=${cbGrpprl}`)
        return []
      }
      offset = nextOffset
    }

    // Pcdt (§2.9.72): clxt(1 byte)=0x02, lcb(4 bytes)=PlcPcd byte size, PlcPcd.
    if (offset + 5 > clxData.length || clxData[offset] !== 2) return []
    const lcb = ctx.readUint32(clxData, offset + 1)
    const plcPcdStart = offset + 5
    if (lcb < 4 || plcPcdStart + lcb > clxData.length) return []

    // PlcPcd (§2.8.35) = aCP[(n+1)] (4 bytes each) + aPcd[n] (8 bytes each).
    // Byte size = 4*(n+1) + 8*n = 12n + 4  →  n = (lcb - 4) / 12.
    if ((lcb - 4) % 12 !== 0) {
      logger.warn(`PlcPcd lcb=${lcb} 不是有效长度`)
      return []
    }
    const n = Math.floor((lcb - 4) / 12)
    // `lcb` already bounds n to the bytes physically present in the CLX. Use
    // the document-wide character ceiling as the allocation guard instead of
    // a fixed 1000-piece cap: heavily edited documents can legitimately have
    // thousands of short pieces.
    /* v8 ignore start */
    if (n <= 0 || n > ctx.maxTotalChars) {
      logger.warn(`PlcPcd n=${n} 超出范围`)
      return []
    }
    /* v8 ignore stop */

    const ccpCount = n + 1
    const ccpByteSize = ccpCount * 4

    const plcCp: number[] = []
    for (let i = 0; i < ccpCount; i++) {
      const cp = ctx.readUint32(clxData, plcPcdStart + i * 4)
      if (i === 0 && cp !== 0) {
        logger.warn(`PlcPcd 首个 CP 必须为 0，实际为 ${cp}`)
        return []
      }
      /* v8 ignore start */
      if (cp > ctx.maxTotalChars) {
        logger.warn(`CP 值过大: ${cp}`)
        return []
      }
      /* v8 ignore stop */
      plcCp.push(cp)
    }

    const rgPcdStart = plcPcdStart + ccpByteSize
    const pieces: Piece[] = []

    for (let i = 0; i < n; i++) {
      const pcdOffset = rgPcdStart + i * 8
      // PCD (8 bytes, MS-DOC §2.9.72):
      //   Pn/flags (2 bytes)
      //   Fc (FcCompressed, 4 bytes): bit 0-29 = fc; bit 30 = fCompressed
      //   Prm (2 bytes): CHPX index when fChp is set
      const fcAndFlags = ctx.readUint32(clxData, pcdOffset + 2)
      const fCompressed = (fcAndFlags & 0x40000000) !== 0
      const fChp = (fcAndFlags & 0x80000000) !== 0
      const rawFc = fcAndFlags & 0x3FFFFFFF
      if (fCompressed && (rawFc & 1) !== 0) {
        logger.warn(`压缩 Piece 的 FC 未按 2 字节对齐: ${rawFc}`)
        return []
      }
      // FcCompressed (§2.9.73): uncompressed text is UTF-16LE at byte offset
      // `fc`; compressed text is 8-bit (Windows-1252) at byte offset `fc / 2`.
      const fcValue = fCompressed ? Math.floor(rawFc / 2) : rawFc
      const chpxIndex = fChp ? ctx.readUint16(clxData, pcdOffset + 6) : undefined

      const cpStart = plcCp[i]
      const cpEnd = plcCp[i + 1]
      const charCount = cpEnd - cpStart
      /* v8 ignore start */
      if (charCount < 0) {
        logger.warn(`CP 边界倒退: ${cpStart} > ${cpEnd}`)
        return []
      }
      /* v8 ignore stop */
      if (charCount === 0) continue

      const piece: Piece = { cpStart, cpEnd, fcValue, fCompressed, fChp, charCount }
      if (chpxIndex !== undefined) piece.chpxIndex = chpxIndex
      pieces.push(piece)
    }

    return pieces
  }
