/**
 * encodingDetector —— 编码检测/文本提取子域（T4-P1 D 块 · contract-split-r1 §2.1 encodingDetector.ts）
 *
 * 自 docParser.ts 原样迁出（move-only，符号名锚）：extractTextWithAutoDetect /
 * extractTextSimple / detectEncodingFromBinary / scoreRawParagraphs /
 * nonTextualSymbolRatio / shouldTryCrossEncodingRetry / crossEncodingRetryWins /
 * scorePlainText / stripBinaryPrefix / isValidChar + 常量 JUNK_CHAR_CLASS /
 * EXTRA_JUNK_CHARS / ENC04_SYMBOL_RATIO_THRESHOLD。
 *
 * FIELD-CP-GOV 时序对齐 ✓：规格文档列为必读参照；本域逐字节保真零逻辑改动，
 * R-F2（result 切片轴）/R-F4（_cpStart 归一化 normalizeParagraphCpAxis）后续修复
 * 触及本域时同 PR 序列对齐。
 *
 * 结构性适配（非逻辑改动）：原类实例/静态依赖经 EncodingDetectorContext 显式注入——
 *  - maxScanBytes 与 DEF-004 的 scanLimitReached 标志（实例态经 ctx.scanLimit 透传）；
 *  - scanUtf16Char：留守于 DocParser 的共享静态（extractParagraphsWithFormat 同用）；
 *  - cleanParagraph / shouldSkipParagraph / hasSignificantContent：C 域函数回调注入。
 * 纯度：禁 import vue/.vue、禁反向 import ../docParser（契约 §2.2 规则 2）。
 */
import { logger } from '../logger'
import type { ParserParagraph, CharStyleSegment } from '../docFormat'

/**
 * 评分/比例函数的输入接缝：段落对象或原始字符串均合法。
 * extractTextWithAutoDetect 内部传 string[]（extractRawParagraphs 产物），
 * DocParser 侧传 ParserParagraph[]；统一经 paraTextOf 取文本，
 * 避免字符串元素被 `.text` 静默取空导致 ENC-04 符号汤臂失效。
 */
export type ParagraphLike = string | { text?: string }

function paraTextOf(p: ParagraphLike): string {
  return typeof p === 'string' ? p : p.text || ''
}

/** 共享扫描器签名（DocParser.scanUtf16Char 的静态形状） */
export type ScanUtf16CharFn = (data: Uint8Array, i: number, maxBytes: number) => { ch: string; advance: number } | null

/** D 域会话上下文：显式注入面 */
export interface EncodingDetectorContext {
  maxScanBytes: number
  /** DEF-004 扫描限位标志（实例态透传，可变） */
  scanLimit: { reached: boolean }
  scanUtf16Char: ScanUtf16CharFn
  /** C 域回调（heuristics/paragraphFilter 迁移后改兄弟直引） */
  cleanParagraph(text: string): string
  shouldSkipParagraph(text: string): boolean
  hasSignificantContent(text: string): boolean
}

export const JUNK_CHAR_CLASS = '伀倀藠俹醫蠀耀頀琀餀栀儀騀甀攀爀愀氀攀漀漀渀'
export const EXTRA_JUNK_CHARS = '伇倈俼俿儀儜厬唀唕嘀噀圀堀嬀崀崜帀幀弰彀戀戀'

/**
 * 伪正文关键词：短段落命中即丢弃。
 * 原先在 encodingDetector 与 heuristics/paragraphFilter 各写一份、且在每个段落
 * 上重建一次数组；现统一在此导出，两处共用同一份只读常量。
 */
export const SKIP_KEYWORDS = [
  'ROOT', 'SUMMARY', 'DOCUMENT', 'WORD', 'WPS', 'MICROSOFT', 'PROPERTY',
  'STORAGE', 'STREAM', 'TABLE', 'FORMAT', 'XMLDATA', 'BASE64', 'TEMPLATE', 'REGISTRY',
]

/**
 * JUNK_CHAR_CLASS 的**码点**集合。刻意存 number 而不是字符：逐字符判定时用
 * `charCodeAt` 取值，避免 `text[i]` 每轮新建单字符字符串再哈希的开销。
 */
const JUNK_CODE_SET = (() => {
  const set = new Set<number>()
  for (let i = 0; i < JUNK_CHAR_CLASS.length; i++) set.add(JUNK_CHAR_CLASS.charCodeAt(i))
  return set
})()

