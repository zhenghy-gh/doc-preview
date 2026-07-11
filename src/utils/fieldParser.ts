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

/**
 * Document field values extracted from PlcfFld.
 * These provide metadata that may supplement or override SummaryInformation.
 */
export interface DocumentFields {
  author?: string
  title?: string
  subject?: string
  keywords?: string
  comments?: string
  lastSavedBy?: string
  createDate?: string
  lastSavedDate?: string
  printDate?: string
  date?: string
  time?: string
  revisionNumber?: string
}

/**
 * 页码域类型（通过 instruction 文本匹配识别）。
 *
 * Word 中这些域没有专门的 flt 值，通过 instruction 文本中的关键字区分：
 * - 'page'         : PAGE 域，当前页码
 * - 'numPages'     : NUMPAGES 域，总页数
 * - 'section'      : SECTION 域，当前节编号
 * - 'sectionPages' : SECTIONPAGES 域，当前节页数
 */
export type PageFieldType = 'page' | 'numPages' | 'section' | 'sectionPages'

/**
 * 单个页码域的解析结果。
 *
 * 对应文档中一个 PAGE/NUMPAGES/SECTION/SECTIONPAGES 域的范围 [cpStart, cpEnd)，
 * 包含域指令文本和域结果（Word 上次更新域时计算的值）。
 */
export interface PageFieldInfo {
  /** 域起始 CP（包含 0x13 字符位置） */
  cpStart: number
  /** 域结束 CP（exclusive，包含 0x15 字符位置） */
  cpEnd: number
  /** 域类型 */
  type: PageFieldType
  /** 域指令文本（如 "PAGE"、"NUMPAGES \* MERGEFORMAT"） */
  instruction: string
  /** 域结果文本（如 "1"、"5"） */
  result: string
}

/**
 * 交叉引用类型（通过 instruction 文本匹配识别）。
 *
 * - 'ref'     : REF 域，引用书签内容、图表/表格编号等
 * - 'noteref' : NOTEREF 域，专门引用脚注或尾注标记
 */
export type CrossReferenceType = 'ref' | 'noteref'

/**
 * 单个交叉引用域的解析结果。
 *
 * 对应文档中一个 REF/NOTEREF 域，包含被引用的书签名称、域开关和域结果。
 */
export interface CrossReferenceInfo {
  /** 域起始 CP（包含 0x13 字符位置） */
  cpStart: number
  /** 域结束 CP（exclusive，包含 0x15 字符位置） */
  cpEnd: number
  /** 域类型 */
  type: CrossReferenceType
  /** 域指令文本（原始） */
  instruction: string
  /** 被引用的书签名称（instruction 中的第一个参数） */
  targetBookmarkName: string
  /** 域结果文本（如 "图 1"、"表 2"、页码等） */
  result: string
  /** 域开关标志集合（如 ['\\h'] 表示超链接形式） */
  switches: string[]
}

/** Field type constants (MS-DOC §2.8.18). */
const FLD_AUTHOR = 1
const FLD_TITLE = 5
const FLD_SUBJECT = 7
const FLD_KEYWORDS = 8
const FLD_COMMENTS = 9
const FLD_LASTSAVEDBY = 11
const FLD_CREATEDATE = 13
const FLD_LASTSAVEDATE = 15
const FLD_PRINTEDATE = 16
const FLD_DATE = 29
const FLD_TIME = 30
const FLD_REVNUM = 42

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

/**
 * Extract document metadata fields from the parsed field table.
 *
 * These fields (AUTHOR, TITLE, DATE, etc.) often contain the "live" values
 * that Word displays, which may differ from SummaryInformation properties.
 *
 * @param fldEntries - Parsed field entries from parsePlcfFld.
 * @param text - The document text (UTF-16LE decoded).
 * @param textBytes - The raw document text bytes for instruction extraction.
 * @returns DocumentFields object with extracted values.
 */
export function extractDocumentFields(
  fldEntries: Array<{ cp: number; ch: number; flt: number }>,
  text: string,
  textBytes?: Uint8Array,
): DocumentFields {
  const fields: DocumentFields = {}
  const allFields = extractAllFields(fldEntries, text, textBytes)

  for (const field of allFields) {
    const result = field.result.trim()
    if (!result) continue

    switch (field.flt) {
      case FLD_AUTHOR:
        if (!fields.author) fields.author = result
        break
      case FLD_TITLE:
        if (!fields.title) fields.title = result
        break
      case FLD_SUBJECT:
        if (!fields.subject) fields.subject = result
        break
      case FLD_KEYWORDS:
        if (!fields.keywords) fields.keywords = result
        break
      case FLD_COMMENTS:
        if (!fields.comments) fields.comments = result
        break
      case FLD_LASTSAVEDBY:
        if (!fields.lastSavedBy) fields.lastSavedBy = result
        break
      case FLD_CREATEDATE:
        if (!fields.createDate) fields.createDate = result
        break
      case FLD_LASTSAVEDATE:
        if (!fields.lastSavedDate) fields.lastSavedDate = result
        break
      case FLD_PRINTEDATE:
        if (!fields.printDate) fields.printDate = result
        break
      case FLD_DATE:
        if (!fields.date) fields.date = result
        break
      case FLD_TIME:
        if (!fields.time) fields.time = result
        break
      case FLD_REVNUM:
        if (!fields.revisionNumber) fields.revisionNumber = result
        break
    }
  }

  return fields
}

/**
 * 页码域关键字 → 域类型映射。
 *
 * instruction 文本的第一个单词（大小写不敏感）用于识别域类型。
 * 注意：SECTIONPAGES 必须在 SECTION 之前匹配，避免误判。
 */
