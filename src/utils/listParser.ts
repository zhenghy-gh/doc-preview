/**
 * List Table (LST) and List Format Override (LFO) parser for
 * Word 97-2003 binary .doc format.
 *
 * The list table stores list definitions including numbering format,
 * start value, and indentation. Each LST entry contains up to 9 levels
 * (LVLF structures) with per-level numbering properties.
 *
 * Reference: MS-DOC §2.8.3 (LST), §2.8.5 (LVLF), §2.8.9 (LFO)
 */

/** Numbering format type (mappings from MS-DOC §2.8.5 lvlf.nfc) */
export type NumberingFormat =
  | 'decimal'           // 0
  | 'upper-roman'       // 1
  | 'lower-roman'       // 2
  | 'upper-alpha'       // 3
  | 'lower-alpha'       // 4
  | 'ordinal'           // 5
  | 'cardinal-text'     // 6
  | 'ordinal-text'      // 7
  | 'cjk-ideographic'   // 10
  | 'cjk-thousand'      // 11
  | 'cjk-legal'         // 12
  | 'cjk-period'        // 16
  | 'circlenumber'      // 18
  | 'disc'              // 23 (bullet)
  | 'circle'            // 24 (bullet)
  | 'square'            // 25 (bullet)
  | 'none'              // 255
  | string              // fallback

/** Per-level list format */
export interface ListLevel {
  /** Numbering format (nfc). */
  nfc: NumberingFormat
  /** Start-at value for this level. */
  startAt: number
  /** Number text template (may contain level placeholders like %1.%2). */
  numberText: string
  /** Is this a bullet level (vs numbered)? */
  isBullet: boolean
  /** Left indent in twips. */
  dxaIndent: number
  /** First line indent in twips. */
  dxaFirstLine: number
}

/** A single LST entry (list definition) */
export interface ListEntry {
  /** List ID (unique identifier). */
  lsid: number
  /** Template list ID (0 if this is not a template-based list). */
  tplc: number
  /** Simple list (1 level) vs multi-level (up to 9 levels). */
  fSimpleList: boolean
  /** Per-level format data. */
  levels: ListLevel[]
}

function readUint16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.length) return 0
  return data[offset] | (data[offset + 1] << 8)
}

function readUint32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) return 0
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}

function readInt16(data: Uint8Array, offset: number): number {
  const v = readUint16(data, offset)
  return v > 0x7FFF ? v - 0x10000 : v
}

/** Map MS-DOC nfc value to CSS list-style-type. */
function nfcToStyle(nfc: number): NumberingFormat {
  switch (nfc) {
    case 0: return 'decimal'
    case 1: return 'upper-roman'
    case 2: return 'lower-roman'
    case 3: return 'upper-alpha'
    case 4: return 'lower-alpha'
    case 5: return 'ordinal'
    case 6: return 'cardinal-text'
    case 7: return 'ordinal-text'
    case 10: return 'cjk-ideographic'
    case 11: return 'cjk-thousand'
    case 12: return 'cjk-legal'
    case 16: return 'cjk-period'
    case 18: return 'circlenumber'
    case 23: return 'disc'
    case 24: return 'circle'
    case 25: return 'square'
    case 255: return 'none'
    default: return `nfc-${nfc}`
  }
}

/**
 * Parse a single LVLF (List Level Format) structure.
 * MS-DOC §2.8.5: LVLF is a fixed 28-byte header followed by variable-length
 * number text in UTF-16LE.
 */
