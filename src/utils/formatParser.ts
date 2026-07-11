/**
 * MS-DOC binary format parser for character (CHPX) and paragraph (PAPX)
 * properties.
 *
 * Word 97-2003 stores formatting as "property exceptions": each CHPX/PAPX
 * contains a list of SPRMs (Single Property Modifiers) that override the
 * base style. The CHPX/PAPX data is located in the table stream (0Table /
 * 1Table) and indexed via `fcPlcfBteChpx` / `fcPlcfBtePapx` in the FIB.
 *
 * This module focuses on the most commonly used properties — font, size,
 * bold, italic, underline, color, alignment, indent, spacing — because
 * these are what the DocPreview UI renders. Less common SPRMs are skipped.
 */

import type { CharacterFormat, ParagraphFormat, TableInfo, TableCellInfo, TableBorders, TableBorderStyle, TableJustification, RevisionType } from './docFormat'
import { parseRmrk } from './revisionParser'

// ---- SPRM operation codes ----

const SPRM_CF_BOLD = 0x0801
const SPRM_CF_ITALIC = 0x0802
const SPRM_CF_STRIKE = 0x0803
const SPRM_CF_OUTLINE = 0x0804   // Character border
const SPRM_CF_SHADOW = 0x0805    // Character shadow
const SPRM_CF_SMALL_CAPS = 0x0806  // Small caps
const SPRM_CF_CAPS = 0x0807        // All caps
const SPRM_CF_VANISH = 0x0808      // Hidden text (vanish)
const SPRM_CF_STRIKE_BIDI = 0x080B // Double strikethrough
const SPRM_CF_KUL = 0x0814
const SPRM_CF_UNDERLINE = 0x0815
const SPRM_HPS = 0x0816
const SPRM_DXAS_POS = 0x0817
const SPRM_CV = 0x081B
const SPRM_CH_HIGHLIGHT = 0x081C
const SPRM_KERN = 0x081E          // Kern (字间距调整，半磅)
const SPRM_DXA_SPACE = 0x081F     // DxaSpace (字符间距，缇)
// ---- Revision mark SPRMs (track changes) ----
const SPRM_CF_RMARK = 0x0809         // Toggle (1 byte): fRMark — 修订插入标记
const SPRM_CF_RMARK_DEL = 0x080A     // Toggle (1 byte): fRMarkDel — 修订删除标记
const SPRM_C_RMARK = 0x0830          // 6-byte RMRK: ibstRMark(2) + DTTM(4) — 插入修订元数据
const SPRM_C_RMARK_DEL = 0x0834      // 6-byte RMRK: ibstRMark(2) + DTTM(4) — 删除修订元数据
const SPRM_CF_FONT = 0x4A30  // Font index (reference to font table)
// ---- Picture / shape SPRMs ----
const SPRM_CF_SPEC = 0x083A     // Toggle (1 byte): fSpec — special character (picture anchor, etc.)
const SPRM_C_PIC_LOCATION = 0x6805 // 4-byte fcPic: offset into Data stream of PICF structure

const SPRM_P_JC = 0x2401
const SPRM_P_DXA_LEFT = 0x2402    // Left indent (twips, signed)
const SPRM_P_DXA_RIGHT = 0x2403   // Right indent (twips, signed)
const SPRM_P_DXA_INDENT = 0x2404  // First line indent (twips, signed)
const SPRM_P_DYA_BEFORE = 0x2406
const SPRM_P_DYA_AFTER = 0x2407
const SPRM_P_LINE = 0x2409
const SPRM_P_BRC_TOP = 0x2410     // Paragraph top border (Brc structure)
const SPRM_P_BRC_LEFT = 0x2411    // Paragraph left border (Brc structure)
const SPRM_P_BRC_BOTTOM = 0x2412  // Paragraph bottom border (Brc structure)
const SPRM_P_BRC_RIGHT = 0x2413   // Paragraph right border (Brc structure)
const SPRM_P_SHD = 0x2414         // Paragraph shading (variable length)
const SPRM_P_DXA_TAB = 0x2417     // Tab stop position (variable length)
const SPRM_P_CHG_TABS = 0x2418    // Change tab stops (variable length)
const SPRM_P_OUTLINE_LVL = 0x2420 // Outline level (1 byte)
const SPRM_P_ILVL = 0x460D  // List level (0-based index into LST levels array)
const SPRM_P_ILST = 0x460E  // List index (reference to LST table)
const SPRM_P_ILFO = 0x460F  // List Format Override index

// Table SPRMs (TAP — Table Properties)
// Per MS-DOC §2.6.8 / §2.4.4: these attach to the paragraph that begins a table row.
const SPRM_P_F_IN_TABLE = 0x240C    // Toggle (1 byte): paragraph is inside a table
// sprmPTableDepth: spec lists as 1-byte operand. Two codes are seen in the wild:
//   0x2410 — spec-compliant (spra=1, 1-byte unsigned)
//   0x4410 — legacy/POI encoding (spra=2, but operand is actually 1 byte)
// We accept both and force 1-byte operand for 0x4410 in getSprmOperandSize.
const SPRM_P_TABLE_DEPTH_SPEC = 0x2410
const SPRM_P_TABLE_DEPTH_LEGACY = 0x4410
const SPRM_T_DEF_TABLE = 0xD608     // Variable length: rgdxaCenter[] + rgtc[]
const SPRM_T_TABLE_BORDERS = 0xD612 // Variable length: 6 Brc (4 bytes each)
const SPRM_T_JTABLE = 0xD632       // 1 byte: table justification (0=left, 1=center, 2=right)
const SPRM_T_DXA_TABLE_INDENT = 0xD609 // 2 bytes: table indent from left margin (twips)

/**
 * Shd color index to CSS color mapping.
 * Word uses a 16-color palette (indices 1-16).
 */
