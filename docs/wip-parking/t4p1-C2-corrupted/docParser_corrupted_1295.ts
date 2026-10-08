import { logger, enableDebugMode } from './logger'
export type ProgressCallback = (stage: ParseProgressStage, percent: number) => void
import { OleParser } from './oleParser'
import type { StreamData, DirectoryEntry } from './oleParser'
import { parseFib } from './fibParser'
import type { FibData, RgCcp } from './fibParser'
import { extractImages, extractPictures, extractProperties, extractDop } from './docparser/assets/documentAssets'
import {
import { hasProperties } from './propertyParser'
import { parseClxPieces, type Piece } from './docparser/pieceTable'
import { guessCharFormat, detectParagraphFormat, detectListInfo, detectAlignment } from './docparser/heuristics/textHeuristics'
import { parseClxWithStories, toDocumentStories, type StoryText, type StoryPieceMap } from './docparser/storySplitter'
import { parseChpxRuns, parsePapxRuns, parseChpxRunsFromFkp, parsePapxRunsFromFkp, mergeCharFormatForParagraph } from './formatParser'
import type { PieceFcRange } from './formatParser'
import type { ChpxRun, PapxRun } from './formatParser'
import { parseStylesheet, resolveStyleFormat, getHeadingLevel, detectStyleSet } from './styleParser'
import type { StyleDefinition, StyleSetInfo } from './styleParser'
import { parseFontTable } from './fontParser'
import { parseListTable, getListFormat, getListFormatFromLfo, parsePlcfLfo } from './listParser'
import type { ListEntry, LfoEntry } from './listParser'
import { parsePlcfFld, extractHyperlinks, extractAllFields, extractDocumentFields, extractPageFields, extractCrossReferences, TocEntry, IndexEntry } from './fieldParser'
import type { FieldRange, DocumentFields, PageFieldInfo, CrossReferenceInfo } from './fieldParser'
import type { DocumentProperties } from './propertyParser'
import type { DopData } from './dopParser'
import type { DocumentStories, CharacterFormat, DocumentFlags, RevisionMark, BookmarkRange, SectionInfo, PageFieldRange, CrossReferenceRange, ParseResult, ParsedDocument, ParseErrorCode } from './docFormat'
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

 * 解析进度回调
 * @param stage 阶段标识
 * @param percent 进度百分比 0-100





export class DocParser {
  extractTextWithAutoDetect as encExtractTextWithAutoDetect,
  extractTextSimple as encExtractTextSimple,
  detectEncodingFromBinary as encDetectEncodingFromBinary,
  scoreRawParagraphs as encScoreRawParagraphs,
  shouldTryCrossEncodingRetry as encShouldTryCrossEncodingRetry,
  crossEncodingRetryWins as encCrossEncodingRetryWins,
  isValidChar as encIsValidChar,
  scorePlainText as encScorePlainText,
  stripBinaryPrefix as encStripBinaryPrefix,
} from './docparser/encodingDetector'
  parseClx as clxParseClx,
  readClxData as clxReadClxData,
  readTableStream as clxReadTableStream,
  extractTextFromRange as clxExtractTextFromRange,
  containsBinarySignature as clxContainsBinarySignature,
  readUint16 as clxReadUint16,
  readUint32 as clxReadUint32,
  MAX_TOTAL_CHARS as CLX_MAX_TOTAL_CHARS,
  isValidPrintableChar as clxIsValidPrintableChar,
  cleanParagraph,
  shouldSkipParagraph,
  hasSignificantContent,
  filterParagraphsWithGenericLogic as pf_filterParagraphsWithGenericLogic,
  filterAndEnhanceParagraphs as pf_filterAndEnhanceParagraphs,
  applyStructuralFormats as pf_applyStructuralFormats,
  removeInternalDuplicates as pf_removeInternalDuplicates,
  collapseWholeBlockRepeats as pf_collapseWholeBlockRepeats,
  cleanWordFieldCodes as pf_cleanWordFieldCodes,
  replacePageFieldsInText as pf_replacePageFieldsInText,
  splitMultiRowTables as pf_splitMultiRowTables,
  normalizeParagraphCpAxis as pf_normalizeParagraphCpAxis,
  parseFormatRuns as fr_parseFormatRuns,
  createParagraphsWithRealFormats as fr_createParagraphsWithRealFormats,
  tryParseFormatsFromTableStream as fr_tryParseFormatsFromTableStream,
  applyParsedStylesToParagraphs as fr_applyParsedStylesToParagraphs,
              crossReferences,
      readUint16: clxReadUint16,
      readUint32: clxReadUint32,
      readTableStream: this.readTableStream.bind(this),
  extractTextFromRange(data: Uint8Array, start: number, end: number, isCompressed: boolean = false, guardBinary: boolean = true): string {
  stripBinaryPrefix(para: any): any {
      shouldSkipParagraph: (t: string) => self.shouldSkipParagraph(t),
  isValidChar(charCode: number): boolean {
  scorePlainText(text: string): number {
    reader.onload = (e) => {
    reader.onerror = () => resolve({ text: '', success: false, error: '文件读取失败' })
    reader.readAsArrayBuffer(file)
    reader.onerror = () => resolve({ success: false, error: '文件读取失败', errorCode: 'FILE_READ_FAILED' })

export { enableDebugMode }

} from './docparser/clxReader'
} from './docparser/heuristics/paragraphFilter'
} from './docparser/formatRecovery'

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

// ---- DocParser ----

/** Default max bytes to scan in a WordDocument stream (10MB). */
const DEFAULT_MAX_SCAN_BYTES = 10 * 1024 * 1024

/**
 * Parsed piece metadata from a PlcPcd. Does not hold the extracted text —
 * callers decide how to slice the byte range (whole piece, or a sub-range
 * when splitting across story boundaries) and call extractTextFromRange.
 */

/**
 * Text bucketed by story. Word stores all stories in one continuous
 * character stream; we split it back out using FibRgLw's rgCcp.
 */

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
   * DEF-004：启发式无界扫描因 maxScanBytes 被截断时置位（显式告警标志）。
   * 持有验证过的文本右界（fcMac：piece table / FibBase 范围 / ccpText 界）时
   * 不做截断，也不置位——上限只约束"无可靠边界、需要兜底扫全流"的场景。
   */
  scanLimitReached = false

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
      // Unreachable in synthetic fixtures: the UTF-16 scanner pairs the
      // odd-position zero byte before a text block with the text's first
      // byte (0x00 0x48 = U+4800), so only real documents with natural
      // paragraph marks exercise this fallback. Real docs are covered by
      // tests/realDocs.test.ts.
      /* v8 ignore start */
      if (this.text.length === 0) {
        this.text = this.extractTextSimple(wordDocumentStream.data)
      }
      /* v8 ignore stop */

      if (this.text.length === 0) {
        return { text: '', success: false, error: '文档内容为空' }
      }
      return { text: this.text, success: true }
    // Unreachable: every operation above is guarded (OLE safe reads, bounded
    // scans). Kept as a last-resort safety net.
    /* v8 ignore start */
    } catch (error) {
      const message = error instanceof Error ? `${error.message}\n${error.stack}` : '未知错误'
      logger.error('解析过程发生异常', message)
      return { text: '', success: false, error: `解析失败: ${error instanceof Error ? error.message : '未知错误'}` }
    }
    /* v8 ignore stop */
  }

  /**
   * Parse the document and return formatted paragraphs (with inferred styles).
   * @returns Parse result with `{ document, text, success, error? }`.
   *   `document.paragraphs` is an array of `{ text, charFormat, paraFormat }`.
   */
  parseWithFormat(onProgress?: ProgressCallback): ParseResult {
    try {
      logger.info('开始解析带格式的 DOC 文件')
      onProgress?.('verifying', 5)

      if (!this.ole.isOleFile()) {
        const error = this.ole.getFormatErrorString()
        const errorCode: ParseErrorCode = 'OLE_FORMAT'
        return { success: false, error, errorCode }
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
        return { success: false, error: '未找到 WordDocument 流', errorCode: 'NO_WORDDOCUMENT_STREAM' }
      }

      onProgress?.('parsing_clx', 25)
      const extracted = this.extractFormattedText(wordDocumentStream, directory, onProgress)

      // Unreachable in synthetic fixtures (see the FIB empty-range note):
      // the UTF-16 scanner pairs odd-position zero bytes with the following
      // text byte, so only real documents with natural paragraph marks reach
      // this fallback. Real docs are covered by tests/realDocs.test.ts.
      /* v8 ignore start */
      if (extracted.paragraphs.length === 0) {
        const fallbackText = this.extractTextSimple(wordDocumentStream.data)
        if (fallbackText.length > 0) {
          return { success: true, text: fallbackText }
        }
        return { success: false, error: '文档内容为空', errorCode: 'EMPTY_DOCUMENT' }
      }
      /* v8 ignore stop */

      // R-F4-1 单轴不变式归一化（FIELD-CP-GOV）：_cpStart 一律在此咽喉点重算为
      // 「最终清洗后文本」的剥离轴累计——上游赋值基于清洗前游标，经域码剔除/
      // 段落过滤/结构化插空后必然漂移（实证 golden para6=47 vs 剥离推算17）。
      // 不变式：相邻保留段 _cpStart 差 == 前段最终 text.length + 1。
      this.normalizeParagraphCpAxis(extracted.paragraphs)

      onProgress?.('building_paragraphs', 80)
      let plainText = ''
      for (let i = 0; i < extracted.paragraphs.length; i++) {
        if (i > 0) plainText += '\n\n'
        plainText += extracted.paragraphs[i].text
      }
      const document: ParsedDocument = { paragraphs: extracted.paragraphs }
      if (extracted.stories) document.stories = extracted.stories
      if (extracted.hyperlinks && extracted.hyperlinks.length > 0) {
        // FieldRange 的 url/result 为可选，但 flt===37 过滤后的超链接记录
        // 在消费端契约中必有 url/result（与 pageFields/crossReferences 同款断言）。
        document.hyperlinks = extracted.hyperlinks as ParsedDocument['hyperlinks']
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
      if (extracted.charts && extracted.charts.length > 0) {
        document.charts = extracted.charts
      }
      if (extracted.wordArts && extracted.wordArts.length > 0) {
        document.wordArts = extracted.wordArts
      }
      if (extracted.indexEntries && extracted.indexEntries.length > 0) {
        document.index = extracted.indexEntries
      }
      if (extracted.styles && extracted.styles.length > 0) {
        document.styles = extracted.styles
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
      // PERF-T2 结构化优先：先走 PICF/fcPic 结构化路径（pictureParser，
      // 按 CHPX 锚点精确定位、无全流扫描），魔数扫描仅在 extractImages
      // 内作为预算内兜底（scanBudget=maxScanBytes，见 extractImages 注释）。
      const chpxRunsForPics = extracted.chpxRuns || []
      const pictures = this.extractPictures(directory, chpxRunsForPics, wordDocumentStream.data)
      if (pictures.length > 0) document.pictures = pictures

      // Extract embedded images (PNG/JPEG/BMP/GIF) from the Data stream,
      // falling back to the WordDocument stream. Attached as data URLs.
      const images = this.extractImages(directory, wordDocumentStream.data)
      if (images.length > 0) document.images = images

      onProgress?.('finalizing', 100)
      return { success: true, document, text: plainText }
    } catch (error) {
      const message = error instanceof Error ? `${error.message}\n${error.stack}` : '未知错误'
      logger.error('解析过程发生异常', message)
      return { success: false, error: `解析失败: ${error instanceof Error ? error.message : '未知错误'}`, errorCode: 'PARSE_FAILED' }
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

      // Fall back to whole-document concatenation. (Reachable in real
      // documents whose rgCcp is absent; story-split path covers fixtures.)
      /* v8 ignore start */
      const textFromClx = this.parseClx(clxData, data)
      if (textFromClx.length > 0) return textFromClx
      /* v8 ignore stop */
    }

    // parseFib reports fcMin=fcMac=0 for Word 97+ files (the legacy FibBase
    // text range is kept separately as fcMinBase/fcMacBase), so plain-text
    // extraction always resolves through encoding auto-detection here.
    const suggestedComplex = fib.isTextutil ? false : fib.fComplex
    return this.extractTextWithAutoDetect(data, suggestedComplex)
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

  /**
   * Read the table stream (0Table or 1Table) data.
   * Returns the stream data, or null if not found.
   */


  /**
   * Common "junk" / binary-noise characters that appear in FIB headers
   * when 8-bit text is misinterpreted as UTF-16LE or vice versa.
   * Extracted to a constant to avoid regex duplication.
   */
  /** ENC-04：非文本符号占比超过该阈值视为"符号汤"误解码，触发跨编码兜底重试。 */

  /**
   * Check whether a UTF-16 code unit is a printable character that should
   * be preserved in extracted text. Uses a "blocklist + range" strategy:
   * accept most Unicode printable characters, only reject control chars
   * and surrogate halves.
   */


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
    // 0x01 0x00 = picture/object placeholder, keep it for inline image rendering
    if (byte1 === 0x01 && byte2 === 0x00) return { ch: '\u0001', advance: 2 }

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

  /** Maximum number of images to extract from a single document. */
  /**
   * PERF-T2：魔数兜底扫描的预算下限。实际预算=maxScanBytes（与 DEF-004
   * 文本扫描上限同一护栏来源）；取 max() 保证小 cap 解析器不致图片全盲。
   * 预算截断仅 logger.warn，不复用 scanLimitReached（该标志专指 WordDocument
   * 文本启发式扫描，语义独立）。
   */

  /**
   * Parse the Clx (complex file information) structure to extract text from pieces.
   *
   * Clx structure:
   *   RgPrc[]   (optional) → clxtPrc(0x01) + cbGrpprl + grpprl
   *   Pcdt:
   *   clxt      (1 byte) = 0x02
   *   lcb       (4 bytes) → length of PlcPcd
   *   PlcPcd    (variable)
   *
   * PlcPcd structure:
   *   aCP     ((n+1)*4 bytes) → character positions for each piece
   *   aPcd    (n*8 bytes) → PCD entries for each piece
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

  /**
   * Parse the PlcPcd inside a CLX blob and return piece metadata.
   * Returns an empty array when the structure is malformed or exceeds
   * safety limits — callers should fall back to extractTextSimple.
   */


    // legacy FibBase range is only kept as fcMinBase/fcMacBase), so there is
    // no direct fcMin/fcMac extraction path here — CLX or auto-detect below.

    // For libwv/non-standard files: lcbClx=0 but ccpText > 0
    // Text is at offset 2048, UTF-16LE, for ccpText characters
    if (fib && fib.lcbClx === 0 && fib.rgCcp.ccpText > 0) {
      logger.log(`libwv 模式: ccpText=${fib.rgCcp.ccpText}, 直接提取文本`)
      // Text starts at offset 2048 for libwv files
      const textStart = 2048
      // Use ccpText to calculate text end (UTF-16LE = 2 bytes per char)
      const textEnd = textStart + fib.rgCcp.ccpText * 2

      // Extract text from WordDocument stream (with fcMac limit from ccpText)
      const raw = this.extractParagraphsWithFormat(data, { fcMin: textStart, fcMac: textEnd, fComplex: false })
      // Use filterAndEnhanceParagraphs to apply structural heuristic formats
      const paragraphs = this.filterAndEnhanceParagraphs(raw)
      // Apply structural formats after filtering (filterAndEnhanceParagraphs no longer calls it)
      this.applyStructuralFormats(paragraphs)

      // Post-process libwv paragraphs: split multi-row tables
      const fixedParagraphs = this.splitMultiRowTables(paragraphs)

      // Try to parse formats from 1Table stream
      const formatResult = this.tryParseFormatsFromTableStream(directory, data)
      if (formatResult && fixedParagraphs.length > 0) {
        this.applyParsedStylesToParagraphs(fixedParagraphs, formatResult)
        return { 
          paragraphs: fixedParagraphs, 
          styles: formatResult.styles,
          charts: formatResult.charts,
        }
      }

      return { paragraphs: fixedParagraphs }
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

          // Apply structural heuristic formats as fallback for files with incomplete format data
          // This handles cases where real formats exist but are incomplete (e.g., libwv-generated files)
          this.applyStructuralFormats(paragraphs)

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

    // Clx unreachable (typically the table stream is missing — e.g. compound
    // files written by third-party exporters that embed Excel objects). Word
    // still writes the legacy FibBase fcMin/fcMac text range, so use it when
    // it is exactly consistent with the story character counts: span == ccp
    // (8-bit) or span == 2*ccp (UTF-16LE). The strict equality keeps garbage
    // FibBase values (textutil files etc.) from hijacking this path.
    if (fib && fib.fcMinBase !== undefined && fib.fcMacBase !== undefined) {
      const span = fib.fcMacBase - fib.fcMinBase
      const c = fib.rgCcp
      const totalCcp = c.ccpText + c.ccpFtn + c.ccpHdd + c.ccpMcr + c.ccpAtn + c.ccpEdn + c.ccpTxbx + c.ccpHdrTxbx
      const inBounds = fib.fcMinBase >= 32 && fib.fcMacBase <= data.length && span > 0
      if (inBounds && totalCcp > 0 && (span === totalCcp || span === totalCcp * 2)) {
        const is8bit = span === totalCcp
        logger.log(`FibBase 范围回退: [${fib.fcMinBase}, ${fib.fcMacBase}) ${is8bit ? '8-bit' : 'UTF-16LE'}`)
        const raw = this.extractParagraphsWithFormat(data, {
          fcMin: fib.fcMinBase, fcMac: fib.fcMacBase,
          fComplex: is8bit, trustFcMin: true, _isRetry: true,
        })
        const paragraphs = this.filterParagraphsWithGenericLogic(raw)
        this.applyStructuralFormats(paragraphs)
        if (paragraphs.length > 0) {
          return { paragraphs }
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
      // Use ccpText to limit text extraction range if available
      const textStart = 2048
      const textEnd = fib?.rgCcp?.ccpText && fib.rgCcp.ccpText > 0
        ? textStart + fib.rgCcp.ccpText * 2
        : undefined
      // ENC-04：binaryDetect 是"先验"，证据可以推翻——选中臂过滤后为空或
      // 符号汤占比超阈值（典型：CJK UTF-16LE 文档被误判为 8-bit）时，
      // 用另一编码重提取并按 raw 评分择优。
      const primary = this.extractParagraphsWithFormat(data, {
        fcMin: textStart,
        fcMac: textEnd,
        fComplex: binaryDetect
      })
      let paragraphs = this.filterParagraphsWithGenericLogic(primary)
      if (this.shouldTryCrossEncodingRetry(paragraphs)) {
        const altRaw = this.extractParagraphsWithFormat(data, {
          fcMin: textStart,
          fcMac: textEnd,
          fComplex: !binaryDetect
        })
        const altFiltered = this.filterParagraphsWithGenericLogic(altRaw)
        if (this.crossEncodingRetryWins(primary, paragraphs, altRaw, altFiltered)) {
          logger.warn(`ENC-04 编码误判兜底：fComplex=${binaryDetect} 触发重试，切换为 fComplex=${!binaryDetect}`)
          paragraphs = altFiltered
        }
      }
      // Apply structural heuristic formats AFTER filtering (filterParagraphsWithGenericLogic
      // removes empty paragraphs, so applyStructuralFormats must run after it to preserve
      // the blank lines it inserts around section headings and after the title).
      this.applyStructuralFormats(paragraphs)

      // Try to parse formats directly from 1Table stream for non-standard FIB files
      const formatResult = this.tryParseFormatsFromTableStream(directory, data)
      if (formatResult && paragraphs.length > 0) {
        // Apply parsed styles to paragraphs
        this.applyParsedStylesToParagraphs(paragraphs, formatResult)
        return {
          paragraphs,
          styles: formatResult.styles,
          charts: formatResult.charts,
        }
      }

      return { paragraphs, tocEntries: undefined }
    }

    const textStart = 2048
    const textEnd = fib?.rgCcp?.ccpText && fib.rgCcp.ccpText > 0
      ? textStart + fib.rgCcp.ccpText * 2
      : undefined
    const raw8 = this.extractParagraphsWithFormat(data, { fcMin: textStart, fcMac: textEnd, fComplex: true })
    const raw16 = this.extractParagraphsWithFormat(data, { fcMin: textStart, fcMac: textEnd, fComplex: false })
    const score8 = this.scoreRawParagraphs(raw8)
    const score16 = this.scoreRawParagraphs(raw16)
    // For textutil files, weight UTF-16 more heavily (textutil usually produces UTF-16)
    const scoreThreshold = isTextutil ? 0.6 : 0.4
    const useComplex = suggestedComplex
      ? score8 >= score16 * scoreThreshold
      : score16 < score8 * scoreThreshold

    let paragraphs = this.filterParagraphsWithGenericLogic(useComplex ? raw8 : raw16)
    // ENC-04：评分比较选中的臂同样可能产出空段落/符号汤，跨编码兜底择优。
    if (this.shouldTryCrossEncodingRetry(paragraphs)) {
      const altRaw = useComplex ? raw16 : raw8
      const altFiltered = this.filterParagraphsWithGenericLogic(altRaw)
      if (this.crossEncodingRetryWins(useComplex ? raw8 : raw16, paragraphs, altRaw, altFiltered)) {
        logger.warn(`ENC-04 评分臂兜底：fComplex=${useComplex} 触发重试，切换为 fComplex=${!useComplex}`)
        paragraphs = altFiltered
      }
    }
    // Apply structural heuristic formats after filtering
    this.applyStructuralFormats(paragraphs)

    // Try to parse formats directly from 1Table stream for non-standard FIB files
    const formatResult = this.tryParseFormatsFromTableStream(directory, data)
    if (formatResult && paragraphs.length > 0) {
      this.applyParsedStylesToParagraphs(paragraphs, formatResult)
      return {
        paragraphs,
        styles: formatResult.styles,
        charts: formatResult.charts,
      }
    }

    return { paragraphs, tocEntries: undefined }
  }

  /**
   * Convert internal StoryText to the public DocumentStories shape.
   * Drops empty fields so the UI can simply check `stories?.footnotes`.
   *
   * 当 DOP 标志位启用首页不同/奇偶页不同时，尝试通过 PlcfHdd 将 headers
   * story 拆分为首页/奇数页/偶数页页眉页脚。PlcfHdd 不可用时回退到
   * 启发式段落拆分。
   */

  /**
   * 拆分页眉页脚 story 文本为首页/奇数页/偶数页页眉页脚。
   *
   * 优先使用 PlcfHdd 精确拆分；PlcfHdd 不可用时回退到启发式段落拆分。
   * 如果提供了 chpxRuns，同时提取页眉页脚区域中的图片。
   */

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
  private get assetCtx(): import('./docparser/assets/documentAssets').AssetExtractionContext {
    return { ole: this.ole, maxScanBytes: this.maxScanBytes, readTableStream: this.readTableStream.bind(this) }
  }

  /** T4-P1 E 块迁移：实现移至 docparser/assets/documentAssets.ts（move-only 薄委托） */
  private extractImages(directory: DirectoryEntry[], wordDocData?: Uint8Array): string[] {
    return extractImages(this.assetCtx, directory, wordDocData)
  }

  private extractPictures(
    directory: DirectoryEntry[],
    chpxRuns: ChpxRun[] = [],
    wordDocData?: Uint8Array,
  ): Array<{
    format: string
    dataUrl: string
    widthPx?: number
    heightPx?: number
    floating?: boolean
    cp?: number
  }> {
    return extractPictures(this.assetCtx, directory, chpxRuns, wordDocData)
  }

  private extractProperties(directory: DirectoryEntry[]): DocumentProperties | null {
    return extractProperties(this.assetCtx, directory)
  }

  private extractDop(fib: FibData, directory: DirectoryEntry[]): DopData | null {
    return extractDop(this.assetCtx, fib, directory)
  }

  /** T4-P1 B 块迁移：实现移至 docparser/clxReader.ts（move-only 薄委托/别名） */
  private get clxCtx(): import('./docparser/storySplitter').StorySplitterContext {
    return {
      ole: this.ole,
      maxTotalChars: CLX_MAX_TOTAL_CHARS,
    }
  }

  private get frCtx(): import('./docparser/formatRecovery').FormatRecoveryContext {
    return { ole: this.ole, readTableStream: this.readTableStream.bind(this), maxTotalChars: CLX_MAX_TOTAL_CHARS, readUint16: clxReadUint16, readUint32: clxReadUint32, cleanParagraph: (t)=>this.cleanParagraph(t), detectParagraphFormat: this.detectParagraphFormat.bind(this), guessCharFormat: this.guessCharFormat.bind(this), shouldSkipParagraph: this.shouldSkipParagraph.bind(this), extractTextSimple: this.extractTextSimple.bind(this) }
  }

  private readClxData(
    fib: FibData,
    wordDocData: Uint8Array,
    directory: DirectoryEntry[],
  ): Uint8Array | null {
    return clxReadClxData(this.clxCtx, fib, wordDocData, directory)
  }

  private readTableStream(
    fib: FibData,
    directory: DirectoryEntry[],
  ): Uint8Array | null {
    return clxReadTableStream(this.clxCtx, fib, directory)
  }

  private parseClx(clxData: Uint8Array, wordDocData: Uint8Array): string {
    return clxParseClx(this.clxCtx, clxData, wordDocData, this.extractTextSimple.bind(this))
  }

  private parseClxPieces(clxData: Uint8Array): Piece[] {
    return parseClxPieces(this.clxCtx, clxData)
  }



  private containsBinarySignature(text: string): boolean {
    return clxContainsBinarySignature(text)
  }

  // 白盒测试（docParser.test.ts table-like 组）经实例直调本委托；A 域迁移后
  // 类内已无其他消费者，故以公开成员保留测试面（public 不受 noUnusedLocals 约束）。
    return clxExtractTextFromRange(data, start, end, isCompressed, guardBinary)
  }

  // 白盒测试面（docParser.test.ts stripBinaryPrefix 组经实例直调）；实现居
  // docparser/encodingDetector.ts，公开成员豁免 noUnusedLocals（同上先例）。
    return encStripBinaryPrefix(para)
  }


  private static isValidPrintableChar(charCode: number): boolean {
    return clxIsValidPrintableChar(charCode)
  }


  // 白盒测试经实例直调；C 域迁移后类内无消费者的成员以 public 保留测试面
  detectListInfo(text: string): { listType: 'ordered' | 'unordered'; listStyle: string; listLevel: number } | null {
    return detectListInfo(text)
  }

  detectAlignment(text: string, index: number, totalParagraphs: number): string | null {
    return detectAlignment(text, index, totalParagraphs)
  }

  private parseClxWithStories(clxData: Uint8Array, wordDocData: Uint8Array, rgCcp: RgCcp): { stories: StoryText; pieceMap: StoryPieceMap } | null {
    return parseClxWithStories(this.clxCtx, clxData, wordDocData, rgCcp)
  }

  private toDocumentStories(
    stories: StoryText,
    fib?: FibData,
    dop?: DopData | null,
    directory?: DirectoryEntry[],
    chpxRuns: ChpxRun[] = []
  ): DocumentStories {
    return toDocumentStories(this.clxCtx, stories, fib, dop, directory, chpxRuns)
  }




  /** T4-P1 D 块迁移：实现移至 docparser/encodingDetector.ts（move-only 薄委托/别名） */
  private get encCtx(): import('./docparser/encodingDetector').EncodingDetectorContext {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    return {
      maxScanBytes: self.maxScanBytes,
      scanLimit: {
        get reached() { return self.scanLimitReached },
        set reached(v: boolean) { self.scanLimitReached = v },
      },
      scanUtf16Char: DocParser.scanUtf16Char,
      cleanParagraph: (t: string) => self.cleanParagraph(t),
      hasSignificantContent: (t: string) => self.hasSignificantContent(t),
    }
  }

  private extractTextWithAutoDetect(data: Uint8Array, suggestedComplex: boolean): string {
    return encExtractTextWithAutoDetect(data, suggestedComplex, this.encCtx)
  }

  private extractTextSimple(data: Uint8Array, options?: { fcMin?: number; fComplex?: boolean }): string {
    return encExtractTextSimple(data, options, this.encCtx)
  }

  private detectEncodingFromBinary(data: Uint8Array): boolean | null {
    return encDetectEncodingFromBinary(data)
  }

  private scoreRawParagraphs(paragraphs: any[]): number {
    return encScoreRawParagraphs(paragraphs)
  }

  private shouldTryCrossEncodingRetry(filteredParas: any[]): boolean {
    return encShouldTryCrossEncodingRetry(filteredParas)
  }

  private crossEncodingRetryWins(primaryRaw: any[], primaryFiltered: any[], altRaw: any[], altFiltered: any[]): boolean {
    return encCrossEncodingRetryWins(primaryRaw, primaryFiltered, altRaw, altFiltered)
  }


  // 白盒测试经实例直调；D 域迁移后类内无其他消费者，以 public 保留测试面
    return encIsValidChar(charCode)
  }

    return encScorePlainText(text)
  }



  /** T4-P1 C 第一半迁移：heuristics 纯函数族 + 三回调接缝（move-only 薄委托） */
  private guessCharFormat(text: string, _paragraphIndex?: number): any {
    return guessCharFormat(text, _paragraphIndex)
  }

  private detectParagraphFormat(text: string, index: number, totalParagraphs: number): any {
    return detectParagraphFormat(text, index, totalParagraphs)
  }

  private cleanParagraph(p: string): string {
    return cleanParagraph(p)
  }

  private shouldSkipParagraph(text: string): boolean {
    return shouldSkipParagraph(text)
  }

  private hasSignificantContent(text: string): boolean {
    return hasSignificantContent(text)
  }


  /** T4-P1 C2 迁移：过滤链主体移至 docparser/heuristics/paragraphFilter.ts（move-only 薄委托） */

  /**
   * R-F4-1：将段落 _cpStart 重算为剥离轴累计游标。
   *
   * 单轴不变式：对任意文档，相邻保留段满足
   *   paragraphs[i+1]._cpStart - paragraphs[i]._cpStart === paragraphs[i].text.length + 1
   * 首段 _cpStart === 0。被过滤/清洗丢弃的段落不占轴位。
   *
   * 上游 createParagraphsWithRealFormats 的 para.cpStart（清洗前累计）仍用于
   * PAPX/CHPX run 匹配——run 坐标属 RAW 轴，与本剥离轴互不相干。
   */
  private normalizeParagraphCpAxis(paragraphs: any[]): void {
    return pf_normalizeParagraphCpAxis(paragraphs)
  }

  private splitMultiRowTables(paragraphs: any[]) {
    return pf_splitMultiRowTables(paragraphs)
  }

  /**
   * PERF-T3：任意周期去重扫描的长度护栏。
   * 超过该长度的段落（病态文档回退路径产物，实测 20k 无匹配段需 54s）
   */
  // 以下三委托虽无类内调用点，但为白盒测试面（docParser.test.ts/perf-t3-dedup
  // 经实例直调），与 extractTextFromRange 同款以公开成员保留（豁免 noUnusedLocals）。
  removeInternalDuplicates(text: string): string {
    return pf_removeInternalDuplicates(text)
  }

  private replacePageFieldsInText(text: string, pageFields: PageFieldInfo[]) {
    return pf_replacePageFieldsInText(text, pageFields)
  }

  cleanWordFieldCodes(para: any) {
    return pf_cleanWordFieldCodes(para)
  }

  collapseWholeBlockRepeats(text: string) {
    return pf_collapseWholeBlockRepeats(text)
  }


  private filterAndEnhanceParagraphs(paragraphs: any[]) {
    return pf_filterAndEnhanceParagraphs(paragraphs)
  }

  private filterParagraphsWithGenericLogic(paragraphs: any[]) {
    return pf_filterParagraphsWithGenericLogic(paragraphs)
  }

  private applyStructuralFormats(paragraphs: any[]) {
    return pf_applyStructuralFormats(paragraphs)
  }

  /** T4-P1 formatRuns 迁移：实现移至 docparser/formatRecovery.ts（move-only 薄委托） */
  private parseFormatRuns(
    fib: FibData,
    directory: DirectoryEntry[],
    wordDocData?: Uint8Array,
    text?: string,
  ) {
    return fr_parseFormatRuns(this.frCtx, fib, directory, wordDocData, text)
  }

  private createParagraphsWithRealFormats(
    text: string,
    chpxRuns: ChpxRun[],
    papxRuns: PapxRun[],
    styles: StyleDefinition[],
    fontNames: string[],
    pieceMap?: Array<{ start: number; end: number; chpxIndex?: number }>,
    listEntries?: ListEntry[],
  ): any[] {
    return fr_createParagraphsWithRealFormats(this.frCtx, text, chpxRuns, papxRuns, styles, fontNames, pieceMap, listEntries)
  }

  private tryParseFormatsFromTableStream(directory: DirectoryEntry[], data: Uint8Array) {
    return fr_tryParseFormatsFromTableStream(this.frCtx, directory, data)
  }

  private applyParsedStylesToParagraphs(paragraphs: any[], formatResult: { styles: StyleDefinition[]; fontTable: Record<string, any> }) {
    return fr_applyParsedStylesToParagraphs(this.frCtx, paragraphs, formatResult)
  }


  private extractParagraphsWithFormat(data: Uint8Array, options?: { fcMin?: number; fComplex?: boolean; _isRetry?: boolean; fcMac?: number; trustFcMin?: boolean }): any[] {
    const paragraphs: any[] = []
    let currentParagraph = ''
    let paragraphIndex = 0
    // DEF-004：调用方持有验证过的文本右界（fcMac 来自 piece table / FibBase 范围 /
    // ccpText 界）时不受 maxScanBytes 限制；上限只约束启发式无界扫描，超限显式告警。
    const hasVerifiedBound = typeof options?.fcMac === 'number' && options.fcMac > 0
    const maxBytes = hasVerifiedBound
      ? Math.min(options!.fcMac!, data.length)
      : Math.min(data.length, this.maxScanBytes)
    if (!hasVerifiedBound && data.length > this.maxScanBytes && !this.scanLimitReached) {
      this.scanLimitReached = true
      logger.warn(`启发式扫描已达 maxScanBytes=${this.maxScanBytes} 上限，剩余 ${data.length - this.maxScanBytes} 字节未扫描（scanLimitReached=true）`)
    }
    let startOffset = options?.fcMin ?? 0

    // The 2048 floor skips FIB header noise for heuristic scans, but callers
    // holding a verified text range (e.g. FibBase fcMin/fcMac) may start
    // earlier — doc bodies can begin right after the 1024-byte FIB area.
    if (startOffset < 2048 && !options?.trustFcMin) {
      startOffset = 2048
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
        if (byte === 0x01) { currentParagraph += '\u0001'; continue }
        if (byte >= 0x20) currentParagraph += String.fromCharCode(byte)
        if (currentParagraph.length >= 8 && this.containsBinarySignature(currentParagraph)) break
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
        if (!result) { i++; continue }
        if (result.ch) currentParagraph += result.ch
        i += result.advance - 1
        if (currentParagraph.length >= 8 && this.containsBinarySignature(currentParagraph)) break
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


  // ==================== Format detection ====================



  // ==================== ENC-04 跨编码兜底重试 ====================

  /**
   * 非文本符号占比：字母/数字/CJK/空白与常用中英标点之外的字符份额。
   *
   * 用于识别"符号汤"式误解码——典型是 CJK UTF-16LE 文档被误判为 8-bit：
   * 高位字节落成少量拉丁字母、低位字节变成杂乱标点/符号，整体呈现
   * 高符号占比、零 CJK 的特征（健康文档该占比通常 <0.15）。
   */

  /** ENC-04 触发判定：过滤后为空 OR 符号汤占比超阈值（显著内容占比过低的可操作化度量）。 */

  /**
   * 兜底择优裁决：候选臂必须非空；原臂为空时直接换，否则候选 raw 评分严格更高才换。
   * 同分保持原选择——保证确定性、避免健康文档被无谓翻转。
   */


  // ==================== Character / paragraph format ====================





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
  })
}

/**
 * Parse a .doc file from an ArrayBuffer and return the formatted document.
 * @param buffer - The .doc file as ArrayBuffer.
 * @param fileName - Optional file name, included in error messages for diagnosis.
 * @returns The parse result with paragraphs and text.
 */
export function parseDocFileFromBuffer(
  buffer: ArrayBuffer,
  fileName?: string
): ParseResult {
  try {
    const parser = new DocParser(buffer)
    return parser.parseWithFormat()
    // Unreachable: parseWithFormat wraps its whole body in its own try/catch
    // and DocParser's constructor performs no throwing work. Kept as a
    // last-resort safety net for exotic callers.
    /* v8 ignore start */
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    const fileHint = fileName ? `（文件: ${fileName}）` : ''
    return { success: false, error: `解析失败${fileHint}: ${message}` }
  }
  /* v8 ignore stop */
}

/**
 * Parse a .doc File and return the formatted document with paragraphs and text.
 * @param file - The .doc file to parse.
 * @param debug - If true, enables debug logging.
 * @returns A promise that resolves to the parse result.
 */
export function parseDocFileWithFormat(file: File, debug: boolean = false): Promise<ParseResult> {
  if (debug) logger.enabled = true
  return new Promise((resolve) => {
    const reader = new FileReader()
      const buffer = e.target?.result as ArrayBuffer
      if (!buffer) {
        resolve({ success: false, error: '无法读取文件', errorCode: 'FILE_READ_FAILED' })
        return
      }
      resolve(parseDocFileFromBuffer(buffer, file.name))
    }
  })
}