/** 统计 CJK 统一表意文字（U+4E00–U+9FFF）个数，避免 match(/…/g) 的数组分配。 */
function countChineseChars(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0x4e00 && code <= 0x9fff) count++
  }
  return count
}

/** 统计垃圾字符个数（JUNK_CHAR_CLASS 码点集合），避免 match(/…/g) 的数组分配。 */
function countJunkChars(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    if (JUNK_CODE_SET.has(text.charCodeAt(i))) count++
  }
  return count
}
/** ENC-04：非文本符号占比超过该阈值视为“符号汤”误解码，触发跨编码兜底重试。 */
export const ENC04_SYMBOL_RATIO_THRESHOLD = 0.35

export function detectEncodingFromBinary(data: Uint8Array): boolean | null {
    const startOffset = Math.min(2048, Math.floor(data.length / 4))
    const scanLen = Math.min(data.length - startOffset, 100000)
    const endOffset = startOffset + scanLen

    // Method 1: null-byte distribution heuristic (more reliable for mixed content).
    // UTF-16LE interleaves 0x00 after every ASCII byte → ~50% null bytes.
    // 8-bit compressed has almost no 0x00 bytes in text content.
    let nullCount = 0
    let totalCR = 0
    let crFollowedByNull = 0
    for (let i = startOffset; i < endOffset; i++) {
      const byte = data[i]
      if (byte === 0x00) nullCount++
      if (i < endOffset - 1 && byte === 0x0D) {
        totalCR++
        if (data[i + 1] === 0x00) crFollowedByNull++
      }
    }

    if (scanLen > 100) {
      const nullRatio = nullCount / scanLen
      // UTF-16LE: ~40-50% nulls for pure English text, but with binary data
      // (tables, images) it can drop to 10-15%. 8-bit: << 5%.
      // Use 10% as a safe threshold.
      if (nullRatio > 0.10) return false  // UTF-16LE
      if (nullRatio < 0.05) return true   // 8-bit
    }

    // Method 2: 0x0D paragraph-marker heuristic (fallback).
    if (totalCR > 0) return crFollowedByNull / totalCR < 0.3

    return null
  }


