/**
 * textHeuristics —— 格式启发式推断纯函数族（T4-P1 C 块第一半 · contract-split-r1 §2.1 heuristics/textHeuristics.ts）
 *
 * 自 docParser.ts 原样迁出（move-only，符号名锚）：guessCharFormat /
 * detectCharacterStyles / shouldHaveUnderline / isSameStyle / detectParagraphFormat /
 * detectListInfo / detectAlignment。域内互相调用已转模块本地裸名。
 *
 * FIELD-CP-GOV 时序对齐 ✓：规格文档列为必读参照；本域逐字节保真零逻辑改动，
 * R-F2/R-F4 后续修复触及本域时同 PR 序列对齐。
 * 纯度：禁 import vue/.vue、禁反向 import ../docParser（契约 §2.2 规则 2）；
 * 全部为纯字符串/正则推断，零外部状态。
 */

import type { CharacterFormat, ParagraphFormat, CharStyle, CharStyleSegment } from '../../docFormat'
import { countChineseChars } from '../encodingDetector'

/**
 * 与 JS `\s` 等价的码点判定（WhiteSpace + LineTerminator）。
 *
 * `detectCharacterStyles` 原先在**逐字符循环内**写 `/\s/.test(text[i])`：
 * 正则字面量每次求值都会新建 RegExp 对象，且 `text[i]` 还要额外分配一个单字符
 * 字符串。改成对已有的 `charCodeAt` 结果做区间判断后，这两项分配都消失。
 *
 * 覆盖范围与 `\s` 完全一致：TAB(09) LF(0A) VT(0B) FF(0C) CR(0D)、SP(20)、
 * NBSP(A0)、ZWNBSP(FEFF)、Zs 类的 1680 / 2000–200A / 202F / 205F / 3000、
 * 以及 LS(2028) / PS(2029)。
 */
function isWhitespaceCode(code: number): boolean {
  return (
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  )
}

/**
 * `shouldHaveUnderline` 用的三个模式。该函数在每个数字字符上被调用，
 * 原先三个正则都是函数体内的字面量（每次求值新建 RegExp 对象），现提升到模块级。
 * 三者均非全局（无 `g`），不涉及 `lastIndex`，跨调用共享安全。
 */
const DATE_COLON_BEFORE_RE = /[：:]\s*$/
const DATE_UNIT_RE = /[年日月时分秒]/
const DATE_TIME_RE = /[0-9]{2,4}[年月日时分秒]/

/** 统计与 `\s` 匹配的码点个数（等价于 `text.replace(/\s/g, '').length` 的差值）。 */
function countWhitespaceChars(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    if (isWhitespaceCode(text.charCodeAt(i))) count++
  }
  return count
}

/** 前导空白个数，等价于 `text.length - text.trimStart().length`。 */
function leadingWhitespaceCount(text: string): number {
  let i = 0
  while (i < text.length && isWhitespaceCode(text.charCodeAt(i))) i++
  return i
}

/**
 * 尾部空白个数，等价于
 * `text.trimEnd().length === 0 ? 0 : text.length - text.trimEnd().length`。
 * 全空白串自然得 0：此时前导计数已等于 text.length，循环上限为 0。
 * `leading` 作为上限保证前导段与尾部段不重叠。
 */
function trailingWhitespaceCount(text: string, leading: number): number {
  const limit = text.length - leading
  let count = 0
  while (count < limit && isWhitespaceCode(text.charCodeAt(text.length - 1 - count))) count++
  return count
}

/**
 * 前导缩进"视觉宽度"：把前导空白串中的 TAB(09) 与全角空格(3000) 各算 2、
 * 其余空白各算 1 后的总长度。
 * 原实现先 match 出前导空白串，再分别 replace 制表符与全角空格为两格，
 * 一次 match 加两次 replace 共三次整串分配；此处单趟扫描零分配。
 */
