/**
 * Field (PlcfFld) parser for Word 97-2003 binary .doc format.
 *
 * Fields are stored in PlcfFld PLC structures, with each field marked by
 * special characters 0x13 (begin), 0x14 (separator), 0x15 (end) in the text.
 *
 * HYPERLINK fields have the format:
 *   0x13 HYPERLINK "url" 0x14 display_text 0x15
 *
 * Reference: MS-DOC §2.8.19 (PlcfFld), §2.8.20 (FLD)
 */

export interface FieldRange {
  /** Start CP of field (including 0x13). */
  cpStart: number
  /** End CP of field (including 0x15). */
  cpEnd: number
  /** Field type (flt). 37 = HYPERLINK, 19 = TOC. */
  flt: number
  /** Field instruction text (between 0x13 and 0x14). */
  instruction: string
  /** Field result text (between 0x14 and 0x15). */
  result: string
  /** For HYPERLINK: the extracted URL. */
  url?: string
  /** For TOC: parsed TOC entries. */
  tocEntries?: TocEntry[]
}

/**
 * TOC entry structure extracted from the TOC field result.
 */
export interface TocEntry {
  /** Level of the TOC entry (1 = heading 1, 2 = heading 2, etc.). */
  level: number
  /** Text of the TOC entry. */
  text: string
  /** Page number (if available). */
  pageNumber?: string
  /** Character position where this entry starts in the document. */
  cp?: number
}

function readUint32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) return 0
  return (data[offset] | (data[offset + 1] << 8) |
          (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}

/**
 * Parse PlcfFld (field position table) from the table stream.
 *
 * PlcfFld layout (MS-DOC §2.8.19):
 *   aCP: (n+1) DWORDs — character positions
 *   aFld: n FLD entries, each 2 bytes:
 *     ch (1) — field character type (0x13/0x14/0x15/0x19)
 *     flt (1) — field type (37 = HYPERLINK)
 *
 * Note: Each field has 3 FLD entries (begin/sep/end), so the CP count
 * is actually 3*n+1 (but Word stores n+1 CPs where n is field count).
 *
 * @param data - The table stream data.
 * @param fc - Offset of the PlcfFld in the table stream.
 * @param lcb - Length of the PlcfFld.
 * @returns Array of field entries with CP ranges.
 */
export function parsePlcfFld(data: Uint8Array, fc: number, lcb: number): Array<{ cp: number; ch: number; flt: number }> {
  if (lcb <= 0 || fc < 0 || fc + lcb > data.length) return []

  // Each FLD entry is 2 bytes. PLC: (n+1)*4 + n*2
  // So: lcb = 4n + 4 + 2n = 6n + 4 → n = (lcb - 4) / 6
  const n = Math.floor((lcb - 4) / 6)
  if (n <= 0 || n > 10000) return []

  const entries: Array<{ cp: number; ch: number; flt: number }> = []
  const fldStart = fc + (n + 1) * 4

  for (let i = 0; i < n; i++) {
    const cp = readUint32(data, fc + i * 4)
    const ch = data[fldStart + i * 2] & 0xFF
    const flt = data[fldStart + i * 2 + 1] & 0xFF
    entries.push({ cp, ch, flt })
  }

  return entries
}

/**
 * Extract HYPERLINK fields from the parsed field table and document text.
 *
 * @param fldEntries - Parsed field entries from parsePlcfFld.
 * @param text - The document text (UTF-16LE decoded).
 * @param textBytes - The raw document text bytes for URL extraction.
 * @returns Array of hyperlink field ranges.
 */
export function extractHyperlinks(
  fldEntries: Array<{ cp: number; ch: number; flt: number }>,
  text: string,
  textBytes?: Uint8Array,
): FieldRange[] {
  const allFields = extractAllFields(fldEntries, text, textBytes)
  return allFields.filter(f => f.flt === 37 && (f.url || f.instruction.includes('HYPERLINK')))
}

/**
 * Extract all fields from the parsed field table and document text.
 * This includes HYPERLINK and TOC fields.
 *
 * @param fldEntries - Parsed field entries from parsePlcfFld.
 * @param text - The document text (UTF-16LE decoded).
 * @param textBytes - The raw document text bytes for URL extraction.
 * @returns Array of field ranges including hyperlinks and TOC.
 */
export function extractAllFields(
  fldEntries: Array<{ cp: number; ch: number; flt: number }>,
  text: string,
  textBytes?: Uint8Array,
): FieldRange[] {
  const fields: FieldRange[] = []

  let i = 0
  while (i + 2 < fldEntries.length) {
    const begin = fldEntries[i]
    const sep = fldEntries[i + 1]
    const end = fldEntries[i + 2]

    if (begin.ch !== 0x13 || sep.ch !== 0x14 || end.ch !== 0x15) {
      i++
      continue
    }

    const instrStart = begin.cp + 1
    const instrEnd = sep.cp
    const resultStart = sep.cp + 1
    const resultEnd = end.cp

    let instruction = ''
    if (textBytes && instrEnd > instrStart) {
      const byteStart = instrStart * 2
      const byteEnd = instrEnd * 2
      if (byteStart < textBytes.length && byteEnd <= textBytes.length) {
        instruction = decodeUtf16le(textBytes, byteStart, byteEnd - byteStart)
      }
    }

    let result = ''
    if (resultEnd > resultStart) {
      result = text.slice(resultStart, resultEnd)
    }

    const field: FieldRange = {
      cpStart: begin.cp,
      cpEnd: end.cp + 1,
      flt: begin.flt,
      instruction,
      result,
    }

    if (begin.flt === 37) {
      const match = instruction.match(/HYPERLINK\s+"([^"]+)"/i)
      if (match) {
        field.url = match[1]
      }
    } else if (begin.flt === 19) {
      field.tocEntries = parseTocResult(result)
    }

    fields.push(field)
    i += 3
  }

  return fields
}

