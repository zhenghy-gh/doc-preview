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
import { readUint16, readUint32, readInt16 } from './binaryReader'
import { WORD_COLOR_PALETTE } from './wordPalette'

// ---- SPRM operation codes (MS-DOC §2.6.1/§2.6.2/§2.6.3 — Word 97+ spec codes) ----
//
// NOTE: these are the on-disk two-byte SPRM opcodes that real Word 97-2003
// binaries emit inside CHPX/PAPX grpprls. An earlier revision of this module
// used a project-invented code table that only matched our synthetic test
// fixtures; real documents silently lost all character formatting (and some
// codes collided with spec semantics — e.g. 0x0801 is sprmCFRMark, not bold).

// -- CHP (character) SPRMs --
const SPRM_CF_RMARK_DEL = 0x0800   // Toggle: fRMarkDel — 修订删除标记
const SPRM_CF_RMARK = 0x0801       // Toggle: fRMark — 修订插入标记
const SPRM_C_IBST_RMARK = 0x4804   // 2-byte: 插入修订作者索引 (SttbfRMark)
const SPRM_C_DTTM_RMARK = 0x6805   // 4-byte DTTM: 插入修订时间戳
const SPRM_C_HIGHLIGHT = 0x2A0C    // 1-byte: highlight color index
const SPRM_C_ISTD = 0x4A30         // 2-byte: character style index
const SPRM_CF_BOLD = 0x0835        // Toggle: bold
const SPRM_CF_ITALIC = 0x0836      // Toggle: italic
const SPRM_CF_STRIKE = 0x0837      // Toggle: strikethrough
const SPRM_CF_OUTLINE = 0x0838     // Toggle: outline
const SPRM_CF_SHADOW = 0x0839      // Toggle: shadow
const SPRM_CF_SMALL_CAPS = 0x083A  // Toggle: small caps
const SPRM_CF_CAPS = 0x083B        // Toggle: all caps
const SPRM_CF_VANISH = 0x083C      // Toggle: hidden text
const SPRM_C_KUL = 0x2A3E          // 1-byte: underline style (0 = none)
const SPRM_C_DXA_SPACE = 0x8840    // 2-byte signed: 字符间距（缇）
const SPRM_C_ICO = 0x2A42          // 1-byte: text color index (ICO palette)
const SPRM_C_HPS = 0x4A43          // 2-byte: font size (half-points)
const SPRM_C_HPS_POS = 0x4845      // 2-byte signed: raised/lowered position (half-points)
const SPRM_C_ISS = 0x2A48          // 1-byte: 0=normal, 1=superscript, 2=subscript
const SPRM_C_KERN = 0x484B         // 2-byte: kerning threshold (half-points)
const SPRM_C_FTC0 = 0x4A4F         // 2-byte: font index — ASCII characters
const SPRM_C_FTC1 = 0x4A50         // 2-byte: font index — East Asian characters
const SPRM_C_FTC2 = 0x4A51         // 2-byte: font index — other characters
const SPRM_C_DSTRIKE = 0x2A53      // 1-byte: double strikethrough
const SPRM_CF_SPEC = 0x0855        // Toggle: fSpec — special char (picture anchor, field, …)
const SPRM_C_IBST_RMARK_DEL = 0x4863 // 2-byte: 删除修订作者索引
const SPRM_C_DTTM_RMARK_DEL = 0x6864 // 4-byte DTTM: 删除修订时间戳
const SPRM_C_CV = 0x6870           // 4-byte COLORREF: r,g,b,fAuto (Word 2000+)
const SPRM_C_PIC_LOCATION = 0x6A03 // 4-byte fcPic: Data 流中 PICF 结构偏移

// -- PAP (paragraph) SPRMs --
const SPRM_P_ISTD = 0x4600           // 2-byte: paragraph style index (consumed, unused)
const SPRM_P_JC = 0x2403             // sprmPJc80: 1-byte alignment
const SPRM_P_PAGE_BREAK_BEFORE = 0x2407 // Toggle: page break before paragraph
const SPRM_P_ILVL = 0x260A           // 1-byte: list level
const SPRM_P_ILFO = 0x460B           // 2-byte: list format override index
const SPRM_P_CHG_TABS_PAPX = 0xC60D  // Variable: PChgTabsPapxOperand (tab stops)
const SPRM_P_DXA_RIGHT = 0x840E      // 2-byte signed: right indent (twips)
const SPRM_P_DXA_LEFT = 0x840F       // 2-byte signed: left indent (twips)
const SPRM_P_DXA_LEFT1 = 0x8411      // 2-byte signed: first line indent (twips)
const SPRM_P_DYA_LINE = 0x6412       // 4-byte LSPD: dyaLine + fMultLinespace
const SPRM_P_DYA_BEFORE = 0xA413     // 2-byte: space before (twips)
const SPRM_P_DYA_AFTER = 0xA414      // 2-byte: space after (twips)
const SPRM_P_CHG_TABS = 0xC615       // Variable: PChgTabsOperand (tab stops)
const SPRM_P_BRC_TOP = 0x6424        // 4-byte BRC80: paragraph top border
const SPRM_P_BRC_LEFT = 0x6425      // 4-byte BRC80: paragraph left border
const SPRM_P_BRC_BOTTOM = 0x6426    // 4-byte BRC80: paragraph bottom border
const SPRM_P_BRC_RIGHT = 0x6427     // 4-byte BRC80: paragraph right border
const SPRM_P_SHD = 0x442D           // sprmPShd80: 2-byte SHD80 paragraph shading
const SPRM_P_OUTLINE_LVL = 0x2640   // 1-byte: outline level (0-8; 9 = body text)
// Legacy list codes produced by older exporters (no spec collision).
const SPRM_P_ILVL_LEGACY = 0x460D
const SPRM_P_ILST_LEGACY = 0x460E  // list index; the spec drives lists via ilfo only
const SPRM_P_ILFO_LEGACY = 0x460F

// -- Table SPRMs (TAP — attach to the paragraph/row-end mark of a table row) --
const SPRM_P_F_IN_TABLE = 0x2416    // Toggle: paragraph is inside a table
const SPRM_P_F_TTP = 0x2417         // Toggle: paragraph is a table row-end (TTP) mark
const SPRM_P_ITAP = 0x6649          // 4-byte: nested table depth (1 = top level)
// Legacy/POI table depth encoding (spra bits say 2 bytes, operand is 1 byte).
const SPRM_P_TABLE_DEPTH_LEGACY = 0x4410
const SPRM_T_JC90 = 0x5400          // 2-byte: table justification (0=left,1=center,2=right)
const SPRM_T_TABLE_BORDERS = 0xD605 // sprmTTableBorders80: cb + 6 × BRC80
const SPRM_T_DEF_TABLE = 0xD608     // 2-byte cb + itcMac + rgdxaCenter[] + rgtc[] (TC80)
const SPRM_T_DEF_TABLE_SHD = 0xD609 // sprmTDefTableShd80: cell shading (consumed, unused)

