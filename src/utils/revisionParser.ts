/**
 * Revision marks (track changes) parser for Word 97-2003 binary .doc format.
 *
 * Revision metadata comes from two sources:
 * 1. SttbfRMark (revision author table) — STTB of author names, indexed by ibstRMark.
 *    Located via FIB fcSttbfRMark/lcbSttbfRMark in the table stream.
 * 2. RMRK structures carried by sprmCRMark (0x0830) / sprmCRMarkDel (0x0834) SPRMs
 *    in CHPX grpprl. Each RMRK = 2-byte author index + 4-byte DTTM timestamp.
 *
 * The revision *type* (insert / delete) is determined by companion toggle SPRMs:
 *   sprmCFRMark    (0x0809) = 1  → 修订插入 (fRMark)
 *   sprmCFRMarkDel (0x080A) = 1  → 修订删除 (fRMarkDel)
 *
 * Reference: MS-DOC §2.5.5 (FibRgFcLcb97 fcSttbfRMark), §2.3.1 (DTTM),
 * §2.9.300 (STTB), §2.4.6 (revision SPRMs).
 */

function readUint16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.length) return 0
  return data[offset] | (data[offset + 1] << 8)
}

function readUint32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) return 0
  return (data[offset] | (data[offset + 1] << 8) |
          (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}

function readUtf16leString(data: Uint8Array, offset: number, charCount: number): string {
  const chars: string[] = []
  for (let i = 0; i < charCount && offset + i * 2 + 1 < data.length; i++) {
    const charCode = data[offset + i * 2] | (data[offset + i * 2 + 1] << 8)
    if (charCode === 0) break
    chars.push(String.fromCharCode(charCode))
  }
  return chars.join('')
}

/**
 * Convert a DTTM (Date-Time-Time) 4-byte value to a Unix timestamp (milliseconds).
 *
 * DTTM layout (MS-DOC §2.3.1):
 *   bits 0-5:   minutes (0-59)
 *   bits 6-10:  hours (0-23)
 *   bits 11-15: day (1-31)
 *   bits 16-19: month (1-12)
 *   bits 20-30: year - 1900
 *   bit 31:     reserved
 *
 * Returns undefined when DTTM is 0 (no timestamp) or the decoded fields are invalid.
 */
export function dttmToTimestamp(dttm: number): number | undefined {
  if (dttm === 0) return undefined
  const minutes = dttm & 0x3F
  const hours = (dttm >> 6) & 0x1F
  const day = (dttm >> 11) & 0x1F
  const month = (dttm >> 16) & 0xF
  const year = ((dttm >> 20) & 0x7FF) + 1900
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  if (hours > 23 || minutes > 59) return undefined
  const date = new Date(year, month - 1, day, hours, minutes)
  const time = date.getTime()
  return Number.isNaN(time) ? undefined : time
}

/**
 * Parse the SttbfRMark (revision author table) — an STTB of author names.
 *
 * STTB layout (MS-DOC §2.9.300):
 *   fExtend (2 bytes): 0xFFFF = UTF-16LE strings; other = 8-bit ANSI
 *   cbSttb  (2 bytes): number of strings
 *   array of strings, each: cbString (2 bytes) + string data
 *     - UTF-16LE: cbString = char count, data = cbString * 2 bytes
 *     - ANSI:     cbString = char count, data = cbString bytes
 *
 * @param data - The table stream (0Table / 1Table) data.
 * @param fc - Offset of SttbfRMark in the table stream.
 * @param lcb - Length of SttbfRMark.
 * @returns Array of author names indexed by ibstRMark. Empty on error.
 */
export function parseSttbfRMark(data: Uint8Array, fc: number, lcb: number): string[] {
  if (lcb <= 0 || fc < 0 || fc + lcb > data.length) return []
  const end = fc + lcb
  let pos = fc

  if (pos + 4 > end) return []
  const fExtend = readUint16(data, pos)
  const isUnicode = fExtend === 0xFFFF
  pos += 2
  const cbSttb = readUint16(data, pos)
  pos += 2

  // Sanity check — a real author table won't have tens of thousands of entries.
  if (cbSttb > 10000) return []

  const authors: string[] = []
  for (let i = 0; i < cbSttb && pos < end; i++) {
    if (pos + 2 > end) break
    const cbString = readUint16(data, pos)
    pos += 2
    if (isUnicode) {
      if (pos + cbString * 2 > end) break
      authors.push(readUtf16leString(data, pos, cbString))
      pos += cbString * 2
    } else {
      if (pos + cbString > end) break
      const chars: string[] = []
      for (let j = 0; j < cbString && pos + j < end; j++) {
        chars.push(String.fromCharCode(data[pos + j]))
      }
      authors.push(chars.join(''))
      pos += cbString
    }
  }
  return authors
}

/**
 * Parse an RMRK structure (6 bytes) carried by sprmCRMark / sprmCRMarkDel.
 *
 * Layout:
 *   ibstRMark (2 bytes): author index into SttbfRMark
 *   DTTM      (4 bytes): revision timestamp
 *
 * @param data - The buffer containing the RMRK (typically the CHPX grpprl operand).
 * @param offset - Byte offset of the RMRK within data.
 * @returns { authorIndex, timestamp } or null if data is too short.
 */
export function parseRmrk(data: Uint8Array, offset: number): {
  authorIndex: number
  timestamp?: number
} | null {
  if (offset < 0 || offset + 6 > data.length) return null
  const authorIndex = readUint16(data, offset)
  const dttm = readUint32(data, offset + 2)
  const timestamp = dttmToTimestamp(dttm)
  return { authorIndex, timestamp }
}