function leadingIndentWidth(text: string): number {
  let width = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (!isWhitespaceCode(code)) break
    width += code === 0x09 || code === 0x3000 ? 2 : 1
  }
  return width
}

// ---- guessCharFormat 用的模式（原先都是函数体内的字面量，每次调用新建 RegExp）----
// 注意 SENTENCE_PUNCT_RE 含 ASCII `. ! ?`，与 detectAlignment 的
// ALIGN_SENTENCE_PUNCT_RE（只含中文标点）**不同**，不可合并。
const SENTENCE_PUNCT_RE = /[，。！？、；.!?]/
const EN_TITLE_START_RE = /^[A-Z][a-z]/
const HAS_LATIN_RE = /[A-Za-z]/
const ALL_CAPS_TITLE_RE = /^[A-Z\s]{3,}$/
// 下面两个带 `g`，仅用于 String.match（会重置并忽略 lastIndex），跨调用共享安全。
const CAPITAL_WORD_RE = /\b[A-Z][a-z]{2,}\b/g
const WORD_RE = /\b[a-zA-Z]{2,}\b/g

// ---- detectAlignment 用的模式 ----
const ALIGN_YEAR_RE = /^\s*\d{4}\s*年/
const ALIGN_MONTH_RE = /^\s*\d{1,2}\s*月/
const ALL_CAPS_LINE_RE = /^[A-Z][A-Z\s]+$/
const ALIGN_SENTENCE_PUNCT_RE = /[，。！？、；]/

// ---- detectListInfo 用的模式 ----
const LIST_MULTI_LEVEL_RE = /^\d+(?:\.\d+)+[\.\s\t]/
const LIST_ARABIC_RE = /^\d+[\.\)][\s\t]/
const LIST_PAREN_ARABIC_RE = /^[\(\（\[]\d+[\)\）\]][\s\t]*/
const LIST_ROMAN_RE = /^(?:i{1,3}|iv|v|vi{0,3}|ix|x|I{1,3}|IV|V|VI{0,3}|IX|X)[\.\)][\s\t]/
const LIST_ROMAN_UPPER_RE = /^[IVXLCDM]/
const LIST_LATIN_RE = /^[a-zA-Z][\.\)][\s\t]/
const LIST_PAREN_LATIN_RE = /^[\(\（][a-zA-Z][\)\）][\s\t]*/
const LIST_CJK_NUMERAL_RE = /^([一二三四五六七八九十百千零〇]{1,4}|[甲乙丙丁戊己庚辛壬癸]|[壹贰叁肆伍陆柒捌玖拾佰仟]{1,4})[\、\.\)]/
const LIST_PAREN_CJK_RE = /^[\(\（]([一二三四五六七八九十]{1,4}|[甲乙丙丁戊己庚辛壬癸])[）\)][\s\t]*/
const LIST_CIRCLED_RE = /^[\u2460-\u2473\u3251-\u325F\u32B1-\u32BF][\s\t]/
const LIST_BULLET_ASCII_RE = /^[•\-\*][\s\t]/
const LIST_BULLET_ASCII_ALT_RE = /^[•\*]\s/
const LIST_BULLET_CJK_RE = /^[○●▪▸►→◇◆]\s/
const LIST_BULLET_SQUARE_RE = /^[▪▫◦‣⁃]\s/

