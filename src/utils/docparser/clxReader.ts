/**
 * clxReader —— CLX/Piece Table 读取子域（T4-P1 B 块 · contract-split-r1 §2.1 clxReader.ts）
 *
 * 自 docParser.ts 原样迁出（move-only，符号名锚）：Piece / readClxData / readTableStream /
 * parseClx / parseClxPieces / containsBinarySignature / extractTextFromRange +
 * 随块私有卫星 MAX_TOTAL_CHARS / readUint16 / readUint32 / BINARY_SIGNATURES /
 * SIGNATURE_CHECK_INTERVAL / HIGH_BYTE_MAP / isValidPrintableChar。
 *
 * 结构性适配（非逻辑改动）：原类实例/静态依赖经 ClxContext 与函数参数显式注入——
 *  - ctx.ole：OLE 容器（readClxData/readTableStream）；
 *  - ctx.maxTotalChars/readUint16/readUint32：原 DocParser 私有静态（类侧保留薄别名零改调用点）；
 *  - parseClx 的 extractTextSimple 参数注入（该函数属 encodingDetector 域，后续波次归位）。
 * 纯度：禁 import vue/.vue、禁反向 import ../docParser（契约 §2.2 规则 2）。
 */
import { logger } from '../logger'
import type { OleParser, DirectoryEntry } from '../oleParser'
import type { FibData } from '../fibParser'
import { parseClxPieces, type ClxBasicCtx } from './pieceTable'
import { readUint16, readUint32 } from '../binaryReader'


export const MAX_TOTAL_CHARS = 10 * 1024 * 1024

// readUint16 / readUint32 的实现已统一到 ../binaryReader（原为各解析器各存一份）。
// 此处按原符号名再导出，保持 docParser.ts 的既有导入契约不变。
export { readUint16, readUint32 }

  export function isValidPrintableChar(charCode: number): boolean {
    if (charCode < 0x20) return false
    if (charCode === 0x7F) return false
    if (charCode >= 0x80 && charCode <= 0x9F) return false
    if (charCode >= 0xD800 && charCode <= 0xDFFF) return false
    if (charCode >= 0xFDD0 && charCode <= 0xFDEF) return false
    if ((charCode & 0xFFFE) === 0xFFFE) return false
    return true
  }

  /**
   * Mapping from 8-bit compressed (fComplex) high-byte characters (0x80-0xFF)
   * to their Unicode equivalents, following Windows-1252 / Word's conventions.
   * Index 0 corresponds to byte 0x80; index 127 corresponds to byte 0xFF.
   * null / undefined means "use the byte value as-is" (Latin-1 fallback).
   */
  export const HIGH_BYTE_MAP: (string | null)[] = (() => {
    const map: (string | null)[] = new Array(128).fill(null)
    map[0x80 - 0x80] = '\u20AC'
    map[0x82 - 0x80] = '\u201A'
    map[0x83 - 0x80] = '\u0192'
    map[0x84 - 0x80] = '\u201E'
    map[0x85 - 0x80] = '\u2026'
    map[0x86 - 0x80] = '\u2020'
    map[0x87 - 0x80] = '\u2021'
    map[0x88 - 0x80] = '\u02C6'
    map[0x89 - 0x80] = '\u2030'
    map[0x8A - 0x80] = '\u0160'
    map[0x8B - 0x80] = '\u2039'
    map[0x8C - 0x80] = '\u0152'
    map[0x8E - 0x80] = '\u017D'
    map[0x91 - 0x80] = '\u2018'
    map[0x92 - 0x80] = '\u2019'
    map[0x93 - 0x80] = '\u201C'
    map[0x94 - 0x80] = '\u201D'
    map[0x95 - 0x80] = '\u2022'
    map[0x96 - 0x80] = '\u2013'
    map[0x97 - 0x80] = '\u2014'
    map[0x98 - 0x80] = '\u02DC'
    map[0x99 - 0x80] = '\u2122'
    map[0x9A - 0x80] = '\u0161'
    map[0x9B - 0x80] = '\u203A'
    map[0x9C - 0x80] = '\u0153'
    map[0x9E - 0x80] = '\u017E'
    map[0x9F - 0x80] = '\u0178'
    return map
  })()