/**
 * Parse TOC field result into structured entries.
 *
 * TOC result format:
 *   Heading 1.................1
 *   Heading 2.................2
 *   Subheading................3
 *
 * Each line contains: heading text + dot leader + page number.
 *
 * @param result - The TOC field result text.
 * @returns Parsed TOC entries.
 */
export function parseTocResult(result: string): TocEntry[] {
  const entries: TocEntry[] = []
  const lines = result.split('\n').filter(line => line.trim())

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const entry = parseTocLine(trimmed)
    if (entry) {
      entries.push(entry)
    }
  }

  return entries
}

/**
 * Parse a single TOC line into an entry.
 *
 * Line format patterns:
 * 1. "Heading Text.................123" - dot leader + page number
 * 2. "Heading Text	123" - tab + page number
 * 3. "Heading Text  123" - spaces + page number
 *
 * @param line - A single TOC line.
 * @returns TocEntry or null if parsing fails.
 */
function parseTocLine(line: string): TocEntry | null {
  // Match dot leader pattern: text + dots + page number
  const dotPattern = /^(.*?)\.{3,}\s*(\d+)$/
  const dotMatch = line.match(dotPattern)
  if (dotMatch) {
    return {
      level: inferTocLevel(dotMatch[1].trim()),
      text: dotMatch[1].trim(),
      pageNumber: dotMatch[2],
    }
  }

  // Match tab-separated pattern
  const tabPattern = /^(.*?)\t+(\d+)$/
  const tabMatch = line.match(tabPattern)
  if (tabMatch) {
    return {
      level: inferTocLevel(tabMatch[1].trim()),
      text: tabMatch[1].trim(),
      pageNumber: tabMatch[2],
    }
  }

  // Match space-separated pattern
  const spacePattern = /^(.*?)\s{2,}(\d+)$/
  const spaceMatch = line.match(spacePattern)
  if (spaceMatch) {
    return {
      level: inferTocLevel(spaceMatch[1].trim()),
      text: spaceMatch[1].trim(),
      pageNumber: spaceMatch[2],
    }
  }

  // Just text without page number (might be a heading without page)
  if (line.length > 0) {
    return {
      level: inferTocLevel(line),
      text: line,
    }
  }

  return null
}

/**
 * Infer TOC level from heading text.
 *
 * Word TOC levels are typically determined by the heading style (Heading 1=1, Heading 2=2, etc.)
 * but in the field result, we can only infer from text patterns.
 *
 * @param text - The TOC entry text.
 * @returns Inferred level (1-9, default 1).
 */
function inferTocLevel(text: string): number {
  // Match "Heading N" or "标题N" pattern
  const headingPattern = /^(heading|标题)\s*(\d+)/i
  const match = text.match(headingPattern)
  if (match) {
    const level = parseInt(match[2], 10)
    return Math.max(1, Math.min(9, level))
  }

  // Default to level 1
  return 1
}

function decodeUtf16le(data: Uint8Array, offset: number, byteLength: number): string {
  let result = ''
  const end = Math.min(offset + byteLength, data.length)
  for (let i = offset; i + 1 < end; i += 2) {
    const code = data[i] | (data[i + 1] << 8)
    if (code === 0) break
    result += String.fromCharCode(code)
  }
  return result
}