export function guessCharFormat(text: string, _paragraphIndex?: number): CharacterFormat {
    const charFormat: CharacterFormat = { styles: [] }
    const chineseCount = countChineseChars(text)
    const totalLength = text.length
    const chineseRatio = chineseCount / totalLength
    // 原先 `text.replace(/\s/g, '')` 只为拿长度，现直接计数，省掉一次整串分配。
    const strippedLength = totalLength - countWhitespaceChars(text)
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
    const hasSentencePunct = SENTENCE_PUNCT_RE.test(text)
    const noSentencePunct = !hasSentencePunct
    const pureName = chineseCount >= 2 && chineseCount <= 4 && strippedLength === chineseCount && trimmed.length <= 4

    if (!pureName && noSentencePunct && !text.includes('：') && !text.includes(':')) {
      const isEnglishTitle = EN_TITLE_START_RE.test(trimmed) && HAS_LATIN_RE.test(trimmed) && !SENTENCE_PUNCT_RE.test(trimmed)
      const isAllCapsTitle = ALL_CAPS_TITLE_RE.test(trimmed) && trimmed.length >= 3 && trimmed.length <= 40
      const isShortChineseTitle = chineseRatio > 0.5 && totalLength < 22 && chineseCount >= 2

      if (isAllCapsTitle) {
        // ALL CAPS → large title
        charFormat.bold = true
        charFormat.fontSize = 28
      } else if (isEnglishTitle && totalLength < 40) {
        // "This Is A Title" pattern or first-word-capitalized
        const capitalWords = (trimmed.match(CAPITAL_WORD_RE) || []).length
        const totalWords = (trimmed.match(WORD_RE) || []).length
        if (capitalWords >= Math.min(totalWords, 2) && totalWords >= 2) {
          charFormat.bold = true
          charFormat.fontSize = 22
        } else if (totalLength < 20) {
          charFormat.bold = true
          charFormat.fontSize = 22
        }
      } else if (isShortChineseTitle) {
        charFormat.bold = true
        charFormat.fontSize = strippedLength < 6 ? 36 : 22
      }
    }

    charFormat.styles = detectCharacterStyles(text)
    return charFormat
  }

export function detectCharacterStyles(text: string): CharStyleSegment[] {
    const styles: CharStyleSegment[] = []
    let currentStyle: CharStyle | null = null
    let styleStart = 0
    // Running count of CJK chars in text[0, i). Lets us decide the fallback Chinese
    // font in O(1) per char instead of re-scanning the whole prefix (was O(n^2)).
    let chineseSoFar = 0

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      const isDigit = code >= 0x30 && code <= 0x39
      const isChinese = code >= 0x4e00 && code <= 0x9fff
      const isUpperCase = code >= 0x41 && code <= 0x5a
      const isLowerCase = code >= 0x61 && code <= 0x7a
      const isWhitespace = isWhitespaceCode(code)

      let charStyle: CharStyle | null = null
      if (isWhitespace) charStyle = { underline: false }
      else if (isDigit) charStyle = { fontName: 'Times New Roman', underline: shouldHaveUnderline(text, i) }
      else if (isUpperCase || isLowerCase) charStyle = { fontName: 'Times New Roman', underline: false }
      else if (isChinese) charStyle = { fontName: '仿宋', underline: false }
      else {
        // Fallback font decision based on CJK density of the preceding text.
        const fontName = (i === 0 || chineseSoFar === 0)
          ? 'Times New Roman'
          : (chineseSoFar / i > 0.7 ? '宋体' : '仿宋')
        charStyle = { fontName, underline: false }
      }

      if (isChinese) chineseSoFar++

      // isSameStyle 是纯函数：原来在同一个分支里连调两次，这里只算一次。
      if (currentStyle) {
        if (isSameStyle(currentStyle, charStyle)) continue
        styles.push({ start: styleStart, end: i, style: currentStyle })
      }
      currentStyle = charStyle
      styleStart = i
    }

    if (currentStyle) styles.push({ start: styleStart, end: text.length, style: currentStyle })

    // 逐字符找冒号：改用 charCodeAt 避免每字符分配单字符字符串
    // （'：' = U+FF1A，':' = U+003A）。
    const colonPositions: number[] = []
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if (code === 0xff1a || code === 0x3a) colonPositions.push(i)
    }
    if (colonPositions.length > 0) {
      // 原实现为每个段落分配并填充一个 text.length 长的布尔数组 shouldUL，
      // 再把每个 style 段与它求交计数。这里直接按区间求交集长度：
      // colonPositions 升序，且各标记区间互不重叠（start_ci = colon[ci] + 1，
      // end_ci = colon[ci+1] - 4 < start_{ci+1}），因此逐段累加交集长度与
      // 原「逐位置查表」的计数完全一致，省掉一次 O(n) 分配 + 填充。
      const underlineRanges: Array<{ start: number; end: number }> = []
      for (let ci = 0; ci < colonPositions.length; ci++) {
        const start = colonPositions[ci] + 1
        const end = ci + 1 < colonPositions.length ? colonPositions[ci + 1] - 4 : text.length
        if (end > start) underlineRanges.push({ start, end })
      }
      for (const seg of styles) {
        if (!seg.style) continue
        let count = 0
        for (const range of underlineRanges) {
          const lo = seg.start > range.start ? seg.start : range.start
          const hi = seg.end < range.end ? seg.end : range.end
          if (hi > lo) count += hi - lo
        }
        if (count > (seg.end - seg.start) * 0.4) seg.style.underline = true
      }
    }
    return styles
  }

