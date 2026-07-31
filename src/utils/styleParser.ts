/**
 * MS-DOC stylesheet (STSH) parser.
 *
 * The stylesheet contains named styles (Normal, Heading 1, etc.) and their
 * default character / paragraph formatting. It is stored in the table stream
 * at the offset given by `fcStshf` in the FIB.
 *
 * Word 97+ STSH layout:
 *   Stshi header: cstd (2) + cbStd (2) + stshiExtraData
 *   Then cstd STD entries, each prefixed by its size (2 bytes).
 *
 * Each STD contains:
 *   istdNext (2) — base style index for inheritance
 *   bte (1) — style type
 *   flags (1)
 *   xstzName (variable) — style name
 *   rsid (8) — revision save ID
 *   tfct (1)
 *   xmm (variable) — mask data
 *   grpprlChpxInSTD: cbGrpprl (2) + grpprl bytes
 *   grpprlPapxInSTD: cbGrpprl (2) + grpprl bytes
 */

import type { CharacterFormat, ParagraphFormat } from './docFormat'
import { parseChpxGrpprlWithFont, parsePapxGrpprl } from './formatParser'

export interface StyleDefinition {
  istd: number
  name: string
  type: 'paragraph' | 'character' | 'table' | 'numbering' | 'unknown'
  /** Base style index for inheritance (istdNext). */
  istdNext?: number
  /** Default character format from style's grpprlChpxInSTD. */
  charFormat?: Partial<CharacterFormat>
  /** Default paragraph format from style's grpprlPapxInSTD. */
  paraFormat?: Partial<ParagraphFormat>
  /** Font index from style's CHPX grpprl. */
  fontIndex?: number
}

/** Known style set names. */
export type StyleSetName = 'Default' | 'Elegant' | 'Formal' | 'Modern' | 'Professional' | 'Simple' | 'Traditional' | 'Custom'

export interface StyleSetInfo {
  /** Style set name. */
  name: StyleSetName
  /** Whether this is a custom style set. */
  isCustom?: boolean
}

// Built-in style indices (istd) for common styles.
export const BUILTIN_STYLES: Record<number, { name: string; type: string }> = {
  0: { name: 'Normal', type: 'paragraph' },
  1: { name: 'Heading 1', type: 'paragraph' },
  2: { name: 'Heading 2', type: 'paragraph' },
  3: { name: 'Heading 3', type: 'paragraph' },
  4: { name: 'Heading 4', type: 'paragraph' },
  5: { name: 'Heading 5', type: 'paragraph' },
  6: { name: 'Heading 6', type: 'paragraph' },
  7: { name: 'Heading 7', type: 'paragraph' },
  8: { name: 'Heading 8', type: 'paragraph' },
  9: { name: 'Heading 9', type: 'paragraph' },
  10: { name: 'Index 1', type: 'paragraph' },
  11: { name: 'Index 2', type: 'paragraph' },
  12: { name: 'Index 3', type: 'paragraph' },
  13: { name: 'TOC 1', type: 'paragraph' },
  14: { name: 'TOC 2', type: 'paragraph' },
  15: { name: 'TOC 3', type: 'paragraph' },
  16: { name: 'TOC 4', type: 'paragraph' },
  17: { name: 'TOC 5', type: 'paragraph' },
  18: { name: 'TOC 6', type: 'paragraph' },
  19: { name: 'TOC 7', type: 'paragraph' },
  20: { name: 'TOC 8', type: 'paragraph' },
  21: { name: 'TOC 9', type: 'paragraph' },
  22: { name: 'Normal Indent', type: 'paragraph' },
  23: { name: 'Footnote Text', type: 'paragraph' },
  24: { name: 'Footnote Reference', type: 'character' },
  25: { name: 'Header', type: 'paragraph' },
  26: { name: 'Footer', type: 'paragraph' },
  27: { name: 'Index Heading', type: 'paragraph' },
  28: { name: 'Caption', type: 'paragraph' },
  29: { name: 'Table of Figures', type: 'paragraph' },
  30: { name: 'Endnote Reference', type: 'character' },
  31: { name: 'Endnote Text', type: 'paragraph' },
  32: { name: 'Table of Authorities', type: 'paragraph' },
  33: { name: 'Macro Text', type: 'paragraph' },
  34: { name: 'ATOth', type: 'paragraph' },
  35: { name: 'ATNRef', type: 'character' },
  37: { name: 'Hyperlink', type: 'character' },
  38: { name: 'Followed Hyperlink', type: 'character' },
  39: { name: 'Annotation Reference', type: 'character' },
  40: { name: 'Line Number', type: 'paragraph' },
  41: { name: 'Page Number', type: 'character' },
  42: { name: 'No List', type: 'paragraph' },
  43: { name: 'Note Heading', type: 'paragraph' },
  44: { name: 'Note Body', type: 'paragraph' },
  64: { name: 'Comment Reference', type: 'character' },
  65: { name: 'Comment Subject', type: 'paragraph' },
  66: { name: 'Comment Text', type: 'paragraph' },
  67: { name: 'Bookmark Reference', type: 'character' },
  105: { name: 'Strong', type: 'character' },
  106: { name: 'Emphasis', type: 'character' },
  107: { name: 'Default Paragraph Font', type: 'character' },
  126: { name: 'Subtitle', type: 'paragraph' },
  127: { name: 'Title', type: 'paragraph' },
}