/**
 * Shd color index to CSS color mapping.
 * Word uses a 16-color palette (indices 1-16).
 * 表体已统一到 wordPalette.ts（与 BORDER_COLOR_MAP / colorIndexToCss 共用同一份）。
 */
const SHD_COLOR_MAP = WORD_COLOR_PALETTE

// ---- Helpers ----

// ---- SPRM operand size calculator ----

/**
 * 仅按 spra (sprm bits 13-15) 推导操作数长度，**不含** sprmTDefTable (0xD608) /
 * sprmPTableDepth (0x4410) 两个特例。
 *
 * 单列出来是因为 `sectionParser.ts` 原先复制了同一段 `switch (spra)`（其注释即
 * 写明"与 formatParser.getSprmOperandSize 一致"）。section 的 SPRM 取值域
 * （0xB0xx / 0x30xx / 0x50xx / 0x90xx 等）不含上述两个特例码，它走的正是这段
 * 纯 spra 逻辑；抽成独立函数后两侧共享同一实现，同时各自保留原有的特例处理，
 * 因此是逐分支等价的搬移而非语义合并。
 */
export function getSprmOperandSizeBySpra(sprm: number, data: Uint8Array, operandOffset: number): number {
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
    // 防御：spra 为 3 位（0-7），所有取值均有 case，default 正常不可达
    default: return 0
  }
}

/**
 * Returns the size (in bytes) of the operand that follows a 2-byte SPRM.
 * The SPRM bit layout:
 *   bits 0-8: ispmd
 *   bit    9: fSpec
 *   bits 10-12: sgc (property group)
 *   bits 13-15: spra (operand size type)
 *
 * Special cases: sprmTDefTable (0xD608) carries a 2-byte cb (its payload can
 * exceed 255 bytes), and the legacy 0x4410 table-depth code encodes spra=2
 * while its actual operand is a single byte.
 */
export function getSprmOperandSize(sprm: number, data: Uint8Array, operandOffset: number): number {
  // sprmTDefTable (0xD608): 2-byte cb, defined as "bytes following, plus 1".
  // Total operand length = 2 (cb field) + (cb - 1) payload bytes.
  if (sprm === SPRM_T_DEF_TABLE) {
    if (operandOffset + 2 > data.length) return 0
    const cb16 = readUint16(data, operandOffset)
    return 2 + Math.max(cb16 - 1, 0)
  }

  // Legacy sprmPTableDepth (0x4410) as emitted by POI-era exporters:
  // spra bits encode 2 (2-byte), but the actual operand is 1 byte.
  // Force 1-byte here so the parser doesn't over-read and misalign
  // subsequent SPRMs in the grpprl.
  if (sprm === SPRM_P_TABLE_DEPTH_LEGACY) {
    return 1
  }

  return getSprmOperandSizeBySpra(sprm, data, operandOffset)
}

// ---- CHPX parsing ----

export interface ChpxRun {
  cpStart: number
  cpEnd: number
  format: Partial<CharacterFormat>
  /** Font index (reference to font table), from sprmCRgFtc0/1/2 (ASCII first). */
  fontIndex?: number
  /** Character style index from sprmCIstd (e.g. Hyperlink, Strong). */
  istd?: number
  /**
   * 修订标记（来自 sprmCFRMark / sprmCFRMarkDel / sprmCIbstRMark(Del) / sprmCDttmRMark(Del)）。
   * 无修订时为 undefined。type 为 'insert'/'delete'/'format'，
   * authorIndex/timestamp 可能缺失。
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
    // Unreachable: the aCP walk above verified strict monotonicity within
    // fc+lcb, and the aPcb chain validation guarantees in-bounds reads.
    /* v8 ignore start */
    if (cpEnd <= cpStart) {
      pcbOffset += readUint16(data, pcbOffset) || 2
      continue
    }
    /* v8 ignore stop */

    const cbOffset = readUint16(data, pcbOffset)
    const { format, fontIndex, revision, isSpecial, fcPic, istd } = parseChpxGrpprlWithFont(data, pcbOffset + 2, cbOffset - 2)
    const run: ChpxRun = { cpStart, cpEnd, format, fontIndex, revision }
    if (isSpecial) run.isSpecial = true
    if (fcPic !== undefined) run.fcPic = fcPic
    if (istd !== undefined) run.istd = istd
    runs.push(run)
    pcbOffset += cbOffset || 2
  }

  return runs
}

/**
 * Parse a grpprl (array of Prl) from a CHPX and return format + font index.
 * Only properties relevant to DocPreview rendering are extracted.
 */