export function shouldHaveUnderline(text: string, index: number): boolean {
    // 原为 text[index] + /[0-9]/ 测试；本函数在每个数字字符上都会被调用，
    // 改用码点判断可省掉一次单字符字符串分配与一次正则求值。
    const code = text.charCodeAt(index)
    if (!(code >= 0x30 && code <= 0x39)) return false
    const before = text.substring(Math.max(0, index - 30), index)
    const after = text.substring(index, Math.min(text.length, index + 30))
    const hasColonBefore = DATE_COLON_BEFORE_RE.test(before)
    const hasDatePattern = DATE_UNIT_RE.test(after) || DATE_UNIT_RE.test(before)
    const hasTimePattern = DATE_TIME_RE.test(after) || DATE_TIME_RE.test(before)
    return hasColonBefore || hasDatePattern || hasTimePattern
  }

export function isSameStyle(style1: CharStyle | null, style2: CharStyle | null): boolean {
    if (!style1 || !style2) return false
    const fn1 = style1.fontName
    const fn2 = style2.fontName
    // If either has no explicit fontName, treat as same style (inherits paragraph default)
    if (fn1 === undefined || fn2 === undefined) {
      return (style1.underline || false) === (style2.underline || false)
    }
    return fn1 === fn2 && (style1.underline || false) === (style2.underline || false)
  }

