/**
 * Font table (STTB Ffn) parser for Word 97-2003 binary .doc format.
 *
 * The font table is stored in the table stream (0Table / 1Table) and contains
 * font names indexed by CHPX sprmCFFont. Each entry (FFN) stores the font
 * name in UTF-16LE format.
 *
 * Reference: MS-DOC §2.7.9 (FFN structure)
 */

function readUint16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.length) return 0
  return data[offset] | (data[offset + 1] << 8)
}

function readUtf16leString(data: Uint8Array, offset: number, maxLen: number): string {
  const chars: string[] = []
  for (let i = 0; i < maxLen && offset + i * 2 + 1 < data.length; i++) {
    const charCode = data[offset + i * 2] | (data[offset + i * 2 + 1] << 8)
    if (charCode === 0) break // null terminator
    chars.push(String.fromCharCode(charCode))
  }
  return chars.join('')
}

/**
 * Parse the font table (STTB Ffn) and return an array of font names.
 *
 * @param data - The table stream (0Table / 1Table) data.
 * @param fc - Offset of the font table in the table stream.
 * @param lcb - Length of the font table.
 * @returns Array of font names, indexed by font index.
 */
export function parseFontTable(data: Uint8Array, fc: number, lcb: number): string[] {
  if (lcb <= 0 || fc < 0 || fc + lcb > data.length) return []

  const fonts: string[] = []
  let pos = fc

  // Read cFfn (number of font entries)
  if (pos + 2 > fc + lcb) return []
  const cFfn = readUint16(data, pos)
  pos += 2

  if (cFfn > 1000) return [] // sanity check

  // Parse each FFN entry
  for (let i = 0; i < cFfn && pos < fc + lcb; i++) {
    const cbFfn = data[pos] // entry length (including cbFfn byte)
    if (cbFfn < 19 || pos + cbFfn > fc + lcb) {
      // Entry too short or out of bounds, skip with minimum guess
      pos += 1
      continue
    }

    // Font name starts at offset 18 within the FFN entry (after cbFfn)
    // FFN structure: cbFfn (1) + flags (3) + weight (2) + chs (1) + ixchSzAlt (1) + panose (10) + fs (2) + xszFfn
    // So xszFfn starts at: 1 + 3 + 2 + 1 + 1 + 10 + 2 = 18 from entry start, or 17 from pos+1
    const nameOffset = pos + 18
    const nameMaxLen = Math.floor((cbFfn - 19) / 2) // remaining bytes after fixed header, divided by 2 for UTF-16

    const fontName = readUtf16leString(data, nameOffset, nameMaxLen)
    fonts.push(fontName || `Font${i}`)

    pos += cbFfn
  }

  return fonts
}