function parseLvlf(data: Uint8Array, offset: number, endBound: number): ListLevel {
  // LVLF structure:
  //   iStartAt (2 bytes) — start value
  //   nfc (1 byte) — numbering format
  //   ... (many flags we skip)
  //   dxaIndent, dxaFirstLine later in the structure
  //   grpprlChpx, grpprlPapx — character/paragraph SPRM groups (variable)
  //   chNumberText — the actual number text string (null-terminated UTF-16LE)

  const startAt = readUint16(data, offset)
  const nfc = data[offset + 2] & 0xFF
  const isBullet = nfc >= 23 && nfc <= 25

  // dxaIndent and dxaFirstLine are in the grpprlPapx at offset 20.
  // The structure layout is:
  //   offset 0: iStartAt (2)
  //   offset 2: nfc (1) + flags (1)
  //   offset 4: lxchFollow (1)
  //   offset 5: rgxchNum (32 bytes) - number text placeholders
  //   offset 37: cbGrpprlChpx (1)
  //   offset 38: cbGrpprlPapx (1)
  //   offset 39: reserved (1)
  //   offset 40: grpprlChpx (cbGrpprlChpx bytes)
  //   offset 40+cbGrpprlChpx: grpprlPapx (cbGrpprlPapx bytes)
  //   after that: number text (UTF-16LE null-terminated)

  let dxaIndent = 0
  let dxaFirstLine = 0

  if (offset + 40 < endBound) {
    const cbGrpprlChpx = data[offset + 37] & 0xFF
    const cbGrpprlPapx = data[offset + 38] & 0xFF

    // Parse PAPX grpprl for indent values
    const papxStart = offset + 40 + cbGrpprlChpx
    const papxEnd = papxStart + cbGrpprlPapx
    if (papxEnd <= endBound) {
      let ppos = papxStart
      while (ppos + 4 <= papxEnd) {
        const sprm = readUint16(data, ppos)
        // sprmPDxaLeft = 0x2402, sprmPDxaLeft1 (first line) = 0x2403
        // But in the LVLF context, SPRM codes may differ.
        // We'll look for indent SPRMs by their common codes.
        if (sprm === 0x2402 && ppos + 4 <= papxEnd) {
          dxaIndent = readInt16(data, ppos + 2)
          ppos += 4
        } else if (sprm === 0x2403 && ppos + 4 <= papxEnd) {
          dxaFirstLine = readInt16(data, ppos + 2)
          ppos += 4
        } else {
          ppos += 2 // skip the SPRM code; can't determine operand size easily
        }
      }
    }

    // Try to read number text after the grpprlPapx
    const numTextStart = papxEnd
    let numberText = ''
    if (numTextStart + 2 <= endBound) {
      const numTextLen = readUint16(data, numTextStart)
      // Read UTF-16LE characters
      for (let i = 0; i < numTextLen && numTextStart + 2 + i * 2 + 1 < endBound; i++) {
        const ch = readUint16(data, numTextStart + 2 + i * 2)
        if (ch === 0) break
        numberText += String.fromCharCode(ch)
      }
    }

    return {
      nfc: nfcToStyle(nfc),
      startAt,
      numberText,
      isBullet,
      dxaIndent,
      dxaFirstLine,
    }
  }

  // Minimal fallback
  return {
    nfc: nfcToStyle(nfc),
    startAt,
    numberText: '',
    isBullet,
    dxaIndent: 0,
    dxaFirstLine: 0,
  }
}

/**
 * Parse the List Table (LST) from the table stream.
 *
 * @param data - The table stream data.
 * @param fc - Offset of the LST in the table stream.
 * @param lcb - Length of the LST.
 * @returns Array of list definitions.
 */
export function parseListTable(data: Uint8Array, fc: number, lcb: number): ListEntry[] {
  if (lcb <= 0 || fc < 0 || fc + lcb > data.length) return []

  const entries: ListEntry[] = []
  let pos = fc
  const endBound = fc + lcb

  // Simple heuristic: try to read LST entries until we run out of data.
  // Each LST entry starts with: lsid (4 bytes) + tplc (4 bytes) + flags (2 bytes) + reserved...
  // followed by 9 LVLF structures (or 1 for simple lists).
  // The exact size depends on grpprl lengths, so we need to parse sequentially.

  // Actually, the LST structure is:
  //   rgistd (2*9 = 18 bytes) — style indices for each level
  //   ... no wait, the LST entry is:
  //   lsid (4) + tplc (4) + rgistd (18) + fSimpleList (1) + reserved (1)
  //   then: 1 or 9 LVLF structures

  while (pos + 28 < endBound && entries.length < 1000) {
    const lsid = readUint32(data, pos)
    const tplc = readUint32(data, pos + 4)
    // Skip rgistd (9 * 2 = 18 bytes)
    const fSimpleList = data[pos + 26] !== 0

    const levelCount = fSimpleList ? 1 : 9
    let levelPos = pos + 28
    const levels: ListLevel[] = []

    for (let i = 0; i < levelCount; i++) {
      if (levelPos + 40 >= endBound) break

      const cbGrpprlChpx = data[levelPos + 37] & 0xFF
      const cbGrpprlPapx = data[levelPos + 38] & 0xFF

      // Size of LVLF header up to grpprlChpx: 40 bytes
      // Then: cbGrpprlChpx + cbGrpprlPapx bytes of SPRM data
      // Then: number text (2 byte length + UTF-16LE string)

      const numTextStart = levelPos + 40 + cbGrpprlChpx + cbGrpprlPapx
      let numTextByteLen = 0
      if (numTextStart + 2 <= endBound) {
        const numTextCharLen = readUint16(data, numTextStart)
        numTextByteLen = 2 + numTextCharLen * 2
      }

      const lvlfSize = 40 + cbGrpprlChpx + cbGrpprlPapx + numTextByteLen
      const level = parseLvlf(data, levelPos, Math.min(levelPos + lvlfSize, endBound))
      levels.push(level)

      levelPos += lvlfSize

      // Alignment: if lvlfSize is odd, skip a padding byte
      if (lvlfSize % 2 !== 0) levelPos++
    }

    entries.push({ lsid, tplc, fSimpleList, levels })

    // Move to next LST entry
    pos = levelPos
  }

  return entries
}