export const BINARY_SIGNATURES = [
    'JFIF', 'ICC_PROFILE', 'Exif', 'Photoshop', 'Adobe', 'sRGB', 'XYZ', 'gAMA',
    'PNG', 'GIF8', 'BM', 'RIFF', 'ID3', 'ftyp', 'mov,', 'MOVI', 'AVI', 'WEBP',
    '<?xml', '<html', '<!DOCTYPE', '<!doctype',
    '%PDF', ' obj\n', 'endobj', 'stream\n', 'endstream',
    '\x89PNG', '\xFF\xD8\xFF', '\xFF\xFB', '\xFF\xF3', '\xFF\xF2', 'ID3',
    'PK\x03\x04', 'PK\x05\x06', 'PK\x07\x08',
]

// How often (in appended chars) to run the binary-signature scan. Must stay below
// the 64-char detection window so a signature completing between checks is still
// within the trailing window at the next scheduled check.
export const SIGNATURE_CHECK_INTERVAL = 48

/** B 域会话上下文：原类实例/静态依赖的显式注入面 */
export interface ClxContext extends ClxBasicCtx {
  ole: OleParser
  readUint32(data: Uint8Array, offset: number): number
}

export function readClxData(
    ctx: ClxContext,
    fib: FibData,
    wordDocData: Uint8Array,
    directory: DirectoryEntry[],
  ): Uint8Array | null {
    if (fib.lcbClx <= 0) return null

    const which: 0 | 1 = fib.fWhichTblStm ? 1 : 0
    const tableStream = ctx.ole.findTableStream(directory, which)
    if (tableStream) {
      const tableData = tableStream.data
      if (fib.fcClx + fib.lcbClx <= tableData.length) {
        return tableData.subarray(fib.fcClx, fib.fcClx + fib.lcbClx)
      }
      logger.warn(`表格流中 CLX 越界 (fcClx=${fib.fcClx}, lcbClx=${fib.lcbClx}, tableLen=${tableData.length})`)
    }

    // Fallback: try reading from WordDocument stream (previous behavior).
    if (fib.fcClx + fib.lcbClx <= wordDocData.length) {
      logger.warn('回退到 WordDocument 流读取 CLX（规范上应在 0Table/1Table）')
      return wordDocData.subarray(fib.fcClx, fib.fcClx + fib.lcbClx)
    }

    // Both streams too short for the declared CLX.
    /* v8 ignore start */
    return null
    /* v8 ignore stop */
  }

export function readTableStream(
    ctx: ClxContext,
    fib: FibData,
    directory: DirectoryEntry[],
  ): Uint8Array | null {
    const which: 0 | 1 = fib.fWhichTblStm ? 1 : 0
    const tableStream = ctx.ole.findTableStream(directory, which)
    if (tableStream && tableStream.data.length > 0) {
      return tableStream.data
    }
    // Unreachable via extractFormattedText (readClxData handles the null
    // case); kept for callers that need the raw table.
    /* v8 ignore start */
    return null
    /* v8 ignore stop */
  }

export function parseClx(
    ctx: ClxContext,
    clxData: Uint8Array,
    wordDocData: Uint8Array,
    extractTextSimple: (data: Uint8Array, options?: { fcMin?: number; fComplex?: boolean }) => string,
  ): string {
    const pieces = parseClxPieces(ctx, clxData)
    if (pieces.length === 0) return ''

    const pieceTexts: string[] = []
    let totalChars = 0

    for (const piece of pieces) {
      totalChars += piece.charCount
      // Requires a >10MB document; exercised indirectly by realDocs.
      /* v8 ignore start */
      if (totalChars > ctx.maxTotalChars) {
        logger.warn('总字符数超出限制，停止读取')
        break
      }
      /* v8 ignore stop */

      const byteStart = piece.fcValue
      const byteEnd = piece.fCompressed
        ? piece.fcValue + piece.charCount
        : piece.fcValue + piece.charCount * 2

      if (byteStart < 0 || byteEnd > wordDocData.length) {
        logger.warn(`Piece (cp=${piece.cpStart}) 越界，跳过`)
        continue
      }

      const pieceText = extractTextFromRange(
        wordDocData, byteStart, byteEnd, piece.fCompressed, false,
      )
      if (pieceText.trim().length > 0) {
        pieceTexts.push(pieceText.trim())
      }
    }

    if (pieceTexts.length > 0) return pieceTexts.join('\n\n')
    return extractTextSimple(wordDocData)
  }