function readUint16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.length) return 0
  return data[offset] | (data[offset + 1] << 8)
}

function readUtf16leString(data: Uint8Array, offset: number, byteLength: number): string {
  if (offset < 0 || offset + byteLength > data.length) return ''
  let result = ''
  for (let i = 0; i + 1 < byteLength; i += 2) {
    const code = data[offset + i] | (data[offset + i + 1] << 8)
    if (code === 0) break
    result += String.fromCharCode(code)
  }
  return result
}

/**
 * Parse a STSH (stylesheet) from the table stream.
 *
 * Word 97+ STSH layout:
 *   Stshi header: cstd (2) + cbStdInFile (2) + stshiExtraData
 *   Then cstd STD entries, each prefixed by cb (2 bytes).
 *
 * Each STD contains (in order):
 *   istdNext (2) — base style for inheritance
 *   bte (1) + flags (1) — style type + flags
 *   xstzName (variable) — style name: cch (2) + UTF-16LE chars
 *   rsid (8)
 *   tfct (1)
 *   xmm (variable)
 *   cupx (1) — count of UPX chunks
 *   chpxUPX: cbGrpprl (2) + grpprl bytes (character format)
 *   papxUPX: cbGrpprl (2) + grpprl bytes (paragraph format, starts with istd)
 *
 * @param data - The table stream data.
 * @param fc - Offset of the STSH in the table stream.
 * @param lcb - Length of the STSH.
 * @returns Array of style definitions, or empty array if malformed.
 */
