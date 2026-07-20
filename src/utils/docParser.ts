import { logger, enableDebugMode } from './logger'

/**
 * 解析进度阶段标识
 */
export type ParseProgressStage =
  | 'verifying'
  | 'parsing_fib'
  | 'parsing_clx'
  | 'parsing_formats'
  | 'parsing_fields'
  | 'parsing_shapes'
  | 'building_paragraphs'
  | 'extracting_properties'
  | 'extracting_images'
  | 'finalizing'

/**
 * 解析进度回调
 * @param stage 阶段标识
 * @param percent 进度百分比 0-100
 */
export type ProgressCallback = (stage: ParseProgressStage, percent: number) => void

export { enableDebugMode }

import { OleParser } from './oleParser'
import type { StreamData, DirectoryEntry } from './oleParser'

import { parseFib } from './fibParser'
import type { FibData, RgCcp } from './fibParser'
import { isTableRowText } from './tableText'
import { extractImagesFromStream, imagesToDataUrls } from './imageExtractor'
import { extractPicturesFromDataStream, parsePicfAt } from './pictureParser'
import type { ParsedPicture } from './pictureParser'
import { parseChpxRuns, parsePapxRuns, mergeCharFormatForParagraph } from './formatParser'
import type { ChpxRun, PapxRun } from './formatParser'
import { parseStylesheet, getHeadingLevel, detectStyleSet } from './styleParser'
import type { StyleDefinition, StyleSetInfo } from './styleParser'
import { parseFontTable } from './fontParser'
import { parseListTable, getListFormat, getListFormatFromLfo, parsePlcfLfo } from './listParser'
import type { ListEntry, LfoEntry } from './listParser'
import { parsePlcfFld, extractHyperlinks, extractAllFields, extractDocumentFields, extractPageFields, extractCrossReferences, TocEntry, IndexEntry } from './fieldParser'
import type { FieldRange, DocumentFields, PageFieldInfo, CrossReferenceInfo } from './fieldParser'
import { parseSummaryInformation, parseDocumentSummaryInformation, hasProperties } from './propertyParser'
import type { DocumentProperties } from './propertyParser'
import { parseDop } from './dopParser'
import type { DopData } from './dopParser'
import type { DocumentStories, CharacterFormat, DocumentFlags, RevisionMark, BookmarkRange, SectionInfo, PageFieldRange, CrossReferenceRange } from './docFormat'
import { parseSttbfRMark } from './revisionParser'
import { extractBookmarks } from './bookmarkParser'
import { extractSections } from './sectionParser'
import { extractShapesFromDataStream, extractShapesFromWordDocumentStream } from './shapeParser'
import type { ShapeInfo } from './shapeParser'
import { extractEquationsFromDirectory, extractEquationsFromWordDocumentStream } from './equationParser'
import type { EquationInfo } from './equationParser'
import { extractChartsFromDirectory, extractChartsFromWordDocumentStream } from './chartParser'
import type { ChartInfo } from './chartParser'
import { extractWordArtFromDirectory, extractWordArtFromDrawingData } from './wordArtParser'
import type { WordArtInfo } from './wordArtParser'
import { parsePlcfHdd, splitHeaderText, splitHeaderTextHeuristic, splitHeaderTextWithImages } from './headerFooterParser'
import type { HeaderFooterPartType, HeaderFooterPartContent } from './docFormat'

// ---- DocParser ----

/** Default max bytes to scan in a WordDocument stream (10MB). */
const DEFAULT_MAX_SCAN_BYTES = 10 * 1024 * 1024

/**
 * Parsed piece metadata from a PlcPcd. Does not hold the extracted text —
 * callers decide how to slice the byte range (whole piece, or a sub-range
 * when splitting across story boundaries) and call extractTextFromRange.
 */
interface Piece {
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

/**
 * Text bucketed by story. Word stores all stories in one continuous
 * character stream; we split it back out using FibRgLw's rgCcp.
 */
interface StoryText {
  /** Main document body (ccpText). */
  main: string
  /** Footnotes (ccpFtn). */
  footnotes: string
  /** Headers and footers (ccpHdd). */
  headers: string
  /** Endnotes (ccpEdn). */
  endnotes: string
  /** Comments / annotations (ccpAtn). */
  comments: string
  /** Text boxes (ccpTxbx + ccpHdrTxbx). */
  textboxes: string
}

/**
 * Per-character CHPX association produced by parseClxWithStories. For each
 * story, lists pieces as (start, end, chpxIndex?) — chpxIndex is set when the
 * piece's fChp flag is on. Used to apply piece-level CHP at the right cp range.
 */
interface StoryPieceMap {
  main: Array<{ start: number; end: number; chpxIndex?: number }>
  footnotes: Array<{ start: number; end: number; chpxIndex?: number }>
  headers: Array<{ start: number; end: number; chpxIndex?: number }>
  endnotes: Array<{ start: number; end: number; chpxIndex?: number }>
  comments: Array<{ start: number; end: number; chpxIndex?: number }>
  textboxes: Array<{ start: number; end: number; chpxIndex?: number }>
}

/**
 * Synchronous .doc (OLE2/CFB) file parser.
 *
 * Extracts plain text and infers formatting (font size, bold, alignment, list type).
 * Format detection is heuristic-based since the parser does not read the full
 * Word CHP/PAP format tables — common patterns (short bold Chinese lines, etc.)
 * are mapped to likely document structure.
 */
export class DocParser {
  private buffer: ArrayBuffer
  private ole: OleParser
  private text: string = ''
  /** Max bytes to scan in the WordDocument stream (configurable). */
  maxScanBytes: number

  /**
   * @param buffer - The .doc file as ArrayBuffer.
   * @param maxScanBytes - Max bytes to scan. Default: 10MB. Pass a smaller value for memory-constrained environments.
   */
  constructor(buffer: ArrayBuffer, maxScanBytes?: number) {
    this.buffer = buffer
    this.ole = new OleParser(buffer)
    this.maxScanBytes = maxScanBytes ?? DEFAULT_MAX_SCAN_BYTES
    logger.info(`初始化解析器，文件大小: ${buffer.byteLength} bytes, 扫描上限: ${this.maxScanBytes}`)
  }

  // ==================== Public API ====================

  /**
   * Parse the document and return plain text only.
   * Uses FIB to locate the text stream; falls back to whole-file scanning.
   * @returns Parse result with `{ text, success, error? }`.
   */
  parse(): { text: string; success: boolean; error?: string } {
    try {
      logger.info('开始解析 DOC 文件')

      if (!this.ole.isOleFile()) {
        const error = this.ole.getFormatErrorString()
        logger.error(error)
        return { text: '', success: false, error }
      }

      const header = this.ole.parseHeader()
      const fat = this.ole.getFatSectors(header)
      const directory = this.ole.getDirectorySectors(header, fat)
      const wordDocumentStream = this.ole.findWordDocumentStream(directory)

      if (!wordDocumentStream) {
        logger.error('未找到 WordDocument 流，尝试直接扫描文件内容')
        const fallbackText = this.extractTextFromFullFile()
        if (fallbackText.length > 0) {
          return { text: fallbackText, success: true }
        }
        return { text: '', success: false, error: '未找到 WordDocument 流' }
      }

      this.text = this.extractTextWithFib(wordDocumentStream, directory)
      if (this.text.length === 0) {
        this.text = this.extractTextSimple(wordDocumentStream.data)
      }

      if (this.text.length === 0) {
        return { text: '', success: false, error: '文档内容为空' }
      }
      return { text: this.text, success: true }
    } catch (error) {
      const message = error instanceof Error ? `${error.message}\n${error.stack}` : '未知错误'
      logger.error('解析过程发生异常', message)
      return { text: '', success: false, error: `解析失败: ${error instanceof Error ? error.message : '未知错误'}` }
    }
  }

  /**
   * Parse the document and return formatted paragraphs (with inferred styles).
   * @returns Parse result with `{ document, text, success, error? }`.
   *   `document.paragraphs` is an array of `{ text, charFormat, paraFormat }`.
   */
  parseWithFormat(onProgress?: ProgressCallback): { success: boolean; document?: any; text?: string; error?: string } {
    try {
      logger.info('开始解析带格式的 DOC 文件')
      onProgress?.('verifying', 5)

      if (!this.ole.isOleFile()) {
        const error = this.ole.getFormatErrorString()
        return { success: false, error }
      }

      onProgress?.('parsing_fib', 15)
      const header = this.ole.parseHeader()
      const fat = this.ole.getFatSectors(header)
      const directory = this.ole.getDirectorySectors(header, fat)
      const wordDocumentStream = this.ole.findWordDocumentStream(directory)

      if (!wordDocumentStream) {
        const fallbackText = this.extractTextFromFullFile()
        if (fallbackText.length > 0) {
          const paragraphs = this.createFormattedParagraphsFromText(fallbackText)
          return { success: true, document: { paragraphs }, text: fallbackText }
        }
        return { success: false, error: '未找到 WordDocument 流' }
      }

      onProgress?.('parsing_clx', 25)
      const extracted = this.extractFormattedText(wordDocumentStream, directory, onProgress)

      if (extracted.paragraphs.length === 0) {
        const fallbackText = this.extractTextSimple(wordDocumentStream.data)
        if (fallbackText.length > 0) {
          return { success: true, text: fallbackText }
        }
        return { success: false, error: '文档内容为空' }
      }

      onProgress?.('building_paragraphs', 80)
      const plainText = extracted.paragraphs.map(p => p.text).join('\n\n')
      const document: any = { paragraphs: extracted.paragraphs }
      if (extracted.stories) document.stories = extracted.stories
      if (extracted.hyperlinks && extracted.hyperlinks.length > 0) {
        document.hyperlinks = extracted.hyperlinks
      }
      if (extracted.tocEntries && extracted.tocEntries.length > 0) {
        document.toc = extracted.tocEntries
      }
      if (extracted.revisions && extracted.revisions.length > 0) {
        document.revisions = extracted.revisions
      }
      if (extracted.documentFields && Object.keys(extracted.documentFields).length > 0) {
        document.documentFields = extracted.documentFields
      }
      if (extracted.bookmarks && extracted.bookmarks.length > 0) {
        document.bookmarks = extracted.bookmarks
      }
      if (extracted.sections && extracted.sections.length > 0) {
        document.sections = extracted.sections
      }
      if (extracted.pageFields && extracted.pageFields.length > 0) {
        document.pageFields = extracted.pageFields as PageFieldRange[]
      }
      if (extracted.crossReferences && extracted.crossReferences.length > 0) {
        document.crossReferences = extracted.crossReferences as CrossReferenceRange[]
      }
      if (extracted.shapes && extracted.shapes.length > 0) {
        document.shapes = extracted.shapes
      }
      if (extracted.equations && extracted.equations.length > 0) {
        document.equations = extracted.equations
      }
      if (extracted.indexEntries && extracted.indexEntries.length > 0) {
        document.index = extracted.indexEntries
      }
      if (extracted.styleSet) {
        document.styleSet = extracted.styleSet
      }

      onProgress?.('extracting_properties', 85)
      // Extract document properties from SummaryInformation stream
      const props = this.extractProperties(directory)
      if (props && hasProperties(props)) {
        document.properties = props
      }

      // Extract DOP (Document Properties) flags from the table stream.
      // Provides facing-pages / title-page / track-changes / footnote flags.
      const fib = parseFib(wordDocumentStream.data)
      if (fib) {
        const dop = this.extractDop(fib, directory)
        if (dop) {
          const docFlags: DocumentFlags = {}
          if (dop.facingPages) docFlags.facingPages = true
          if (dop.titlePage) docFlags.titlePage = true
          if (dop.pmhMain) docFlags.pmhMain = true
          if (dop.trackChanges) docFlags.trackChanges = true
          if (dop.ftnRestart) docFlags.ftnRestart = true
          if (dop.ftnEnd) docFlags.ftnEnd = true
          if (dop.ftnAtEnd) docFlags.ftnAtEnd = true
          if (Object.keys(docFlags).length > 0) {
            document.docFlags = docFlags
          }
        }
        // Surface the detected Word version (from nFib) for UI display
        if (fib.wordVersion && fib.wordVersion !== 'unknown') {
          document.wordVersion = fib.wordVersion
        }
      }

      onProgress?.('extracting_images', 92)
      // Extract embedded images (PNG/JPEG/BMP/GIF) from the Data stream,
      // falling back to the WordDocument stream. Attached as data URLs.
      const images = this.extractImages(directory, wordDocumentStream.data)
      if (images.length > 0) document.images = images

      // Extract structured pictures (PICF-based with dimensions) via CHPX fcPic
      const chpxRunsForPics = extracted.chpxRuns || []
      const pictures = this.extractPictures(directory, chpxRunsForPics)
      if (pictures.length > 0) document.pictures = pictures

      onProgress?.('finalizing', 100)
      return { success: true, document, text: plainText }
    } catch (error) {
      const message = error instanceof Error ? `${error.message}\n${error.stack}` : '未知错误'
      logger.error('解析过程发生异常', message)
      return { success: false, error: `解析失败: ${error instanceof Error ? error.message : '未知错误'}` }
    }
  }

  // ==================== Text extraction ====================

  private extractTextWithFib(wordStream: StreamData, directory: DirectoryEntry[]): string {
    const data = wordStream.data
    if (data.length < 32) return ''

    const fib = parseFib(data)
    if (!fib) return this.extractTextSimple(data)

    const clxData = this.readClxData(fib, data, directory)
    if (clxData) {
      // Prefer story-split extraction: it keeps header/footer/footnote text
      // out of the main body when rgCcp is populated.
      if (fib.rgCcp.ccpText > 0) {
        const result = this.parseClxWithStories(clxData, data, fib.rgCcp)
        if (result && result.stories.main.trim().length > 0) {
          return result.stories.main.trim()
        }
      }

      // Fall back to whole-document concatenation.
      const textFromClx = this.parseClx(clxData, data)
      if (textFromClx.length > 0) return textFromClx
    }

    if (fib.fcMin === 0 || fib.fcMac === 0) {
      // textutil files have unreliable fComplex — ignore it and lean toward UTF-16
      const suggestedComplex = fib.isTextutil ? false : fib.fComplex
      return this.extractTextWithAutoDetect(data, suggestedComplex)
    }

    return this.extractTextSimple(data, { fcMin: fib.fcMin, fComplex: fib.fComplex })
  }