export function parseChpxGrpprlWithFont(data: Uint8Array, offset: number, size: number): { format: Partial<CharacterFormat>; fontIndex?: number; revision?: { type: RevisionType; authorIndex?: number; timestamp?: number }; isSpecial?: boolean; fcPic?: number; istd?: number } {
  const fmt: Partial<CharacterFormat> = {}
  let ftc0: number | undefined
  let ftc1: number | undefined
  let ftc2: number | undefined
  let revision: { type: RevisionType; authorIndex?: number; timestamp?: number } | undefined = undefined
  let isSpecial = false
  let fcPic: number | undefined = undefined
  let istd: number | undefined = undefined
  let pos = 0

  while (pos + 2 <= size) {
    const sprm = readUint16(data, offset + pos)
    const operandOffset = offset + pos + 2
    const operandSize = getSprmOperandSize(sprm, data, operandOffset)
    // Guard against malformed SPRMs.
    if (operandSize <= 0 || pos + 2 + operandSize > size) break

    // Toggle operands: 0 = off, 1 = on, 0x80/0x81 = "match/invert style"
    // (we can't resolve those without the style chain, so leave undefined).
    const toggle = data[operandOffset]

    switch (sprm) {
      case SPRM_CF_BOLD:
        if (toggle === 1) fmt.bold = true
        else if (toggle === 0) fmt.bold = false
        break
      case SPRM_CF_ITALIC:
        if (toggle === 1) fmt.italic = true
        else if (toggle === 0) fmt.italic = false
        break
      case SPRM_CF_STRIKE:
        if (toggle === 1) fmt.strikethrough = true
        else if (toggle === 0) fmt.strikethrough = false
        break
      case SPRM_C_DSTRIKE:
        // Double strikethrough — rendered as plain strikethrough.
        if (toggle !== 0) fmt.strikethrough = true
        break
      case SPRM_CF_OUTLINE:
        if (toggle === 1) fmt.outline = true
        else if (toggle === 0) fmt.outline = false
        break
      case SPRM_CF_SHADOW:
        if (toggle === 1) fmt.shadow = true
        else if (toggle === 0) fmt.shadow = false
        break
      case SPRM_CF_SMALL_CAPS:
        if (toggle === 1) fmt.smallCaps = true
        else if (toggle === 0) fmt.smallCaps = false
        break
      case SPRM_CF_CAPS:
        if (toggle === 1) fmt.allCaps = true
        else if (toggle === 0) fmt.allCaps = false
        break
      case SPRM_CF_VANISH:
        if (toggle === 1) fmt.hidden = true
        else if (toggle === 0) fmt.hidden = false
        break
      case SPRM_C_KUL:
        // sprmCKul — underline style code; 0 = none, anything else underlined.
        fmt.underline = toggle !== 0
        break
      case SPRM_C_HPS: {
        const hps = readUint16(data, operandOffset)
        if (hps > 0) fmt.fontSize = hps / 2  // half-points → points
        break
      }
      case SPRM_C_HPS_POS: {
        // sprmCHpsPos — raised (>0) / lowered (<0) text in half-points.
        const hpsPos = readInt16(data, operandOffset)
        if (hpsPos > 0) fmt.superscript = true
        else if (hpsPos < 0) fmt.subscript = true
        break
      }
      case SPRM_C_ISS: {
        // sprmCIss — 0 = normal, 1 = superscript, 2 = subscript.
        const iss = data[operandOffset]
        if (iss === 1) fmt.superscript = true
        else if (iss === 2) fmt.subscript = true
        break
      }
      case SPRM_C_ICO: {
        // sprmCIco — classic 16-color palette index (same table as SHD).
        const ico = data[operandOffset]
        if (ico >= 1 && ico <= 16) fmt.color = SHD_COLOR_MAP[ico]
        break
      }
      case SPRM_C_CV: {
        // sprmCCv (Word 2000+) — COLORREF bytes: red, green, blue, fAuto.
        const r = data[operandOffset]
        const g = data[operandOffset + 1]
        const b = data[operandOffset + 2]
        if (data[operandOffset + 3] !== 0xFF) {
          fmt.color = `rgb(${r}, ${g}, ${b})`
        }
        break
      }
      case SPRM_C_HIGHLIGHT: {
        const hl = data[operandOffset]
        if (hl !== 0) {
          fmt.highlight = highlightColor(hl)
        }
        break
      }
      case SPRM_C_KERN:
        // sprmCHpsKern is the kerning *threshold* (apply kerning when font
        // size ≥ hps/2), not a letter-spacing amount. Rendering it as
        // letterSpacing stretched heading styles badly, so just consume it.
        // Actual letter spacing comes from sprmCDxaSpace above.
        break
      case SPRM_C_DXA_SPACE: {
        // sprmCDxaSpace: 字符间距（缇） → 实际磅数 = dxaSpace / 20
        const dxaSpace = readInt16(data, operandOffset)
        if (dxaSpace !== 0) {
          fmt.letterSpacing = twipsToPt(dxaSpace)
        }
        break
      }
      case SPRM_C_FTC0:
        // sprmCRgFtc0 — font index for ASCII characters (STTB Ffn).
        ftc0 = readUint16(data, operandOffset)
        break
      case SPRM_C_FTC1:
        // sprmCRgFtc1 — font index for East Asian characters.
        ftc1 = readUint16(data, operandOffset)
        break
      case SPRM_C_FTC2:
        // sprmCRgFtc2 — font index for other characters.
        ftc2 = readUint16(data, operandOffset)
        break
      case SPRM_C_ISTD:
        // Character style index — the caller resolves the style chain
        // (formatParser must not depend on styleParser).
        istd = readUint16(data, operandOffset)
        break
      case SPRM_CF_RMARK: {
        // sprmCFRMark — Toggle: 标记字符为"修订插入"
        if (toggle === 1) {
          if (!revision) revision = { type: 'insert' }
          // Unreachable: this parser only ever creates insert/delete
          // revisions. Kept for spec completeness.
          /* v8 ignore start */
          else if (revision.type === 'format') revision.type = 'insert'
          /* v8 ignore stop */
        }
        break
      }
      case SPRM_CF_RMARK_DEL: {
        // sprmCFRMarkDel — Toggle: 标记字符为"修订删除"
        if (toggle === 1) {
          if (!revision) revision = { type: 'delete' }
          else revision.type = 'delete'
        }
        break
      }
      case SPRM_C_IBST_RMARK: {
        // sprmCIbstRMark — 插入修订的作者索引（SttbfRMark）
        const ibst = readUint16(data, operandOffset)
        if (!revision) revision = { type: 'insert' }
        revision.authorIndex = ibst
        break
      }
      case SPRM_C_DTTM_RMARK: {
        // sprmCDttmRMark — 插入修订的 DTTM 时间戳
        const dttm = readUint32(data, operandOffset)
        if (dttm !== 0) {
          if (!revision) revision = { type: 'insert' }
          revision.timestamp = dttm
        }
        break
      }
      case SPRM_C_IBST_RMARK_DEL: {
        // sprmCIbstRMarkDel — 删除修订的作者索引
        const ibst = readUint16(data, operandOffset)
        if (!revision) revision = { type: 'delete' }
        else revision.type = 'delete'
        revision.authorIndex = ibst
        break
      }
      case SPRM_C_DTTM_RMARK_DEL: {
        // sprmCDttmRMarkDel — 删除修订的 DTTM 时间戳
        const dttm = readUint32(data, operandOffset)
        if (dttm !== 0) {
          if (!revision) revision = { type: 'delete' }
          else revision.type = 'delete'
          revision.timestamp = dttm
        }
        break
      }
      case SPRM_CF_SPEC: {
        // sprmCFSpec — Toggle: 标记字符为特殊字符（图片锚点等）
        if (toggle === 1) {
          isSpecial = true
        }
        break
      }
      case SPRM_C_PIC_LOCATION: {
        // sprmCPicLocation — 4-byte fcPic: Data 流中 PICF 结构的偏移
        fcPic = readUint32(data, operandOffset) & 0x3FFFFFFF
        break
      }
    }

    pos += 2 + operandSize
  }

  // ASCII font takes priority, then East Asian, then "other".
  const fontIndex = ftc0 ?? ftc1 ?? ftc2

  const result: { format: Partial<CharacterFormat>; fontIndex?: number; revision?: { type: RevisionType; authorIndex?: number; timestamp?: number }; isSpecial?: boolean; fcPic?: number; istd?: number } = { format: fmt, fontIndex, revision }
  if (isSpecial) result.isSpecial = true
  if (fcPic !== undefined) result.fcPic = fcPic
  if (istd !== undefined) result.istd = istd
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
    // Unreachable: the aCP walk above verified strict monotonicity within
    // fc+lcb, and the aPcb chain validation guarantees in-bounds reads.
    /* v8 ignore start */
    if (cpEnd <= cpStart) {
      pcbOffset += readUint16(data, pcbOffset) || 4
      continue
    }
    /* v8 ignore stop */

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
export function parsePapxGrpprl(data: Uint8Array, offset: number, size: number): { format: Partial<ParagraphFormat>; ilvl?: number; ilst?: number; ilfo?: number; table?: TableInfo } {
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
      case SPRM_P_ISTD:
        // Paragraph style index — already carried by the PAPX istd field.
        break
      case SPRM_P_ILVL:
      case SPRM_P_ILVL_LEGACY: {
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
        const twips = readInt16(data, operandOffset)
        fmt.rightIndent = twipsToPt(twips)
        break
      }
      case SPRM_P_DXA_LEFT1: {
        // sprmPDxaLeft1 — first line indent (negative = hanging indent)
        const twips = readInt16(data, operandOffset)
        fmt.firstLineIndent = twipsToPt(twips)
        break
      }
      case SPRM_P_DYA_BEFORE: {
        const twips = readUint16(data, operandOffset)
        fmt.spaceBefore = twipsToPt(twips)
        break
      }
      case SPRM_P_DYA_AFTER: {
        const twips = readUint16(data, operandOffset)
        fmt.spaceAfter = twipsToPt(twips)
        break
      }
      case SPRM_P_DYA_LINE: {
        // sprmPDyaLine — 4-byte LSPD: dyaLine (int16) + fMultLinespace (uint16).
        // fMult=1 → dyaLine is a line-count multiple in 1/240ths;
        // fMult=0 → dyaLine is an exact/at-least height in twips.
        const dyaLine = readInt16(data, operandOffset)
        const fMult = readUint16(data, operandOffset + 2)
        if (fMult === 1) {
          if (dyaLine !== 0) fmt.lineSpacing = Math.abs(dyaLine) / 240
        } else if (dyaLine !== 0) {
          fmt.lineSpacing = twipsToPt(Math.abs(dyaLine))
        }
        break
      }
      case SPRM_P_PAGE_BREAK_BEFORE: {
        if (data[operandOffset] === 1) fmt.pageBreakBefore = true
        break
      }
      case SPRM_P_OUTLINE_LVL: {
        // sprmPOutLvl — outline level 0-8; 9 = body text (ignored)
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
        // 4-byte BRC80: byte0 dptLineWidth (1/8pt), byte1 brcType, byte2 ico.
        if (operandSize < 4) break
        const dptLineWidth = data[operandOffset]
        const brcType = data[operandOffset + 1]
        const ico = data[operandOffset + 2]
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
        // sprmPShd80 — 2-byte SHD80:
        //   bits 0-4: icoFore, bits 5-9: icoBack, bits 10-15: ipat
        if (operandSize >= 2) {
          const shd = readUint16(data, operandOffset)
          const icoBack = (shd >> 5) & 0x1F
          if (icoBack > 0 && icoBack <= 16) {
            fmt.backgroundColor = SHD_COLOR_MAP[icoBack] || undefined
          }
        }
        break
      }
      case SPRM_P_ILST_LEGACY: {
        ilst = readInt16(data, operandOffset)
        break
      }
      case SPRM_P_ILFO:
      case SPRM_P_ILFO_LEGACY: {
        ilfo = readInt16(data, operandOffset)
        break
      }
      case SPRM_P_CHG_TABS_PAPX: {
        // sprmPChgTabsPapx (0xC60D) — PChgTabsPapxOperand:
        //   cb(1) + cTabsDel(1) + rgdxaDel(2×d) + cTabsAdd(1) + rgdxaAdd(2×a) + rgtbdAdd(1×a)
        // 简化处理：忽略删除，只提取添加的制表位位置。
        if (operandSize < 3) break
        const opEnd = operandOffset + operandSize
        const cTabsDel = data[operandOffset + 1]
        const cAddOffset = operandOffset + 2 + cTabsDel * 2
        if (cAddOffset >= opEnd) break
        const cTabsAdd = data[cAddOffset]
        const addBase = cAddOffset + 1
        for (let i = 0; i < cTabsAdd; i++) {
          const tabOffset = addBase + i * 2
          if (tabOffset + 2 > opEnd) break
          if (fmt.tabs === undefined) fmt.tabs = []
          fmt.tabs.push(twipsToPt(readInt16(data, tabOffset)))
        }
        break
      }
      case SPRM_P_CHG_TABS: {
        // sprmPChgTabs (0xC615) — PChgTabsOperand:
        //   cb(1) + cTabsDel(1) + rgdxaDel(2×d) + rgdxaClose(2×d)
        //        + cTabsAdd(1) + rgdxaAdd(2×a) + rgtbdAdd(1×a)
        // cb=255 表示复杂形式（全部制表位重定义），此处跳过。
        if (operandSize < 3 || data[operandOffset] === 255) break
        const opEnd = operandOffset + operandSize
        const cTabsDel = data[operandOffset + 1]
        const cAddOffset = operandOffset + 2 + cTabsDel * 4
        if (cAddOffset >= opEnd) break
        const cTabsAdd = data[cAddOffset]
        const addBase = cAddOffset + 1
        for (let i = 0; i < cTabsAdd; i++) {
          const tabOffset = addBase + i * 2
          if (tabOffset + 2 > opEnd) break
          const tabPt = twipsToPt(readInt16(data, tabOffset))
          if (fmt.tabs === undefined) fmt.tabs = []
          if (!fmt.tabs.includes(tabPt)) fmt.tabs.push(tabPt)
        }
        break
      }
      case SPRM_P_F_IN_TABLE: {
        // sprmPFInTable — toggle (1 byte): paragraph is inside a table.
        if (data[operandOffset] !== 0) {
          if (!table) table = { inTable: true }
          else table.inTable = true
        }
        break
      }
      case SPRM_P_F_TTP: {
        // sprmPFTtp — toggle: this paragraph is a table row-end (TTP) mark.
        // The row-end mark's PAPX carries the row's TAP SPRMs, so make sure
        // a table object exists for them to land in.
        if (data[operandOffset] !== 0) {
          if (!table) table = { inTable: true }
          else table.inTable = true
        }
        break
      }
      case SPRM_P_ITAP: {
        // sprmPItap — 4-byte nested table depth (1 = top level).
        const depth = readUint32(data, operandOffset)
        if (depth > 0 && depth < 16) {
          if (!table) table = { inTable: true, depth }
          else table.depth = depth
        }
        break
      }
      case SPRM_P_TABLE_DEPTH_LEGACY: {
        // Legacy 1-byte table depth (getSprmOperandSize forces 1 byte).
        const depth = data[operandOffset]
        if (depth > 0) {
          if (!table) table = { inTable: true, depth }
          else table.depth = depth
        }
        break
      }
      case SPRM_T_DEF_TABLE: {
        // sprmTDefTable (0xD608) — 2-byte cb + itcMac + rgdxaCenter[] + rgtc[] (TC80).
        const def = parseTDefTable(data, operandOffset, operandSize)
        if (def.cells.length > 0) {
          if (!table) table = { inTable: true }
          table.cells = def.cells
          if (def.indentTwips !== undefined && table.indentTwips === undefined) {
            table.indentTwips = def.indentTwips
          }
        }
        break
      }
      case SPRM_T_TABLE_BORDERS: {
        // sprmTTableBorders80 (0xD605) — cb + 6 × BRC80:
        //   顺序: brcTop, brcLeft, brcBottom, brcRight, brcInsideH, brcInsideV
        const borders = parseTTableBorders(data, operandOffset, operandSize)
        if (borders) {
          if (!table) table = { inTable: true }
          table.borders = borders
        }
        break
      }
      case SPRM_T_JC90: {
        // sprmTJc90 (0x5400) — 2-byte: 0=left, 1=center, 2=right.
        const val = readUint16(data, operandOffset)
        let justification: TableJustification | undefined
        if (val === 0) justification = 'left'
        else if (val === 1) justification = 'center'
        else if (val === 2) justification = 'right'
        if (justification) {
          if (!table) table = { inTable: true }
          table.justification = justification
        }
        break
      }
      case SPRM_T_DEF_TABLE_SHD: {
        // sprmTDefTableShd80 — cell shading; consumed for alignment, not rendered.
        break
      }
    }

    pos += 2 + operandSize
  }

  return { format: fmt, ilvl, ilst, ilfo, table }
}