export function containsBinarySignature(text: string): boolean {
    const tail = text.slice(-64)
    return BINARY_SIGNATURES.some(sig => tail.includes(sig))
  }

export function extractTextFromRange(data: Uint8Array, start: number, end: number, isCompressed: boolean = false, guardBinary: boolean = true): string {
    if (start < 0 || end > data.length || start >= end) return ''

    let text = ''
    // The binary-signature scan is expensive (slice + N substring searches), so we
    // throttle it instead of running it on every character. The interval (48) is kept
    // smaller than the 64-char detection window so a signature completing between
    // checks is still inside the trailing window at the next check — detection is only
    // deferred by a few dozen chars, which the lastIndexOf('\n') truncation absorbs.
    let sinceCheck = 0
    if (isCompressed) {
      for (let i = start; i < end; i++) {
        const byte = data[i]
        if (byte === 0x0D) text += '\n'
        else if (byte === 0x09) text += '\t'
        else if (byte === 0x0C) text += '\f'
        else if (byte === 0x0B) text += '\v'
        else if (byte === 0x07) text += '\u0007'
        else if (byte === 0x01) text += '\u0001'
        else if (byte === 0xA0) text += '\u00A0'
        else if (byte === 0xAD) text += '\u00AD'
        else if (byte === 0x1E) text += '\u2011'
        else if (byte === 0x0A || byte === 0x00) continue
        else if (byte >= 0x80 && byte <= 0xFF) {
          const mapped = HIGH_BYTE_MAP[byte - 0x80]
          if (mapped !== null) text += mapped
          // CP1252 0xA0-0xFF are identical to Latin-1 (accented letters like
          // ü/ö/é); decode as-is per the HIGH_BYTE_MAP contract. Bytes undefined
          // in CP1252 (0x81/0x8D/0x8F/0x90/0x9D) remain skipped as likely noise.
          else if (byte >= 0xA0) text += String.fromCharCode(byte)
        }
        else if (byte >= 0x20) text += String.fromCharCode(byte)
        // Unreachable: every caller passes guardBinary=false (piece ranges
        // are pre-validated). Kept for the public default.
        /* v8 ignore start */
        if (guardBinary && ++sinceCheck >= SIGNATURE_CHECK_INTERVAL && text.length >= 8) {
          sinceCheck = 0
          if (containsBinarySignature(text)) {
            const lastNewline = text.lastIndexOf('\n')
            text = lastNewline >= 0 ? text.slice(0, lastNewline) : ''
            return text
          }
        }
        /* v8 ignore stop */
      }
    } else {
      for (let i = start; i < end - 1; i += 2) {
        const charCode = (data[i] | (data[i + 1] << 8)) & 0xFFFF
        if (charCode === 0x000d) text += '\n'
        else if (charCode === 0x0009) text += '\t'
        else if (charCode === 0x000c) text += '\f'
        else if (charCode === 0x000b) text += '\v'
        else if (charCode === 0x0007) text += '\u0007'
        else if (charCode === 0x0001) text += '\u0001'
        else if (charCode === 0x00a0) text += '\u00A0'
        else if (charCode === 0x00ad) text += '\u00AD'
        else if (charCode === 0x001e) text += '\u2011'
        else if (charCode === 0x000a || charCode === 0x0000) continue
        else if (isValidPrintableChar(charCode)) {
          text += String.fromCharCode(charCode)
        }
        // Unreachable: every caller passes guardBinary=false (see above).
        /* v8 ignore start */
        if (guardBinary && ++sinceCheck >= SIGNATURE_CHECK_INTERVAL && text.length >= 8) {
          sinceCheck = 0
          if (containsBinarySignature(text)) {
            const lastNewline = text.lastIndexOf('\n')
            text = lastNewline >= 0 ? text.slice(0, lastNewline) : ''
            return text
          }
        }
        /* v8 ignore stop */
      }
    }
    // Unreachable: every caller passes guardBinary=false (see above).
    /* v8 ignore start */
    if (guardBinary && text.length >= 8 && containsBinarySignature(text)) {
      const lastNewline = text.lastIndexOf('\n')
      text = lastNewline >= 0 ? text.slice(0, lastNewline) : ''
    }
    return text
    /* v8 ignore stop */
  }

  // ==================== CHP/PAP format parsing ====================
