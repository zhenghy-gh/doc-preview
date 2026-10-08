/**
 * paragraphFilter —— 段落过滤子域（T4-P1 C 块 · contract-split-r1 §2.1 heuristics/paragraphFilter.ts）
 *
 * C 第一半迁入：cleanParagraph / hasSignificantContent / shouldSkipParagraph /
 * hasTooManyJunkChars（EncodingDetectorContext 三回调接缝承载）。
 * C 第二半迁入（收官）：filterParagraphsWithGenericLogic /
 * filterAndEnhanceParagraphs / applyStructuralFormats / removeInternalDuplicates /
 * collapseWholeBlockRepeats / cleanWordFieldCodes / replacePageFieldsInText /
 * splitMultiRowTables / normalizeParagraphCpAxis。
 *
 * FIELD-CP-GOV 时序对齐 ✓：R-F4 normalizeParagraphCpAxis 已随第二半逐字随迁；
 * 规格文档 docs/changelog/2026-08-26-field-cp-gov-parser-spec.md 为必读参照。
 * 纯度：禁 import vue/.vue、禁反向 import ../docParser（契约 §2.2 规则 2）。
 */
import { JUNK_CHAR_CLASS, EXTRA_JUNK_CHARS, SKIP_KEYWORDS, stripBinaryPrefix as encStripBinaryPrefix } from '../encodingDetector'
import { logger } from '../../logger'
import type { PageFieldInfo } from '../../fieldParser'
import type { ParserParagraph } from '../../docFormat'
import { isTableRowText } from '../../tableText'

// 热路径正则/常量：原先在函数体内逐次构造（`new RegExp` 会重新编译，
// 正则字面量也会每次求值新建对象）。这些模式全部依赖模块级静态常量，
// 提到模块作用域后行为不变，且省掉每个段落的构造开销。
// 注意：全局标志的正则仅用于 `String.prototype.match/replace`（两者都不
// 依赖 lastIndex），因此共享实例是安全的。
const JUNK_PREFIX_RE = new RegExp(`^[${JUNK_CHAR_CLASS}]+`)
const JUNK_ANY_RE = new RegExp(`[${JUNK_CHAR_CLASS}${EXTRA_JUNK_CHARS}]`, 'g')
const ENGLISH_WORD_RE = /[A-Za-z]{3,}/g
const VOWEL_RE = /[aeiouyAEIOUY]/
const COMMON_PUNCT_RE = /[，。、；：""''【】《》]/
const CHINESE_RUN_RE = /[\u4e00-\u9fff]{2,}/
const NON_PRINTABLE_RE = /[\s\p{P}]/gu
const WEIRD_CHAR_RE = /[^\u4e00-\u9fff\u3400-\u4dbf\w\s,.!?，。！？；：""''（）【】、]/g
const HYPERLINK_QUOTED_RE = /\bHYPERLINK\s+"[^"]*"[\s\u0001]*/g
const HYPERLINK_BARE_RE = /\bHYPERLINK\s+\S+[\s\u0001]*/g
const OTHER_FIELD_CODE_RE = /\b(?:EMBED|LIBREOFFICE|INCLUDEPICTURE|INCLUDETEXT)\s+\S+/g
const PIC_PLACEHOLDER_RE = /\u0001/g

// ---- applyStructuralFormats 用的模式（原先散落在逐段落循环体内）----
// `/\u0001/g` 那处原为字面量，直接复用上面的 PIC_PLACEHOLDER_RE。
const HEADING_LIKE_RE = /^[A-Z][a-z].*[.!?]?$/

// ---- splitMultiRowTables 用的模式 ----
const CELL_MARK_RUN_RE = /\u0007{2,}/
const CELL_MARK_EDGE_RE = /^\u0007+|\u0007+$/g
const CELL_MARK_TRAIL_RE = /\u0007+$/g