/**
 * Parse the sprmTDefTable operand and extract per-cell info.
 *
 * Operand layout (MS-DOC §2.6.3 sprmTDefTable — TDefTableOperand):
 *   bytes 0-1    : cb (2 bytes — payload length + 1, handled by getSprmOperandSize)
 *   byte  2      : itcMac (number of columns, max 63)
 *   bytes 3..    : rgdxaCenter[itcMac+1] (column boundaries, int16 twips)
 *   bytes 后     : rgtc[itcMac] (TC80 cell descriptors, 20 bytes each)
 *
 * TC80 structure (20 bytes):
 *   bytes 0-1 : grfTc bit field —
 *     bit 0: fFirstMerged (horizontal merge start)
 *     bit 1: fMerged      (horizontal merge continuation)
 *     bit 5: fVertMerge   (vertical merge member)
 *     bit 6: fVertRestart (vertical merge start)
 *   bytes 2-3 : wWidth (preferred cell width)
 *   bytes 4-7 / 8-11 / 12-15 / 16-19: brcTop/Left/Bottom/Right (BRC80)
 */
function parseTDefTable(data: Uint8Array, operandOffset: number, operandSize: number): { cells: TableCellInfo[]; indentTwips?: number } {
  // operandSize includes the 2-byte cb field; payload starts right after it.
  if (operandSize < 3) return { cells: [] }
  const payloadStart = operandOffset + 2
  const payloadEnd = operandOffset + operandSize
  if (payloadStart >= data.length) return { cells: [] }
  const itcMac = data[payloadStart]
  if (itcMac === 0 || itcMac > 63) return { cells: [] }

  const rgdxaStart = payloadStart + 1
  const rgtcStart = rgdxaStart + (itcMac + 1) * 2
  if (rgtcStart > payloadEnd) return { cells: [] }

  // Table indent: the first column boundary is the row's left edge (twips).
  const dxaLeft = readInt16(data, rgdxaStart)
  const indentTwips = dxaLeft > 0 ? dxaLeft : undefined

  const cells: TableCellInfo[] = []
  for (let i = 0; i < itcMac; i++) {
    const tcOffset = rgtcStart + i * 20
    // rgtc may be truncated — Word omits trailing TCs it considers default.
    const hasTc = tcOffset + 20 <= payloadEnd && tcOffset + 20 <= data.length

    const cellInfo: TableCellInfo = {
      column: i,
      verticalMerge: 'none',
    }

    if (hasTc) {
      const grfTc = readUint16(data, tcOffset)
      const fFirstMerged = (grfTc & 0x01) !== 0
      const fMerged = (grfTc & 0x02) !== 0
      const fVertMerge = (grfTc & 0x20) !== 0
      const fVertRestart = (grfTc & 0x40) !== 0

      if (fVertRestart) cellInfo.verticalMerge = 'restart'
      else if (fVertMerge) cellInfo.verticalMerge = 'continue'

      if (fFirstMerged) cellInfo.horizontalMerge = 'restart'
      else if (fMerged) cellInfo.horizontalMerge = 'continue'

      const borders: TableCellInfo['borders'] = {}
      const top = brc80ToBorderStyle(data, tcOffset + 4)
      const left = brc80ToBorderStyle(data, tcOffset + 8)
      const bottom = brc80ToBorderStyle(data, tcOffset + 12)
      const right = brc80ToBorderStyle(data, tcOffset + 16)
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
  return { cells, indentTwips }
}

/**
 * Decode a 4-byte BRC80 (border code) at `offset`:
 *   byte 0: dptLineWidth (1/8 pt)
 *   byte 1: brcType (0 = none)
 *   byte 2: ico (classic color index)
 *   byte 3: dptSpace + fShadow/fFrame flags (ignored)
 */
function brc80ToBorderStyle(data: Uint8Array, offset: number): TableBorderStyle | null {
  if (offset + 4 > data.length) return null
  const lineWidth = data[offset]
  const borderType = data[offset + 1]
  const colorIndex = data[offset + 2]
  if (borderType === 0 && lineWidth === 0 && colorIndex === 0) return null
  const style: TableBorderStyle = {}
  if (lineWidth > 0) style.lineWidth = lineWidth
  if (borderType > 0) style.borderType = borderType
  if (colorIndex > 0) style.colorIndex = colorIndex
  return Object.keys(style).length > 0 ? style : null
}

/**
 * Parse the sprmTTableBorders80 operand and extract the 6 table borders.
 *
 * Layout (MS-DOC §2.6.3 sprmTTableBorders80):
 *   byte 0: cb (后续长度 = 24, 已由 getSprmOperandSize 处理)
 *   之后: 6 个 BRC80 结构 (每个 4 字节)
 *   顺序: brcTop, brcLeft, brcBottom, brcRight, brcInsideH, brcInsideV
 */
function parseTTableBorders(data: Uint8Array, operandOffset: number, operandSize: number): TableBorders | null {
  // operandSize includes cb byte; payload starts at operandOffset+1.
  const payloadStart = operandOffset + 1
  if (payloadStart + 6 * 4 > data.length) return null
  if (operandSize - 1 < 6 * 4) return null

  const borders: TableBorders = {}
  const order: Array<keyof TableBorders> = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  for (let i = 0; i < 6; i++) {
    const style = brc80ToBorderStyle(data, payloadStart + i * 4)
    if (style) {
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
 * ── Round 166：`mergeCharFormatForParagraph` 桶查询的顺序提示 ──────────────
 *
 * 动机：真实 27 份语料实测本函数 **33,702 次/轮**（= 段落数），每次在 `runs`
 * 上做一次二分求「首个 `cpEnd > cpStart` 的下标」，实测 **276,405 次二分迭代/轮**
 * （均 8.2 步/次）。
 *
 * 关键观察：**调用方按文档序逐段处理 ⇒ `cpStart` 单调不减**（段落首尾相接），
 * 而 `runs` 已按 `cpStart`/`cpEnd` 升序且**互不重叠**（见函数内注释）⇒
 * `cpEnd` 单调不减 ⇒ 谓词 `cpEnd > cpStart` 单调 ⇒ **上次求出的下界就是本次
 * 下界的下界**，可从它继续。实测 **99.92% 命中**（33,675/33,702）、
 * 平均只前进 **0.773 步**、**零回退**。
 *
 * 做法：记 `(runs 身份, 上次 cpStart, 上次 lo)`；仅当**同一个 runs 数组**且
 * `cpStart >= 上次 cpStart` 时把上次 `lo` 当起点，随后**有界线性前推**至多
 * `MERGE_HINT_MAX_STEPS` 步（顺序枚举时 0~1 步即命中），超界退化为从当前
 * `lo` 起的二分。
 *
 * 等价性（**提示自证，不依赖调用方守序**）：`hintLo` 是上次 cpStart 的首个
 * `cpEnd > 上次 cpStart` 的下标 ⇒ 对一切 `i < hintLo` 有
 * `runs[i].cpEnd <= 上次 cpStart <= cpStart` ⇒ 这些下标**都不可能**是本次答案，
 * 故起点仍是合法下界。**守卫不成立时起点退回 0，与旧实现逐字节相同；即使某个
 * 调用方乱序调用，也只会退回全量二分而不会算错。** 有界线性前推同理：只在确认
 * `runs[lo].cpEnd <= cpStart` 时才前进，退出时 `lo` 仍是合法下界（命中即返回）。
 * `runs` 构造后只读，故「同一数组对象」即「同一内容」。
 *
 * 隔离实测（真实 33,702 次调用序列 + 27 份真实 runs 回放）：结果逐项相同，
 * 二分迭代 276,405 → **0**。
 */
const MERGE_HINT_MAX_STEPS = 8
let mergeHintRuns: ChpxRun[] | null = null
let mergeHintCpStart = -1
let mergeHintLo = 0

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
  styleFormats?: ReadonlyMap<number, Partial<CharacterFormat>>,
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

  // runs are sorted by cpStart and cpEnd (aCP is strictly increasing), so binary-search
  // the first run that can overlap [cpStart, cpEnd) and stop as soon as runs move past
  // the paragraph. This turns the per-paragraph cost from O(runs) into O(log runs +
  // overlapping), avoiding the O(paragraphs * runs) blow-up on text-heavy documents.
  // Round 166：顺序提示 + 有界线性前推（见上方 MERGE_HINT_* 注释）。
  // 提示只抬高下界，合法性由「hintLo 是上次 cpStart 的首个 cpEnd > cpStart」自证。
  let lo = 0
  if (runs === mergeHintRuns && cpStart >= mergeHintCpStart) lo = mergeHintLo
  const mergeScanLimit = lo + MERGE_HINT_MAX_STEPS
  while (lo < runs.length && runs[lo].cpEnd <= cpStart && lo < mergeScanLimit) lo++
  if (!(lo < runs.length && runs[lo].cpEnd > cpStart)) {
    let hi = runs.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (runs[mid].cpEnd > cpStart) hi = mid
      else lo = mid + 1
    }
  }
  mergeHintRuns = runs
  mergeHintCpStart = cpStart
  mergeHintLo = lo
  for (let ri = lo; ri < runs.length; ri++) {
    const run = runs[ri]
    if (run.cpStart >= cpEnd) break
    const overlapStart = run.cpStart > cpStart ? run.cpStart : cpStart
    const overlapEnd = run.cpEnd < cpEnd ? run.cpEnd : cpEnd
    if (overlapEnd <= overlapStart) continue
    const len = overlapEnd - overlapStart
    const styleFormat = run.istd !== undefined ? styleFormats?.get(run.istd) : undefined
    const format = styleFormat ? { ...styleFormat, ...run.format } : run.format
    if (format.bold) boldCount += len
    if (format.italic) italicCount += len
    if (format.underline) underlineCount += len
    if (format.strikethrough) strikethroughCount += len
    if (format.superscript) superscriptCount += len
    if (format.subscript) subscriptCount += len
    if (format.smallCaps) smallCapsCount += len
    if (format.allCaps) allCapsCount += len
    if (format.fontSize !== undefined) {
      fontSizeSum += format.fontSize * len
      fontSizeCount += len
    }
    if (format.color && !firstColor) firstColor = format.color
    if (format.highlight && !firstHighlight) firstHighlight = format.highlight
    // Font name from font index
    if (run.fontIndex !== undefined && fontNames && !firstFontName) {
      const fontName = fontNames[run.fontIndex]
      if (fontName) firstFontName = fontName
    }
    if (!firstFontName && format.fontName) firstFontName = format.fontName
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

/**
 * ── Round 166：papx run 查询的顺序游标（`createParagraphsWithRealFormats` 专用）──
 *
 * 动机：`createParagraphsWithRealFormats` 对**每个段落**求「包含 `markCp` 的 PAPX
 * run」，实测 **33,702 次/轮**、**429,089 次二分迭代/轮**（均 12.73 步/次；单份
 * 文档 `papxRuns` 最大 27,537 项）。
 *
 * 关键观察：**段落按文档序处理 ⇒ `markCp = cpStart + len` 单调不减**（段落首尾
 * 相接：下一段的 cpStart 就是上一段的 cpEnd），而 `papxRuns` 已按 `cpStart` 升序
 * 且**互不重叠**（`parsePapxRunsFromFkp` 由互不相交的 piece × fc 区间构造；真实
 * 27 份语料实测 39,657 个 run **零重叠**）⇒ **包含 `markCp` 的 run 下标单调不减**
 * ⇒ 上次命中的下标是本次的合法下界。真实序列实测 **99.999% 命中**（33,701.9/
 * 33,702）、平均只前进 **1.166 步**、**零回退**。
 *
 * 做法：记 `(papxRuns 身份, 上次 markCp, 上次命中下标)`；仅当**同一个数组对象**
 * 且 `markCp >= 上次 markCp` 时从上次下标起**有界线性前推**（至多
 * `PAPX_HINT_MAX_STEPS` 步），确认 `cpEnd > markCp` 且 `cpStart <= markCp`
 * （即真正包含）才直接返回；否则退化为从当前下界起的二分。
 *
 * 等价性（**游标自证，不依赖调用方守序**）：命中时 `papxHintLo` 是「包含上次
 * markCp 的 run」下标，而 run 互不重叠 ⇒ 对一切 `i < papxHintLo` 有
 * `papxRuns[i].cpEnd <= 上次 markCp <= markCp` ⇒ 这些下标**都不可能**包含本次
 * markCp，故起点仍是合法下界。**守卫不成立时起点退回 0，与旧实现逐字节相同；
 * 即使某个调用方乱序调用，也只会退回全量二分而不会算错。** 线性前推同理：只在
 * 确认 `papxRuns[lo].cpEnd <= markCp` 时才前进，退出时 `lo` 仍是合法下界。
 * `papxRuns` 构造后只读，故「同一数组对象」即「同一内容」，跨文档身份不同自动失效。
 *
 * 隔离实测（真实 33,702 次调用序列 + 27 份真实 papxRuns 回放）：结果逐项相同，
 * 二分迭代 429,089 → **0**，墙钟 **5.49×**。
 */
const PAPX_HINT_MAX_STEPS = 8
let papxHintRuns: PapxRun[] | null = null
let papxHintMarkCp = -1
let papxHintLo = 0

/**
 * 返回 `papxRuns` 中包含 `markCp` 的 run 下标（无则 -1），语义与改动前的
 * 「[0, n-1] 上二分找包含 run」逐字节等价。
 *
 * 前置条件：`papxRuns` 已按 `cpStart` 升序且互不重叠（`parsePapxRunsFromFkp`
 * 的构造保证；若被破坏，本函数与旧实现都无良定义，但本函数的守卫仍保证
 * 「提示不成立时退化为全量二分」这一安全性）。
 */
export function findPapxRunContaining(papxRuns: PapxRun[], markCp: number): number {
  let lo = 0
  const hi = papxRuns.length - 1
  if (papxRuns === papxHintRuns && markCp >= papxHintMarkCp) {
    lo = papxHintLo
    const lim = lo + PAPX_HINT_MAX_STEPS
    while (lo <= hi && papxRuns[lo].cpEnd <= markCp && lo < lim) lo++
    if (lo <= hi && papxRuns[lo].cpEnd > markCp && papxRuns[lo].cpStart <= markCp) {
      papxHintMarkCp = markCp
      papxHintLo = lo
      return lo
    }
  }
  let a = lo
  let b = hi
  let found = -1
  while (a <= b) {
    const mid = (a + b) >> 1
    const run = papxRuns[mid]
    if (run.cpEnd <= markCp) a = mid + 1
    else if (run.cpStart > markCp) b = mid - 1
    else { found = mid; break }
  }
  papxHintRuns = papxRuns
  papxHintMarkCp = markCp
  papxHintLo = found >= 0 ? found : lo
  return found
}

// ---- Spec-level FKP parsing (MS-DOC §2.4.2 Retrieving Text-related Formatting) ----
//
// Real Word 97+ files do NOT store CHPX/PAPX grpprls inline in the bin tables.
// Instead PlcfBteChpx / PlcfBtePapx map FC ranges to 512-byte Formatted Disk
// Pages (FKPs) inside the WordDocument stream:
//
//   PlcBteChpx = aFC[(n+1)] (4 bytes each) + aPnBteChpx[n] (4 bytes each)
//     → byte size = 8n + 4 → n = (lcb - 4) / 8
//   PnFkpChpx/PnFkpPapx: bits 0-21 = pn; FKP is at pn*512 in WordDocument.
//
//   ChpxFkp (512 bytes): rgfc[crun+1] (4-byte FCs) + rgb[crun] (1 byte each,
//     word offset of CHPX within the FKP; 0 = no CHPX) + crun at byte 511.
//     CHPX at rgb*2: cb (1 byte) + grpprl[cb].
//
//   PapxFkp (512 bytes): rgfc[cpara+1] + rgbx[cpara] (13 bytes each: bOffset
//     1 byte + PHE 12 bytes) + cpara at byte 511. PapxInFkp at bOffset*2:
//     cb (1 byte); if cb != 0 the payload is 2*cb-1 bytes (istd + grpprl);
//     if cb == 0 a second byte cb' follows and the payload is 2*cb' bytes.
//
// FCs are byte offsets in the WordDocument stream; they are converted to CPs
// via the piece table (each piece maps [fcStart, fcEnd) ↔ [cpStart, cpEnd)
// with 1 or 2 bytes per character depending on fCompressed).

/** Minimal piece-table info needed to convert FCs to CPs. */
export interface PieceFcRange {
  cpStart: number
  cpEnd: number
  /** Byte offset of the piece's first character in the WordDocument stream. */
  fcStart: number
  /** true = 8-bit (1 byte/char), false = UTF-16LE (2 bytes/char). */
  compressed: boolean
}

/** Read the bin table (PlcBteChpx/PlcBtePapx) and return FKP page numbers with their FC ranges. */
function parseBinTable(
  tableData: Uint8Array,
  fc: number,
  lcb: number,
): Array<{ fcStart: number; fcEnd: number; pn: number }> {
  if (lcb < 12 || fc < 0 || fc + lcb > tableData.length) return []
  // n = (lcb - 4) / 8; tolerate trailing padding by flooring.
  const n = Math.floor((lcb - 4) / 8)
  if (n <= 0 || n > 100000) return []

  const entries: Array<{ fcStart: number; fcEnd: number; pn: number }> = []
  for (let i = 0; i < n; i++) {
    const fcStart = readUint32(tableData, fc + i * 4)
    const fcEnd = readUint32(tableData, fc + (i + 1) * 4)
    if (fcEnd <= fcStart) return [] // aFC must be strictly increasing
    const pnRaw = readUint32(tableData, fc + (n + 1) * 4 + i * 4)
    const pn = pnRaw & 0x3FFFFF
    entries.push({ fcStart, fcEnd, pn })
  }
  return entries
}

/**
 * Parse CHPX runs the spec-level way: bin table → ChpxFkp pages → grpprls,
 * FC ranges converted to CPs via the piece table.
 *
 * @param tableData - The table stream (0Table/1Table).
 * @param wordDocData - The WordDocument stream (FKPs live here).
 * @param fc/lcb - fcPlcfBteChpx / lcbPlcfBteChpx from the FIB.
 * @param pieces - Full piece table for FC→CP conversion.
 */
export function parseChpxRunsFromFkp(
  tableData: Uint8Array,
  wordDocData: Uint8Array,
  fc: number,
  lcb: number,
  pieces: PieceFcRange[],
): ChpxRun[] {
  if (pieces.length === 0) return []
  const bins = parseBinTable(tableData, fc, lcb)
  if (bins.length === 0) return []

  const runs: ChpxRun[] = []
  for (const bin of bins) {
    const base = bin.pn * 512
    if (base + 512 > wordDocData.length) continue
    const crun = wordDocData[base + 511]
    // rgfc needs (crun+1)*4 bytes and rgb needs crun bytes; all must fit
    // before the crun byte itself.
    if (crun === 0 || (crun + 1) * 4 + crun > 511) continue

    for (let i = 0; i < crun; i++) {
      const fcStart = readUint32(wordDocData, base + i * 4)
      const fcEnd = readUint32(wordDocData, base + (i + 1) * 4)
      if (fcEnd <= fcStart) continue
      const rgb = wordDocData[base + (crun + 1) * 4 + i]
      if (rgb === 0) continue // no CHPX → inherits from paragraph style
      const chpxOffset = base + rgb * 2
      if (chpxOffset >= base + 511) continue
      const cb = wordDocData[chpxOffset]
      if (cb === 0 || chpxOffset + 1 + cb > base + 512) continue

      const { format, fontIndex, revision, isSpecial, fcPic, istd } =
        parseChpxGrpprlWithFont(wordDocData, chpxOffset + 1, cb)
      if (Object.keys(format).length === 0 && fontIndex === undefined &&
          !revision && !isSpecial && fcPic === undefined && istd === undefined) continue

      for (const p of pieces) {
        const bytesPerChar = p.compressed ? 1 : 2
        const pieceFcEnd = p.fcStart + (p.cpEnd - p.cpStart) * bytesPerChar
        const s = Math.max(fcStart, p.fcStart)
        const e = Math.min(fcEnd, pieceFcEnd)
        if (e <= s) continue
        const cpS = p.cpStart + Math.floor((s - p.fcStart) / bytesPerChar)
        const cpE = p.cpStart + Math.ceil((e - p.fcStart) / bytesPerChar)
        if (cpE > cpS) {
          const run: ChpxRun = { cpStart: cpS, cpEnd: cpE, format, fontIndex, revision }
          if (isSpecial) run.isSpecial = true
          if (fcPic !== undefined) run.fcPic = fcPic
          if (istd !== undefined) run.istd = istd
          runs.push(run)
        }
      }
    }
  }

  runs.sort((a, b) => a.cpStart - b.cpStart || a.cpEnd - b.cpEnd)
  return runs
}

/**
 * Parse PAPX runs the spec-level way: bin table → PapxFkp pages → grpprls,
 * FC ranges converted to CPs via the piece table.
 */
export function parsePapxRunsFromFkp(
  tableData: Uint8Array,
  wordDocData: Uint8Array,
  fc: number,
  lcb: number,
  pieces: PieceFcRange[],
): PapxRun[] {
  if (pieces.length === 0) return []
  const bins = parseBinTable(tableData, fc, lcb)
  if (bins.length === 0) return []

  const runs: PapxRun[] = []
  for (const bin of bins) {
    const base = bin.pn * 512
    if (base + 512 > wordDocData.length) continue
    const cpara = wordDocData[base + 511]
    // rgfc: (cpara+1)*4 bytes; rgbx (BxPap): 13 bytes each.
    if (cpara === 0 || (cpara + 1) * 4 + cpara * 13 > 511) continue

    for (let i = 0; i < cpara; i++) {
      const fcStart = readUint32(wordDocData, base + i * 4)
      const fcEnd = readUint32(wordDocData, base + (i + 1) * 4)
      if (fcEnd <= fcStart) continue
      const bOffset = wordDocData[base + (cpara + 1) * 4 + i * 13]
      if (bOffset === 0) continue // no PAPX → style defaults
      let papxOffset = base + bOffset * 2
      if (papxOffset >= base + 511) continue

      // PapxInFkp: cb (1 byte). cb != 0 → payload 2*cb-1 bytes; cb == 0 →
      // read cb' (next byte), payload 2*cb' bytes. Payload = istd(2) + grpprl.
      const cb = wordDocData[papxOffset]
      let payloadLen: number
      if (cb === 0) {
        const cbPrime = wordDocData[papxOffset + 1]
        payloadLen = cbPrime * 2
        papxOffset += 2
      } else {
        payloadLen = cb * 2 - 1
        papxOffset += 1
      }
      if (payloadLen < 2 || papxOffset + payloadLen > base + 512) continue

      const istd = readUint16(wordDocData, papxOffset)
      const grpprlLen = payloadLen - 2
      const { format, ilvl, ilst, ilfo, table } =
        parsePapxGrpprl(wordDocData, papxOffset + 2, grpprlLen)

      for (const p of pieces) {
        const bytesPerChar = p.compressed ? 1 : 2
        const pieceFcEnd = p.fcStart + (p.cpEnd - p.cpStart) * bytesPerChar
        const s = Math.max(fcStart, p.fcStart)
        const e = Math.min(fcEnd, pieceFcEnd)
        if (e <= s) continue
        const cpS = p.cpStart + Math.floor((s - p.fcStart) / bytesPerChar)
        const cpE = p.cpStart + Math.ceil((e - p.fcStart) / bytesPerChar)
        if (cpE > cpS) {
          const run: PapxRun = { cpStart: cpS, cpEnd: cpE, format, istd }
          if (ilvl !== undefined) run.ilvl = ilvl
          if (ilst !== undefined) run.ilst = ilst
          if (ilfo !== undefined) run.ilfo = ilfo
          if (table) run.table = table
          runs.push(run)
        }
      }
    }
  }

  runs.sort((a, b) => a.cpStart - b.cpStart || a.cpEnd - b.cpEnd)
  return runs
}