  /**
   * Read the CLX blob that `fib.fcClx`/`lcbClx` points at.
   *
   * Per MS-DOC, the CLX lives in the table stream selected by `fWhichTblStm`
   * (0 → 0Table, 1 → 1Table), not in the WordDocument stream. We try the
   * correct table stream first, then fall back to the WordDocument stream for
   * files where the table stream is missing or the FIB points elsewhere — this
   * preserves the previous behavior for those edge cases.
   */
  private readClxData(
    fib: FibData,
    wordDocData: Uint8Array,
    directory: DirectoryEntry[],
  ): Uint8Array | null {
    if (fib.lcbClx <= 0) return null

    const which: 0 | 1 = fib.fWhichTblStm ? 1 : 0
    const tableStream = this.ole.findTableStream(directory, which)
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

    return null
  }

  /**
   * Read the table stream (0Table or 1Table) data.
   * Returns the stream data, or null if not found.
   */
  private readTableStream(
    fib: FibData,
    directory: DirectoryEntry[],
  ): Uint8Array | null {
    const which: 0 | 1 = fib.fWhichTblStm ? 1 : 0
    const tableStream = this.ole.findTableStream(directory, which)
    if (tableStream && tableStream.data.length > 0) {
      return tableStream.data
    }
    return null
  }

  private extractTextWithAutoDetect(data: Uint8Array, suggestedComplex: boolean): string {
    const binaryDetect = this.detectEncodingFromBinary(data)
    if (binaryDetect !== null) {
      return this.extractTextSimple(data, { fcMin: 0, fComplex: binaryDetect })
    }

    const text8 = this.extractTextSimple(data, { fcMin: 0, fComplex: true })
    const text16 = this.extractTextSimple(data, { fcMin: 0, fComplex: false })
    const score8 = this.scorePlainText(text8)
    const score16 = this.scorePlainText(text16)
    logger.log(`自动检测编码评分 - 8-bit: ${score8}, UTF-16LE: ${score16}`)

    if (suggestedComplex) {
      return score8 >= score16 * 0.4 ? text8 : text16
    }
    return score16 >= score8 * 0.4 ? text16 : text8
  }

  /**
   * Common "junk" / binary-noise characters that appear in FIB headers
   * when 8-bit text is misinterpreted as UTF-16LE or vice versa.
   * Extracted to a constant to avoid regex duplication.
   */
  private static readonly JUNK_CHAR_CLASS = '伀倀藠俹醫蠀耀頀琀餀栀儀騀甀攀爀愀氀攀漀漀渀'
  private static readonly EXTRA_JUNK_CHARS = '伇倈俼俿儀儜厬唀唕嘀噀圀堀嬀崀崜帀幀弰彀戀戀'