export function parseStylesheet(data: Uint8Array, fc: number, lcb: number): StyleDefinition[] {
  if (lcb <= 0 || fc < 0 || fc + lcb > data.length) return []

  const styles: StyleDefinition[] = []

  try {
    let pos = fc

    // Read Stshi header
    if (pos + 4 > fc + lcb) return []
    const cstd = readUint16(data, pos)
    // cbStdInFile at offset 2 — size of each STD in file, not needed for parsing
    pos += 4

    if (cstd === 0 || cstd > 10000) return []

    // Skip stshiExtraData (cbStdInFile includes the 2-byte cb field itself,
    // but the extra data size = cbStdInFile - 2, per spec §2.8.3.1)
    // Actually cbStdInFile is the size of each STD in the file, not the header extra.
    // The stshiExtraData size is separate. Let's skip the header by reading
    // stshi.cb (which was cbStdInFile at offset 2) — no wait, that's wrong.
    //
    // Per MS-DOC §2.8.3.1: The STSHI starts with cstd (2) + cbStdInFile (2).
    // Then stshiExtraData follows. Its size is determined by the total STSHI size.
    // We don't know the exact STSHI size, so we need to scan the STD entries
    // directly after the header.
    //
    // In practice, the STD array starts right after the 4-byte header for most
    // Word 97+ files. Each STD is prefixed by its size (cb = 2 bytes).

    // Read STD entries
    for (let i = 0; i < cstd && pos + 2 <= fc + lcb; i++) {
      const cb = readUint16(data, pos) // Size of this STD entry
      if (cb === 0 || pos + 2 + cb > fc + lcb) {
        // Empty or overflow — create minimal entry
        const builtin = BUILTIN_STYLES[i]
        styles.push({
          istd: i,
          name: builtin?.name || `Style ${i}`,
          type: (builtin?.type || 'unknown') as StyleDefinition['type'],
        })
        pos += 2 // skip the cb field
        continue
      }

      const stdStart = pos + 2 // Skip cb field
      const stdEnd = stdStart + cb
      let stdPos = stdStart

      // Read istdNext (2 bytes)
      const istdNext = readUint16(data, stdPos)
      stdPos += 2

      // Read bte (1 byte) + flags (1 byte)
      const bte = data[stdPos] & 0xFF
      stdPos += 2 // bte + flags

      // Determine style type
      let styleType: StyleDefinition['type'] = 'unknown'
      if (bte === 1) styleType = 'paragraph'
      else if (bte === 2) styleType = 'character'
      else if (bte === 3) styleType = 'table'
      else if (bte === 4) styleType = 'numbering'

      // Read xstzName: cch (2 bytes) + UTF-16LE string
      let name = ''
      if (stdPos + 2 <= stdEnd) {
        const cch = readUint16(data, stdPos)
        stdPos += 2
        if (cch > 0 && cch < 256 && stdPos + cch * 2 <= stdEnd) {
          name = readUtf16leString(data, stdPos, cch * 2)
          stdPos += cch * 2
        }
      }

      // Skip rsid (8 bytes), tfct (1 byte)
      stdPos += 9
      // Skip xmm (variable) — we'll scan forward to find grpprl data
      // The xmm data contains an ABD (array of byte differences) and grpprl masks.
      // Instead of parsing xmm precisely, we'll search for the UPX chunks
      // at the end of the STD by looking for valid grpprl patterns.

      let charFormat: Partial<CharacterFormat> | undefined
      let paraFormat: Partial<ParagraphFormat> | undefined
      let fontIndex: number | undefined

      // Try to find grpprl data at the end of the STD.
      // The UPX chunks are at the end of the STD, after xmm.
      // For paragraph styles: PAPX UPX + CHPX UPX
      // For character styles: CHPX UPX only
      //
      // Strategy: scan backwards from stdEnd to find valid grpprl patterns.
      // Each UPX starts with cbGrpprl (2 bytes) followed by grpprl data.

      if (styleType === 'paragraph' && stdEnd - stdPos > 10) {
        // Try to find the two grpprl chunks from the end of STD.
        // The last UPX is CHPX: cbGrpprl (2) + grpprl (cbGrpprl-2 bytes)
        // Before that is PAPX: cbGrpprl (2) + istd (2) + grpprl (cbGrpprl-4 bytes)
        //
        // We scan from a reasonable offset near the end of STD.
        // Look for cupx byte first (at stdEnd - something).
        // Actually, cupx is before the UPX chunks. Let's try a different approach:
        // scan forward from stdPos (after xmm) looking for valid UPX structures.

        // Scan for cupx byte — it should be 1 or 2 for paragraph styles
        // After cupx, the UPX chunks follow immediately.
        for (let scanPos = stdPos; scanPos + 3 < stdEnd; scanPos++) {
          const cupx = data[scanPos]
          if (cupx < 1 || cupx > 2) continue

          // Try parsing UPX chunks starting after cupx
          let upxPos = scanPos + 1
          const upxEnd = stdEnd

          // PAPX UPX (first for paragraph style): cb (2) + istd (2) + grpprl
          if (upxPos + 2 <= upxEnd) {
            const papxCb = readUint16(data, upxPos)
            if (papxCb >= 4 && papxCb <= 1024 && upxPos + papxCb <= upxEnd) {
              // Parse PAPX grpprl (skip istd at offset 2)
              const papxGrpprlSize = papxCb - 4
              if (papxGrpprlSize > 0) {
                paraFormat = parsePapxGrpprl(data, upxPos + 4, papxGrpprlSize).format
              }
              upxPos += papxCb
            } else {
              continue // Not a valid UPX, try next scanPos
            }
          }

          // CHPX UPX (second for paragraph style): cb (2) + grpprl
          if (cupx >= 2 && upxPos + 2 <= upxEnd) {
            const chpxCb = readUint16(data, upxPos)
            if (chpxCb >= 2 && chpxCb <= 1024 && upxPos + chpxCb <= upxEnd) {
              const chpxGrpprlSize = chpxCb - 2
              if (chpxGrpprlSize > 0) {
                const result = parseChpxGrpprlWithFont(data, upxPos + 2, chpxGrpprlSize)
                charFormat = result.format
                fontIndex = result.fontIndex
              }
              upxPos += chpxCb
            }
          }

          // If we got any format data, break out of scan loop
          if (paraFormat !== undefined || charFormat !== undefined) break
        }
      } else if (styleType === 'character' && stdEnd - stdPos > 6) {
        // Character style: only CHPX UPX
        for (let scanPos = stdPos; scanPos + 3 < stdEnd; scanPos++) {
          const cupx = data[scanPos]
          if (cupx !== 1) continue

          let upxPos = scanPos + 1
          const upxEnd = stdEnd

          // CHPX UPX: cb (2) + grpprl
          if (upxPos + 2 <= upxEnd) {
            const chpxCb = readUint16(data, upxPos)
            if (chpxCb >= 2 && chpxCb <= 1024 && upxPos + chpxCb <= upxEnd) {
              const chpxGrpprlSize = chpxCb - 2
              if (chpxGrpprlSize > 0) {
                const result = parseChpxGrpprlWithFont(data, upxPos + 2, chpxGrpprlSize)
                charFormat = result.format
                fontIndex = result.fontIndex
              }
              break
            }
          }
        }
      }

      const builtin = BUILTIN_STYLES[i]
      const styleDef: StyleDefinition = {
        istd: i,
        name: name || builtin?.name || `Style ${i}`,
        type: styleType,
      }
      if (istdNext !== 0 && istdNext !== 0xFFFF && istdNext !== i) {
        styleDef.istdNext = istdNext
      }
      if (charFormat && Object.keys(charFormat).length > 0) {
        styleDef.charFormat = charFormat
      }
      if (paraFormat && Object.keys(paraFormat).length > 0) {
        styleDef.paraFormat = paraFormat
      }
      if (fontIndex !== undefined) {
        styleDef.fontIndex = fontIndex
      }
      styles.push(styleDef)

      pos = stdEnd
    }

    // If we have very few parsed styles, fall back to built-in styles
    if (styles.length < 10) {
      for (let i = 0; i < 50; i++) {
        const builtin = BUILTIN_STYLES[i]
        if (builtin && !styles.find(s => s.istd === i)) {
          styles.push({
            istd: i,
            name: builtin.name,
            type: builtin.type as StyleDefinition['type'],
          })
        }
      }
    }
  } catch {
    // On any parsing error, return what we have.
  }

  return styles
}