/**
 * Given a list index (ilst), look up the list entry and return
 * list formatting info (listType, listStyle) for the given level.
 *
 * @param lists - Parsed list table entries.
 * @param ilst - List index (0-based).
 * @param level - List level (0-based).
 * @returns List formatting info, or null if not found.
 */
export function getListFormat(
  lists: ListEntry[],
  ilst: number,
  level: number = 0,
): { listType: 'ordered' | 'unordered'; listStyle: string; listLevel: number } | null {
  if (ilst < 0 || ilst >= lists.length) return null

  const entry = lists[ilst]
  if (level < 0 || level >= entry.levels.length) level = 0
  const lv = entry.levels[level]
  if (!lv) return null

  const isBullet = lv.isBullet || lv.nfc === 'none' || lv.nfc === 'disc' || lv.nfc === 'circle' || lv.nfc === 'square'

  return {
    listType: isBullet ? 'unordered' : 'ordered',
    listStyle: lv.nfc,
    listLevel: level,
  }
}

/** A single LFO (List Format Override) entry */
export interface LfoEntry {
  /** List ID — links to LST entry with matching lsid. */
  lsid: number
  /** Number of level overrides. */
  clfoLvl: number
}

/**
 * Parse PlcfLfo (List Format Override table) from the table stream.
 *
 * PlcfLfo layout (MS-DOC §2.8.9):
 *   aCP: (n+1) DWORDs — character positions
 *   aLFO: n LFO entries, each 8 bytes:
 *     lsid (4) + clfoLvl (1) + unused (3)
 *
 * @param data - The table stream data.
 * @param fc - Offset of the PlcfLfo in the table stream.
 * @param lcb - Length of the PlcfLfo.
 * @returns Array of LFO entries.
 */
export function parsePlcfLfo(data: Uint8Array, fc: number, lcb: number): LfoEntry[] {
  if (lcb <= 0 || fc < 0 || fc + lcb > data.length) return []

  // Each LFO is 8 bytes. PLC: (n+1)*4 + n*8 = 4n + 4 + 8n = 12n + 4
  // So n = (lcb - 4) / 12
  const n = Math.floor((lcb - 4) / 12)
  if (n <= 0 || n > 10000) return []

  const entries: LfoEntry[] = []
  const lfoStart = fc + (n + 1) * 4

  for (let i = 0; i < n; i++) {
    const offset = lfoStart + i * 8
    if (offset + 8 > fc + lcb) break
    const lsid = readUint32(data, offset)
    const clfoLvl = data[offset + 4] & 0xFF
    entries.push({ lsid, clfoLvl })
  }

  return entries
}

/**
 * Find the LST entry matching an ilfo (List Format Override index).
 *
 * The ilfo is 1-based. We look up the LFO entry, get its lsid,
 * then find the matching LST entry.
 *
 * @param listEntries - Parsed LST entries.
 * @param lfoEntries - Parsed LFO entries from PlcfLfo.
 * @param ilfo - 1-based LFO index.
 * @param level - List level (0-based).
 * @returns List formatting info, or null if not found.
 */
export function getListFormatFromLfo(
  listEntries: ListEntry[],
  lfoEntries: LfoEntry[],
  ilfo: number,
  level: number = 0,
): { listType: 'ordered' | 'unordered'; listStyle: string; listLevel: number } | null {
  // ilfo is 1-based
  const lfoIndex = ilfo - 1
  if (lfoIndex < 0 || lfoIndex >= lfoEntries.length) return null

  const lfo = lfoEntries[lfoIndex]
  // Find LST entry with matching lsid
  const lstIdx = listEntries.findIndex(e => e.lsid === lfo.lsid)
  if (lstIdx < 0) return null

  return getListFormat(listEntries, lstIdx, level)
}