const SHD_COLOR_MAP: Record<number, string> = {
  1: '#000000',  // Black
  2: '#0000FF',  // Blue
  3: '#00FFFF',  // Cyan
  4: '#00FF00',  // Green
  5: '#FF00FF',  // Magenta
  6: '#FF0000',  // Red
  7: '#FFFF00',  // Yellow
  8: '#FFFFFF',  // White
  9: '#000080',  // Dark Blue
  10: '#008080', // Dark Cyan
  11: '#008000', // Dark Green
  12: '#800080', // Dark Magenta
  13: '#800000', // Dark Red
  14: '#808000', // Dark Yellow (Olive)
  15: '#808080', // Dark Gray
  16: '#C0C0C0', // Light Gray
}

// ---- Helpers ----

function readUint16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.length) return 0
  return data[offset] | (data[offset + 1] << 8)
}

function readInt16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.length) return 0
  const val = data[offset] | (data[offset + 1] << 8)
  return val > 0x7FFF ? val - 0x10000 : val
}

function readUint32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) return 0
  return (data[offset] | (data[offset + 1] << 8) |
          (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}

// ---- SPRM operand size calculator ----

/**
 * Returns the size (in bytes) of the operand that follows a 2-byte SPRM.
 * The SPRM bit layout:
 *   bits 0-8: ispmd
 *   bit    9: fSpec
 *   bits 10-12: sgc (property group)
 *   bits 13-15: spra (operand size type)
 *
 * Special cases: sprmPDxaTab (0x2417) and sprmPChgTabs (0x2418) are documented
 * as spra=6 (variable length), but their actual encoding yields spra=2 via bit fields.
 * We override these to use variable-length format.
 */
function getSprmOperandSize(sprm: number, data: Uint8Array, operandOffset: number): number {
  // Special handling for tab-related SPRMs
  if (sprm === SPRM_P_DXA_TAB || sprm === SPRM_P_CHG_TABS) {
    // Variable length: first byte is the length of the rest
    if (operandOffset >= data.length) return 0
    return 1 + data[operandOffset]
  }

  // Special handling for legacy sprmPTableDepth (0x4410):
  // spra bits encode 2 (2-byte), but the actual operand is 1 byte.
  // We force 1-byte here so the parser doesn't over-read and misalign
  // subsequent SPRMs in the grpprl.
  if (sprm === SPRM_P_TABLE_DEPTH_LEGACY) {
    return 1
  }

  // sprmCRMark (0x0830) / sprmCRMarkDel (0x0834) carry a 6-byte RMRK structure
  // (ibstRMark + DTTM), but their spra bits encode 0 (Toggle, 1 byte).
  if (sprm === SPRM_C_RMARK || sprm === SPRM_C_RMARK_DEL) {
    return 6
  }

  // sprmTJTable (0xD632) and sprmTDxaTableIndent (0xD609) have spra=6
  // (variable length), but the payload is a fixed 1-byte / 2-byte value
  // preceded by a cb byte. Standard variable-length handling (1 + cb)
  // works correctly because cb already encodes the payload size.
  // No special case needed — fall through to the spra=6 branch below.

  const spra = (sprm >> 13) & 0x7
  switch (spra) {
    case 0: return 1  // ToggleOperand
    case 1: return 1  // 1-byte unsigned
    case 2: return 2  // 2-byte unsigned
    case 3: return 4  // 4-byte unsigned
    case 4: return 2  // 2-byte signed
    case 5: return 2  // 2-byte unsigned
    case 7: return 3  // 3-byte
    case 6: {
      // Variable length: first byte is the length of the rest.
      if (operandOffset >= data.length) return 0
      return 1 + data[operandOffset]
    }
    default: return 0
  }
}

// ---- CHPX parsing ----

export interface ChpxRun {
  cpStart: number
  cpEnd: number
  format: Partial<CharacterFormat>
  /** Font index (reference to font table), if sprmCFFont was present. */
  fontIndex?: number
  /**
   * 修订标记（来自 sprmCFRMark / sprmCFRMarkDel / sprmCRMark / sprmCRMarkDel）。
   * 无修订时为 undefined。type 为 'insert'/'delete'/'format'，
   * authorIndex/timestamp 来自 RMRK 结构（可能缺失）。
   */
  revision?: {
    type: RevisionType
    authorIndex?: number
    timestamp?: number
  }
  /** 特殊字符标志（fSpec），表示该 run 的字符是特殊字符（图片锚点等）。 */
  isSpecial?: boolean
  /** 图片在 Data 流中的 PICF 偏移（fcPic），由 sprmCPicLocation 提供。 */
  fcPic?: number
}

/**
 * Parse a PlcfBteChpx structure and return an array of character format
 * runs. Each run covers [cpStart, cpEnd) with its applied format.
 *
 * @param data - The table stream (0Table / 1Table) data.
 * @param fc - Offset of the PlcfBteChpx in the table stream.
 * @param lcb - Length of the PlcfBteChpx.
 * @returns Array of character runs, or empty array if the structure is malformed.
 */
export function parseChpxRuns(data: Uint8Array, fc: number, lcb: number): ChpxRun[] {
  if (lcb <= 0 || fc < 0 || fc + lcb > data.length) return []

  // PlcfBteChpx layout (MS-DOC §2.4.2):
  //   aCP: (n+1) DWORDs — character positions, strictly increasing
  //   aPcb: n variable-length CHPX entries, each starting with cbOffset (2 bytes)
  //
  // Since aPcb is variable-length, we can't compute n from lcb alone.
  // Strategy: scan CPs forward until they stop being strictly increasing,
  // then verify by walking the aPcb chain to confirm it ends at fc+lcb.

  // Step 1: Find n by scanning aCP for the longest valid strictly-increasing run.
  // Minimum PLC size: 1 CP (4 bytes) + at least 2 bytes for aPcb = 6 bytes → n >= 1
  const maxPossibleN = Math.min(20000, Math.floor((lcb - 4) / 6))
  let n = 0
  const firstCP = readUint32(data, fc)
  if (firstCP > 0x00FFFFFF) return [] // sanity check

  // Scan CPs forward; stop when CP stops increasing or we exceed data bounds.
  let candidateN = 0
  for (let i = 1; i <= maxPossibleN; i++) {
    const cpOffset = fc + i * 4
    if (cpOffset + 4 > fc + lcb) break // not enough room for aCP[i+1]
    const cp = readUint32(data, cpOffset)
    const prevCP = readUint32(data, cpOffset - 4)
    if (cp <= prevCP || cp > 0x0FFFFFFF) break
    candidateN = i
  }

  if (candidateN === 0) return []

  // Step 2: Verify by walking the aPcb chain.
  // Try candidateN, and if verification fails, try smaller values.
  for (let tryN = candidateN; tryN >= 1; tryN--) {
    const aCPEnd = fc + (tryN + 1) * 4
    if (aCPEnd > fc + lcb) continue

    // Walk the aPcb chain
    let pcbOffset = aCPEnd
    let valid = true
    let count = 0
    while (pcbOffset < fc + lcb && count < tryN) {
      if (pcbOffset + 2 > fc + lcb) { valid = false; break }
      const cbOff = readUint16(data, pcbOffset)
      if (cbOff < 2 || cbOff > 8192) { valid = false; break }
      pcbOffset += cbOff
      count++
    }
    if (valid && count === tryN && Math.abs(pcbOffset - (fc + lcb)) <= 4) {
      n = tryN
      break
    }
  }

  if (n === 0) return []

  const runs: ChpxRun[] = []
  const aCPEnd = fc + (n + 1) * 4
  let pcbOffset = aCPEnd

  for (let i = 0; i < n; i++) {
    const cpStart = readUint32(data, fc + i * 4)
    const cpEnd = readUint32(data, fc + (i + 1) * 4)
    if (cpEnd <= cpStart) {
      pcbOffset += readUint16(data, pcbOffset) || 2
      continue
    }

    const cbOffset = readUint16(data, pcbOffset)
    const { format, fontIndex, revision, isSpecial, fcPic } = parseChpxGrpprlWithFont(data, pcbOffset + 2, cbOffset - 2)
    const run: ChpxRun = { cpStart, cpEnd, format, fontIndex, revision }
    if (isSpecial) run.isSpecial = true
    if (fcPic !== undefined) run.fcPic = fcPic
    runs.push(run)
    pcbOffset += cbOffset || 2
  }

  return runs
}

/**
 * Parse a grpprl (array of Prl) from a CHPX and return format + font index.
 * Only properties relevant to DocPreview rendering are extracted.
 */
function parseChpxGrpprlWithFont(data: Uint8Array, offset: number, size: number): { format: Partial<CharacterFormat>; fontIndex?: number; revision?: { type: RevisionType; authorIndex?: number; timestamp?: number }; isSpecial?: boolean; fcPic?: number } {
  const fmt: Partial<CharacterFormat> = {}
  let fontIndex: number | undefined = undefined
  let revision: { type: RevisionType; authorIndex?: number; timestamp?: number } | undefined = undefined
  let isSpecial = false
  let fcPic: number | undefined = undefined
  let pos = 0

  while (pos + 2 <= size) {
    const sprm = readUint16(data, offset + pos)
    const operandOffset = offset + pos + 2
    const operandSize = getSprmOperandSize(sprm, data, operandOffset)
    // Guard against malformed SPRMs.
    if (operandSize <= 0 || pos + 2 + operandSize > size) break

    switch (sprm) {
      case SPRM_CF_BOLD:
        fmt.bold = data[operandOffset] === 1
        break
      case SPRM_CF_ITALIC:
        fmt.italic = data[operandOffset] === 1
        break
      case SPRM_CF_STRIKE:
        fmt.strikethrough = data[operandOffset] === 1
        break
      case SPRM_CF_OUTLINE:
        fmt.outline = data[operandOffset] === 1
        break
      case SPRM_CF_SHADOW:
        fmt.shadow = data[operandOffset] === 1
        break
      case SPRM_CF_SMALL_CAPS:
        fmt.smallCaps = data[operandOffset] === 1
        break
      case SPRM_CF_CAPS:
        fmt.allCaps = data[operandOffset] === 1
        break
      case SPRM_CF_VANISH:
        fmt.hidden = data[operandOffset] === 1
        break
      case SPRM_CF_STRIKE_BIDI:
        // Double strikethrough — also set strikethrough flag
        if (data[operandOffset] === 1) {
          fmt.strikethrough = true
        }
        break
      case SPRM_CF_UNDERLINE:
      case SPRM_CF_KUL:
        fmt.underline = data[operandOffset] !== 0
        break
      case SPRM_HPS: {
        const hps = readUint16(data, operandOffset)
        if (hps > 0) fmt.fontSize = hps / 2  // half-points → points
        break
      }
      case SPRM_DXAS_POS: {
        const dxasPos = readInt16(data, operandOffset)
        if (dxasPos > 0) fmt.superscript = true
        else if (dxasPos < 0) fmt.subscript = true
        break
      }
      case SPRM_CV: {
        const cv = readUint32(data, operandOffset)
        if ((cv & 0x80000000) === 0) {
          const b = cv & 0xFF
          const g = (cv >> 8) & 0xFF
          const r = (cv >> 16) & 0xFF
          fmt.color = `rgb(${r}, ${g}, ${b})`
        }
        break
      }
      case SPRM_CH_HIGHLIGHT: {
        const hl = data[operandOffset]
        if (hl !== 0) {
          fmt.highlight = highlightColor(hl)
        }
        break
      }
      case SPRM_KERN: {
        // sprmKern: 字间距调整（半磅） → 实际磅数 = kern / 2
        const kern = readUint16(data, operandOffset)
        if (kern > 0) {
          fmt.letterSpacing = kern / 2
        }
        break
      }
      case SPRM_DXA_SPACE: {
        // sprmDxaSpace: 字符间距（缇） → 实际磅数 = dxaSpace / 20
        const dxaSpace = readInt16(data, operandOffset)
        if (dxaSpace !== 0) {
          fmt.letterSpacing = twipsToPt(dxaSpace)
        }
        break
      }
      case SPRM_CF_FONT: {
        // sprmCFFont: 2-byte font index (reference to STTB Ffn)
        fontIndex = readUint16(data, operandOffset)
        break
      }
      case SPRM_CF_RMARK: {
        // sprmCFRMark (0x0809) — Toggle: 标记字符为"修订插入"
        if (data[operandOffset] === 1) {
          if (!revision) revision = { type: 'insert' }
          else if (revision.type === 'format') revision.type = 'insert'
        }
        break
      }
      case SPRM_CF_RMARK_DEL: {
        // sprmCFRMarkDel (0x080A) — Toggle: 标记字符为"修订删除"
        if (data[operandOffset] === 1) {
          if (!revision) revision = { type: 'delete' }
          else revision.type = 'delete'
        }
        break
      }
      case SPRM_C_RMARK: {
        // sprmCRMark (0x0830) — 6-byte RMRK: 插入修订的作者索引 + 时间戳
        const rmrk = parseRmrk(data, operandOffset)
        if (rmrk) {
          if (!revision) revision = { type: 'insert' }
          revision.authorIndex = rmrk.authorIndex
          revision.timestamp = rmrk.timestamp
        }
        break
      }
      case SPRM_C_RMARK_DEL: {
        // sprmCRMarkDel (0x0834) — 6-byte RMRK: 删除修订的作者索引 + 时间戳
        const rmrk = parseRmrk(data, operandOffset)
        if (rmrk) {
          if (!revision) revision = { type: 'delete' }
          else revision.type = 'delete'
          revision.authorIndex = rmrk.authorIndex
          revision.timestamp = rmrk.timestamp
        }
        break
      }
      case SPRM_CF_SPEC: {
        // sprmCFSpec (0x083A) — Toggle: 标记字符为特殊字符（图片锚点等）
        if (data[operandOffset] === 1) {
          isSpecial = true
        }
        break
      }
      case SPRM_C_PIC_LOCATION: {
        // sprmCPicLocation (0x6805) — 4-byte fcPic: Data 流中 PICF 结构的偏移
        fcPic = readUint32(data, operandOffset) & 0x3FFFFFFF
        break
      }
    }

    pos += 2 + operandSize
  }

  const result: { format: Partial<CharacterFormat>; fontIndex?: number; revision?: { type: RevisionType; authorIndex?: number; timestamp?: number }; isSpecial?: boolean; fcPic?: number } = { format: fmt, fontIndex, revision }
  if (isSpecial) result.isSpecial = true
  if (fcPic !== undefined) result.fcPic = fcPic
  return result
}

function highlightColor(code: number): string {
  switch (code) {
    case 1: return '#FFFF00'  // Yellow
    case 2: return '#00FF00'  // Bright Green
    case 3: return '#00FFFF'  // Cyan
    case 4: return '#FF00FF'  // Magenta / Pink
    case 5: return '#0000FF'  // Blue
    case 6: return '#FF0000'  // Red
    case 7: return '#000080'  // Dark Blue
    case 8: return '#008080'  // Dark Cyan
    case 9: return '#008000'  // Dark Green
    case 10: return '#800080' // Dark Magenta
    case 11: return '#800000' // Dark Red
    case 12: return '#808000' // Dark Yellow
    case 13: return '#808080' // Dark Gray
    case 14: return '#C0C0C0' // Light Gray
    case 15: return '#000000' // Black
    default: return '#FFFF00'
  }
}

// ---- PAPX parsing ----

export interface PapxRun {
  cpStart: number
  cpEnd: number
  format: Partial<ParagraphFormat>
  /** Style index (istd) for this paragraph; 0 = Normal. */
  istd: number
  /** List level (ilvl) from sprmPIlvl, 0-based index into LST levels array. */
  ilvl?: number
  /** List index (ilst) from sprmPIlst, referencing LST table entry. */
  ilst?: number
  /** List Format Override index (ilfo) from sprmPIlfo. */
  ilfo?: number
  /** 表格信息（来自 TAP SPRM），仅当段落属于表格行时存在。 */
  table?: TableInfo
}

/**
 * Parse a PlcfBtePapx structure and return an array of paragraph format
 * runs. Each run covers [cpStart, cpEnd) (one paragraph per run, roughly).
 *
 * @param data - The table stream data.
 * @param fc - Offset of the PlcfBtePapx.
 * @param lcb - Length of the PlcfBtePapx.
 * @returns Array of paragraph runs, or empty array if malformed.
 */
export function parsePapxRuns(data: Uint8Array, fc: number, lcb: number): PapxRun[] {
  if (lcb <= 0 || fc < 0 || fc + lcb > data.length) return []

  // PlcfBtePapx layout (MS-DOC §2.4.4):
  //   aCP: (n+1) DWORDs — paragraph positions, strictly increasing
  //   aPcb: n variable-length PAPX entries, each starting with cbOffset (2 bytes) + istd (2 bytes)

  // Step 1: Find candidate n by scanning aCP for strictly increasing values.
  const maxPossibleN = Math.min(20000, Math.floor((lcb - 4) / 8))
  let n = 0
  const firstCP = readUint32(data, fc)
  if (firstCP > 0x00FFFFFF) return []

  let candidateN = 0
  for (let i = 1; i <= maxPossibleN; i++) {
    const cpOffset = fc + i * 4
    if (cpOffset + 4 > fc + lcb) break
    const cp = readUint32(data, cpOffset)
    const prevCP = readUint32(data, cpOffset - 4)
    if (cp <= prevCP || cp > 0x0FFFFFFF) break
    candidateN = i
  }

  if (candidateN === 0) return []

  // Step 2: Verify by walking the aPcb chain.
  for (let tryN = candidateN; tryN >= 1; tryN--) {
    const aCPEnd = fc + (tryN + 1) * 4
    if (aCPEnd > fc + lcb) continue

    let pcbOffset = aCPEnd
    let valid = true
    let count = 0
    while (pcbOffset < fc + lcb && count < tryN) {
      if (pcbOffset + 2 > fc + lcb) { valid = false; break }
      const cbOff = readUint16(data, pcbOffset)
      if (cbOff < 4 || cbOff > 16384) { valid = false; break }
      pcbOffset += cbOff
      count++
    }
    if (valid && count === tryN && Math.abs(pcbOffset - (fc + lcb)) <= 4) {
      n = tryN
      break
    }
  }

  if (n === 0) return []

  const runs: PapxRun[] = []
  const aCPEnd = fc + (n + 1) * 4
  let pcbOffset = aCPEnd

  for (let i = 0; i < n; i++) {
    const cpStart = readUint32(data, fc + i * 4)
    const cpEnd = readUint32(data, fc + (i + 1) * 4)
    if (cpEnd <= cpStart) {
      pcbOffset += readUint16(data, pcbOffset) || 4
      continue
    }

    const cbOffset = readUint16(data, pcbOffset)
    const istd = readUint16(data, pcbOffset + 2)
    const { format, ilvl, ilst, ilfo, table } = parsePapxGrpprl(data, pcbOffset + 4, cbOffset - 4)
    const run: PapxRun = { cpStart, cpEnd, format, istd }
    if (ilvl !== undefined) run.ilvl = ilvl
    if (ilst !== undefined) run.ilst = ilst
    if (ilfo !== undefined) run.ilfo = ilfo
    if (table) run.table = table
    runs.push(run)
    pcbOffset += cbOffset || 4
  }

  return runs
}

/**
 * Parse a grpprl from a PAPX and return a ParagraphFormat.
 * Only properties relevant to DocPreview rendering are extracted.
 */
function parsePapxGrpprl(data: Uint8Array, offset: number, size: number): { format: Partial<ParagraphFormat>; ilvl?: number; ilst?: number; ilfo?: number; table?: TableInfo } {
  const fmt: Partial<ParagraphFormat> = {}
  let ilvl: number | undefined
  let ilst: number | undefined
  let ilfo: number | undefined
  let table: TableInfo | undefined
  let pos = 0

  while (pos + 2 <= size) {
    const sprm = readUint16(data, offset + pos)
    const operandOffset = offset + pos + 2
    const operandSize = getSprmOperandSize(sprm, data, operandOffset)
    if (operandSize <= 0 || pos + 2 + operandSize > size) break

    switch (sprm) {
      case SPRM_P_ILVL: {
        ilvl = data[operandOffset]
        break
      }
      case SPRM_P_JC: {
        const jc = data[operandOffset]
        switch (jc) {
          case 0: fmt.alignment = 'left'; break
          case 1: fmt.alignment = 'center'; break
          case 2: fmt.alignment = 'right'; break
          case 3: fmt.alignment = 'justify'; break
          // 4 = distribute (treated as justify for rendering)
          case 4: fmt.alignment = 'justify'; break
        }
        break
      }
      case SPRM_P_DXA_LEFT: {
        const twips = readInt16(data, operandOffset)
        fmt.indent = twipsToPt(twips)
        break
      }
      case SPRM_P_DXA_RIGHT: {
        // 0x2403 = sprmPDxaRight (right indent)
        const twips = readInt16(data, operandOffset)
        fmt.rightIndent = twipsToPt(twips)
        break
      }
      case SPRM_P_DXA_INDENT: {
        // 0x2404 = sprmPDxaIndent (first line indent)
        const twips = readInt16(data, operandOffset)
        fmt.firstLineIndent = twipsToPt(twips)
        break
      }
      case SPRM_P_DYA_BEFORE: {
        const twips = readInt16(data, operandOffset)
        fmt.spaceBefore = twipsToPt(twips)
        break
      }
      case SPRM_P_DYA_AFTER: {
        const twips = readInt16(data, operandOffset)
        fmt.spaceAfter = twipsToPt(twips)
        break
      }
      case SPRM_P_LINE: {
        const line = readInt16(data, operandOffset)
        if (line < 0) {
          fmt.lineSpacing = Math.abs(line) / 240
        } else if (line > 0) {
          fmt.lineSpacing = twipsToPt(line)
        }
        break
      }
      case SPRM_P_OUTLINE_LVL: {
        // 0x2420 = sprmPOutlineLvl — direct outline level from PAPX
        const lvl = data[operandOffset]
        if (lvl >= 0 && lvl <= 8) {
          fmt.outlineLevel = lvl
        }
        break
      }
      case SPRM_P_BRC_TOP:
      case SPRM_P_BRC_LEFT:
      case SPRM_P_BRC_BOTTOM:
      case SPRM_P_BRC_RIGHT: {
        if (operandSize < 4) break
        const cb = data[operandOffset]
        if (cb < 4) break
        const ico = data[operandOffset + 1]
        const dptLineWidth = data[operandOffset + 2]
        const brcType = data[operandOffset + 3]
        if (brcType === 0) break
        if (!fmt.borders) fmt.borders = {}
        const border = {
          colorIndex: ico,
          lineWidth: dptLineWidth,
          borderType: brcType,
        }
        switch (sprm) {
          case SPRM_P_BRC_TOP: fmt.borders.top = border; break
          case SPRM_P_BRC_LEFT: fmt.borders.left = border; break
          case SPRM_P_BRC_BOTTOM: fmt.borders.bottom = border; break
          case SPRM_P_BRC_RIGHT: fmt.borders.right = border; break
        }
        break
      }
      case SPRM_P_SHD: {
        // 0x2414 = sprmPShd — paragraph shading
        // Shd structure: 2 bytes - cvBack (5 bits) + icoBack (5 bits) + icoFore (5 bits) + unused (1 bit)
        // Simplified: extract icoBack (background color index)
        if (operandSize >= 2) {
          const shd = readUint16(data, operandOffset)
          const icoBack = (shd >> 0) & 0x1F  // bits 0-4: background color index
          const cvBack = (shd >> 5) & 0x1F   // bits 5-9: cvBack
          // Map icoBack to color (Word color index 0-15)
          // If cvBack != 0, use cvBack; otherwise use icoBack
          const colorIndex = cvBack || icoBack
          if (colorIndex > 0 && colorIndex <= 16) {
            fmt.backgroundColor = SHD_COLOR_MAP[colorIndex] || undefined
          }
        }
        break
      }
      case SPRM_P_ILST: {
        ilst = readInt16(data, operandOffset)
        break
      }
      case SPRM_P_ILFO: {
        ilfo = readInt16(data, operandOffset)
        break
      }
      case SPRM_P_DXA_TAB: {
        // sprmPDxaTab (0x2417) - 可变长度制表位定义
        // spra=6: 首字节是后续长度（不包括首字节）
        // 每个制表位定义：dxaTab(2字节) + jcTab(1字节) + tlc(1字节) = 4字节
        // 简化处理：只提取位置（dxaTab），忽略类型和前导符
        if (operandSize >= 2 && fmt.tabs === undefined) {
          fmt.tabs = []
        }
        // 首字节是长度计数（不包括首字节本身）
        const tabCount = operandSize > 1 ? data[operandOffset] : 0
        // 计算实际制表位数量（每个4字节）
        const actualTabs = Math.min(tabCount, Math.floor((operandSize - 1) / 4))
        for (let i = 0; i < actualTabs && fmt.tabs; i++) {
          const tabOffset = operandOffset + 1 + i * 4
          if (tabOffset + 2 > data.length) break
          const dxaTab = readInt16(data, tabOffset)
          const tabPt = twipsToPt(dxaTab)
          fmt.tabs.push(tabPt)
        }
        break
      }
      case SPRM_P_CHG_TABS: {
        // sprmPChgTabs (0x2418) - 修改制表位（增量/删除）
        // spra=6: 首字节是后续长度
        // 结构：
        //   - cDelTab (1字节): 要删除的制表位数量
        //   - rgdxaDelTab (cDelTab * 2字节): 要删除的制表位位置
        //   - cAddTab (1字节): 要添加的制表位数量
        //   - rgdxaAddTab (cAddTab * 4字节): 要添加的制表位定义（位置+类型+前导符）
        // 简化处理：忽略删除操作，只提取添加的制表位位置
        if (operandSize < 2) break
        const cDelTab = data[operandOffset + 1]
        const delTabsOffset = operandOffset + 2
        const delTabsBytes = cDelTab * 2
        const cAddTabOffset = delTabsOffset + delTabsBytes
        if (cAddTabOffset >= data.length) break
        const cAddTab = data[cAddTabOffset]
        const addTabsOffset = cAddTabOffset + 1
        const actualAddTabs = Math.min(cAddTab, Math.floor((operandSize - (cAddTabOffset - operandOffset)) / 4))
        if (actualAddTabs > 0 && fmt.tabs === undefined) {
          fmt.tabs = []
        }
        for (let i = 0; i < actualAddTabs && fmt.tabs; i++) {
          const tabOffset = addTabsOffset + i * 4
          if (tabOffset + 2 > data.length) break
          const dxaTab = readInt16(data, tabOffset)
          const tabPt = twipsToPt(dxaTab)
          // 检查是否已存在（避免重复添加）
          if (!fmt.tabs.includes(tabPt)) {
            fmt.tabs.push(tabPt)
          }
        }
        break
      }
      case SPRM_P_F_IN_TABLE: {
        // sprmPFInTable (0x240C) — toggle (1 byte): paragraph is inside a table.
        const flag = data[operandOffset] !== 0
        if (flag) {
          if (!table) table = { inTable: true }
          else table.inTable = true
        }
        break
      }
      case SPRM_P_TABLE_DEPTH_SPEC:
      case SPRM_P_TABLE_DEPTH_LEGACY: {
        // sprmPTableDepth — 1 byte: nested table depth (1 = top-level).
        // 0x2410 is the spec encoding (spra=1); 0x4410 is a legacy/POI variant
        // whose spra bits encode 2 but the operand is still 1 byte.
        // getSprmOperandSize forces 1-byte for 0x4410 to keep alignment correct.
        const depth = data[operandOffset]
        if (depth > 0) {
          if (!table) table = { inTable: true, depth }
          else table.depth = depth
        }
        break
      }
      case SPRM_T_DEF_TABLE: {
        // sprmTDefTable (0xD608) — variable length:
        //   byte 0       : cb (后续数据长度，已由 getSprmOperandSize 处理)
        //   byte 1       : itcMac (列数, 最大 63)
        //   bytes 2..    : rgdxaCenter[itcMac+1] (列边界, 每个 2 字节)
        //   bytes 后     : rgtc[itcMac] (单元格属性, 每个 20 字节)
        // TC 结构 (20 字节):
        //   bytes 0-3: TCGrpf 位域
        //     bits 0-2: fVertMerge (0=none, 1=continue, 2=restart)
        //   bytes 4-7: unused
        //   bytes 8-11: BrcTop (4 字节)
        //   bytes 12-15: BrcLeft
        //   bytes 16-19: BrcBottom
        //   bytes 20-23: BrcRight
        // 实际 rgtc 每个元素 20 字节（仅前 4 字节位域 + 16 字节边框）。
        const cells = parseTDefTable(data, operandOffset, operandSize)
        if (cells.length > 0) {
          if (!table) table = { inTable: true }
          table.cells = cells
        }
        break
      }
      case SPRM_T_TABLE_BORDERS: {
        // sprmTTableBorders (0xD612) — variable length:
        //   byte 0: cb (后续长度)
        //   之后: 6 个 Brc 结构 (每个 4 字节)
        //   顺序: brcTop, brcLeft, brcBottom, brcRight, brcInsideH, brcInsideV
        const borders = parseTTableBorders(data, operandOffset, operandSize)
        if (borders) {
          if (!table) table = { inTable: true }
          table.borders = borders
        }
        break
      }
      case SPRM_T_JTABLE: {
        // sprmTJTable (0xD632) — variable length (spra=6):
        //   byte 0: cb (=1)
        //   byte 1: justification (0=left, 1=center, 2=right)
        const payloadStart = operandOffset + 1
        if (payloadStart < data.length) {
          const val = data[payloadStart]
          let justification: TableJustification | undefined
          if (val === 0) justification = 'left'
          else if (val === 1) justification = 'center'
          else if (val === 2) justification = 'right'
          if (justification) {
            if (!table) table = { inTable: true }
            table.justification = justification
          }
        }
        break
      }
      case SPRM_T_DXA_TABLE_INDENT: {
        // sprmTDxaTableIndent (0xD609) — variable length (spra=6):
        //   byte 0: cb (=2)
        //   bytes 1-2: dxaIndent (twips, signed)
        const payloadStart = operandOffset + 1
        if (payloadStart + 2 <= data.length) {
          const indent = readUint16(data, payloadStart)
          if (indent !== 0) {
            if (!table) table = { inTable: true }
            table.indentTwips = indent
          }
        }
        break
      }
    }

    pos += 2 + operandSize
  }

  return { format: fmt, ilvl, ilst, ilfo, table }
}

/**
 * Parse sprmTDefTable operand and extract per-cell info.
 *
 * Layout (MS-DOC §2.6.8 sprmTDefTable):
 *   byte 0       : itcMac (number of columns, max 63)
 *   bytes 1..    : rgdxaCenter[itcMac+1] (column boundaries, 2 bytes each)
 *   bytes 后     : rgtc[itcMac] (cell descriptors, 20 bytes each)
 *
 * TC structure (20 bytes):
 *   bytes 0-3 : TCGrpf (bit field)
 *     bits 0-2: fVertMerge (0=none, 1=continue, 2=restart)
 *     bits 3-5: fHorzMerge (0=none, 1=continue, 2=restart)
 *   bytes 4-7 : BrcTop (4 bytes)
 *   bytes 8-11: BrcLeft (4 bytes)
 *   bytes 12-15: BrcBottom (4 bytes)
 *   bytes 16-19: BrcRight (4 bytes)
 *
 * Brc structure (4 bytes):
 *   bits 0-7: dptLineWidth (1/8 pt)
 *   bits 8-11: brcType
 *   bits 12-15: ico (color index)
 */
function parseTDefTable(data: Uint8Array, operandOffset: number, operandSize: number): TableCellInfo[] {
  if (operandSize < 1) return []
  const payloadStart = operandOffset + 1
  if (payloadStart >= data.length) return []
  const itcMac = data[payloadStart]
  if (itcMac === 0 || itcMac > 63) return []

  const rgdxaEnd = payloadStart + 1 + (itcMac + 1) * 2
  if (rgdxaEnd > operandOffset + operandSize + 1) return []

  const rgtcStart = rgdxaEnd
  const availableBytes = (operandOffset + operandSize + 1) - rgtcStart
  const tcSize = availableBytes >= itcMac * 20 ? 20 : (availableBytes >= itcMac * 18 ? 18 : 0)
  if (tcSize === 0) return []

  const columnWidths: number[] = []
  for (let i = 0; i < itcMac; i++) {
    const xaOffset = payloadStart + 1 + i * 2
    const xaNextOffset = payloadStart + 1 + (i + 1) * 2
    if (xaNextOffset + 2 <= data.length) {
      const xa = readUint16(data, xaOffset)
      const xaNext = readUint16(data, xaNextOffset)
      columnWidths.push(xaNext - xa)
    } else {
      columnWidths.push(0)
    }
  }

  const cells: TableCellInfo[] = []
  for (let i = 0; i < itcMac; i++) {
    const tcOffset = rgtcStart + i * tcSize
    if (tcOffset >= data.length) break

    const tcGrpf = readUint32(data, tcOffset)
    const fVertMerge = tcGrpf & 0x07
    const fHorzMerge = (tcGrpf >> 3) & 0x07

    let verticalMerge: 'none' | 'restart' | 'continue' = 'none'
    if (fVertMerge === 1) verticalMerge = 'continue'
    else if (fVertMerge === 2) verticalMerge = 'restart'

    let horizontalMerge: 'none' | 'restart' | 'continue' = 'none'
    if (fHorzMerge === 1) horizontalMerge = 'continue'
    else if (fHorzMerge === 2) horizontalMerge = 'restart'

    const cellInfo: TableCellInfo = {
      column: i,
      verticalMerge,
    }

    if (horizontalMerge !== 'none') {
      cellInfo.horizontalMerge = horizontalMerge
    }

    if (tcSize >= 20) {
      const brcTop = readUint32(data, tcOffset + 4)
      const brcLeft = readUint32(data, tcOffset + 8)
      const brcBottom = readUint32(data, tcOffset + 12)
      const brcRight = readUint32(data, tcOffset + 16)

      const borders: TableCellInfo['borders'] = {}
      const top = brcToBorderStyle(brcTop)
      const left = brcToBorderStyle(brcLeft)
      const bottom = brcToBorderStyle(brcBottom)
      const right = brcToBorderStyle(brcRight)
      if (top) borders.top = top
      if (left) borders.left = left
      if (bottom) borders.bottom = bottom
      if (right) borders.right = right
      if (Object.keys(borders).length > 0) {
        cellInfo.borders = borders
      }
    }

    cells.push(cellInfo)
  }
  return cells
}

function brcToBorderStyle(brcDword: number): TableBorderStyle | null {
  if (brcDword === 0) return null
  const lineWidth = brcDword & 0xFF
  const borderType = (brcDword >> 8) & 0x0F
  const colorIndex = (brcDword >> 12) & 0x0F
  const style: TableBorderStyle = {}
  if (lineWidth > 0) style.lineWidth = lineWidth
  if (borderType > 0) style.borderType = borderType
  if (colorIndex > 0) style.colorIndex = colorIndex
  return Object.keys(style).length > 0 ? style : null
}

/**
 * Parse sprmTTableBorders operand and extract the 6 table borders.
 *
 * Layout (MS-DOC §2.6.8 sprmTTableBorders):
 *   byte 0: cb (后续长度, 已由 getSprmOperandSize 处理)
 *   之后: 6 个 Brc 结构 (每个 4 字节)
 *   顺序: brcTop, brcLeft, brcBottom, brcRight, brcInsideH, brcInsideV
 *
 * Brc 结构 (4 字节):
 *   bits 0-7: dptLineWidth (1/8 pt)
 *   bits 8-11: brcType (边框类型)
 *   bits 12-15: ico (颜色索引)
 */
function parseTTableBorders(data: Uint8Array, operandOffset: number, operandSize: number): TableBorders | null {
  // operandSize includes cb byte; payload starts at operandOffset+1.
  const payloadStart = operandOffset + 1
  if (payloadStart + 6 * 4 > data.length) return null
  if (operandSize - 1 < 6 * 4) return null

  const borders: TableBorders = {}
  const order: Array<keyof TableBorders> = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  for (let i = 0; i < 6; i++) {
    const brcOffset = payloadStart + i * 4
    const brcDword = readUint32(data, brcOffset)
    if (brcDword === 0) continue
    const lineWidth = brcDword & 0xFF
    const borderType = (brcDword >> 8) & 0x0F
    const colorIndex = (brcDword >> 12) & 0x0F
    const style: TableBorderStyle = {}
    if (lineWidth > 0) style.lineWidth = lineWidth
    if (borderType > 0) style.borderType = borderType
    if (colorIndex > 0) style.colorIndex = colorIndex
    if (Object.keys(style).length > 0) {
      borders[order[i]] = style
    }
  }
  return borders
}

function twipsToPt(twips: number): number {
  return Math.round((twips / 20) * 100) / 100
}

// ---- Utility: merge format runs into paragraph character format ----

/**
 * Given a list of CHPX character runs and a paragraph's [cpStart, cpEnd)
 * range, merge the character formats within that range and return a summary.
 *
 * Returns the most prominent format for the paragraph — if the majority of
 * characters share a property, it's set; otherwise the property is omitted.
 * This is used as a paragraph-level fallback when per-character rendering
 * is not desired.
 */
export function mergeCharFormatForParagraph(
  runs: ChpxRun[],
  cpStart: number,
  cpEnd: number,
  fontNames?: string[],
): Partial<CharacterFormat> {
  const totalChars = cpEnd - cpStart
  if (totalChars <= 0 || runs.length === 0) return {}

  // Collect properties from runs that overlap the paragraph.
  let boldCount = 0
  let italicCount = 0
  let underlineCount = 0
  let strikethroughCount = 0
  let superscriptCount = 0
  let subscriptCount = 0
  let smallCapsCount = 0
  let allCapsCount = 0
  let fontSizeSum = 0
  let fontSizeCount = 0
  let firstColor: string | undefined
  let firstHighlight: string | undefined
  let firstFontName: string | undefined

  for (const run of runs) {
    const overlapStart = Math.max(run.cpStart, cpStart)
    const overlapEnd = Math.min(run.cpEnd, cpEnd)
    if (overlapEnd <= overlapStart) continue
    const len = overlapEnd - overlapStart

    if (run.format.bold) boldCount += len
    if (run.format.italic) italicCount += len
    if (run.format.underline) underlineCount += len
    if (run.format.strikethrough) strikethroughCount += len
    if (run.format.superscript) superscriptCount += len
    if (run.format.subscript) subscriptCount += len
    if (run.format.smallCaps) smallCapsCount += len
    if (run.format.allCaps) allCapsCount += len
    if (run.format.fontSize !== undefined) {
      fontSizeSum += run.format.fontSize * len
      fontSizeCount += len
    }
    if (run.format.color && !firstColor) firstColor = run.format.color
    if (run.format.highlight && !firstHighlight) firstHighlight = run.format.highlight
    // Font name from font index
    if (run.fontIndex !== undefined && fontNames && !firstFontName) {
      const fontName = fontNames[run.fontIndex]
      if (fontName) firstFontName = fontName
    }
  }

  const result: Partial<CharacterFormat> = {}
  if (boldCount > totalChars * 0.5) result.bold = true
  if (italicCount > totalChars * 0.3) result.italic = true
  if (underlineCount > totalChars * 0.3) result.underline = true
  if (strikethroughCount > totalChars * 0.3) result.strikethrough = true
  if (superscriptCount > totalChars * 0.3) result.superscript = true
  if (subscriptCount > totalChars * 0.3) result.subscript = true
  if (smallCapsCount > totalChars * 0.5) result.smallCaps = true
  if (allCapsCount > totalChars * 0.5) result.allCaps = true
  if (fontSizeCount > totalChars * 0.5 && fontSizeCount > 0) {
    result.fontSize = Math.round(fontSizeSum / fontSizeCount)
  }
  if (firstColor) result.color = firstColor
  if (firstHighlight) result.highlight = firstHighlight
  if (firstFontName) result.fontName = firstFontName

  return result
}