  /**
   * Check whether a UTF-16 code unit is a printable character that should
   * be preserved in extracted text. Uses a "blocklist + range" strategy:
   * accept most Unicode printable characters, only reject control chars
   * and surrogate halves.
   */
  private static isValidPrintableChar(charCode: number): boolean {
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
  private static readonly HIGH_BYTE_MAP: (string | null)[] = (() => {
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

  /**
   * Scan UTF-16LE bytes and yield characters into a buffer.
   * Returns the number of bytes consumed (the loop advances i by this - 1).
   * Shared between extractTextSimple and extractParagraphsWithFormat.
   */
  private static scanUtf16Char(
    data: Uint8Array, i: number, maxBytes: number,
  ): { ch: string; advance: number } | null {
    if (i + 2 > maxBytes) return null
    const byte1 = data[i]; const byte2 = data[i + 1]

    // 0x0D 0x00 = paragraph break (caller handles)
    if (byte1 === 0x0D && byte2 === 0x00) return null
    // 0x0A 0x00 = line feed, skip
    if (byte1 === 0x0A && byte2 === 0x00) return { ch: '', advance: 2 }
    // 0x09 0x00 = tab, keep it for table rendering
    if (byte1 === 0x09 && byte2 === 0x00) return { ch: '\t', advance: 2 }

    const charCode = (byte2 << 8) | byte1

    // ASCII printable range (byte2 === 0x00)
    if (byte2 === 0x00 && byte1 >= 0x20 && byte1 <= 0x7E) {
      return { ch: String.fromCharCode(byte1), advance: 2 }
    }

    // CJK Unified Ideographs + Extension A
    if (charCode >= 0x3400 && charCode <= 0x9FFF) {
      return { ch: String.fromCharCode(charCode), advance: 2 }
    }

    // General printable Unicode check (punctuation, symbols, letters, etc.)
    if (DocParser.isValidPrintableChar(charCode)) {
      return { ch: String.fromCharCode(charCode), advance: 2 }
    }

    return null
  }

  private extractTextSimple(data: Uint8Array, options?: { fcMin?: number; fComplex?: boolean }): string {
    const paragraphs: string[] = []
    let currentParagraph = ''
    const maxBytes = Math.min(data.length, this.maxScanBytes)
    const startOffset = options?.fcMin ?? 0
    const isCompressed = options?.fComplex ?? false

    if (isCompressed) {
      for (let i = startOffset; i < maxBytes; i++) {
        const byte = data[i]
        if (byte === 0x0D) {
          if (currentParagraph.trim().length >= 2) paragraphs.push(currentParagraph.trim())
          currentParagraph = ''
          continue
        }
        if (byte === 0x09) {
          currentParagraph += '\t'
          continue
        }
        if (byte === 0x0A || byte === 0x00) continue
        if (byte >= 0x20) currentParagraph += String.fromCharCode(byte)
      }
    } else {
      for (let i = startOffset; i < maxBytes - 1; i++) {
        const byte1 = data[i]; const byte2 = data[i + 1]
        if (byte1 === 0x0D && byte2 === 0x00) {
          if (currentParagraph.trim().length >= 2) paragraphs.push(currentParagraph.trim())
          currentParagraph = ''
          i++; continue
        }
        const result = DocParser.scanUtf16Char(data, i, maxBytes)
        if (!result) continue
        if (result.ch) currentParagraph += result.ch
        i += result.advance - 1
      }
    }

    if (currentParagraph.trim().length >= 2) paragraphs.push(currentParagraph.trim())

    const junkPattern = new RegExp(`[${DocParser.JUNK_CHAR_CLASS}]`, 'g')

    let foundStart = false
    const filteredStart: string[] = []

    for (const p of paragraphs) {
      if (!foundStart) {
        const cp = this.cleanParagraph(p)
        if (cp.length > 5) {
          const chineseCount = (cp.match(/[\u4e00-\u9fff]/g) || []).length
          const junkCount = (cp.match(junkPattern) || []).length
          if (chineseCount >= 3 && junkCount < chineseCount) { foundStart = true; filteredStart.push(cp); continue }
        }
      } else {
        const cp = this.cleanParagraph(p)
        if (!this.shouldSkipParagraph(cp)) filteredStart.push(cp)
      }
    }

    if (!foundStart) {
      filteredStart.push(...paragraphs.slice(0, 3).map(p => this.cleanParagraph(p)).filter(p => !this.shouldSkipParagraph(p)))
    }

    const filtered = filteredStart.filter(p => {
      if (p.length < 2) return false
      if (this.shouldSkipParagraph(p)) return false
      if (!this.hasSignificantContent(p)) return false
      const upper = p.toUpperCase()
      const skip = ['ROOT', 'SUMMARY', 'DOCUMENT', 'WORD', 'WPS', 'MICROSOFT', 'PROPERTY', 'STORAGE', 'STREAM', 'TABLE', 'FORMAT', 'XMLDATA', 'BASE64', 'TEMPLATE', 'REGISTRY']
      for (const s of skip) { if (upper.includes(s)) return false }
      return true
    })

    return filtered.join('\n\n').trim()
  }

  private static readonly MAX_PIECE_COUNT = 1000
  private static readonly MAX_TOTAL_CHARS = 10 * 1024 * 1024
  /** Maximum number of images to extract from a single document. */
  private static readonly MAX_IMAGES = 50

  private static readUint32(data: Uint8Array, offset: number): number {
    if (offset < 0 || offset + 4 > data.length) return 0
    return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
  }

  private static readUint16(data: Uint8Array, offset: number): number {
    if (offset < 0 || offset + 2 > data.length) return 0
    return (data[offset] | (data[offset + 1] << 8)) & 0xFFFF
  }

  /**
   * Parse the Clx (complex file information) structure to extract text from pieces.
   *
   * Clx structure:
   *   clxt (1 byte) = 0x02  → indicates Pcdt follows
   *   lcb  (4 bytes)       → length of Pcdt data
   *   Pcdt (variable)
   *
   * Pcdt structure:
   *   clxt      (1 byte) = 0x01
   *   reserved  (2 bytes)
   *   lcbPlcPcd (4 bytes) → length of PlcPcd
   *   PlcPcd    (variable)
   *
   * PlcPcd structure:
   *   n       (4 bytes)   → number of pieces
   *   rgCcp   ((n+1)*4 bytes) → character positions for each piece
   *   rgPcd   (n*8 bytes) → PCD entries for each piece
   *
   * PCD entry (8 bytes each):
   *   reserved (2 bytes)  → flags / unused
   *   fc       (4 bytes)  → file offset + compression flag
   *                          bit 30: fCompressed (1 = 8-bit, 0 = UTF-16LE)
   *                          bits 0-29: actual file offset
   *   prm      (2 bytes)  → property modifier (CHP/PAP info, unused here)
   *
   * This overload concatenates text from ALL pieces. When the FIB exposes
   * per-story character counts (rgCcp), prefer parseClxWithStories() — it
   * splits pieces by story boundary so header/footer/footnote text does
   * not leak into the main body.
   */
  private parseClx(clxData: Uint8Array, wordDocData: Uint8Array): string {
    const pieces = this.parseClxPieces(clxData)
    if (pieces.length === 0) return this.extractTextSimple(wordDocData)

    const pieceTexts: string[] = []
    let totalChars = 0

    for (const piece of pieces) {
      totalChars += piece.charCount
      if (totalChars > DocParser.MAX_TOTAL_CHARS) {
        logger.warn('总字符数超出限制，停止读取')
        break
      }

      const byteStart = piece.fcValue
      const byteEnd = piece.fCompressed
        ? piece.fcValue + piece.charCount
        : piece.fcValue + piece.charCount * 2

      if (byteStart < 0 || byteEnd > wordDocData.length) {
        logger.warn(`Piece (cp=${piece.cpStart}) 越界，跳过`)
        continue
      }

      const pieceText = this.extractTextFromRange(
        wordDocData, byteStart, byteEnd, piece.fCompressed,
      )
      if (pieceText.trim().length > 0) {
        pieceTexts.push(pieceText.trim())
      }
    }

    if (pieceTexts.length > 0) return pieceTexts.join('\n\n')
    return this.extractTextSimple(wordDocData)
  }

  /**
   * Parse the PlcPcd inside a CLX blob and return piece metadata.
   * Returns an empty array when the structure is malformed or exceeds
   * safety limits — callers should fall back to extractTextSimple.
   */
  private parseClxPieces(clxData: Uint8Array): Piece[] {
    if (clxData.length < 5) return []
    const clxt = clxData[0]
    if (clxt !== 2) return []

    let offset = 1
    const lcb = DocParser.readUint32(clxData, offset)
    offset += 4
    if (lcb <= 0 || lcb > clxData.length - offset) return []

    const pcdtStart = offset
    const clxt2 = clxData[pcdtStart]
    if (clxt2 !== 1) return []

    const lcbPlcPcd = DocParser.readUint32(clxData, pcdtStart + 3)
    const plcPcdStart = pcdtStart + 7

    if (lcbPlcPcd <= 0 || plcPcdStart + lcbPlcPcd > clxData.length) return []

    const n = DocParser.readUint32(clxData, plcPcdStart)
    if (n <= 0 || n > DocParser.MAX_PIECE_COUNT) {
      logger.warn(`PlcPcd n=${n} 超出范围`)
      return []
    }

    const ccpCount = n + 1
    const ccpByteSize = ccpCount * 4
    const pcdByteSize = n * 8
    const expectedSize = 4 + ccpByteSize + pcdByteSize

    if (plcPcdStart + expectedSize > clxData.length) {
      logger.warn('PlcPcd 数据越界')
      return []
    }

    const plcCp: number[] = []
    for (let i = 0; i < ccpCount; i++) {
      const cp = DocParser.readUint32(clxData, plcPcdStart + 4 + i * 4)
      if (cp > DocParser.MAX_TOTAL_CHARS) {
        logger.warn(`CP 值过大: ${cp}`)
        return []
      }
      plcCp.push(cp)
    }

    const rgPcdStart = plcPcdStart + 4 + ccpByteSize
    const pieces: Piece[] = []

    for (let i = 0; i < n; i++) {
      const pcdOffset = rgPcdStart + i * 8
      // PCD (8 bytes, MS-DOC §2.5.6.4):
      //   Pn (2 bytes): paragraph number (or 0)
      //   Fc (4 bytes): bit 0-29 = fc; bit 30 = fCompressed; bit 31 = fChp
      //   Prm (2 bytes): CHPX index when fChp is set
      const fcAndFlags = DocParser.readUint32(clxData, pcdOffset + 2)
      const fCompressed = (fcAndFlags & 0x40000000) !== 0
      const fChp = (fcAndFlags & 0x80000000) !== 0
      const fcValue = fcAndFlags & 0x3FFFFFFF
      const chpxIndex = fChp ? DocParser.readUint16(clxData, pcdOffset + 6) : undefined

      const cpStart = plcCp[i]
      const cpEnd = plcCp[i + 1]
      const charCount = cpEnd - cpStart
      if (charCount <= 0) continue

      const piece: Piece = { cpStart, cpEnd, fcValue, fCompressed, fChp, charCount }
      if (chpxIndex !== undefined) piece.chpxIndex = chpxIndex
      pieces.push(piece)
    }

    return pieces
  }

  /**
   * Split pieces into per-story text using FibRgLw's rgCcp boundaries.
   *
   * Word stores all stories as one continuous character stream:
   *   [main][footnotes][headers/footers][macro][comments][endnotes][textboxes][header textboxes]
   *
   * Each piece's global CP range is intersected with each story's CP range.
   * When a piece straddles a story boundary, the byte range is sliced by
   * character offset so each story gets only its own characters.
   *
   * Returns null when there are no pieces or ccpText is zero (caller should
   * fall back to parseClx's whole-document concatenation).
   */
  private splitPiecesByStory(
    pieces: Piece[],
    rgCcp: RgCcp,
    wordDocData: Uint8Array,
  ): { stories: StoryText; pieceMap: StoryPieceMap } | null {
    if (pieces.length === 0 || rgCcp.ccpText <= 0) return null

    // Build story CP boundaries in order. Names map to StoryText fields.
    // macro (ccpMcr) is skipped — we don't expose macro text.
    let cp = 0
    const bounds: Array<{ name: keyof StoryText; start: number; end: number }> = []
    const addBound = (name: keyof StoryText, count: number) => {
      bounds.push({ name, start: cp, end: cp + count })
      cp += count
    }
    addBound('main', rgCcp.ccpText)
    addBound('footnotes', rgCcp.ccpFtn)
    addBound('headers', rgCcp.ccpHdd)
    cp += rgCcp.ccpMcr // skip macro
    addBound('comments', rgCcp.ccpAtn)
    addBound('endnotes', rgCcp.ccpEdn)
    addBound('textboxes', rgCcp.ccpTxbx)
    // ccpHdrTxbx folded into textboxes per our StoryText shape
    cp += rgCcp.ccpHdrTxbx

    const stories: StoryText = {
      main: '',
      footnotes: '',
      headers: '',
      endnotes: '',
      comments: '',
      textboxes: '',
    }
    const pieceMap: StoryPieceMap = {
      main: [],
      footnotes: [],
      headers: [],
      endnotes: [],
      comments: [],
      textboxes: [],
    }

    let totalChars = 0
    // Per-piece running character offsets within each story (post-skip).
    const storyOffset: Record<keyof StoryText, number> = {
      main: 0, footnotes: 0, headers: 0, endnotes: 0, comments: 0, textboxes: 0,
    }

    for (const piece of pieces) {
      for (const b of bounds) {
        if (b.end <= b.start) continue
        // No overlap between piece CP range and this story's CP range.
        if (piece.cpEnd <= b.start || piece.cpStart >= b.end) continue

        const overlapCpStart = Math.max(piece.cpStart, b.start)
        const overlapCpEnd = Math.min(piece.cpEnd, b.end)
        const overlapCharCount = overlapCpEnd - overlapCpStart
        if (overlapCharCount <= 0) continue

        totalChars += overlapCharCount
        if (totalChars > DocParser.MAX_TOTAL_CHARS) {
          logger.warn('总字符数超出限制，停止 story 分流')
          return { stories, pieceMap }
        }

        // Translate the overlap's character offset into a byte offset
        // within this piece's storage in the WordDocument stream.
        const charOffset = overlapCpStart - piece.cpStart
        const byteOffset = piece.fCompressed ? charOffset : charOffset * 2
        const byteLen = piece.fCompressed ? overlapCharCount : overlapCharCount * 2
        const segStart = piece.fcValue + byteOffset
        const segEnd = segStart + byteLen

        if (segStart < 0 || segEnd > wordDocData.length) {
          logger.warn(`Story segment 越界 (cp=${overlapCpStart})，跳过`)
          continue
        }

        const segText = this.extractTextFromRange(
          wordDocData, segStart, segEnd, piece.fCompressed,
        )
        const segTextLen = segText.length
        const segStartInStory = storyOffset[b.name]
        stories[b.name] += segText
        if (segTextLen > 0) {
          pieceMap[b.name].push({
            start: segStartInStory,
            end: segStartInStory + segTextLen,
            chpxIndex: piece.fChp ? piece.chpxIndex : undefined,
          })
        }
        storyOffset[b.name] += segTextLen
      }
    }

    return { stories, pieceMap }
  }

  /**
   * Parse CLX and split by story. Returns null when story splitting is not
   * applicable (no pieces, or ccpText is zero); callers should fall back to
   * parseClx() which concatenates all pieces.
   */
  private parseClxWithStories(
    clxData: Uint8Array,
    wordDocData: Uint8Array,
    rgCcp: RgCcp,
  ): { stories: StoryText; pieceMap: StoryPieceMap } | null {
    const pieces = this.parseClxPieces(clxData)
    if (pieces.length === 0) return null
    return this.splitPiecesByStory(pieces, rgCcp, wordDocData)
  }

  private extractTextFromRange(data: Uint8Array, start: number, end: number, isCompressed: boolean = false): string {
    if (start < 0 || end > data.length || start >= end) return ''

    let text = ''
    if (isCompressed) {
      for (let i = start; i < end; i++) {
        const byte = data[i]
        if (byte === 0x0D) text += '\n'
        else if (byte === 0x09) text += '\t'
        else if (byte === 0x0C) text += '\f'
        else if (byte === 0x0B) text += '\v'
        else if (byte === 0x07) text += '\u0007'
        else if (byte === 0xA0) text += '\u00A0'
        else if (byte === 0xAD) text += '\u00AD'
        else if (byte === 0x1E) text += '\u2011'
        else if (byte === 0x0A || byte === 0x00) continue
        else if (byte >= 0x80 && byte <= 0xFF) {
          const mapped = DocParser.HIGH_BYTE_MAP[byte - 0x80]
          text += mapped ?? String.fromCharCode(byte)
        }
        else if (byte >= 0x20) text += String.fromCharCode(byte)
      }
    } else {
      for (let i = start; i < end - 1; i += 2) {
        const charCode = (data[i] | (data[i + 1] << 8)) & 0xFFFF
        if (charCode === 0x000d) text += '\n'
        else if (charCode === 0x0009) text += '\t'
        else if (charCode === 0x000c) text += '\f'
        else if (charCode === 0x000b) text += '\v'
        else if (charCode === 0x0007) text += '\u0007'
        else if (charCode === 0x00a0) text += '\u00A0'
        else if (charCode === 0x00ad) text += '\u00AD'
        else if (charCode === 0x001e) text += '\u2011'
        else if (charCode === 0x000a || charCode === 0x0000) continue
        else if (DocParser.isValidPrintableChar(charCode)) {
          text += String.fromCharCode(charCode)
        }
      }
    }
    return text
  }

  // ==================== CHP/PAP format parsing ====================

  /**
   * Parse CHPX (character property) and PAPX (paragraph property) runs from
   * the table stream. Returns empty arrays if the data is missing or malformed.
   *
   * The CHP/PAP tables are stored in the table stream (0Table / 1Table) and
   * their offsets are given by fcPlcfBteChpx / fcPlcfBtePapx in the FIB.
   */
  private parseFormatRuns(
    fib: FibData,
    directory: DirectoryEntry[],
    wordDocData?: Uint8Array,
    text?: string,
  ): { chpxRuns: ChpxRun[]; papxRuns: PapxRun[]; styles: StyleDefinition[]; fontNames: string[]; listEntries: ListEntry[]; lfoEntries: LfoEntry[]; hyperlinks: FieldRange[]; tocEntries: TocEntry[]; indexEntries: IndexEntry[]; authors: string[]; revisions: RevisionMark[]; documentFields: DocumentFields; bookmarks: BookmarkRange[]; sections: SectionInfo[]; pageFields: PageFieldInfo[]; crossReferences: CrossReferenceInfo[]; shapes: ShapeInfo[]; equations: EquationInfo[]; charts: ChartInfo[]; wordArts: WordArtInfo[]; styleSet?: StyleSetInfo } {
    const chpxRuns: ChpxRun[] = []
    const papxRuns: PapxRun[] = []
    let styles: StyleDefinition[] = []
    let styleSet: StyleSetInfo | undefined
    let fontNames: string[] = []
    let listEntries: ListEntry[] = []
    const lfoEntries: LfoEntry[] = []
    const hyperlinks: FieldRange[] = []
    const tocEntries: TocEntry[] = []
    const indexEntries: IndexEntry[] = []
    let authors: string[] = []
    const revisions: RevisionMark[] = []
    const documentFields: DocumentFields = {}
    let bookmarks: BookmarkRange[] = []
    let sections: SectionInfo[] = []
    let pageFields: PageFieldInfo[] = []
    let crossReferences: CrossReferenceInfo[] = []
    let shapes: ShapeInfo[] = []
    const equations: EquationInfo[] = []

    if (!fib) return { chpxRuns, papxRuns, styles, fontNames, listEntries, lfoEntries, hyperlinks, tocEntries, indexEntries, authors, revisions, documentFields, bookmarks, sections, pageFields, crossReferences, shapes, equations, charts: [], wordArts: [] }

    const tableData = this.readTableStream(fib, directory)
    if (!tableData || tableData.length === 0) return { chpxRuns, papxRuns, styles, fontNames, listEntries, lfoEntries, hyperlinks, tocEntries, indexEntries, authors, revisions, documentFields, bookmarks, sections, pageFields, crossReferences, shapes, equations, charts: [], wordArts: [] }

    try {
      if (fib.lcbPlcfBteChpx > 0 &&
          fib.fcPlcfBteChpx + fib.lcbPlcfBteChpx <= tableData.length) {
        const runs = parseChpxRuns(tableData, fib.fcPlcfBteChpx, fib.lcbPlcfBteChpx)
        if (runs.length > 0) {
          logger.info(`解析到 ${runs.length} 个 CHPX 字符格式运行`)
          chpxRuns.push(...runs)
        }
      }
    } catch (e) {
      logger.warn(`CHPX 解析失败: ${e}`)
    }

    // Parse revision author table (SttbfRMark) and collect revision marks from CHPX runs.
    try {
      if (fib.fcSttbfRMark !== undefined && fib.lcbSttbfRMark !== undefined && fib.lcbSttbfRMark > 0 &&
          fib.fcSttbfRMark + fib.lcbSttbfRMark <= tableData.length) {
        authors = parseSttbfRMark(tableData, fib.fcSttbfRMark, fib.lcbSttbfRMark)
        if (authors.length > 0) {
          logger.info(`解析到 ${authors.length} 个修订作者`)
        }
      }
    } catch (e) {
      logger.warn(`SttbfRMark 解析失败: ${e}`)
    }

    for (const run of chpxRuns) {
      if (run.revision) {
        const mark: RevisionMark = {
          cpStart: run.cpStart,
          cpEnd: run.cpEnd,
          type: run.revision.type,
        }
        if (run.revision.authorIndex !== undefined) {
          mark.authorIndex = run.revision.authorIndex
          if (authors.length > 0 && run.revision.authorIndex < authors.length) {
            mark.author = authors[run.revision.authorIndex]
          }
        }
        if (run.revision.timestamp !== undefined) {
          mark.timestamp = run.revision.timestamp
        }
        revisions.push(mark)
      }
    }
    if (revisions.length > 0) {
      logger.info(`解析到 ${revisions.length} 个修订标记`)
    }

    try {
      if (fib.lcbPlcfBtePapx > 0 &&
          fib.fcPlcfBtePapx + fib.lcbPlcfBtePapx <= tableData.length) {
        const runs = parsePapxRuns(tableData, fib.fcPlcfBtePapx, fib.lcbPlcfBtePapx)
        if (runs.length > 0) {
          logger.info(`解析到 ${runs.length} 个 PAPX 段落格式运行`)
          papxRuns.push(...runs)
        }
      }
    } catch (e) {
      logger.warn(`PAPX 解析失败: ${e}`)
    }

    try {
      if (fib.lcbStshf > 0 &&
          fib.fcStshf + fib.lcbStshf <= tableData.length) {
        const parsedStyles = parseStylesheet(tableData, fib.fcStshf, fib.lcbStshf)
        if (parsedStyles.length > 0) {
          logger.info(`解析到 ${parsedStyles.length} 个样式定义`)
          styles = parsedStyles
          const detected = detectStyleSet(parsedStyles)
          if (detected) {
            logger.info(`检测到样式集: ${detected.name}`)
            styleSet = detected
          }
        }
      }
    } catch (e) {
      logger.warn(`样式表解析失败: ${e}`)
    }

    try {
      if (fib.lcbSttbfFfn > 0 &&
          fib.fcSttbfFfn + fib.lcbSttbfFfn <= tableData.length) {
        fontNames = parseFontTable(tableData, fib.fcSttbfFfn, fib.lcbSttbfFfn)
        if (fontNames.length > 0) {
          logger.info(`解析到 ${fontNames.length} 个字体名称`)
        }
      }
    } catch (e) {
      logger.warn(`字体表解析失败: ${e}`)
    }

    try {
      if (fib.lcbLst > 0 &&
          fib.fcLst + fib.lcbLst <= tableData.length) {
        listEntries = parseListTable(tableData, fib.fcLst, fib.lcbLst)
        if (listEntries.length > 0) {
          logger.info(`解析到 ${listEntries.length} 个列表定义`)
        }
      }

      // Parse PlcfLfo (List Format Override table)
      if (fib.lcbPlcfLfo > 0 && fib.fcPlcfLfo + fib.lcbPlcfLfo <= tableData.length) {
        const parsed = parsePlcfLfo(tableData, fib.fcPlcfLfo, fib.lcbPlcfLfo)
        if (parsed.length > 0) {
          ;(lfoEntries as LfoEntry[]).push(...parsed)
          logger.info(`解析到 ${parsed.length} 个列表格式覆盖 (LFO)`)
        }
      }
    } catch (e) {
      logger.warn(`列表表解析失败: ${e}`)
    }

    // Parse PlcfFld (field positions) and extract hyperlinks and TOC
    try {
      if (fib.lcbPlcfFldMom > 0 &&
          fib.fcPlcfFldMom + fib.lcbPlcfFldMom <= tableData.length) {
        const fldEntries = parsePlcfFld(tableData, fib.fcPlcfFldMom, fib.lcbPlcfFldMom)
        if (fldEntries.length > 0 && wordDocData && text) {
          const links = extractHyperlinks(fldEntries, text, wordDocData)
          if (links.length > 0) {
            ;(hyperlinks as FieldRange[]).push(...links)
            logger.info(`解析到 ${links.length} 个超链接`)
          }

          const allFields = extractAllFields(fldEntries, text, wordDocData)
          const tocFields = allFields.filter(f => f.flt === 19 && f.tocEntries && f.tocEntries.length > 0)
          for (const tocField of tocFields) {
            if (tocField.tocEntries) {
              ;(tocEntries as TocEntry[]).push(...tocField.tocEntries)
            }
          }
          if (tocEntries.length > 0) {
            logger.info(`解析到 ${tocEntries.length} 个目录条目`)
          }

          const indexFields = allFields.filter(f => f.flt === 14 && f.indexEntries && f.indexEntries.length > 0)
          for (const indexField of indexFields) {
            if (indexField.indexEntries) {
              ;(indexEntries as IndexEntry[]).push(...indexField.indexEntries)
            }
          }
          if (indexEntries.length > 0) {
            logger.info(`解析到 ${indexEntries.length} 个索引条目`)
          }

          const fields = extractDocumentFields(fldEntries, text, wordDocData)
          const fieldCount = Object.keys(fields).length
          if (fieldCount > 0) {
            Object.assign(documentFields, fields)
            logger.info(`解析到 ${fieldCount} 个文档域（AUTHOR/TITLE/DATE 等）`)
          }
        }
      }
    } catch (e) {
      logger.warn(`域表解析失败: ${e}`)
    }

    // Parse bookmarks (PlcfBkf + PlcfBkl + SttbfBkmk)
    try {
      if (fib.fcPlcfBkf !== undefined && fib.lcbPlcfBkf !== undefined &&
          fib.fcPlcfBkl !== undefined && fib.lcbPlcfBkl !== undefined &&
          fib.fcSttbfBkmk !== undefined && fib.lcbSttbfBkmk !== undefined) {
        const parsed = extractBookmarks(
          tableData,
          fib.fcPlcfBkf, fib.lcbPlcfBkf,
          fib.fcPlcfBkl, fib.lcbPlcfBkl,
          fib.fcSttbfBkmk, fib.lcbSttbfBkmk,
        )
        if (parsed.length > 0) {
          bookmarks = parsed
          logger.info(`解析到 ${bookmarks.length} 个书签`)
        }
      }
    } catch (e) {
      logger.warn(`书签解析失败: ${e}`)
    }

    // Parse sections (PlcfSed + SEPX) — requires WordDocument stream for SEPX
    try {
      if (fib.fcPlcfSed !== undefined && fib.lcbPlcfSed !== undefined &&
          fib.lcbPlcfSed > 0 && wordDocData) {
        const parsed = extractSections(
          tableData,
          wordDocData,
          fib.fcPlcfSed, fib.lcbPlcfSed,
        )
        if (parsed.length > 0) {
          sections = parsed
        }
      }
    } catch (e) {
      logger.warn(`分节解析失败: ${e}`)
    }

    // Parse page fields (PAGE / NUMPAGES / SECTION / SECTIONPAGES)
    // Reuses the PlcfFld parsing above; extractPageFields matches by instruction text.
    try {
      if (fib.lcbPlcfFldMom > 0 &&
          fib.fcPlcfFldMom + fib.lcbPlcfFldMom <= tableData.length &&
          wordDocData && text) {
        const fldEntries = parsePlcfFld(tableData, fib.fcPlcfFldMom, fib.lcbPlcfFldMom)
        if (fldEntries.length > 0) {
          const parsed = extractPageFields(fldEntries, text, wordDocData)
          if (parsed.length > 0) {
            pageFields = parsed
            logger.info(`解析到 ${pageFields.length} 个页码域（PAGE/NUMPAGES/SECTION）`)
          }
        }
      }
    } catch (e) {
      logger.warn(`页码域解析失败: ${e}`)
    }

    // Parse cross-references (REF / NOTEREF)
    // Reuses the PlcfFld parsing above; extractCrossReferences matches by instruction text.
    try {
      if (fib.lcbPlcfFldMom > 0 &&
          fib.fcPlcfFldMom + fib.lcbPlcfFldMom <= tableData.length &&
          wordDocData && text) {
        const fldEntries = parsePlcfFld(tableData, fib.fcPlcfFldMom, fib.lcbPlcfFldMom)
        if (fldEntries.length > 0) {
          const parsed = extractCrossReferences(fldEntries, text, wordDocData)
          if (parsed.length > 0) {
            crossReferences = parsed
            logger.info(`解析到 ${crossReferences.length} 个交叉引用（REF/NOTEREF）`)
          }
        }
      }
    } catch (e) {
      logger.warn(`交叉引用解析失败: ${e}`)
    }

    // Parse shapes (Office Art Drawing Container)
    // Floating images have shape anchors that describe their position/size
    try {
      const dataEntry = this.ole.findStreamByName(directory, 'Data')
      if (dataEntry) {
        const dataStream = this.ole.readStream(dataEntry)
        if (dataStream.data && dataStream.data.length > 0) {
          const dataShapes = extractShapesFromDataStream(dataStream.data)
          if (dataShapes.length > 0) {
            shapes.push(...dataShapes)
          }
        }
      }
      if (wordDocData && wordDocData.length > 0) {
        const docShapes = extractShapesFromWordDocumentStream(wordDocData)
        for (const shape of docShapes) {
          if (!shapes.some(s => s.spid === shape.spid)) {
            shapes.push(shape)
          }
        }
      }
      if (shapes.length > 0) {
        logger.info(`解析到 ${shapes.length} 个形状（Office Art Drawing Container）`)
      }
    } catch (e) {
      logger.warn(`形状解析失败: ${e}`)
    }

    // Parse equations (Equation Editor OLE objects)
    // Equations are stored as OLE objects with names like "Equation.1", "Equation.2"
    try {
      const dirEquations = extractEquationsFromDirectory(directory, (entry) => this.ole.readStream(entry))
      if (dirEquations.length > 0) {
        equations.push(...dirEquations)
        logger.info(`解析到 ${dirEquations.length} 个公式（OLE 对象）`)
      }

      if (wordDocData && wordDocData.length > 0) {
        const docEquations = extractEquationsFromWordDocumentStream(wordDocData)
        for (const eq of docEquations) {
          if (!equations.some(e => e.eqnText === eq.eqnText)) {
            equations.push(eq)
          }
        }
        if (docEquations.length > 0) {
          logger.info(`从 WordDocument 流解析到 ${docEquations.length} 个公式`)
        }
      }
    } catch (e) {
      logger.warn(`公式解析失败: ${e}`)
    }

    // 图表解析
    const charts: ChartInfo[] = []
    try {
      const dirCharts = extractChartsFromDirectory(directory, (entry) => this.ole.readStream(entry))
      if (dirCharts.length > 0) {
        charts.push(...dirCharts)
        logger.info(`解析到 ${dirCharts.length} 个图表（OLE 对象）`)
      }

      if (wordDocData && wordDocData.length > 0) {
        const docCharts = extractChartsFromWordDocumentStream(wordDocData)
        for (const chart of docCharts) {
          if (!charts.some(c => c.name === chart.name)) {
            charts.push(chart)
          }
        }
        if (docCharts.length > 0) {
          logger.info(`从 WordDocument 流解析到 ${docCharts.length} 个图表`)
        }
      }
    } catch (e) {
      logger.warn(`图表解析失败: ${e}`)
    }

    // WordArt 解析
    const wordArts: WordArtInfo[] = []
    try {
      const dirWordArts = extractWordArtFromDirectory(directory, (entry) => this.ole.readStream(entry))
      if (dirWordArts.length > 0) {
        wordArts.push(...dirWordArts)
        logger.info(`解析到 ${dirWordArts.length} 个 WordArt（OLE 对象）`)
      }

      if (wordDocData && wordDocData.length > 0) {
        const docWordArts = extractWordArtFromDrawingData(wordDocData)
        for (const wa of docWordArts) {
          if (!wordArts.some(w => w.name === wa.name && w.text === wa.text)) {
            wordArts.push(wa)
          }
        }
        if (docWordArts.length > 0) {
          logger.info(`从 WordDocument 流解析到 ${docWordArts.length} 个 WordArt`)
        }
      }
    } catch (e) {
      logger.warn(`WordArt 解析失败: ${e}`)
    }

    return { chpxRuns, papxRuns, styles, fontNames, listEntries, lfoEntries, hyperlinks, tocEntries, indexEntries, authors, revisions, documentFields, bookmarks, sections, pageFields, crossReferences, shapes, equations, charts, wordArts, styleSet }
  }

  /**
   * Create formatted paragraphs with real CHP/PAP format data.
   * Uses single newline splitting and original paragraph indices for accurate
   * PAPX matching, and text offset as cp estimate for CHPX matching.
   *
   * @param pieceMap - Optional piece map from splitPiecesByStory that gives
   *   per-character CHPX associations via piece-level chpxIndex.
   */
  private createParagraphsWithRealFormats(
    text: string,
    chpxRuns: ChpxRun[],
    papxRuns: PapxRun[],
    styles: StyleDefinition[],
    fontNames: string[],
    pieceMap?: Array<{ start: number; end: number; chpxIndex?: number }>,
    listEntries?: ListEntry[],
    lfoEntries?: LfoEntry[],
  ): any[] {
    const allParagraphs: Array<{ text: string; cpStart: number; originalIndex: number }> = []
    let cp = 0

    const parts = text.split(/\n/)
    for (let i = 0; i < parts.length; i++) {
      const paraText = parts[i]
      const paraLen = paraText.length
      allParagraphs.push({ text: paraText, cpStart: cp, originalIndex: i })
      cp += paraLen + 1 // +1 for the \n (paragraph mark)
    }

    const result: any[] = []
    for (let i = 0; i < allParagraphs.length; i++) {
      const para = allParagraphs[i]
      const rawText = para.text
      // 检测分页符：段落开头的 \f 表示段前分页
      let pageBreakBefore = false
      let textToClean = rawText
      if (rawText.startsWith('\f')) {
        pageBreakBefore = true
        textToClean = rawText.slice(1)
      }
      // 段落中间的 \f 也视为分页符（放在下一段前）
      if (textToClean.includes('\f')) {
        // 将文本按 \f 分割，第一个部分作为当前段落
        const firstPart = textToClean.split('\f')[0]
        const remaining = textToClean.slice(firstPart.length + 1)
        if (firstPart.trim().length > 0) {
          textToClean = firstPart
        } else {
          pageBreakBefore = true
          textToClean = remaining
        }
      }
      const cleaned = this.cleanParagraph(textToClean.trim())
      if (!this.shouldSkipParagraph(cleaned) && cleaned.length > 0) {
        const paraFormat = this.detectParagraphFormat(cleaned, i, allParagraphs.length)
        const charFormat = this.guessCharFormat(cleaned, i)
        if (pageBreakBefore) {
          paraFormat.pageBreakBefore = true
        }
        const newPara: any = {
          text: cleaned,
          paraFormat,
          charFormat,
          _cpStart: para.cpStart, // 保留 CP 位置供超链接映射
        }

        if (papxRuns.length > 0 && para.originalIndex < papxRuns.length) {
          const papx = papxRuns[para.originalIndex]
          if (papx.format && Object.keys(papx.format).length > 0) {
            newPara.paraFormat = {
              ...newPara.paraFormat,
              ...papx.format,
            }
            newPara.paraFormatFromReal = true
          }
          // Use outlineLevel from PAPX (sprmPOutlineLvl) as heading level
          if (papx.format.outlineLevel !== undefined && papx.format.outlineLevel >= 0 && papx.format.outlineLevel <= 8) {
            newPara.paraFormat.headingLevel = papx.format.outlineLevel + 1 // 0-based → 1-based
          }
          if (styles.length > 0 && papx.istd !== undefined) {
            const style = styles.find(s => s.istd === papx.istd)
            if (style) {
              newPara.paraFormat.styleName = style.name
              // Apply style's base paragraph format (inheritance)
              if (style.paraFormat && Object.keys(style.paraFormat).length > 0) {
                // Style base format → PAPX overrides (already applied above)
                newPara.paraFormat = {
                  ...style.paraFormat,
                  ...newPara.paraFormat,
                }
              }
              // Apply style's base character format
              if (style.charFormat && Object.keys(style.charFormat).length > 0) {
                newPara.charFormat = {
                  ...style.charFormat,
                  ...newPara.charFormat,
                }
              }
              // Apply style's font name
              if (style.fontIndex !== undefined && fontNames && fontNames.length > style.fontIndex) {
                if (!newPara.charFormat.fontName) {
                  newPara.charFormat.fontName = fontNames[style.fontIndex]
                }
              }
              // Only use style-name-based heading level if outlineLevel wasn't set
              if (newPara.paraFormat.headingLevel === undefined) {
                const headingLevel = getHeadingLevel(style.name)
                if (headingLevel !== null) {
                  newPara.paraFormat.headingLevel = headingLevel
                }
              }
            }
          }
          // Apply real list format from LST/LFO table (replaces heuristic detectListInfo)
          // Priority: ilfo (LFO override) > ilst (direct LST reference)
          if (papx.ilfo !== undefined && papx.ilfo > 0 && lfoEntries && lfoEntries.length > 0 && listEntries && listEntries.length > 0) {
            const level = papx.ilvl ?? 0
            const listFmt = getListFormatFromLfo(listEntries, lfoEntries, papx.ilfo, level)
            if (listFmt) {
              newPara.paraFormat.listType = listFmt.listType
              newPara.paraFormat.listStyle = listFmt.listStyle
              newPara.paraFormat.listLevel = listFmt.listLevel
              newPara.paraFormat.listId = papx.ilfo
              newPara.paraFormatFromReal = true
            }
          } else if (papx.ilst !== undefined && listEntries && listEntries.length > 0) {
            const level = papx.ilvl ?? 0
            const listFmt = getListFormat(listEntries, papx.ilst, level)
            if (listFmt) {
              newPara.paraFormat.listType = listFmt.listType
              newPara.paraFormat.listStyle = listFmt.listStyle
              newPara.paraFormat.listLevel = listFmt.listLevel
              newPara.paraFormat.listId = papx.ilst
              newPara.paraFormatFromReal = true
            }
          }
          // Apply table info from TAP SPRMs (sprmPFInTable / sprmTDefTable / sprmTTableBorders)
          if (papx.table) {
            newPara.paraFormat.table = papx.table
            newPara.paraFormatFromReal = true
          }
        }

        const cpStart = para.cpStart
        const cpEnd = cpStart + para.text.length
        // 1. Try piece-level CHPX first (most accurate when prm/fChp is set)
        let merged: Partial<CharacterFormat> = {}
        let usedPieceChp = false
        if (pieceMap && pieceMap.length > 0) {
          // Find pieces that overlap the paragraph's [cpStart, cpEnd).
          // We need to know the paragraph's range in piece-map coordinates.
          // Since pieceMap and para are both based on `text`, para.cpStart
          // IS the offset in the same coordinate system.
          const overlapping = pieceMap.filter(p =>
            !(p.end <= cpStart || p.start >= cpEnd),
          )
          if (overlapping.length > 0) {
            const ratio = overlapping.reduce((s, p) => {
              const overlapStart = Math.max(p.start, cpStart)
              const overlapEnd = Math.min(p.end, cpEnd)
              return s + (overlapEnd - overlapStart)
            }, 0) / (cpEnd - cpStart)
            // If overlapping pieces cover >= 50% of the paragraph, use them.
            if (ratio >= 0.5) {
              for (const p of overlapping) {
                if (p.chpxIndex !== undefined && p.chpxIndex < chpxRuns.length) {
                  const pieceChp = chpxRuns[p.chpxIndex]
                  if (pieceChp.format) {
                    merged = { ...merged, ...pieceChp.format }
                    usedPieceChp = true
                  }
                  if (pieceChp.fontIndex !== undefined && fontNames && fontNames[pieceChp.fontIndex]) {
                    merged.fontName = fontNames[pieceChp.fontIndex]
                    usedPieceChp = true
                  }
                }
              }
            }
          }
        }
        // 2. Fall back to CHPX range matching when no piece-level data.
        if (!usedPieceChp && chpxRuns.length > 0 && cleaned.length > 0) {
          merged = mergeCharFormatForParagraph(chpxRuns, cpStart, cpEnd, fontNames)
        }
        if (Object.keys(merged).length > 0) {
          newPara.charFormat = {
            ...newPara.charFormat,
            ...merged,
          }
          newPara.charFormatFromReal = true
          // Clear heuristic styles array since real CHPX format is available
          delete newPara.charFormat.styles
        }

        result.push(newPara)
      }
    }

    return result
  }

  // ==================== Format extraction ====================

  private extractFormattedText(
    wordStream: StreamData,
    directory: DirectoryEntry[],
    onProgress?: ProgressCallback,
  ): { paragraphs: any[]; stories?: DocumentStories; chpxRuns?: ChpxRun[]; papxRuns?: PapxRun[]; styles?: StyleDefinition[]; hyperlinks?: FieldRange[]; tocEntries?: TocEntry[]; indexEntries?: IndexEntry[]; revisions?: RevisionMark[]; documentFields?: DocumentFields; bookmarks?: BookmarkRange[]; sections?: SectionInfo[]; pageFields?: PageFieldInfo[]; crossReferences?: CrossReferenceInfo[]; shapes?: ShapeInfo[]; equations?: EquationInfo[]; charts?: ChartInfo[]; wordArts?: WordArtInfo[]; styleSet?: StyleSetInfo } {
    const data = wordStream.data
    const fib = parseFib(data)

    if (fib && fib.fcMin > 0 && fib.fcMac > 0) {
      return { paragraphs: this.extractTextWithFormatFromFib(data, fib), tocEntries: [], indexEntries: [], documentFields: {}, equations: [] }
    }

    // Prefer CLX-driven extraction: it correctly handles per-piece encoding
    // and is the spec-compliant path for Word 97+ documents.
    if (fib && fib.lcbClx > 0) {
      const clxData = this.readClxData(fib, data, directory)
      if (clxData) {
        // Try story-split extraction first to keep header/footer/footnote
        // text out of the main body.
        let mainText = ''
        let pieceMapMain: Array<{ start: number; end: number; chpxIndex?: number }> = []
        let storyResult: StoryText | null = null

        if (fib.rgCcp.ccpText > 0) {
          const result = this.parseClxWithStories(clxData, data, fib.rgCcp)
          if (result && result.stories.main.trim().length > 0) {
            mainText = result.stories.main
            pieceMapMain = result.pieceMap.main
            storyResult = result.stories
          }
        }

        if (!mainText) {
          mainText = this.parseClx(clxData, data)
          pieceMapMain = []
        }

        if (mainText.length > 0) {
          onProgress?.('parsing_formats', 35)
          // Parse formats AFTER we have the text (needed for hyperlink extraction)
          const { chpxRuns, papxRuns, styles, fontNames, listEntries, lfoEntries, hyperlinks, tocEntries, indexEntries, revisions, documentFields, bookmarks, sections, pageFields, crossReferences, shapes, equations, charts, wordArts, styleSet } =
            this.parseFormatRuns(fib, directory, data, mainText)

          onProgress?.('parsing_fields', 55)
          // Replace page field placeholders in mainText before paragraph splitting.
          // mainText currently contains instruction+result concatenations like "PAGE1"
          // (0x13/0x14/0x15 were skipped during extraction). We replace each field's
          // instruction+result span with just the result so paragraphs show "1" not "PAGE1".
          if (pageFields.length > 0) {
            mainText = this.replacePageFieldsInText(mainText, pageFields)
          }

          onProgress?.('parsing_shapes', 65)
          const hasRealFormats = chpxRuns.length > 0 || papxRuns.length > 0 || styles.length > 0 || listEntries.length > 0

          let paragraphs: any[]
          if (hasRealFormats) {
            paragraphs = this.createParagraphsWithRealFormats(
              mainText, chpxRuns, papxRuns, styles, fontNames,
              pieceMapMain, listEntries, lfoEntries,
            )
          } else {
            paragraphs = this.createFormattedParagraphsFromText(mainText)
          }

          if (paragraphs.length > 0) {
            // 提取 DOP 用于页眉页脚拆分
            const dop = this.extractDop(fib, directory)
            return {
              paragraphs,
              stories: storyResult ? this.toDocumentStories(storyResult, fib, dop, directory, chpxRuns) : undefined,
              chpxRuns,
              papxRuns,
              styles,
              hyperlinks,
              tocEntries,
              indexEntries,
              revisions,
              documentFields,
              bookmarks,
              sections,
              pageFields,
              crossReferences,
              shapes,
              equations,
              charts,
              wordArts,
              styleSet,
            }
          }
        }
      }
    }

    // textutil-generated files have fComplex bit always set (byte 10=0xBF),
    // but the content is often UTF-16LE. Ignore fComplex for those files
    // and lean toward UTF-16 in the scoring fallback.
    const isTextutil = fib?.isTextutil === true
    const suggestedComplex = isTextutil ? false : (fib?.fComplex ?? false)
    logger.warn(
      `FIB无有效偏移，自动检测编码(fComplex=${fib?.fComplex}, textutil=${isTextutil}, useSuggested=${suggestedComplex})`
    )

    const binaryDetect = this.detectEncodingFromBinary(data)
    if (binaryDetect !== null) {
      const raw = this.extractParagraphsWithFormat(data, { fcMin: 0, fComplex: binaryDetect })
      return { paragraphs: this.filterParagraphsWithGenericLogic(raw), tocEntries: undefined }
    }

    const raw8 = this.extractParagraphsWithFormat(data, { fcMin: 0, fComplex: true })
    const raw16 = this.extractParagraphsWithFormat(data, { fcMin: 0, fComplex: false })
    const score8 = this.scoreRawParagraphs(raw8)
    const score16 = this.scoreRawParagraphs(raw16)
    // For textutil files, weight UTF-16 more heavily (textutil usually produces UTF-16)
    const scoreThreshold = isTextutil ? 0.6 : 0.4
    const useComplex = suggestedComplex
      ? score8 >= score16 * scoreThreshold
      : score16 < score8 * scoreThreshold
    return { paragraphs: this.filterParagraphsWithGenericLogic(useComplex ? raw8 : raw16), tocEntries: undefined }
  }

  /**
   * Convert internal StoryText to the public DocumentStories shape.
   * Drops empty fields so the UI can simply check `stories?.footnotes`.
   *
   * 当 DOP 标志位启用首页不同/奇偶页不同时，尝试通过 PlcfHdd 将 headers
   * story 拆分为首页/奇数页/偶数页页眉页脚。PlcfHdd 不可用时回退到
   * 启发式段落拆分。
   */
  private toDocumentStories(
    stories: StoryText,
    fib?: FibData,
    dop?: DopData | null,
    directory?: DirectoryEntry[],
    chpxRuns: ChpxRun[] = []
  ): DocumentStories {
    const out: DocumentStories = {}
    if (stories.headers.trim()) out.headers = stories.headers.trim()
    if (stories.footnotes.trim()) out.footnotes = stories.footnotes.trim()
    if (stories.endnotes.trim()) out.endnotes = stories.endnotes.trim()
    if (stories.comments.trim()) out.comments = stories.comments.trim()
    if (stories.textboxes.trim()) out.textboxes = stories.textboxes.trim()

    // 尝试拆分页眉页脚（仅当 DOP 标志位启用时）
    if (out.headers && dop && (dop.titlePage || dop.facingPages)) {
      const headerParts = this.splitHeaderParts(stories.headers, fib, dop, directory, chpxRuns)
      if (headerParts) {
        out.headerParts = headerParts.textParts
        if (headerParts.startsWithImages) {
          out.headerPartsWithImages = headerParts.startsWithImages
        }
      }
    }

    return out
  }

  /**
   * 拆分页眉页脚 story 文本为首页/奇数页/偶数页页眉页脚。
   *
   * 优先使用 PlcfHdd 精确拆分；PlcfHdd 不可用时回退到启发式段落拆分。
   * 如果提供了 chpxRuns，同时提取页眉页脚区域中的图片。
   */
  private splitHeaderParts(
    headersText: string,
    fib?: FibData,
    dop?: DopData | null,
    directory?: DirectoryEntry[],
    chpxRuns: ChpxRun[] = []
  ): { textParts: Partial<Record<HeaderFooterPartType, string>>; startsWithImages?: Partial<Record<HeaderFooterPartType, HeaderFooterPartContent>> } | null {
    if (!headersText || !dop) return null

    // 提取页眉页脚区域中的图片（通过 chpxRuns 中的 fcPic）
    const headerPictures: ParsedPicture[] = []
    if (chpxRuns.length > 0 && directory) {
      const dataEntry = this.ole.findStreamByName(directory, 'Data')
      if (dataEntry) {
        const dataStream = this.ole.readStream(dataEntry)
        if (dataStream.data && dataStream.data.length > 0) {
          const seenFcPics = new Set<number>()
          for (const run of chpxRuns) {
            if (run.fcPic !== undefined && !seenFcPics.has(run.fcPic)) {
              seenFcPics.add(run.fcPic)
              const pic = parsePicfAt(dataStream.data, run.fcPic)
              if (pic) {
                headerPictures.push(pic)
              }
            }
          }
        }
      }
    }

    // 策略 1：通过 PlcfHdd 精确拆分
    if (fib && fib.lcbPlcfHdd && fib.lcbPlcfHdd > 0 && fib.fcPlcfHdd && directory) {
      try {
        const tableData = this.readTableStream(fib, directory)
        if (tableData) {
          const end = fib.fcPlcfHdd + fib.lcbPlcfHdd
          if (end <= tableData.length) {
            const plcfHddData = tableData.subarray(fib.fcPlcfHdd, end)
            const split = parsePlcfHdd(plcfHddData, dop.titlePage, dop.facingPages)
            if (split) {
              const textParts = splitHeaderText(headersText, split)
              if (textParts) {
                logger.log(`页眉页脚通过 PlcfHdd 拆分成功: ${Object.keys(textParts).length} 部分`)
                
                // 如果有图片，尝试按子范围拆分图片
                let startsWithImages: Partial<Record<HeaderFooterPartType, HeaderFooterPartContent>> | undefined
                if (headerPictures.length > 0) {
                  const withImages = splitHeaderTextWithImages(headersText, split, headerPictures)
                  if (withImages && Object.keys(withImages).length > 0) {
                    startsWithImages = withImages
                    logger.log(`页眉页脚图片拆分成功: ${Object.keys(withImages).length} 部分包含图片`)
                  }
                }
                
                return { textParts, startsWithImages }
              }
            }
          }
        }
      } catch (e) {
        logger.warn(`PlcfHdd 拆分失败，回退到启发式: ${e}`)
      }
    }

    // 策略 2：启发式段落拆分（不支持图片拆分）
    const textParts = splitHeaderTextHeuristic(headersText, dop.titlePage, dop.facingPages)
    if (textParts) {
      return { textParts }
    }

    return null
  }

  /**
   * Extract embedded images from the document.
   *
   * Word 97-2003 stores embedded pictures as binary blobs inside the `Data`
   * stream. Each picture is referenced from the document text via a special
   * character and a CHP `fcPic` pointer, but parsing that requires the CHP
   * table which this project does not yet read.
   *
   * As a pragmatic fallback, we scan the `Data` stream (and the WordDocument
   * stream as a secondary fallback) for well-known image magic numbers
   * (PNG / JPEG / BMP / GIF) and slice out each image. Returns an array of
   * data URLs ready for inline `<img>` rendering.
   */
  private extractImages(directory: DirectoryEntry[], wordDocData?: Uint8Array): string[] {
    try {
      const candidates: Uint8Array[] = []

      // Primary: the `Data` stream is where Word stores embedded pictures.
      const dataEntry = this.ole.findStreamByName(directory, 'Data')
      if (dataEntry) {
        const dataStream = this.ole.readStream(dataEntry)
        if (dataStream.data && dataStream.data.length > 0) {
          candidates.push(dataStream.data)
        }
      }

      // Secondary fallback: some producers embed images directly in the
      // WordDocument stream. We scan it too, then dedupe by byte content.
      if (wordDocData && wordDocData.length > 0) {
        candidates.push(wordDocData)
      }

      let images: Array<{ format: string; data: Uint8Array }> = []
      for (const candidate of candidates) {
        const found = extractImagesFromStream(candidate)
        for (const img of found) {
          if (images.length >= DocParser.MAX_IMAGES) break
          images.push(img)
        }
        if (images.length >= DocParser.MAX_IMAGES) break
      }

      if (images.length === 0) return []

      // Dedupe by size + first 16 bytes (cheap and effective for embedded
      // images that may appear in both Data and WordDocument streams).
      const seen = new Set<string>()
      const unique: typeof images = []
      for (const img of images) {
        const head = Array.from(img.data.subarray(0, Math.min(16, img.data.length)))
          .join(',')
        const key = `${img.format}:${img.data.length}:${head}`
        if (seen.has(key)) continue
        seen.add(key)
        unique.push(img)
      }

      return imagesToDataUrls(unique as any)
    } catch (err) {
      logger.warn('图片提取失败:', err instanceof Error ? err.message : String(err))
      return []
    }
  }

  /**
   * Extract embedded pictures with structured info (format, dimensions, etc.)
   *
   * Uses PICF envelope detection when possible, falling back to magic-number
   * scanning. Returns structured picture objects instead of plain data URLs.
   */
  private extractPictures(
    directory: DirectoryEntry[],
    chpxRuns: ChpxRun[] = [],
  ): Array<{
    format: string
    dataUrl: string
    widthPx?: number
    heightPx?: number
    floating?: boolean
    cp?: number
  }> {
    try {
      const dataEntry = this.ole.findStreamByName(directory, 'Data')
      if (!dataEntry) return []

      const dataStream = this.ole.readStream(dataEntry)
      if (!dataStream.data || dataStream.data.length < 64) return []

      const pictures: ParsedPicture[] = []
      const seenFcPics = new Set<number>()
      const fcPicToCp = new Map<number, number>()

      for (const run of chpxRuns) {
        if (run.fcPic === undefined) continue
        if (!fcPicToCp.has(run.fcPic)) {
          fcPicToCp.set(run.fcPic, run.cpStart)
        }
        if (seenFcPics.has(run.fcPic)) continue
        seenFcPics.add(run.fcPic)
        const pic = parsePicfAt(dataStream.data, run.fcPic)
        if (pic) {
          pic.dataOffset = run.fcPic
          pictures.push(pic)
        }
      }

      if (pictures.length === 0) {
        const scanned = extractPicturesFromDataStream(dataStream.data)
        pictures.push(...scanned.slice(0, DocParser.MAX_IMAGES))
      }

      if (pictures.length === 0) return []

      const result: Array<{
        format: string
        dataUrl: string
        widthPx?: number
        heightPx?: number
        floating?: boolean
        cp?: number
      }> = []

      for (const pic of pictures) {
        if (pic.format === 'unknown') continue
        if (result.length >= DocParser.MAX_IMAGES) break

        let binary = ''
        const bytes = pic.data
        const chunkSize = 0x8000
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
          binary += String.fromCharCode.apply(
            null,
            Array.from(slice) as unknown as number[],
          )
        }
        const mime =
          pic.format === 'png'
            ? 'image/png'
            : pic.format === 'jpeg'
              ? 'image/jpeg'
              : pic.format === 'gif'
                ? 'image/gif'
                : pic.format === 'bmp'
                  ? 'image/bmp'
                  : 'application/octet-stream'
        const dataUrl = `data:${mime};base64,${btoa(binary)}`

        const item: {
          format: string
          dataUrl: string
          widthPx?: number
          heightPx?: number
          floating?: boolean
          cp?: number
        } = {
          format: pic.format,
          dataUrl,
        }
        if (pic.widthPx !== undefined) item.widthPx = pic.widthPx
        if (pic.heightPx !== undefined) item.heightPx = pic.heightPx
        if (pic.floating !== undefined) item.floating = pic.floating
        if (pic.dataOffset !== undefined && fcPicToCp.has(pic.dataOffset)) {
          item.cp = fcPicToCp.get(pic.dataOffset)
        }

        result.push(item)
      }

      return result
    } catch (err) {
      logger.warn('结构化图片提取失败:', err instanceof Error ? err.message : String(err))
      return []
    }
  }

  /**
   * Extract document properties from the SummaryInformation stream.
   *
   * Word documents store metadata (title, author, keywords, etc.) in the
   * SummaryInformation stream using the OLE Property Set format (MS-OLEPS).
   *
   * @param directory - Directory entries from the OLE container.
   * @returns Document properties, or null if not found/parse failed.
   */
  private extractProperties(directory: DirectoryEntry[]): DocumentProperties | null {
    try {
      // SummaryInformation stream name can be:
      // - "\005SummaryInformation" (most common, \005 is byte 5)
      // - "SummaryInformation" (less common)
      const summaryEntry = this.ole.findStreamByName(directory, '\x05SummaryInformation') ||
                           this.ole.findStreamByName(directory, 'SummaryInformation')

      let baseProps: DocumentProperties | null = null
      if (summaryEntry) {
        const summaryStream = this.ole.readStream(summaryEntry)
        if (summaryStream.data && summaryStream.data.length > 0) {
          baseProps = parseSummaryInformation(summaryStream.data)
        }
      }

      // DocumentSummaryInformation stream contains extended properties
      // (category, company, manager, etc.)
      const docSummaryEntry = this.ole.findStreamByName(directory, '\x05DocumentSummaryInformation') ||
                              this.ole.findStreamByName(directory, 'DocumentSummaryInformation')
      if (docSummaryEntry) {
        const docSummaryStream = this.ole.readStream(docSummaryEntry)
        if (docSummaryStream.data && docSummaryStream.data.length > 0) {
          const extProps = parseDocumentSummaryInformation(docSummaryStream.data)
          if (extProps) {
            baseProps = baseProps ? { ...baseProps, ...extProps } : extProps
          }
        }
      }

      return baseProps
    } catch (err) {
      logger.warn('属性提取失败:', err instanceof Error ? err.message : String(err))
      return null
    }
  }

  /**
   * Extract DOP (Document Properties) from the table stream.
   *
   * Per MS-DOC §2.5.6, the DOP sits at offset `fcDop` in the table stream
   * (0Table or 1Table selected by fWhichTblStm) with length `lcbDop`.
   * Returns null if FIB has no DOP offset or the data is invalid.
   */
  private extractDop(fib: FibData, directory: DirectoryEntry[]): DopData | null {
    if (fib.lcbDop <= 0 || fib.fcDop === 0) {
      return null
    }

    try {
      const tableData = this.readTableStream(fib, directory)
      if (!tableData) {
        logger.warn('DOP 提取：未找到表格流')
        return null
      }

      const end = fib.fcDop + fib.lcbDop
      if (end > tableData.length) {
        logger.warn(`DOP 越界 (fcDop=${fib.fcDop}, lcbDop=${fib.lcbDop}, tableLen=${tableData.length})`)
        return null
      }

      const dopBytes = tableData.subarray(fib.fcDop, end)
      return parseDop(dopBytes)
    } catch (err) {
      logger.warn('DOP 提取失败:', err instanceof Error ? err.message : String(err))
      return null
    }
  }

  private extractTextWithFormatFromFib(data: Uint8Array, fib: FibData): any[] {
    const clxEnd = fib.fcClx + fib.lcbClx
    if (clxEnd > data.length) {
      return this.extractParagraphsWithFormat(data, { fcMin: fib.fcMin, fComplex: fib.fComplex })
    }
    const paragraphs = this.extractParagraphsWithFormat(data, { fcMin: fib.fcMin, fComplex: fib.fComplex })
    return this.filterParagraphsWithGenericLogic(paragraphs)
  }

  private extractParagraphsWithFormat(data: Uint8Array, options?: { fcMin?: number; fComplex?: boolean; _isRetry?: boolean }): any[] {
    const paragraphs: any[] = []
    let currentParagraph = ''
    let paragraphIndex = 0
    const maxBytes = Math.min(data.length, this.maxScanBytes)
    let startOffset = options?.fcMin ?? 0

    if (startOffset < 200) {
      startOffset = 200
      logger.log(`从 offset ${startOffset} 开始提取`)
    }

    const isCompressed = options?.fComplex ?? false

    if (isCompressed) {
      for (let i = startOffset; i < maxBytes; i++) {
        const byte = data[i]
        if (byte === 0x0D) {
          if (currentParagraph.trim().length >= 2) {
            const cleaned = this.cleanParagraph(currentParagraph.trim())
            if (cleaned.length > 0) {
              paragraphs.push({ text: cleaned, paraFormat: this.detectParagraphFormat(cleaned, paragraphIndex, 50) || { alignment: 'left' }, charFormat: this.guessCharFormat(cleaned, paragraphIndex) })
              paragraphIndex++
            }
          }
          currentParagraph = ''; continue
        }
        if (byte === 0x0A || byte === 0x00) continue
        if (byte === 0x07) { currentParagraph += '\u0007'; continue }
        if (byte >= 0x20) currentParagraph += String.fromCharCode(byte)
      }
    } else {
      for (let i = startOffset; i < maxBytes - 1; i++) {
        const byte1 = data[i]; const byte2 = data[i + 1]
        if (byte1 === 0x0D && byte2 === 0x00) {
          if (currentParagraph.trim().length >= 2) {
            const cleaned = this.cleanParagraph(currentParagraph.trim())
            if (cleaned.length > 0) {
              paragraphs.push({ text: cleaned, paraFormat: this.detectParagraphFormat(cleaned, paragraphIndex, 50) || { alignment: 'left' }, charFormat: this.guessCharFormat(cleaned, paragraphIndex) })
              paragraphIndex++
            }
          }
          currentParagraph = ''; i++; continue
        }
        if (byte1 === 0x07 && byte2 === 0x00) { currentParagraph += '\u0007'; i++; continue }
        const result = DocParser.scanUtf16Char(data, i, maxBytes)
        if (!result) continue
        if (result.ch) currentParagraph += result.ch
        i += result.advance - 1
      }
    }

    if (currentParagraph.trim().length >= 2) {
      const cleaned = this.cleanParagraph(currentParagraph.trim())
      if (cleaned.length > 0) {
        paragraphs.push({ text: cleaned, paraFormat: this.detectParagraphFormat(cleaned, paragraphIndex, 50) || { alignment: 'left' }, charFormat: this.guessCharFormat(cleaned, paragraphIndex) })
      }
    }

    if (isCompressed && paragraphs.length > 0 && !options?._isRetry) {
      const binaryDetect = this.detectEncodingFromBinary(data)
      if (binaryDetect === false) {
        const alt = this.extractParagraphsWithFormat(data, { ...options, fComplex: false, _isRetry: true })
        return this.filterAndEnhanceParagraphs(alt)
      }
    }

    return this.filterAndEnhanceParagraphs(paragraphs)
  }

  // ==================== Paragraph filtering ====================

  private filterParagraphsWithGenericLogic(paragraphs: any[]): any[] {
    let filtered = paragraphs.filter(p => {
      if (p.text.length < 2) return false
      if (!this.hasSignificantContent(p.text)) return false
      if (p.text.length < 80) {
        const upper = p.text.toUpperCase()
        const skip = ['ROOT', 'SUMMARY', 'DOCUMENT', 'WORD', 'WPS', 'MICROSOFT', 'PROPERTY', 'STORAGE', 'STREAM', 'TABLE', 'FORMAT', 'XMLDATA', 'BASE64', 'TEMPLATE', 'REGISTRY']
        for (const s of skip) { if (upper.includes(s)) return false }
      }
      return true
    })

    for (let i = 0; i < Math.min(3, filtered.length); i++) {
      filtered[i] = this.stripBinaryPrefix(filtered[i])
    }

    filtered = filtered.filter(p => p.text.length >= 2)
    filtered = filtered.filter(p => {
      const weird = (p.text.match(/[^\u4e00-\u9fff\u3400-\u4dbf\w\s,.!?，。！？；：""''（）【】、]/g) || []).length
      return weird / p.text.length < 0.5
    })
    filtered = filtered.map(p => this.cleanWordFieldCodes(p))
    filtered = filtered.filter(p => p.text.length >= 2)
    return filtered
  }

  private filterAndEnhanceParagraphs(paragraphs: any[]): any[] {
    let foundStart = false
    const filtered: any[] = []
    for (const para of paragraphs) {
      if (!foundStart) {
        if (this.hasSignificantContent(para.text)) {
          foundStart = true
          if (!this.shouldSkipParagraph(para.text)) filtered.push(para)
        }
        continue
      }
      if (this.shouldSkipParagraph(para.text)) continue
      if (!this.hasSignificantContent(para.text)) continue
      filtered.push(para)
    }
    if (!foundStart && paragraphs.length > 0) {
      return paragraphs.filter(p => !this.shouldSkipParagraph(p.text)).slice(0, 5)
    }
    return filtered
  }

  // ==================== Format detection ====================

  private detectEncodingFromBinary(data: Uint8Array): boolean | null {
    const startOffset = Math.min(2048, Math.floor(data.length / 4))
    const scanLen = Math.min(data.length - startOffset, 100000)
    const endOffset = startOffset + scanLen

    // Method 1: 0x0D paragraph-marker heuristic
    let totalCR = 0; let crFollowedByNull = 0
    for (let i = startOffset; i < endOffset - 1; i++) {
      if (data[i] === 0x0D) {
        totalCR++
        if (data[i + 1] === 0x00) crFollowedByNull++
      }
    }
    if (totalCR > 0) return crFollowedByNull / totalCR < 0.3

    // Method 2: null-byte distribution heuristic.
    // UTF-16LE interleaves 0x00 after every ASCII byte → ~50% null bytes.
    // 8-bit compressed has almost no 0x00 bytes in text content.
    if (scanLen > 100) {
      let nullCount = 0
      for (let i = startOffset; i < endOffset; i++) {
        if (data[i] === 0x00) nullCount++
      }
      const nullRatio = nullCount / scanLen
      // UTF-16LE: ~50% nulls. 8-bit: << 5%. Use 10% as threshold.
      if (nullRatio > 0.10) return false  // UTF-16LE
      if (nullRatio < 0.02) return true   // 8-bit
    }

    return null
  }

  private scoreRawParagraphs(paragraphs: any[]): number {
    if (!paragraphs || paragraphs.length === 0) return 0
    let score = 0
    for (const p of paragraphs) {
      const text = p.text || ''
      if (text.length < 4) continue
      const englishWords = (text.match(/[A-Za-z]{3,}/g) || []).length
      if (englishWords >= 2) score += 30; else if (englishWords >= 1) score += 10
      const chineseCount = (text.match(/[一-鿿]/g) || []).length
      if (chineseCount >= 3) score += 25; else if (chineseCount >= 1) score += 5
      if (text.length >= 10 && text.length <= 500) score += Math.min(text.length / 2, 50)
      if (/[,.]/.test(text) || /[，。]/.test(text)) score += 10
      if (/^[A-Z]/.test(text.trim())) score += 5
    }
    return score
  }

  private scorePlainText(text: string): number {
    if (!text || text.length === 0) return 0
    const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0)
    let score = 0
    for (const p of paragraphs) {
      if (p.length < 4) continue
      const englishWords = (p.match(/[A-Za-z]{3,}/g) || []).length
      if (englishWords >= 2) score += 30; else if (englishWords >= 1) score += 10
      const chineseCount = (p.match(/[一-鿿]/g) || []).length
      if (chineseCount >= 3) score += 25; else if (chineseCount >= 1) score += 5
      if (p.length >= 10 && p.length <= 500) score += Math.min(p.length / 2, 50)
      if (/[,.]/.test(p) || /[，。]/.test(p)) score += 10
    }
    return score
  }

  // ==================== Character / paragraph format ====================

  private guessCharFormat(text: string, _paragraphIndex?: number): any {
    const charFormat: any = { styles: [] }
    const chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const totalLength = text.length
    const chineseRatio = chineseCount / totalLength
    const stripped = text.replace(/\s/g, '')
    const trimmed = text.trim()

    // Default font: Chinese docs use Song, English use Times New Roman
    if (chineseCount >= 2) {
      charFormat.fontSize = 16
      if (chineseRatio > 0.7) charFormat.fontName = '仿宋_GB2312'
      else charFormat.fontName = '宋体'
    } else {
      charFormat.fontSize = 12
      charFormat.fontName = 'Times New Roman'
    }

    // --- Title detection ---
    // Chinese title: short, >50% Chinese, no sentence punctuation
    const hasSentencePunct = /[，。！？、；]/.test(text)
    const noSentencePunct = !hasSentencePunct
    const pureName = chineseCount >= 2 && chineseCount <= 4 && stripped.length === chineseCount && trimmed.length <= 4

    if (!pureName && noSentencePunct && !text.includes('：') && !text.includes(':')) {
      const isEnglishTitle = /^[A-Z][a-z]/.test(trimmed) && /[A-Za-z]/.test(trimmed) && !/[，。！？、；]/.test(trimmed)
      const isAllCapsTitle = /^[A-Z\s]{3,}$/.test(trimmed) && trimmed.length >= 3 && trimmed.length <= 40
      const isShortChineseTitle = chineseRatio > 0.5 && totalLength < 22 && chineseCount >= 2

      if (isAllCapsTitle) {
        // ALL CAPS → large title
        charFormat.bold = true
        charFormat.fontSize = 28
      } else if (isEnglishTitle && totalLength < 40) {
        // "This Is A Title" pattern or first-word-capitalized
        const capitalWords = (trimmed.match(/\b[A-Z][a-z]{2,}\b/g) || []).length
        const totalWords = (trimmed.match(/\b[a-zA-Z]{2,}\b/g) || []).length
        if (capitalWords >= Math.min(totalWords, 2) && totalWords >= 2) {
          charFormat.bold = true
          charFormat.fontSize = 22
        } else if (totalLength < 20) {
          charFormat.bold = true
          charFormat.fontSize = 22
        }
      } else if (isShortChineseTitle) {
        charFormat.bold = true
        charFormat.fontSize = stripped.length < 6 ? 36 : 22
      }
    }

    charFormat.styles = this.detectCharacterStyles(text)
    return charFormat
  }

  private detectCharacterStyles(text: string): Array<{start: number; end: number; style: any}> {
    const styles: Array<{start: number; end: number; style: any}> = []
    let currentStyle: any = null
    let styleStart = 0

    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      const isDigit = /[0-9]/.test(char)
      const isChinese = /[\u4e00-\u9fff]/.test(char)
      const isUpperCase = /[A-Z]/.test(char)
      const isLowerCase = /[a-z]/.test(char)
      const isWhitespace = /\s/.test(char)

      let charStyle: any = null
      if (isWhitespace) charStyle = { underline: false }
      else if (isDigit) charStyle = { fontName: 'Times New Roman', underline: this.shouldHaveUnderline(text, i) }
      else if (isUpperCase || isLowerCase) charStyle = { fontName: 'Times New Roman', underline: false }
      else if (isChinese) charStyle = { fontName: '仿宋', underline: false }
      else charStyle = { fontName: this.getChineseFont(text, i), underline: false }

      if (currentStyle && this.isSameStyle(currentStyle, charStyle)) continue
      if (currentStyle && !this.isSameStyle(currentStyle, charStyle)) {
        styles.push({ start: styleStart, end: i, style: currentStyle })
      }
      currentStyle = charStyle
      styleStart = i
    }

    if (currentStyle) styles.push({ start: styleStart, end: text.length, style: currentStyle })

    const colonPositions: number[] = []
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '：' || text[i] === ':') colonPositions.push(i)
    }
    if (colonPositions.length > 0) {
      const shouldUL = new Array(text.length).fill(false)
      for (let ci = 0; ci < colonPositions.length; ci++) {
        const start = colonPositions[ci] + 1
        const end = ci + 1 < colonPositions.length ? colonPositions[ci + 1] - 4 : text.length
        for (let j = start; j < end; j++) shouldUL[j] = true
      }
      for (const seg of styles) {
        if (!seg.style) continue
        let count = 0
        for (let j = seg.start; j < seg.end; j++) { if (shouldUL[j]) count++ }
        if (count > (seg.end - seg.start) * 0.4) seg.style.underline = true
      }
    }
    return styles
  }

  private shouldHaveUnderline(text: string, index: number): boolean {
    const char = text[index]
    if (!/[0-9]/.test(char)) return false
    const before = text.substring(Math.max(0, index - 30), index)
    const after = text.substring(index, Math.min(text.length, index + 30))
    const hasColonBefore = /[：:]\s*$/.test(before)
    const hasDatePattern = /[年日月时分秒]/.test(after) || /[年日月时分秒]/.test(before)
    const hasTimePattern = /[0-9]{2,4}[年月日时分秒]/.test(after) || /[0-9]{2,4}[年月日时分秒]/.test(before)
    return hasColonBefore || hasDatePattern || hasTimePattern
  }

  private isSameStyle(style1: any, style2: any): boolean {
    if (!style1 || !style2) return false
    const fn1 = style1.fontName
    const fn2 = style2.fontName
    // If either has no explicit fontName, treat as same style (inherits paragraph default)
    if (fn1 === undefined || fn2 === undefined) {
      return (style1.underline || false) === (style2.underline || false)
    }
    return fn1 === fn2 && (style1.underline || false) === (style2.underline || false)
  }

  private getChineseFont(text: string, index: number): string {
    const before = text.substring(0, index)
    const chineseCount = (before.match(/[\u4e00-\u9fff]/g) || []).length
    if (before.length === 0) return '宋体'
    return chineseCount / before.length > 0.7 ? '宋体' : '仿宋'
  }

  private detectParagraphFormat(text: string, index: number, totalParagraphs: number): any {
    const format: any = {}
    const alignment = this.detectAlignment(text, index, totalParagraphs)
    if (alignment) format.alignment = alignment

    // Detect list type (with level inferred from leading whitespace).
    const listInfo = this.detectListInfo(text)
    if (listInfo) {
      format.listType = listInfo.listType
      format.listStyle = listInfo.listStyle
      if (listInfo.listLevel > 0) format.listLevel = listInfo.listLevel
    }

    return format
  }

  /**
   * Detect list marker at the start of a paragraph.
   *
   * Supported markers (ordered):
   *   - Arabic numerals: `1.`, `2)`, `(1)`, `（1）`
   *   - Multi-level Arabic: `1.1`, `1.2.3`
   *   - Single Latin letter: `a.`, `B)`, `(a)`
   *   - Roman numerals: `i.`, `ii.`, `iv.`, `I.`, `II.`
   *   - CJK ideographic: `一、`, `二、`, `（一）`, `甲、`, `乙、`
   *   - Circled numbers: `① ② ... ㊿`
   *
   * Supported markers (unordered):
   *   - ASCII bullets: `-`, `*`, `+`
   *   - CJK bullets: `• ○ ● ▪ ▸ ► → ◇ ◆`
   *
   * The list level is inferred from leading whitespace (per 2 spaces ≈ 1 level).
   * Returns null if the paragraph does not look like a list item.
   */
  private detectListInfo(text: string): { listType: 'ordered' | 'unordered'; listStyle: string; listLevel: number } | null {
    // Count leading whitespace (spaces / tabs / full-width spaces).
    const leadingMatch = text.match(/^[\s\u3000\t]*/)
    const leadingSpaces = leadingMatch ? leadingMatch[0].replace(/\t/g, '  ').replace(/\u3000/g, '  ').length : 0
    const listLevel = Math.floor(leadingSpaces / 2)

    const trimmed = text.trim()
    if (trimmed.length < 2) return null

    // 1. Multi-level Arabic: 1.1 / 1.2.3 (at least one dot-separated number followed by space or end)
    if (/^\d+(?:\.\d+)+[\.\s\t]/.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'decimal', listLevel }
    }

    // 2. Arabic numeral with . or ) then space: 1. / 2) / 12.
    if (/^\d+[\.\)][\s\t]/.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'decimal', listLevel }
    }

    // 3. Parenthesized Arabic: (1) / （2） / [1] — allow optional space after closing paren.
    if (/^[\(\（\[]\d+[\)\）\]][\s\t]*/.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'decimal', listLevel }
    }

    // 4. Roman numerals: i. / ii. / iv. / I. / II. (checked BEFORE single Latin letter
    //    so "i." / "v." / "x." are treated as Roman rather than lower-alpha).
    if (/^(?:i{1,3}|iv|v|vi{0,3}|ix|x|I{1,3}|IV|V|VI{0,3}|IX|X)[\.\)][\s\t]/.test(trimmed)) {
      const isUpper = /^[IVXLCDM]/.test(trimmed)
      return { listType: 'ordered', listStyle: isUpper ? 'upper-roman' : 'lower-roman', listLevel }
    }

    // 5. Latin letter with . or ): a. / B) / (a)
    if (/^[a-zA-Z][\.\)][\s\t]/.test(trimmed) && trimmed.length >= 3) {
      return { listType: 'ordered', listStyle: 'lower-alpha', listLevel }
    }
    if (/^[\(\（][a-zA-Z][\)\）][\s\t]*/.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'lower-alpha', listLevel }
    }

    // 6. CJK ideographic numerals: 一、二、三、...、十、十一、... / 甲、乙、... / 壹、贰、...
    //    Also accept （一）（二） parenthesized form (no trailing space required,
    //    since Chinese numbered items often have no separator).
    const cjkNumeralMatch = trimmed.match(/^([一二三四五六七八九十百千零〇]{1,4}|[甲乙丙丁戊己庚辛壬癸]|[壹贰叁肆伍陆柒捌玖拾佰仟]{1,4})[\、\.\)]/)
    if (cjkNumeralMatch) {
      return { listType: 'ordered', listStyle: 'cjk-ideographic', listLevel }
    }
    if (/^[\(\（]([一二三四五六七八九十]{1,4}|[甲乙丙丁戊己庚辛壬癸])[）\)][\s\t]*/.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'cjk-ideographic', listLevel }
    }

    // 7. Circled numbers: ① ② ... ㊿ (U+2460..U+2473, U+3251..U+325F, U+32B1..U+32BF)
    if (/^[\u2460-\u2473\u3251-\u325F\u32B1-\u32BF][\s\t]/.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'cjk-ideographic', listLevel }
    }

    // 8. Unordered: ASCII and CJK bullets
    if (/^[•\-\*][\s\t]/.test(trimmed) || /^[•\*]\s/.test(trimmed)) {
      return { listType: 'unordered', listStyle: 'disc', listLevel }
    }
    if (/^[○●▪▸►→◇◆]\s/.test(trimmed)) {
      return { listType: 'unordered', listStyle: 'disc', listLevel }
    }
    if (/^[▪▫◦‣⁃]\s/.test(trimmed)) {
      return { listType: 'unordered', listStyle: 'square', listLevel }
    }

    return null
  }

  private detectAlignment(text: string, index: number, totalParagraphs: number): string | null {
    const trimmed = text.trim()
    const stripped = trimmed.replace(/\s/g, '')
    const chineseCount = (stripped.match(/[一-鿿]/g) || []).length
    const totalLen = trimmed.length
    const leadingSpaces = text.length - text.trimStart().length
    const trailingSpaces = text.trimEnd().length === 0 ? 0 : text.length - text.trimEnd().length

    // Detect centering by leading whitespace: if text is centered in the "page",
    // it will have roughly equal leading and trailing whitespace within the line.
    // A large leading space ratio suggests intentional centering.
    if (totalLen > 0 && leadingSpaces > 0) {
      const leadingRatio = leadingSpaces / (leadingSpaces + totalLen)
      if (leadingRatio > 0.15 && leadingRatio < 0.5) return 'center'
    }

    // Short line with both leading and trailing spaces → centered
    if (leadingSpaces > 2 && trailingSpaces > 2 && totalLen < 60) return 'center'

    // Pure Chinese name (2-4 chars) in the second half of document → right-aligned (signature)
    const onlyName = chineseCount >= 2 && chineseCount <= 4 && stripped.length === chineseCount
    if (onlyName && index > totalParagraphs * 0.5) return 'right'

    // Date lines → right-aligned
    if (/^\s*\d{4}\s*年/.test(trimmed) || /^\s*\d{1,2}\s*月/.test(trimmed)) return 'right'

    // Short ALL-CAPS English → center (likely a title/subtitle)
    if (/^[A-Z][A-Z\s]+$/.test(trimmed) && totalLen >= 3 && totalLen <= 50) return 'center'

    // Short centered Chinese title
    const hasSentencePunct = /[，。！？、；]/.test(trimmed)
    const noFieldMarkers = !trimmed.includes('：') && !trimmed.includes(':') && !trimmed.includes('？') && !trimmed.includes('?') && !hasSentencePunct
    if (totalLen < 18 && chineseCount >= 2 && chineseCount / stripped.length > 0.5 && noFieldMarkers) return 'center'

    return null
  }

  // ==================== Paragraph cleaning ====================

  private cleanParagraph(p: string): string {
    let cleaned = p.trim()
    const junkChars = new RegExp(`^[${DocParser.JUNK_CHAR_CLASS}]+`)
    cleaned = cleaned.replace(junkChars, '')
    return cleaned.trim()
  }

  private stripBinaryPrefix(para: any): any {
    const text = para.text
    if (!text || text.length < 10) return para

    let realStart = 0

    // Strategy 1: longest run of valid characters (existing)
    let longestValidRun = 0
    let longestValidRunStart = 0
    let currentRun = 0
    let currentRunStart = 0

    // Strategy 2: first English capital-letter word start
    let firstCapitalWordStart = -1
    // Strategy 3: first CJK character
    let firstCjkStart = -1

    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i)
      const ch = text[i]

      // Track longest valid run
      if (this.isValidChar(charCode)) {
        if (currentRun === 0) currentRunStart = i
        currentRun++
        if (currentRun > longestValidRun) {
          longestValidRun = currentRun
          longestValidRunStart = currentRunStart
        }
      } else {
        currentRun = 0
      }

      // Track first English word starting with capital letter
      if (firstCapitalWordStart === -1 && /[A-Z]/.test(ch) && i + 2 < text.length && /[a-z]/.test(text[i + 1])) {
        // Check that we're not in the middle of a word
        const prev = i > 0 ? text[i - 1] : ' '
        if (prev === ' ' || !this.isValidChar(text.charCodeAt(i - 1))) {
          firstCapitalWordStart = i
        }
      }

      // Track first CJK character
      if (firstCjkStart === -1 && charCode >= 0x4E00 && charCode <= 0x9FFF) {
        firstCjkStart = i
      }
    }

    // Choose the best start position
    let candidates: Array<{ pos: number; reason: string; score: number }> = []

    if (longestValidRun >= 5) {
      candidates.push({ pos: longestValidRunStart, reason: 'longestRun', score: longestValidRun })
    }

    // Prefer capital word starts that are near the longest run
    if (firstCapitalWordStart >= 0) {
      // Score: how close to start but after noise, bonus if near longest run
      const nearLongest = Math.abs(firstCapitalWordStart - longestValidRunStart) < 20 ? 30 : 0
      candidates.push({ pos: firstCapitalWordStart, reason: 'capitalWord', score: 20 + nearLongest })
    }

    // Prefer CJK starts after position 0
    if (firstCjkStart && firstCjkStart > 0 && firstCjkStart < longestValidRunStart) {
      candidates.push({ pos: firstCjkStart, reason: 'cjk', score: 25 })
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score)
      realStart = candidates[0].pos
    }

    if (realStart > 0) {
      const cleaned = text.substring(realStart)
      const newCharFormat = { ...para.charFormat }
      if (newCharFormat.styles && newCharFormat.styles.length > 0) {
        newCharFormat.styles = newCharFormat.styles
          .map((style: any) => ({ start: Math.max(0, style.start - realStart), end: Math.max(0, style.end - realStart), style: style.style }))
          .filter((style: any) => style.end > style.start && style.start < cleaned.length)
      }
      return { ...para, text: cleaned, charFormat: newCharFormat }
    }

    const totalWeird = (text.match(/[^\u4e00-\u9fff\u3400-\u4dbf\w\s,.!?，。！？；：""''（）【】、]/g) || []).length
    if (totalWeird > text.length * 0.4) return { ...para, text: '' }

    return para
  }

  /**
   * 替换 mainText 中的页码域占位文本。
   *
   * 由于 extractTextFromRange 跳过了 0x13/0x14/0x15 域字符，mainText 中页码域的
   * instruction 和 result 连在一起（如 "PAGE1"、"NUMPAGES5"）。本方法将每个域的
   * instruction+result 连接串替换为纯 result，使段落显示为页码而非域代码。
   *
   * 策略：
   * 1. 对每个页码域，构建搜索串 = instruction.trim() + result
   * 2. 在 mainText 中搜索该串，替换为 result
   * 3. 由于 instruction 通常包含开关（如 "PAGE \* MERGEFORMAT"），搜索串足够独特
   * 4. 仅替换第一个匹配，避免误伤正文
   *
   * 若搜索串未找到匹配（mainText 偏移与 cp 不一致等情况），该域保留原状，
   * 由 cleanWordFieldCodes 的启发式清理兜底。
   */
  private replacePageFieldsInText(text: string, pageFields: PageFieldInfo[]): string {
    let result = text
    for (const field of pageFields) {
      const instruction = field.instruction.trim()
      const searchStr = instruction + field.result
      if (searchStr.length === 0) continue
      // 仅替换第一个匹配，避免误伤
      const idx = result.indexOf(searchStr)
      if (idx >= 0) {
        result = result.slice(0, idx) + field.result + result.slice(idx + searchStr.length)
      }
    }
    return result
  }

  private isValidChar(charCode: number): boolean {
    return (charCode >= 0x4E00 && charCode <= 0x9FFF) || (charCode >= 0x3400 && charCode <= 0x4DBF) ||
      (charCode >= 32 && charCode <= 126) ||
      [0x3001, 0x3002, 0xFF0C, 0xFF0E, 0x300A, 0x300B, 0xFF1A, 0x2018, 0x2019, 0x201C, 0x201D, 0xFF08, 0xFF09, 0xFF1F, 0xFF01, 0x3000, 0x2014, 0xFF0B].includes(charCode)
  }

  private cleanWordFieldCodes(para: any): any {
    let text = para.text

    const pagePattern = /第\s*PAGE\s*(\d+)\s*页\s*共\s*NUMPAGES\s*(\d+)\s*页/gi
    const replaced = text.replace(pagePattern, '第 $1 页 共 $2 页')

    if (replaced === text) {
      const fieldPatterns = [
        /\bPAGE\b/gi, /\bNUMPAGES\b/gi, /\bDATE\b/gi, /\bTIME\b/gi, /\bSECTION\b/gi,
        /\bSECTIONPAGES\b/gi, /\bFILENAME\b/gi, /\bAUTHOR\b/gi, /\bTITLE\b/gi,
        /\bSUBJECT\b/gi, /\bKEYWORDS\b/gi, /\bCOMMENTS\b/gi, /\bCREATEDATE\b/gi,
        /\bSAVEDATE\b/gi, /\bPRINTDATE\b/gi, /\bEDITTIME\b/gi, /\bNUMWORDS\b/gi,
        /\bNUMCHARS\b/gi, /\bDOCPROPERTY\b/gi, /\bMERGEFIELD\b/gi, /\bREF\b/gi,
        /\bHYPERLINK\b/gi, /\bINCLUDEPICTURE\b/gi, /\bINCLUDETEXT\b/gi, /\bSEQ\b/gi,
        /\bTOC\b/gi, /\bTOC\s+o\s+"1-9"\b/gi, /\bTOC\s+o\s+"1-3"\b/gi,
      ]
      let cleaned = text
      for (const pattern of fieldPatterns) cleaned = cleaned.replace(pattern, '')
      text = cleaned
    } else {
      text = replaced
    }

    const cleaned = text.replace(/ {2,}/g, ' ').replace(/，\s*，/g, '，').replace(/。\s*。/g, '。').replace(/：\s*：/g, '：').trim()

    if (cleaned !== text) {
      const newCharFormat = { ...para.charFormat }
      if (newCharFormat.styles && newCharFormat.styles.length > 0) delete newCharFormat.styles
      return { ...para, text: cleaned, charFormat: newCharFormat }
    }
    return para
  }

  private hasSignificantContent(text: string): boolean {
    if (text.length < 2) return false
    if (isTableRowText(text)) return true
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const chineseRatio = chineseChars / text.length
    if (chineseChars >= 2 && chineseRatio > 0.3) return true

    const englishWords = (text.match(/[A-Za-z]{3,}/g) || []).filter(w => /[aeiouyAEIOUY]/.test(w)).length
    if (englishWords >= 2) return true

    const hasCommonPunctuation = /[，。、；：""''【】《》]/.test(text)
    const hasContent = /[\u4e00-\u9fff]{2,}/.test(text)
    if (hasCommonPunctuation && hasContent) return true

    const printableChars = text.replace(/[\s\p{P}]/gu, '').length
    if (printableChars >= 3 && chineseChars >= 1) return true

    return false
  }

  private shouldSkipParagraph(text: string): boolean {
    return this.hasTooManyJunkChars(text)
  }

  private hasTooManyJunkChars(text: string): boolean {
    const junkPattern = new RegExp(`[${DocParser.JUNK_CHAR_CLASS}${DocParser.EXTRA_JUNK_CHARS}]`, 'g')
    const junkMatches = text.match(junkPattern) || []
    if (junkMatches.length > 0) {
      const totalLength = text.trim().length
      if (junkMatches.length > 2 || (totalLength > 0 && junkMatches.length / totalLength > 0.2)) return true
    }
    return false
  }

  private createFormattedParagraphsFromText(text: string): any[] {
    const paragraphs: any[] = []
    // When the text contains Word table cell marks (0x07), split by single
    // newlines so each table row stays its own paragraph. Otherwise split by
    // double newlines (piece boundaries) to preserve the existing behavior.
    const hasCellMarks = text.includes('\u0007')
    const separator = hasCellMarks ? /\n/ : /\n\n/
    const textParagraphs = text.split(separator).filter(p => p.trim().length > 0)
    for (let i = 0; i < textParagraphs.length; i++) {
      const paraText = textParagraphs[i]
      const cleaned = this.cleanParagraph(paraText.trim())
      if (!this.shouldSkipParagraph(cleaned) && cleaned.length > 0) {
        paragraphs.push({ text: cleaned, paraFormat: this.detectParagraphFormat(cleaned, i, textParagraphs.length), charFormat: this.guessCharFormat(cleaned, i) })
      }
    }
    return paragraphs
  }

  private extractTextFromFullFile(): string {
    const fullData = new Uint8Array(this.buffer)
    return this.extractTextSimple(fullData)
  }
}