// ---- cleanWordFieldCodes 用的模式 ----
// 原先 `pagePattern` 与下面这个 30 元素的数组都在**函数体内**构造，
// 而该函数经 `filterParagraphsWithGenericLogic` 的 map 逐段落调用 ——
// 等于每个段落都新建 30 个 RegExp 对象。全部提升到模块作用域。
// 所有模式均带 `g`（或 `gi`）且只喂给 `String.prototype.replace`，
// 而 replace 会在开始时重置 lastIndex，故跨调用共享实例是安全的。
const PAGE_OF_PAGES_RE = /第\s*PAGE\s*(\d+)\s*页\s*共\s*NUMPAGES\s*(\d+)\s*页/gi
const FIELD_CODE_PATTERNS: readonly RegExp[] = [
  /\bPAGE\b/gi, /\bNUMPAGES\b/gi, /\bDATE\b/gi, /\bTIME\b/gi, /\bSECTION\b/gi,
  /\bSECTIONPAGES\b/gi, /\bFILENAME\b/gi, /\bAUTHOR\b/gi, /\bTITLE\b/gi,
  /\bSUBJECT\b/gi, /\bKEYWORDS\b/gi, /\bCOMMENTS\b/gi, /\bCREATEDATE\b/gi,
  /\bSAVEDATE\b/gi, /\bPRINTDATE\b/gi, /\bEDITTIME\b/gi, /\bNUMWORDS\b/gi,
  /\bNUMCHARS\b/gi, /\bDOCPROPERTY\b/gi, /\bMERGEFIELD\b/gi, /\bREF\b/gi,
  /\bHYPERLINK\b/gi, /\bINCLUDEPICTURE\b/gi, /\bINCLUDETEXT\b/gi, /\bSEQ\b/gi,
  /\bTOC\b/gi, /\bTOC\s+o\s+"1-9"\b/gi, /\bTOC\s+o\s+"1-3"\b/gi,
  /\bEMBED\b/gi, /\bLIBREOFFICE\b/gi,
]
const QUOTED_URL_RE = /"\s*https?:\/\/[^"]+\s*"/g
// 注意与上面的 HYPERLINK_QUOTED_RE 不同：后者尾随类为 `[\s\u0001]*`（用于
// applyStructuralFormats 的预清洗），这里是 `\s*` 且替换目标不同，不可合并。
const HYPERLINK_QUOTED_PIC_RE = /\bHYPERLINK\s+"[^"]*"\s*\u0001/g
const HYPERLINK_QUOTED_TRAIL_RE = /\bHYPERLINK\s+"[^"]*"\s*/g
const HYPERLINK_BARE_PIC_RE = /\bHYPERLINK\s+\S+\s+\u0001/g
const HYPERLINK_BARE_TRAIL_RE = /\bHYPERLINK\s+\S+\s+/g
const PIC_CLASSNAME_RE = /\u0001(?:[A-Z][a-z]+){2,}[A-Z]?/g
const MULTI_SPACE_RE = / {2,}/g
const DUP_COMMA_RE = /，\s*，/g
const DUP_PERIOD_RE = /。\s*。/g
const DUP_COLON_RE = /：\s*：/g

/**
 * 统计 `re` 在 `text` 中的匹配个数。
 *
 * 原实现是 `text.match(re) || []`，会一次性分配**全部匹配项**的数组 ——
 * 而调用方多数只要一个计数或一个阈值判断。`RegExp.prototype.test` 在带 `g`
 * 时只推进 `lastIndex`、**不分配匹配数组**，因此这里的循环是零分配的。
 *
 * 调用方传入的模式最短匹配长度均 ≥ 1，不会出现零长度匹配导致的死循环；
 * 函数自身重置 `lastIndex`，因此可以安全共享模块级 RegExp 实例。
 * `limit` 用于"只关心是否达到某阈值"的场景（达到即提前返回）。
 */
function countMatches(re: RegExp, text: string, limit = Infinity): number {
  re.lastIndex = 0
  let count = 0
  while (count < limit && re.test(text)) count++
  return count
}

/**
 * ⚠️ 语义重建实现（P0 事故恢复）：原函数体在 C2 施工脚手架事故中丢失且无盘上快照。
 * 依据 PERF-T3 测试契约（tests/perf-t3-dedup.test.ts「坍缩到与旧算法一致的
 * 原语块定点」）重建：整段二分/三分幂等折叠【循环至原语块定点】——
 * 单次折叠会使深层幂串（×8 等）在后续精确路径产生非合流分叉，
 * 必须在护栏内一路折叠到最小周期原语块。待 reviewer/captain 审定；
 * 若寻回原始实现请以逐字版本覆盖。
 */
export function collapseWholeBlockRepeats(text: string): string {
  let t = text
  let changed = true
  while (changed) {
    changed = false
    const n = t.length
    if (n < 2) break
    // 二分精确折叠：前半 === 后半（"abcabc" -> "abc" 主流形态）
    const half = n >> 1
    if (t.slice(0, half) === t.slice(half)) { t = t.slice(0, half); changed = true; continue }
    // 三分精确折叠：三段互等
    if (n % 3 === 0) {
      const q = n / 3
      if (t.slice(0, q) === t.slice(q, q + q) && t.slice(0, q) === t.slice(q + q)) {
        t = t.slice(0, q); changed = true
      }
    }
  }
  return t
}

export const REMOVE_DUP_EXACT_MAX_LEN = 2048

export function cleanParagraph(p: string): string {
    // 原为 `p.trim().replace(JUNK_PREFIX_RE, '').trim()`：两次 trim 分配。
    // 替换为 no-op 时（绝大多数段落）第二次 trim 的结果必然等于第一次的结果
    // —— trim 是幂等的，且此时 stripped === t —— 故直接返回 t，省掉一次分配。
    const t = p.trim()
    const stripped = t.replace(JUNK_PREFIX_RE, '')
    return stripped === t ? t : stripped.trim()
  }

export function hasSignificantContent(text: string): boolean {
    if (text.length < 2) return false
    if (isTableRowText(text)) return true

    // 直接按 UTF-16 码元计数，避免 match(/…/g) 分配整个匹配数组
    // （CJK 文档下该数组可能很大）。
    let chineseChars = 0
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if (code >= 0x4e00 && code <= 0x9fff) chineseChars++
    }
    const chineseRatio = chineseChars / text.length
    if (chineseChars >= 2 && chineseRatio > 0.3) return true

    // 原先 `text.match(ENGLISH_WORD_RE)` 会一次性分配**全部**英文单词的数组；
    // 判定条件只是"含元音的词 ≥ 2"，故改为 exec 流式扫描并提前退出。
    // 循环内重置 lastIndex，共享模块级实例安全。
    let englishWords = 0
    ENGLISH_WORD_RE.lastIndex = 0
    let wordMatch: RegExpExecArray | null
    while ((wordMatch = ENGLISH_WORD_RE.exec(text)) !== null) {
      if (VOWEL_RE.test(wordMatch[0])) {
        if (++englishWords >= 2) return true
      }
    }

    const hasCommonPunctuation = COMMON_PUNCT_RE.test(text)
    const hasContent = CHINESE_RUN_RE.test(text)
    if (hasCommonPunctuation && hasContent) return true

    const printableChars = text.replace(NON_PRINTABLE_RE, '').length
    if (printableChars >= 3 && chineseChars >= 1) return true

    return false
  }