const PAGE_FIELD_KEYWORDS: Array<{ keyword: string; type: PageFieldType }> = [
  { keyword: 'SECTIONPAGES', type: 'sectionPages' },
  { keyword: 'NUMPAGES', type: 'numPages' },
  { keyword: 'PAGE', type: 'page' },
  { keyword: 'SECTION', type: 'section' },
]

/**
 * 从已解析的域表中提取页码域（PAGE / NUMPAGES / SECTION / SECTIONPAGES）。
 *
 * Word 中页码域没有专门的 flt 值，通过 instruction 文本中的关键字识别。
 * 域的 result 字段包含 Word 上次更新域时计算的值（如 "1"、"5"），
 * 可用于在预览中显示页码。
 *
 * @param fldEntries - 已解析的 PlcfFld 条目
 * @param text - 文档文本（UTF-16LE 解码后）
 * @param textBytes - 原始文档文本字节（用于 instruction 提取）
 * @returns 页码域信息数组
 */
export function extractPageFields(
  fldEntries: Array<{ cp: number; ch: number; flt: number }>,
  text: string,
  textBytes?: Uint8Array,
): PageFieldInfo[] {
  const allFields = extractAllFields(fldEntries, text, textBytes)
  const pageFields: PageFieldInfo[] = []

  for (const field of allFields) {
    const instruction = field.instruction.trim()
    if (!instruction) continue

    // 取 instruction 的第一个单词作为关键字
    const firstWordMatch = instruction.match(/^(\S+)/)
    if (!firstWordMatch) continue
    const firstWord = firstWordMatch[1].toUpperCase()

    for (const { keyword, type } of PAGE_FIELD_KEYWORDS) {
      if (firstWord === keyword) {
        pageFields.push({
          cpStart: field.cpStart,
          cpEnd: field.cpEnd,
          type,
          instruction,
          result: field.result,
        })
        break
      }
    }
  }

  return pageFields
}

/**
 * 交叉引用域关键字 → 域类型映射。
 *
 * instruction 文本的第一个单词（大小写不敏感）用于识别域类型。
 * 注意：NOTEREF 必须在 REF 之前匹配（虽然此处用全词匹配，但保持顺序以防未来扩展）。
 */
const CROSS_REFERENCE_KEYWORDS: Array<{ keyword: string; type: CrossReferenceType }> = [
  { keyword: 'NOTEREF', type: 'noteref' },
  { keyword: 'REF', type: 'ref' },
]

/**
 * 从 instruction 文本中解析被引用的书签名称和域开关。
 *
 * instruction 格式：
 *   REF <bookmarkName> [\<switch>...]
 *   NOTEREF <bookmarkName> [\<switch>...]
 *
 * 书签名称是第一个关键字之后的第一个 token，开关以 `\` 开头。
 *
 * @param instruction - 域指令文本
 * @returns 包含 targetBookmarkName 和 switches 的对象
 */
function parseRefInstruction(instruction: string): { targetBookmarkName: string; switches: string[] } {
  const tokens = instruction.trim().split(/\s+/).filter(t => t.length > 0)
  const switches: string[] = []
  let targetBookmarkName = ''

  // tokens[0] 是 REF/NOTEREF 关键字，从 tokens[1] 开始
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.startsWith('\\')) {
      switches.push(token)
    } else if (!targetBookmarkName) {
      // 第一个非开关 token 是书签名称
      // 处理可能的引号包裹（虽然 REF 域通常不用引号，但保持健壮性）
      targetBookmarkName = token.replace(/^"|"$/g, '')
    } else {
      // 后续非开关 token 可能是书签名称的一部分（罕见），追加
      targetBookmarkName += ' ' + token.replace(/^"|"$/g, '')
    }
  }

  return { targetBookmarkName, switches }
}

/**
 * 从已解析的域表中提取交叉引用域（REF / NOTEREF）。
 *
 * Word 中 REF 域没有专门的 flt 值，通过 instruction 文本中的关键字识别。
 * 域的 result 字段包含 Word 上次更新域时计算的引用文本（如 "图 1"、"表 2"、页码等）。
 *
 * 常见用法：
 * - `REF _Ref12345 \h` — 引用自动书签（如标题编号），\h 表示超链接
 * - `REF FigRef \n` — 引用段落编号
 * - `NOTEREF FootnoteRef` — 引用脚注标记
 *
 * @param fldEntries - 已解析的 PlcfFld 条目
 * @param text - 文档文本（UTF-16LE 解码后）
 * @param textBytes - 原始文档文本字节（用于 instruction 提取）
 * @returns 交叉引用域信息数组
 */
export function extractCrossReferences(
  fldEntries: Array<{ cp: number; ch: number; flt: number }>,
  text: string,
  textBytes?: Uint8Array,
): CrossReferenceInfo[] {
  const allFields = extractAllFields(fldEntries, text, textBytes)
  const crossRefs: CrossReferenceInfo[] = []

  for (const field of allFields) {
    const instruction = field.instruction.trim()
    if (!instruction) continue

    // 取 instruction 的第一个单词作为关键字
    const firstWordMatch = instruction.match(/^(\S+)/)
    if (!firstWordMatch) continue
    const firstWord = firstWordMatch[1].toUpperCase()

    for (const { keyword, type } of CROSS_REFERENCE_KEYWORDS) {
      if (firstWord === keyword) {
        const { targetBookmarkName, switches } = parseRefInstruction(instruction)
        // 跳过没有目标书签名的 REF 域（无效引用）
        if (!targetBookmarkName) break

        crossRefs.push({
          cpStart: field.cpStart,
          cpEnd: field.cpEnd,
          type,
          instruction,
          targetBookmarkName,
          result: field.result,
          switches,
        })
        break
      }
    }
  }

  return crossRefs
}