// ==================== Public API ====================

/**
 * Parse a .doc File object and extract plain text.
 * @param file - The .doc file to parse.
 * @param debug - If true, enables debug logging.
 * @returns A promise that resolves to the parse result.
 */
export function parseDocFile(file: File, debug: boolean = false): Promise<{ text: string; success: boolean; error?: string }> {
  if (debug) logger.enabled = true
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer
      if (!buffer) {
        resolve({ text: '', success: false, error: '无法读取文件' })
        return
      }
      try {
        const parser = new DocParser(buffer)
        resolve(parser.parse())
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        resolve({ text: '', success: false, error: `解析失败: ${message}` })
      }
    }
    reader.onerror = () => resolve({ text: '', success: false, error: '文件读取失败' })
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Parse a .doc file from an ArrayBuffer and return the formatted document.
 * @param buffer - The .doc file as ArrayBuffer.
 * @param _fileName - Optional file name (for logging).
 * @returns The parse result with paragraphs and text.
 */
export function parseDocFileFromBuffer(
  buffer: ArrayBuffer,
  _fileName?: string
): { success: boolean; document?: any; text?: string; error?: string } {
  try {
    const parser = new DocParser(buffer)
    return parser.parseWithFormat()
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    return { success: false, error: `解析失败: ${message}` }
  }
}

/**
 * Parse a .doc File and return the formatted document with paragraphs and text.
 * @param file - The .doc file to parse.
 * @param debug - If true, enables debug logging.
 * @returns A promise that resolves to the parse result.
 */
export function parseDocFileWithFormat(file: File, debug: boolean = false): Promise<{
  success: boolean
  document?: any
  text?: string
  error?: string
}> {
  if (debug) logger.enabled = true
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer
      if (!buffer) {
        resolve({ success: false, error: '无法读取文件' })
        return
      }
      resolve(parseDocFileFromBuffer(buffer, file.name))
    }
    reader.onerror = () => resolve({ success: false, error: '文件读取失败' })
    reader.readAsArrayBuffer(file)
  })
}