/**
 * Check if a style is a heading style (Heading 1-9).
 * Returns the heading level (1-9) or null if not a heading.
 */
const STYLE_SETS: Array<{ name: StyleSetName; patterns: string[] }> = [
  { name: 'Default', patterns: ['Normal', 'Heading 1', 'Heading 2', 'Heading 3'] },
  { name: 'Elegant', patterns: ['Elegant', 'Elegant Heading', 'Elegant Title'] },
  { name: 'Formal', patterns: ['Formal', 'Formal Heading', 'Formal Title'] },
  { name: 'Modern', patterns: ['Modern', 'Modern Heading', 'Modern Title'] },
  { name: 'Professional', patterns: ['Professional', 'Professional Heading'] },
  { name: 'Simple', patterns: ['Simple', 'Simple Heading'] },
  { name: 'Traditional', patterns: ['Traditional', 'Traditional Heading'] },
]

export function detectStyleSet(styles: StyleDefinition[]): StyleSetInfo | null {
  const styleNames = styles.map(s => s.name.toLowerCase())

  for (const styleSet of STYLE_SETS) {
    const matched = styleSet.patterns.filter(p => {
      const lowerP = p.toLowerCase()
      return styleNames.includes(lowerP) || styleNames.some(sn => sn.includes(lowerP))
    })
    if (matched.length >= 2) {
      return { name: styleSet.name }
    }
  }

  const hasHeadingStyles = styles.some(s => getHeadingLevel(s.name) !== null)
  if (hasHeadingStyles && styles.length >= 5) {
    return { name: 'Default', isCustom: false }
  }

  if (styles.length > 20) {
    return { name: 'Custom', isCustom: true }
  }

  return null
}

export function getHeadingLevel(styleName: string): number | null {
  const match = styleName.match(/^heading\s*(\d+)$/i)
  if (match) {
    const level = parseInt(match[1], 10)
    if (level >= 1 && level <= 9) return level
  }
  // Also check Chinese heading names
  const zhMatch = styleName.match(/^标题\s*(\d+)$/)
  if (zhMatch) {
    const level = parseInt(zhMatch[1], 10)
    if (level >= 1 && level <= 9) return level
  }
  return null
}

/**
 * Look up a style name by istd (style index).
 * Returns the style name or a default name if not found.
 */
export function getStyleName(styles: StyleDefinition[], istd: number): string {
  const style = styles.find(s => s.istd === istd)
  if (style) return style.name
  const builtin = BUILTIN_STYLES[istd]
  if (builtin) return builtin.name
  return `Style ${istd}`
}