export function detectParagraphFormat(text: string, index: number, totalParagraphs: number): ParagraphFormat {
    const format: ParagraphFormat = {}
    const alignment = detectAlignment(text, index, totalParagraphs)
    if (alignment) format.alignment = alignment

    // Detect list type (with level inferred from leading whitespace).
    const listInfo = detectListInfo(text)
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
export function detectListInfo(text: string): { listType: 'ordered' | 'unordered'; listStyle: string; listLevel: number } | null {
    // Count leading whitespace (spaces / tabs / full-width spaces) as an indent width.
    // 原先 match(/^[\s\u3000\t]*/) + 两次 replace 共 3 次整串分配，现单趟扫描。
    const listLevel = Math.floor(leadingIndentWidth(text) / 2)

    const trimmed = text.trim()
    if (trimmed.length < 2) return null

    // 1. Multi-level Arabic: 1.1 / 1.2.3 (at least one dot-separated number followed by space or end)
    if (LIST_MULTI_LEVEL_RE.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'decimal', listLevel }
    }

    // 2. Arabic numeral with . or ) then space: 1. / 2) / 12.
    if (LIST_ARABIC_RE.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'decimal', listLevel }
    }

    // 3. Parenthesized Arabic: (1) / （2） / [1] — allow optional space after closing paren.
    if (LIST_PAREN_ARABIC_RE.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'decimal', listLevel }
    }

    // 4. Roman numerals: i. / ii. / iv. / I. / II. (checked BEFORE single Latin letter
    //    so "i." / "v." / "x." are treated as Roman rather than lower-alpha).
    if (LIST_ROMAN_RE.test(trimmed)) {
      const isUpper = LIST_ROMAN_UPPER_RE.test(trimmed)
      return { listType: 'ordered', listStyle: isUpper ? 'upper-roman' : 'lower-roman', listLevel }
    }

    // 5. Latin letter with . or ): a. / B) / (a)
    if (LIST_LATIN_RE.test(trimmed) && trimmed.length >= 3) {
      return { listType: 'ordered', listStyle: 'lower-alpha', listLevel }
    }
    if (LIST_PAREN_LATIN_RE.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'lower-alpha', listLevel }
    }

    // 6. CJK ideographic numerals: 一、二、三、...、十、十一、... / 甲、乙、... / 壹、贰、...
    //    Also accept （一）（二） parenthesized form (no trailing space required,
    //    since Chinese numbered items often have no separator).
    //    原实现用 match() 但只用其结果做真值判断，改用 test() 等价且不产出数组。
    if (LIST_CJK_NUMERAL_RE.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'cjk-ideographic', listLevel }
    }
    if (LIST_PAREN_CJK_RE.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'cjk-ideographic', listLevel }
    }

    // 7. Circled numbers: ① ② ... ㊿ (U+2460..U+2473, U+3251..U+325F, U+32B1..U+32BF)
    if (LIST_CIRCLED_RE.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'cjk-ideographic', listLevel }
    }

    // 8. Unordered: ASCII and CJK bullets
    if (LIST_BULLET_ASCII_RE.test(trimmed) || LIST_BULLET_ASCII_ALT_RE.test(trimmed)) {
      return { listType: 'unordered', listStyle: 'disc', listLevel }
    }
    if (LIST_BULLET_CJK_RE.test(trimmed)) {
      return { listType: 'unordered', listStyle: 'disc', listLevel }
    }
    if (LIST_BULLET_SQUARE_RE.test(trimmed)) {
      return { listType: 'unordered', listStyle: 'square', listLevel }
    }

    return null
  }

export function detectAlignment(text: string, index: number, totalParagraphs: number): ParagraphFormat['alignment'] | null {
    const trimmed = text.trim()
    const totalLen = trimmed.length
    // 原先每次调用要 trim()/trimStart()/trimEnd()×2/replace()/match() 共 6 次分配。
    // 前导/尾部空白改为计数（trimStart/trimEnd 只用于取长度），
    // stripped 只用到长度与其中的中文字数 —— 两者都可直接在 trimmed 上算。
    const leadingSpaces = leadingWhitespaceCount(text)
    const trailingSpaces = trailingWhitespaceCount(text, leadingSpaces)
    const strippedLen = totalLen - countWhitespaceChars(trimmed)
    const chineseCount = countChineseChars(trimmed)

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
    const onlyName = chineseCount >= 2 && chineseCount <= 4 && strippedLen === chineseCount
    if (onlyName && index > totalParagraphs * 0.5) return 'right'

    // Date lines → right-aligned
    if (ALIGN_YEAR_RE.test(trimmed) || ALIGN_MONTH_RE.test(trimmed)) return 'right'

    // Short ALL-CAPS English → center (likely a title/subtitle)
    if (ALL_CAPS_LINE_RE.test(trimmed) && totalLen >= 3 && totalLen <= 50) return 'center'

    // Short centered Chinese title
    const hasSentencePunct = ALIGN_SENTENCE_PUNCT_RE.test(trimmed)
    const noFieldMarkers = !trimmed.includes('：') && !trimmed.includes(':') && !trimmed.includes('？') && !trimmed.includes('?') && !hasSentencePunct
    if (totalLen < 18 && chineseCount >= 2 && chineseCount / strippedLen > 0.5 && noFieldMarkers) return 'center'

    return null
  }

  // ==================== Paragraph cleaning ====================

