import { logger, enableDebugMode } from './logger'
export { enableDebugMode }

import { OleParser } from './oleParser'
import type { StreamData } from './oleParser'

import { parseFib } from './fibParser'
import type { FibData } from './fibParser'

// ---- DocParser ----

/** Default max bytes to scan in a WordDocument stream (10MB). */
const DEFAULT_MAX_SCAN_BYTES = 10 * 1024 * 1024

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

      this.text = this.extractTextWithFib(wordDocumentStream)
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
  parseWithFormat(): { success: boolean; document?: any; text?: string; error?: string } {
    try {
      logger.info('开始解析带格式的 DOC 文件')

      if (!this.ole.isOleFile()) {
        const error = this.ole.getFormatErrorString()
        return { success: false, error }
      }

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

      const formattedParagraphs = this.extractFormattedText(wordDocumentStream)

      if (formattedParagraphs.length === 0) {
        const fallbackText = this.extractTextSimple(wordDocumentStream.data)
        if (fallbackText.length > 0) {
          return { success: true, text: fallbackText }
        }
        return { success: false, error: '文档内容为空' }
      }

      const plainText = formattedParagraphs.map(p => p.text).join('\n\n')
      return { success: true, document: { paragraphs: formattedParagraphs }, text: plainText }
    } catch (error) {
      const message = error instanceof Error ? `${error.message}\n${error.stack}` : '未知错误'
      logger.error('解析过程发生异常', message)
      return { success: false, error: `解析失败: ${error instanceof Error ? error.message : '未知错误'}` }
    }
  }

  // ==================== Text extraction ====================

  private extractTextWithFib(wordStream: StreamData): string {
    const data = wordStream.data
    if (data.length < 32) return ''

    const fib = parseFib(data)
    if (!fib) return this.extractTextSimple(data)

    if (fib.lcbClx > 0 && fib.fcClx + fib.lcbClx <= data.length) {
      const clxData = data.subarray(fib.fcClx, fib.fcClx + fib.lcbClx)
      const textFromClx = this.parseClx(clxData, data)
      if (textFromClx.length > 0) return textFromClx
    }

    if (fib.fcMin === 0 || fib.fcMac === 0) {
      return this.extractTextWithAutoDetect(data, fib.fComplex)
    }

    return this.extractTextSimple(data, { fcMin: fib.fcMin, fComplex: fib.fComplex })
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

  /** Shared set of CJK/symbol codepoints valid in UTF-16LE .doc text. */
  private static readonly VALID_CJK_CODEPOINTS = new Set([
    0x3001, 0x3002, 0xFF0C, 0xFF0E, 0x300A, 0x300B, 0x2018, 0x2019,
    0x201C, 0x201D, 0xFF08, 0xFF09, 0xFF1F, 0xFF01, 0xFF1A, 0x3000,
  ])

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

    // ASCII range (byte2 is high byte, must be 0x00 for single-byte chars)
    if (byte2 === 0x00 && byte1 >= 0x20 && byte1 <= 0x7E) {
      return { ch: String.fromCharCode(byte1), advance: 2 }
    }

    const charCode = (byte2 << 8) | byte1
    // CJK Unified Ideographs
    if (charCode >= 0x4E00 && charCode <= 0x9FFF) {
      return { ch: String.fromCharCode(charCode), advance: 2 }
    }
    // CJK symbols and punctuation
    if (DocParser.VALID_CJK_CODEPOINTS.has(charCode)) {
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

  private parseClx(clxData: Uint8Array, wordDocData: Uint8Array): string {
    if (clxData.length < 4) return ''
    const clxt = clxData[0]
    if (clxt !== 2) return this.extractTextSimple(wordDocData)

    let offset = 1
    const lcb = clxData[offset] | (clxData[offset + 1] << 8) | (clxData[offset + 2] << 16) | (clxData[offset + 3] << 24)
    offset += 4
    if (lcb <= 0 || offset + lcb > clxData.length) return this.extractTextSimple(wordDocData)

    const clxt2 = clxData[offset]; offset += 1
    if (clxt2 !== 1) return this.extractTextSimple(wordDocData)

    offset += 4

    const rgCcp: number[] = []
    while (offset + 4 <= clxData.length) {
      const ccp = clxData[offset] | (clxData[offset + 1] << 8) | (clxData[offset + 2] << 16) | (clxData[offset + 3] << 24)
      if (ccp === 0 && rgCcp.length > 0) break
      rgCcp.push(ccp); offset += 4
    }

    let text = ''
    let lastCcp = 0
    for (const ccp of rgCcp) {
      if (ccp > lastCcp && ccp > 0) {
        text += this.extractTextFromRange(wordDocData, lastCcp, ccp)
      }
      lastCcp = ccp
    }
    return text.length > 0 ? text : this.extractTextSimple(wordDocData)
  }

  private extractTextFromRange(data: Uint8Array, start: number, end: number): string {
    let text = ''
    const actualStart = Math.max(0, start)
    const actualEnd = Math.min(data.length, end)
    for (let i = actualStart; i < actualEnd - 1; i += 2) {
      const charCode = data[i] | (data[i + 1] << 8)
      if (charCode === 0x000d) text += '\n'
      else if (charCode === 0x000a || charCode === 0x0000) continue
      else if ((charCode >= 0x0020 && charCode <= 0x007E) || (charCode >= 0x4E00 && charCode <= 0x9FFF) || (charCode >= 0x3000 && charCode <= 0x303F) || (charCode >= 0xFF00 && charCode <= 0xFFEF) || (charCode === 0x2018 || charCode === 0x2019 || charCode === 0x201C || charCode === 0x201D)) {
        text += String.fromCharCode(charCode)
      }
    }
    return text
  }

  // ==================== Format extraction ====================

  private extractFormattedText(wordStream: StreamData): any[] {
    const data = wordStream.data
    const fib = parseFib(data)

    if (fib && fib.fcMin > 0 && fib.fcMac > 0) {
      return this.extractTextWithFormatFromFib(data, fib)
    }

    const suggestedComplex = fib ? fib.fComplex : false
    logger.warn(`FIB无有效偏移，自动检测编码(fComplex=${suggestedComplex})`)

    const binaryDetect = this.detectEncodingFromBinary(data)
    if (binaryDetect !== null) {
      const raw = this.extractParagraphsWithFormat(data, { fcMin: 0, fComplex: binaryDetect })
      return this.filterParagraphsWithGenericLogic(raw)
    }

    const raw8 = this.extractParagraphsWithFormat(data, { fcMin: 0, fComplex: true })
    const raw16 = this.extractParagraphsWithFormat(data, { fcMin: 0, fComplex: false })
    const score8 = this.scoreRawParagraphs(raw8)
    const score16 = this.scoreRawParagraphs(raw16)
    const useComplex = suggestedComplex ? score8 >= score16 * 0.4 : score16 < score8 * 0.4
    return this.filterParagraphsWithGenericLogic(useComplex ? raw8 : raw16)
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
      const isChinese = /\u4e00-\u9fff/.test(char)
      const isUpperCase = /[A-Z]/.test(char)
      const isLowerCase = /[a-z]/.test(char)
      const isWhitespace = /\s/.test(char)

      let charStyle: any = null
      if (isWhitespace) charStyle = { fontName: '宋体', underline: false }
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
    return style1.fontName === style2.fontName && (style1.underline || false) === (style2.underline || false)
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

    // Detect list type
    const trimmed = text.trim()
    if (/^\d+[\.\)][\s\t]/.test(trimmed)) {
      format.listType = 'ordered'
      format.listStyle = 'decimal'
    } else if (/^[a-zA-Z][\.\)][\s\t]/.test(trimmed) && trimmed.length >= 3) {
      format.listType = 'ordered'
      format.listStyle = 'lower-alpha'
    } else if (/^[•\-\*][\s\t]/.test(trimmed) || /^[•\*]\s/.test(trimmed)) {
      format.listType = 'unordered'
      format.listStyle = 'disc'
    } else if (/^[○●▪▸►→]\s/.test(trimmed)) {
      format.listType = 'unordered'
      format.listStyle = 'disc'
    }

    return format
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

    const cleaned = text.replace(/\s{2,}/g, ' ').replace(/，\s*，/g, '，').replace(/。\s*。/g, '。').replace(/：\s*：/g, '：').trim()

    if (cleaned !== text) {
      const newCharFormat = { ...para.charFormat }
      if (newCharFormat.styles && newCharFormat.styles.length > 0) delete newCharFormat.styles
      return { ...para, text: cleaned, charFormat: newCharFormat }
    }
    return para
  }

  private hasSignificantContent(text: string): boolean {
    if (text.length < 2) return false
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
    const textParagraphs = text.split(/\n\n/).filter(p => p.trim().length > 0)
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