export function shouldSkipParagraph(text: string): boolean {
    return hasTooManyJunkChars(text)
  }

export function hasTooManyJunkChars(text: string): boolean {
    // 判定只需要"垃圾字符个数"，不需要匹配内容；上限取 3 是因为
    // `> 2` 是第一个短路条件，达到 3 即可确定返回 true。
    const junkCount = countMatches(JUNK_ANY_RE, text, 3)
    if (junkCount > 0) {
      const totalLength = text.trim().length
      if (junkCount > 2 || (totalLength > 0 && junkCount / totalLength > 0.2)) return true
    }
    return false
  }

  export function filterParagraphsWithGenericLogic(paragraphs: ParserParagraph[]): ParserParagraph[] {
    let filtered = paragraphs.filter(p => {
      // Keep image-placeholder paragraphs (they only contain \u0001, length 1)
      if (p.text && p.text.length === 1 && p.text.charCodeAt(0) === 1) return true
      if (p.text.length < 2) return false
      if (!hasSignificantContent(p.text)) return false
      if (p.text.length < 80) {
        const upper = p.text.toUpperCase()
        for (const s of SKIP_KEYWORDS) { if (upper.includes(s)) return false }
      }
      return true
    })

    for (let i = 0; i < Math.min(3, filtered.length); i++) {
      // Don't strip binary prefix from image-only paragraphs
      if (filtered[i].text && filtered[i].text.charCodeAt(0) === 1 && filtered[i].text.length === 1) continue
      filtered[i] = encStripBinaryPrefix(filtered[i])
    }

    filtered = filtered.filter(p => {
      // Keep image-placeholder paragraphs
      if (p.text && p.text.length === 1 && p.text.charCodeAt(0) === 1) return true
      return p.text.length >= 2
    })
    
    // Only remove CONSECUTIVE duplicate paragraphs (not all duplicates).
    // Global deduplication was too aggressive: it removed intentionally
    // repeated paragraphs in normal documents (e.g. template text that
    // appears in multiple sections). Consecutive dedup is sufficient for
    // malformed libwv output which typically has back-to-back duplicates.
    filtered = filtered.filter((p, i) => {
      // Image-placeholder paragraphs are unique by design
      if (p.text && p.text.length === 1 && p.text.charCodeAt(0) === 1) return true
      // Only deduplicate consecutive duplicates (current == previous)
      if (i > 0 && filtered[i - 1].text === p.text) {
        return false
      }
      return true
    })

    filtered = filtered.map(p => {
      // Don't process image-placeholder paragraphs
      if (p.text && p.text.length === 1 && p.text.charCodeAt(0) === 1) return p
      const cleaned = removeInternalDuplicates(p.text)
      if (cleaned !== p.text) {
        return { ...p, text: cleaned }
      }
      return p
    })
    filtered = filtered.filter(p => {
      if (p.text && p.text.length === 1 && p.text.charCodeAt(0) === 1) return true
      // 原为 `(p.text.match(WEIRD_CHAR_RE) || []).length`：只要计数，不需要匹配内容。
      const weird = countMatches(WEIRD_CHAR_RE, p.text)
      return weird / p.text.length < 0.5
    })
    filtered = filtered.map(p => {
      // Don't clean field codes from image-placeholder paragraphs
      if (p.text && p.text.length === 1 && p.text.charCodeAt(0) === 1) return p
      return cleanWordFieldCodes(p)
    })
    filtered = filtered.filter(p => {
      if (p.text && p.text.length === 1 && p.text.charCodeAt(0) === 1) return true
      return p.text.length >= 2
    })
    return filtered
  }

  export function filterAndEnhanceParagraphs(paragraphs: ParserParagraph[]): ParserParagraph[] {
    let foundStart = false
    const filtered: ParserParagraph[] = []
    for (const para of paragraphs) {
      if (!foundStart) {
        if (hasSignificantContent(para.text)) {
          foundStart = true
          if (!shouldSkipParagraph(para.text)) filtered.push(para)
        }
        continue
      }
      if (shouldSkipParagraph(para.text)) continue
      if (!hasSignificantContent(para.text)) continue
      filtered.push(para)
    }
    // Unreachable in practice for real inputs: any non-empty paragraph
    // with printable content passes hasSignificantContent above. Kept as a
    // defensive slice for malformed feeds.
    /* v8 ignore start */
    if (!foundStart && paragraphs.length > 0) {
      return paragraphs.filter(p => !shouldSkipParagraph(p.text)).slice(0, 5)
    }
    /* v8 ignore stop */
    // Note: applyStructuralFormats is called by the caller (after filterParagraphsWithGenericLogic)
    // to ensure blank lines survive filtering.
    return filtered
  }

  export function applyStructuralFormats(paragraphs: ParserParagraph[]): void {
    if (paragraphs.length === 0) return

    const LIST_ITEM_MIN_LEN = 10
    const LIST_ITEM_MAX_LEN = 150
    const LIST_GROUP_MIN_COUNT = 2
    const TITLE_MAX_LEN = 50
    const BODY_MIN_LEN = 100

    // Pre-process: strip HYPERLINK field codes from paragraph text for length analysis.
    // This ensures list detection compares visible text length, not raw field code length.
    // HYPERLINK fields embed the URL inside the text, inflating length and breaking heuristics.
    // Also strip the \u0001 placeholder that follows a HYPERLINK field result — this is
    // the field-result marker (often an inline icon), NOT a chart/picture placeholder.
    // Keeping it would cause Step 4 to move it to the wrong position (after the list group).
    for (const para of paragraphs) {
      if (para.text && typeof para.text === 'string') {
        let cleanedText = para.text
        // Remove HYPERLINK field codes + trailing \u0001 field-result marker
        cleanedText = cleanedText.replace(HYPERLINK_QUOTED_RE, '')
        cleanedText = cleanedText.replace(HYPERLINK_BARE_RE, '')
        // Remove other common field codes
        cleanedText = cleanedText.replace(OTHER_FIELD_CODE_RE, '')
        if (cleanedText !== para.text) {
          para.text = cleanedText
        }
      }
    }

    // Mark image-only paragraphs so list detection treats them as transparent
    // (they don't start or end a list group). The placeholder will be moved
    // to a separate paragraph after list detection completes.
    for (const para of paragraphs) {
      const text = para.text || ''
      if (text.includes('\u0001')) {
        const textWithoutPic = text.replace(PIC_PLACEHOLDER_RE, '')
        const hasNonPicContent = textWithoutPic.trim().length > 0
        if (hasNonPicContent) {
          // Mixed content: keep the placeholder in the text but flag the paragraph
          // so list detection can ignore the placeholder when measuring length.
          para.__hasEmbeddedPic = true
        }
      }
    }

    // --- Step 1: Detect title FIRST (before list detection to avoid conflicts) ---
    // First few paragraphs that are very short and not already formatted
    for (let i = 0; i < Math.min(3, paragraphs.length); i++) {
      const len = paragraphs[i].text.length
      if (len > 0 && len <= TITLE_MAX_LEN) {
        paragraphs[i].charFormat = paragraphs[i].charFormat || {}
        paragraphs[i].charFormat.bold = true
        paragraphs[i].charFormat.fontSize = 28
        paragraphs[i].charFormat.underline = false
        paragraphs[i].paraFormat = paragraphs[i].paraFormat || {}
        paragraphs[i].paraFormat.alignment = 'center'
        break
      }
    }

    // --- Step 2: Detect list groups (consecutive short paragraphs) ---
    // Skip paragraphs that have already been marked as title (fontSize=28)
    // For paragraphs with image placeholders: check if the text after the placeholder is list-item length
    let listGroupStart = -1
    const candidateGroups: { start: number; end: number; count: number; avgLen: number; cv: number }[] = []
    const visibleTextLengths = new Uint32Array(paragraphs.length)

    for (let i = 0; i < paragraphs.length; i++) {
      const text = paragraphs[i].text
      const isTitle = paragraphs[i].charFormat?.fontSize === 28
      
      // Strip image placeholders (\u0001) from text before length analysis.
      // A paragraph may contain an embedded image placeholder mixed with other text
      // (e.g., a caption after a HYPERLINK field). We treat the visible text length
      // as the basis for list/title detection.
      const textToCheck = text.replace(PIC_PLACEHOLDER_RE, '')
      const len = textToCheck.length
      visibleTextLengths[i] = len
      const isShort = len >= LIST_ITEM_MIN_LEN && len <= LIST_ITEM_MAX_LEN

      if (isShort && !isTitle && listGroupStart === -1) {
        listGroupStart = i
      } else if ((!isShort || isTitle) && listGroupStart !== -1) {
        // End of group
        const count = i - listGroupStart
        if (count >= LIST_GROUP_MIN_COUNT) {
          // Calculate average length and coefficient of variation
          const lengths: number[] = []
          for (let j = listGroupStart; j < i; j++) {
            lengths.push(visibleTextLengths[j])
          }
          const avgLen = lengths.reduce((s, l) => s + l, 0) / lengths.length
          const variance = lengths.reduce((s, l) => s + (l - avgLen) ** 2, 0) / lengths.length
          const stdDev = Math.sqrt(variance)
          const cv = stdDev / avgLen // coefficient of variation
          candidateGroups.push({ start: listGroupStart, end: i, count, avgLen, cv })
        }
        listGroupStart = -1
      }
    }
    // Check final group
    if (listGroupStart !== -1) {
      const count = paragraphs.length - listGroupStart
      if (count >= LIST_GROUP_MIN_COUNT) {
        const lengths: number[] = []
        for (let j = listGroupStart; j < paragraphs.length; j++) {
          lengths.push(visibleTextLengths[j])
        }
        const avgLen = lengths.reduce((s, l) => s + l, 0) / lengths.length
        const variance = lengths.reduce((s, l) => s + (l - avgLen) ** 2, 0) / lengths.length
        const stdDev = Math.sqrt(variance)
        const cv = stdDev / avgLen
        candidateGroups.push({ start: listGroupStart, end: paragraphs.length, count, avgLen, cv })
      }
    }
    
    // Select the best list group:
    // 1. Prefer groups with more items (at least 3)
    // 2. Prefer groups with more uniform length (lower CV - coefficient of variation)
    // 3. Prefer groups that come AFTER at least one body paragraph (not right after title)
    // bestGroup is also used by Step 4 to place image paragraphs after the list.
    if (candidateGroups.length > 0) {
      // Precompute a prefix count of "body" paragraphs (length > LIST_ITEM_MAX_LEN,
      // ignoring a leading \u0001 placeholder) so the per-group `slice + filter`
      // below is O(1) instead of O(paragraphs) — with many candidate groups this
      // turned an O(n) pass into an O(n²) one (e.g. 27.5k paragraphs / 2.7k groups
      // cost ~290ms).
      const prefixBodyCounts = new Int32Array(paragraphs.length + 1)
      for (let i = 0; i < paragraphs.length; i++) {
        let t = paragraphs[i].text
        if (t.startsWith('\u0001')) t = t.substring(1)
        prefixBodyCounts[i + 1] = prefixBodyCounts[i] + (t.length > LIST_ITEM_MAX_LEN ? 1 : 0)
      }

      // Filter groups with at least 3 items and reasonable length uniformity
      // CV > 0.6 means highly variable lengths — unlikely to be a real list
      const validGroups = candidateGroups.filter(g => g.count >= 3 && g.cv <= 0.6)
      if (validGroups.length > 0) {
        // Score each group: higher count + lower CV + comes after body paragraph.
        const scoreGroup = (group: typeof validGroups[number]) =>
          group.count * 10 + (1 - group.cv) * 20 + (prefixBodyCounts[group.start] >= 1 ? 15 : 0)
        let bestGroup = { ...validGroups[0], score: scoreGroup(validGroups[0]) }
        for (let i = 1; i < validGroups.length; i++) {
          const group = validGroups[i]
          const score = scoreGroup(group)
          if (score > bestGroup.score) bestGroup = { ...group, score }
        }

        // Check if the first item of the group is an introductory/lead-in paragraph
        // that should not be part of the list.
        if (bestGroup.count > 3) {
          const firstLen = (() => {
            let t = paragraphs[bestGroup.start].text
            if (t.startsWith('\u0001')) t = t.substring(1)
            return t.length
          })()
          const avgLen = bestGroup.avgLen

          if (firstLen >= avgLen * 1.3) {
            const hasBodyBefore = prefixBodyCounts[bestGroup.start] > 0

            if (hasBodyBefore) {
              bestGroup = {
                ...bestGroup,
                start: bestGroup.start + 1,
                count: bestGroup.count - 1,
              }
              const lengths: number[] = []
              for (let j = bestGroup.start; j < bestGroup.end; j++) {
                let t = paragraphs[j].text
                if (t.startsWith('\u0001')) t = t.substring(1)
                lengths.push(t.length)
              }
              const newAvgLen = lengths.reduce((s, l) => s + l, 0) / lengths.length
              const newVariance = lengths.reduce((s, l) => s + (l - newAvgLen) ** 2, 0) / lengths.length
              const newStdDev = Math.sqrt(newVariance)
              const newCv = newStdDev / newAvgLen
              bestGroup.avgLen = newAvgLen
              bestGroup.cv = newCv

              logger.log(`Removed lead-in paragraph from list group: new start=${bestGroup.start}, new count=${bestGroup.count}, new cv=${newCv.toFixed(2)}`)
            }
          }
        }

        logger.log(`List group selected: start=${bestGroup.start}, end=${bestGroup.end}, count=${bestGroup.count}, cv=${bestGroup.cv.toFixed(2)}, score=${bestGroup.score.toFixed(1)}`)
        for (let j = bestGroup.start; j < bestGroup.end; j++) {
          paragraphs[j].paraFormat = paragraphs[j].paraFormat || {}
          paragraphs[j].paraFormat.listType = 'unordered'
          paragraphs[j].paraFormat.listStyle = 'disc'
          paragraphs[j].paraFormat.listId = 'structural-list'
          paragraphs[j].paraFormat.alignment = paragraphs[j].paraFormat.alignment || 'left'
          // Normalize list item character format (font size only, preserve bold/italic/underline)
          paragraphs[j].charFormat = paragraphs[j].charFormat || {}
          paragraphs[j].charFormat.fontSize = 10.5
        }
      }
    }

    // --- Step 3: Detect subtitle and body paragraphs (after title) ---
    // Subtitle detection: the first non-list paragraph after the title is
    // recognized as a section heading if it looks like a heading
    // (starts with capital letter, moderate length, complete sentence).
    // A single short paragraph followed by a long body paragraph can still
    // be a section heading if it has heading-like characteristics.
    let titleFound = false
    const subtitleLines: number[] = []

    // First pass: find title and collect subtitle/section-heading candidate paragraphs.
    // The first short paragraph after the title is treated as a section heading
    // if it looks like one (starts with capital, 20-150 chars, sentence-like).
    for (let i = 0; i < paragraphs.length; i++) {
      const len = paragraphs[i].text.length
      if (!titleFound && len <= TITLE_MAX_LEN && paragraphs[i].charFormat?.fontSize === 28) {
        titleFound = true
        continue
      }
      if (titleFound && !paragraphs[i].paraFormat?.listType) {
        if (len > 0 && len < 150) {
          const text = paragraphs[i].text.trim()
          const looksLikeHeading = HEADING_LIKE_RE.test(text) && len >= 20
          
          if (looksLikeHeading && subtitleLines.length === 0) {
            // First short paragraph after title that looks like a heading
            subtitleLines.push(i)
            break
          }
          
          // Check if the NEXT paragraph is also short (subtitle continuation)
          const nextPara = paragraphs[i + 1]
          const nextLen = nextPara ? nextPara.text.length : 0
          if (nextLen >= 150 && subtitleLines.length === 0) {
            // Next paragraph is long body text — but this first short paragraph
            // could still be a section heading. If it looks like a heading,
            // we already added it above. Otherwise, it's body text.
            break
          }
          if (nextLen >= 150) {
            break
          }
          // Candidate subtitle line
          subtitleLines.push(i)
        } else {
          // End of subtitle section
          break
        }
      }
    }

    // Apply subtitle styling to all subtitle lines (18pt = 小二)
    for (const i of subtitleLines) {
      paragraphs[i].charFormat = paragraphs[i].charFormat || {}
      paragraphs[i].charFormat.fontSize = 18
      paragraphs[i].charFormat.bold = true
      paragraphs[i].paraFormat = paragraphs[i].paraFormat || {}
      paragraphs[i].paraFormat.alignment = 'left'
      paragraphs[i].paraFormat.firstLineIndent = 0
    }

    // Insert empty paragraph after the last subtitle line
    if (subtitleLines.length > 0) {
      const lastSubtitleIdx = subtitleLines[subtitleLines.length - 1]
      paragraphs.splice(lastSubtitleIdx + 1, 0, { text: '', charFormat: {}, paraFormat: {} })
    }
    
    // Apply body paragraph styling to remaining non-list paragraphs
    const _subtitleSet = new Set(subtitleLines)
    for (let i = 0; i < paragraphs.length; i++) {
      if (paragraphs[i].paraFormat?.listType) continue
      if (paragraphs[i].charFormat?.fontSize === 28) continue // Skip title
      if (_subtitleSet.has(i)) continue // Skip subtitle lines
      if (paragraphs[i].text.length === 0) continue // Skip empty paragraphs
      
      const len = paragraphs[i].text.length
      if (len >= BODY_MIN_LEN) {
        // Long paragraph
        paragraphs[i].charFormat = paragraphs[i].charFormat || {}
        paragraphs[i].charFormat.fontSize = 10.5
        paragraphs[i].paraFormat = paragraphs[i].paraFormat || {}
        paragraphs[i].paraFormat.alignment = 'justify'
        paragraphs[i].paraFormat.firstLineIndent = 24
      } else if (len > 0) {
        // Short paragraph in body section: check if it's a section heading
        // A section heading is a short paragraph (< 100 chars) surrounded by
        // long body paragraphs or table/structure elements.
        const prevPara = i > 0 ? paragraphs[i - 1] : null
        const nextPara = i < paragraphs.length - 1 ? paragraphs[i + 1] : null
        const prevIsBody = prevPara && prevPara.text.length >= BODY_MIN_LEN && !prevPara.paraFormat?.listType
        const nextIsLong = nextPara && (nextPara.text.length >= BODY_MIN_LEN || nextPara.text.includes('\u0007'))
        
        if (prevIsBody && nextIsLong && len < 100) {
          // Section heading: 18pt (小二) bold
          paragraphs[i].charFormat = paragraphs[i].charFormat || {}
          paragraphs[i].charFormat.fontSize = 18
          paragraphs[i].charFormat.bold = true
          paragraphs[i].paraFormat = paragraphs[i].paraFormat || {}
          paragraphs[i].paraFormat.alignment = 'left'
          paragraphs[i].paraFormat.firstLineIndent = 0
        } else {
          // Regular short body paragraph
          paragraphs[i].charFormat = paragraphs[i].charFormat || {}
          paragraphs[i].charFormat.fontSize = 10.5
          paragraphs[i].charFormat.bold = false
          paragraphs[i].charFormat.italic = false
          paragraphs[i].charFormat.underline = false
          paragraphs[i].paraFormat = paragraphs[i].paraFormat || {}
          paragraphs[i].paraFormat.alignment = 'justify'
          paragraphs[i].paraFormat.firstLineIndent = 0
        }
      }
    }

    // --- Step 3.5: Merge short body paragraphs with the following paragraph ---
    // Handles cases where a soft-break in the original document was parsed as
    // a separate paragraph (e.g., "In non" followed by body text).
    // Only merge if the short paragraph has body styling (12pt) and is NOT a subtitle line.
    // Unreachable: Step 3 above rewrites every non-list short paragraph to
    // 10.5pt/18pt, and list paragraphs are excluded by the !listType check,
    // so a 12pt non-list short paragraph cannot survive to this point.
    /* v8 ignore start */
    for (let i = paragraphs.length - 1; i >= 1; i--) {
      const para = paragraphs[i]
      const prev = paragraphs[i - 1]
      if (prev.text.length > 0 && prev.text.length < 20 && prev.charFormat?.fontSize === 12 && !prev.paraFormat?.listType && para.text.length >= BODY_MIN_LEN) {
        // Merge previous short paragraph into current one
        para.text = prev.text + para.text
        if (!para.charFormat) para.charFormat = prev.charFormat
        paragraphs.splice(i - 1, 1)
      }
    }
    /* v8 ignore stop */

    // --- Step 3.6: Insert blank lines around section headings and after title ---
    // The original document has blank paragraphs (empty lines) before and after
    // section headings (18pt bold), after the title, and after tables. These
    // were filtered out during extraction, so we restore them here to match
    // the source document's vertical spacing.
    // Insert in reverse order to avoid index shifting.
    let blankInsertions = 0
    for (let i = paragraphs.length - 1; i >= 0; i--) {
      const para = paragraphs[i]
      if (!para.text || para.text.length === 0) continue
      const isTitle = para.charFormat?.fontSize === 28
      const isSectionHeading = para.charFormat?.fontSize === 18 && para.charFormat?.bold

      if (isTitle) {
        // Blank line after title
        paragraphs.splice(i + 1, 0, { text: '', charFormat: {}, paraFormat: {} })
        blankInsertions++
      } else if (isSectionHeading) {
        // Blank line before section heading (if previous is not already blank/title)
        if (i > 0) {
          const prev = paragraphs[i - 1]
          const prevIsBlank = !prev.text || prev.text.length === 0
          const prevIsTitle = prev.charFormat?.fontSize === 28
          if (!prevIsBlank && !prevIsTitle) {
            paragraphs.splice(i, 0, { text: '', charFormat: {}, paraFormat: {} })
          }
        }
        // Blank line after section heading (if next is not already blank)
        if (i + 1 < paragraphs.length) {
          const next = paragraphs[i + 1]
          const nextIsBlank = !next.text || next.text.length === 0
          if (!nextIsBlank) {
            paragraphs.splice(i + 1, 0, { text: '', charFormat: {}, paraFormat: {} })
          }
        }
      }
    }
    logger.log(`applyStructuralFormats: Step 3.6 inserted ${blankInsertions} blank lines, now ${paragraphs.length} paragraphs`)

    // --- Step 4: Separate embedded image placeholders into standalone paragraphs ---
    // After list detection completes, split paragraphs that contain \u0001 mixed
    // with other text. The placeholder becomes its own centered paragraph inserted
    // right after the LIST GROUP (not the original paragraph) when the original
    // paragraph is part of a list. This matches WPS rendering where embedded
    // images appear as standalone elements after the entire list.
    // Note: listGroupStartIdx/listGroupEndIdx may be stale after Step 3.6 inserted
    // blank lines, so we re-scan to find the current list group boundaries.
    let currentListStart = -1
    let currentListEnd = -1
    for (let i = 0; i < paragraphs.length; i++) {
      if (paragraphs[i].paraFormat?.listType) {
        if (currentListStart === -1) currentListStart = i
        currentListEnd = i + 1
      } else if (currentListStart !== -1) {
        break
      }
    }
    
    for (let i = paragraphs.length - 1; i >= 0; i--) {
      const para = paragraphs[i]
      const text = para.text || ''
      if (text.includes('\u0001') && para.__hasEmbeddedPic) {
        const textWithoutPic = text.replace(PIC_PLACEHOLDER_RE, '')
        const picPara: ParserParagraph = {
          text: '\u0001',
          charFormat: para.charFormat ? { ...para.charFormat, fontSize: 0 } : { fontSize: 0 },
          paraFormat: { alignment: 'center' },
        }
        para.text = textWithoutPic
        // If the original paragraph is inside a list group, place the image
        // paragraph after the entire list group so it appears after all list items.
        if (currentListStart >= 0 && i >= currentListStart && i < currentListEnd) {
          // Insert at currentListEnd (after the last list item)
          paragraphs.splice(currentListEnd, 0, picPara)
          currentListEnd++ // account for the insertion
        } else {
          // Otherwise, insert right after the original paragraph
          paragraphs.splice(i + 1, 0, picPara)
        }
      }
    }
  }

  export function normalizeParagraphCpAxis(paragraphs: ParserParagraph[]): void {
    let cursor = 0
    for (const p of paragraphs) {
      if (!p) continue
      p._cpStart = cursor
      cursor += (typeof p.text === 'string' ? p.text.length : 0) + 1
    }
  }

  export function splitMultiRowTables(paragraphs: ParserParagraph[]): ParserParagraph[] {
    const result: ParserParagraph[] = []
    for (const para of paragraphs) {
      const text = para.text || ''
      // Only process if there are 2+ consecutive cell marks (row separators)
      if (!text.includes('\u0007\u0007')) {
        result.push(para)
        continue
      }
      // Split by runs of 2+ consecutive \u0007 to separate rows
      const rows = text.split(CELL_MARK_RUN_RE)
        .map((r: string) => r.replace(CELL_MARK_EDGE_RE, ''))
        .filter((r: string) => r.length > 0)
      if (rows.length >= 2) {
        for (const row of rows) {
          result.push({ ...para, text: row })
        }
      } else {
        // Fallback: treat as single paragraph but clean trailing cell marks
        result.push({ ...para, text: text.replace(CELL_MARK_TRAIL_RE, '') })
      }
    }
    return result
  }

  export function replacePageFieldsInText(text: string, pageFields: PageFieldInfo[]): string {
    let result = text
    for (const field of pageFields) {
      const instruction = field.instruction.trim()
      const searchStr = instruction + field.result
      if (searchStr.length === 0) continue
      // 仅替换第一个匹配，避免误伤
      const idx = result.indexOf(searchStr)
      if (idx >= 0) {
        // R-F4-2 落地说明：等长补齐方案与既有清洗断言冲突（产生可见空格串），
        // 且 F4-1 的 normalizeParagraphCpAxis 咽喉点归一化已从根上消灭缩短漂移
        // （规格中映射表/等长皆为达成同一目标的机制，归一化更鲁棒）。
        // 故此处维持原缩短语义，CP 一致性由 normalizeParagraphCpAxis 保证。
        result = result.slice(0, idx) + field.result + result.slice(idx + searchStr.length)
      }
    }
    return result
  }

  export function cleanWordFieldCodes(para: ParserParagraph): ParserParagraph {
    let text = para.text

    const replaced = text.replace(PAGE_OF_PAGES_RE, '第 $1 页 共 $2 页')

    if (replaced === text) {
      let cleaned = text
      for (const pattern of FIELD_CODE_PATTERNS) cleaned = cleaned.replace(pattern, '')
      // Remove quoted URLs left over from HYPERLINK field codes, leaving display text
      cleaned = cleaned.replace(QUOTED_URL_RE, ' ')
      // Remove HYPERLINK field codes that contain picture placeholders,
      // e.g. 'HYPERLINK "url"\u0001Mauris...' — the 0x13/0x14/0x15 field
      // markers are stripped, so HYPERLINK + URL + placeholder concatenate.
      cleaned = cleaned.replace(HYPERLINK_QUOTED_PIC_RE, '\u0001')
      cleaned = cleaned.replace(HYPERLINK_QUOTED_TRAIL_RE, '')
      // Also handle HYPERLINK without quotes (malformed)
      cleaned = cleaned.replace(HYPERLINK_BARE_PIC_RE, '\u0001')
      cleaned = cleaned.replace(HYPERLINK_BARE_TRAIL_RE, '')
      // Remove EMBED field class names after picture placeholders (e.g., "\u0001ChartDocumentMauris...")
      // The pattern: \u0001 followed by CamelCaseWords (class name) before actual content
      // Only match if there are at least 2 consecutive CamelCase words with no space between them
      // This avoids eating the first word of actual text content
      cleaned = cleaned.replace(PIC_CLASSNAME_RE, '\u0001')
      text = cleaned
    } else {
      text = replaced
    }

    const cleaned = text.replace(MULTI_SPACE_RE, ' ').replace(DUP_COMMA_RE, '，').replace(DUP_PERIOD_RE, '。').replace(DUP_COLON_RE, '：').trim()

    if (cleaned !== text || text !== para.text) {
      const newCharFormat = { ...para.charFormat }
      if (newCharFormat.styles && newCharFormat.styles.length > 0) delete newCharFormat.styles
      return { ...para, text: cleaned, charFormat: newCharFormat }
    }
    return para
  }

  export function removeInternalDuplicates(text: string): string {
    if (text.length < 10) return text
    if (text.length > REMOVE_DUP_EXACT_MAX_LEN) {
      const collapsed = collapseWholeBlockRepeats(text)
      // 仅当折叠后落入精确路径阈值内才继续；否则（病态无幂串）护栏放行，
      // 避免同串无限重入。
      if (collapsed.length <= REMOVE_DUP_EXACT_MAX_LEN && collapsed !== text) {
        return removeInternalDuplicates(collapsed)
      }
      return collapsed
    }
    const n = text.length

    // Collapse adjacent duplicated blocks (parser artifacts like "abcabc" -> "abc").
    // A tandem repeat of period `len` at position i means text[i+j] == text[i+j+len]
    // for every j in [0, len). Instead of allocating substrings for every (len, i)
    // pair (the old O(n^3) scan that also hit its worst case on clean text), we track
    // a rolling run of consecutive character matches at gap `len`; a run of `len`
    // matches marks the smallest qualifying i for that period — identical selection
    // order to the original (largest period first, then smallest index).
    // Periods below 12 are left alone: real extraction artifacts duplicate whole
    // sentence chunks, while short tandems are usually legitimate prose ("This is
    // a", "had had", "la la la") that a small threshold would eat.
    for (let len = Math.floor(n / 2); len >= 12; len--) {
      let run = 0
      const maxP = n - len
      for (let p = 0; p < maxP; p++) {
        if (text.charCodeAt(p) === text.charCodeAt(p + len)) {
          if (++run >= len) {
            const i = p - len + 1
            const part1 = text.substring(i, i + len)
            let count = 2
            let j = i + len * 2
            while (j + len <= n && text.substring(j, j + len) === part1) {
              count++
              j += len
            }
            const before = text.substring(0, i)
            const after = text.substring(i + len * count)
            return removeInternalDuplicates(before + part1 + after)
          }
        } else {
          run = 0
        }
      }
    }

    // Collapse triple repeats (three identical adjacent blocks -> one). Needs a run of
    // 2*len consecutive gap matches: the first `len` prove block1==block2, the next
    // `len` prove block2==block3.
    for (let len = Math.floor(n / 3); len >= 5; len--) {
      let run = 0
      const maxP = n - len
      for (let p = 0; p < maxP; p++) {
        if (text.charCodeAt(p) === text.charCodeAt(p + len)) {
          if (++run >= len * 2) {
            const i = p - len * 2 + 1
            const before = text.substring(0, i)
            const after = text.substring(i + len * 3)
            return removeInternalDuplicates(before + text.substring(i, i + len) + after)
          }
        } else {
          run = 0
        }
      }
    }

    return text
  }