export function scoreRawParagraphs(paragraphs: ParagraphLike[]): number {
    if (!paragraphs || paragraphs.length === 0) return 0
    let score = 0
    for (const p of paragraphs) {
      const text = paraTextOf(p)
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


const SYMBOL_RATIO_PUNCTUATION = `，。、；：“”‘’（）【】《》…—·,.:;!?\'"()-_%°±×÷`

function isAllowedSymbolRatioChar(code: number): boolean {
  return code >= 0x41 && code <= 0x5a ||
    code >= 0x61 && code <= 0x7a ||
    code >= 0x30 && code <= 0x39 ||
    code >= 0x4e00 && code <= 0x9fff ||
    code >= 0x3400 && code <= 0x4dbf ||
    code === 0x20 || code >= 0x09 && code <= 0x0d || code === 0xa0 ||
    code === 0x1680 || code >= 0x2000 && code <= 0x200a ||
    code === 0x2028 || code === 0x2029 || code === 0x202f ||
    code === 0x205f || code === 0x3000 || code === 0xfeff ||
    SYMBOL_RATIO_PUNCTUATION.includes(String.fromCharCode(code))
}

export function nonTextualSymbolRatio(paragraphs: ParagraphLike[]): number {
    let total = 0
    let symbols = 0
    for (const p of paragraphs) {
      const text: string = paraTextOf(p)
      for (const ch of text) {
        total++
        // 常用中英标点与空白不算符号；其余（控制符、杂配符、私有区等）计为符号
        if (!isAllowedSymbolRatioChar(ch.charCodeAt(0))) symbols++
      }
    }
    return total === 0 ? 0 : symbols / total
  }


export function shouldTryCrossEncodingRetry(filteredParas: ParagraphLike[]): boolean {
    if (!filteredParas || filteredParas.length === 0) return true
    return nonTextualSymbolRatio(filteredParas) > ENC04_SYMBOL_RATIO_THRESHOLD
  }


export function crossEncodingRetryWins(primaryRaw: ParagraphLike[], primaryFiltered: ParagraphLike[], altRaw: ParagraphLike[], altFiltered: ParagraphLike[]): boolean {
    if (!altFiltered || altFiltered.length === 0) return false
    if (!primaryFiltered || primaryFiltered.length === 0) return true
    return scoreRawParagraphs(altRaw) > scoreRawParagraphs(primaryRaw)
  }


export function scorePlainText(text: string): number {
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


export function extractTextWithAutoDetect(
    data: Uint8Array,
    suggestedComplex: boolean,
    ctx: EncodingDetectorContext,
  ): string {
    const binaryDetect = detectEncodingFromBinary(data)

    // 二值判定不可用（null）时保留原评分回退分支（sparse-NUL 规格路径）
    if (binaryDetect === null) {
      /* v8 ignore start */
      const text8 = extractTextSimple(data, { fcMin: 0, fComplex: true }, ctx)
      const text16 = extractTextSimple(data, { fcMin: 0, fComplex: false }, ctx)
      const score8 = scorePlainText(text8)
      const score16 = scorePlainText(text16)
      logger.log(`自动检测编码评分 - 8-bit: ${score8}, UTF-16LE: ${score16}`)
      if (suggestedComplex) {
        return score8 >= score16 * 0.4 ? text8 : text16
      }
      return score16 >= score8 * 0.4 ? text16 : text8
      /* v8 ignore stop */
    }

    // ENC-04 强制覆盖：binary 误判臂（如把 UTF-16LE 中文判成 8-bit）必须被
    // 跨编码重试推翻——选中臂产出空段/符号汤即触发对侧臂并按原始段评分择优。
    const useComplex = binaryDetect
    const rawPrimary = extractRawParagraphs(data, { fcMin: 0, fComplex: useComplex }, ctx)
    const primaryFiltered = filterRawParagraphs(rawPrimary, ctx)
    if (shouldTryCrossEncodingRetry(primaryFiltered)) {
      const altRaw = extractRawParagraphs(data, { fcMin: 0, fComplex: !useComplex }, ctx)
      const altFiltered = filterRawParagraphs(altRaw, ctx)
      if (crossEncodingRetryWins(rawPrimary, primaryFiltered, altRaw, altFiltered)) {
        logger.warn('ENC-04 跨编码重试触发：切换为对侧编码臂')
        return altFiltered.join('\n\n').trim()
      }
    }
    return primaryFiltered.join('\n\n').trim()
  }



export function extractTextSimple(
    data: Uint8Array,
    options: { fcMin?: number; fComplex?: boolean } | undefined,
    ctx: EncodingDetectorContext,
  ): string {
    return filterRawParagraphs(extractRawParagraphs(data, options, ctx), ctx).join('\n\n').trim()
}

/** C 块原始段收集体：仅扫描分段，不做任何过滤（ENC-04 重试需对原始段评分）。 */
function extractRawParagraphs(
    data: Uint8Array,
    options: { fcMin?: number; fComplex?: boolean } | undefined,
    ctx: EncodingDetectorContext,
  ): string[] {
    const paragraphs: string[] = []
    let currentParagraph = ''
    const maxBytes = Math.min(data.length, ctx.maxScanBytes)
    if (data.length > ctx.maxScanBytes && !ctx.scanLimit.reached) {
      ctx.scanLimit.reached = true
      logger.warn(`extractTextSimple 启发式扫描已达 maxScanBytes=${ctx.maxScanBytes} 上限（scanLimitReached=true）`)
    }
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
        const result = ctx.scanUtf16Char(data, i, maxBytes)
        if (!result) continue
        if (result.ch) currentParagraph += result.ch
        i += result.advance - 1
      }
    }

    return paragraphs
    if (currentParagraph.trim().length >= 2) paragraphs.push(currentParagraph.trim())
}

/** 过滤管线（C 块语义）：起点定位/跳过规则/显著内容/内置 skip 表。 */
function filterRawParagraphs(paragraphs: string[], ctx: EncodingDetectorContext): string[] {
    let foundStart = false
    const filteredStart: string[] = []

    for (const p of paragraphs) {
      if (!foundStart) {
        const cp = ctx.cleanParagraph(p)
        if (cp.length > 5) {
          const chineseCount = countChineseChars(cp)
          const junkCount = countJunkChars(cp)
          if (chineseCount >= 3 && junkCount < chineseCount) { foundStart = true; filteredStart.push(cp); continue }
        }
      } else {
        const cp = ctx.cleanParagraph(p)
        if (!ctx.shouldSkipParagraph(cp)) filteredStart.push(cp)
      }
    }

    if (!foundStart) {
      filteredStart.push(...paragraphs.slice(0, 3).map(p => ctx.cleanParagraph(p)).filter(p => !ctx.shouldSkipParagraph(p)))
    }

    const filtered = filteredStart.filter(p => {
      if (p.length < 2) return false
      if (ctx.shouldSkipParagraph(p)) return false
      if (!ctx.hasSignificantContent(p)) return false
      const upper = p.toUpperCase()
      for (const s of SKIP_KEYWORDS) { if (upper.includes(s)) return false }
      return true
    })

    return filtered
}

export function stripBinaryPrefix(para: ParserParagraph): ParserParagraph {
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
    // Strategy 3: first continuous CJK run (2+ chars). A single stray CJK
    // character is common in FIB binary noise and must NOT be treated as the
    // body start; runs of 4+ characters are the strongest signal (AGENTS.md:
    // "定位第一个连续 4+ 中文字符").
    const cjkRuns: Array<{ start: number; len: number }> = []
    let currentCjkRun = 0
    let currentCjkRunStart = 0

    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i)
      const ch = text[i]

      // Track longest valid run
      if (isValidChar(charCode)) {
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
        if (prev === ' ' || !isValidChar(text.charCodeAt(i - 1))) {
          firstCapitalWordStart = i
        }
      }

      // Track continuous CJK runs (flush on non-CJK char)
      if (charCode >= 0x4E00 && charCode <= 0x9FFF) {
        if (currentCjkRun === 0) currentCjkRunStart = i
        currentCjkRun++
      } else {
        if (currentCjkRun >= 2) cjkRuns.push({ start: currentCjkRunStart, len: currentCjkRun })
        currentCjkRun = 0
      }
    }
    // Flush a trailing CJK run (text ends with CJK chars)
    if (currentCjkRun >= 2) cjkRuns.push({ start: currentCjkRunStart, len: currentCjkRun })

    // Choose the best start position
    const candidates: Array<{ pos: number; reason: string; score: number }> = []

    if (longestValidRun >= 5) {
      candidates.push({ pos: longestValidRunStart, reason: 'longestRun', score: longestValidRun })
    }

    // Prefer capital word starts that are near the longest run
    if (firstCapitalWordStart >= 0) {
      // Score: how close to start but after noise, bonus if near longest run
      const nearLongest = Math.abs(firstCapitalWordStart - longestValidRunStart) < 20 ? 30 : 0
      candidates.push({ pos: firstCapitalWordStart, reason: 'capitalWord', score: 20 + nearLongest })
    }

    // Prefer the first continuous CJK run after position 0. Only runs of 2+
    // chars count; a 4+ char run (the body itself) outranks a short noise run.
    if (cjkRuns.length > 0) {
      const strongRun = cjkRuns.find(r => r.len >= 4)
      const chosen = strongRun || cjkRuns[0]
      // Allow chosen.start == longestValidRunStart (CJK body preceded by noise
      // is itself the longest valid run); reject starts inside an earlier
      // ASCII run (e.g. English text before a Chinese paragraph).
      if (chosen.start > 0 && chosen.start <= longestValidRunStart) {
        candidates.push({ pos: chosen.start, reason: strongRun ? 'cjkRun' : 'cjkRunShort', score: strongRun ? 40 : 24 })
      }
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
          .map((style: CharStyleSegment) => ({ start: Math.max(0, style.start - realStart), end: Math.max(0, style.end - realStart), style: style.style }))
          .filter((style: CharStyleSegment) => style.end > style.start && style.start < cleaned.length)
      }
      return { ...para, text: cleaned, charFormat: newCharFormat }
    }

    const totalWeird = (text.match(/[^\u4e00-\u9fff\u3400-\u4dbf\w\s,.!?，。！？；：""''（）【】、]/g) || []).length
    if (totalWeird > text.length * 0.4) return { ...para, text: '' }

    return para
  }


export function isValidChar(charCode: number): boolean {
    return (charCode >= 0x4E00 && charCode <= 0x9FFF) || (charCode >= 0x3400 && charCode <= 0x4DBF) ||
      (charCode >= 32 && charCode <= 126) ||
      [0x3001, 0x3002, 0xFF0C, 0xFF0E, 0x300A, 0x300B, 0xFF1A, 0x2018, 0x2019, 0x201C, 0x201D, 0xFF08, 0xFF09, 0xFF1F, 0xFF01, 0x3000, 0x2014, 0xFF0B].includes(charCode)
  }
