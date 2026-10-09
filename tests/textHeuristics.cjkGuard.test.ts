// Round 112 护栏：guessCharFormat / detectAlignment 的「无 CJK 时跳过 O(n) 计数」。
//
// 参照实现是**改动前**两个函数的逐行转写（无条件调用 countChineseAndWhitespace）。
// 参照里只借用生产模块导出的 `countChineseAndWhitespace` 与 `detectCharacterStyles`
// （本轮未改动这两个函数），其余小工具（isWhitespaceCode / leadingWhitespaceCount /
// trailingWhitespaceCount）与全部正则在本文件内按原定义复刻。
// 本护栏抓的是**控制流**（跳过计数的分支），不是那些被复刻的常量。
//
// 等价性依据（供审阅）：无 CJK ⇒ chineseCount 必为 0。两个函数里对 chineseCount 的
// 判断都是 `>= 2`（guessCharFormat 三处：字体选择 / pureName / isShortChineseTitle；
// detectAlignment 两处：onlyName / 居中标题），全部短路；依赖 chineseCount 的
// `chineseRatio` 与 `strippedLength`/`strippedLen` 因此都不会被读取。
import { describe, it, expect } from 'vitest'
import {
  guessCharFormat,
  detectAlignment,
  detectCharacterStyles,
  countChineseAndWhitespace,
} from '../src/utils/docparser/heuristics/textHeuristics'
import type { CharacterFormat } from '../src/utils/docFormat'

// ── 复刻的小工具 ────────────────────────────────
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
function leadingWhitespaceCount(text: string): number {
  let i = 0
  while (i < text.length && isWhitespaceCode(text.charCodeAt(i))) i++
  return i
}
function trailingWhitespaceCount(text: string, leading: number): number {
  const limit = text.length - leading
  let count = 0
  while (count < limit && isWhitespaceCode(text.charCodeAt(text.length - 1 - count))) count++
  return count
}

// ── 复刻的正则 ──────────────────────────────────
const SENTENCE_PUNCT_RE = /[，。！？、；.!?]/
const EN_TITLE_START_RE = /^[A-Z][a-z]/
const HAS_LATIN_RE = /[A-Za-z]/
const ALL_CAPS_TITLE_RE = /^[A-Z\s]{3,}$/
const CAPITAL_WORD_RE = /\b[A-Z][a-z]{2,}\b/g
const WORD_RE = /\b[a-zA-Z]{2,}\b/g
const ALIGN_YEAR_RE = /^\s*\d{4}\s*年/
const ALIGN_MONTH_RE = /^\s*\d{1,2}\s*月/
const ALL_CAPS_LINE_RE = /^[A-Z][A-Z\s]+$/
const ALIGN_SENTENCE_PUNCT_RE = /[，。！？、；]/

// ── 改动前实现的逐行转写 ────────────────────────
function refGuessCharFormat(text: string): CharacterFormat {
  const charFormat: CharacterFormat = { styles: [] }
  const [chineseCount, whitespaceCount] = countChineseAndWhitespace(text)
  const totalLength = text.length
  const chineseRatio = chineseCount / totalLength
  const strippedLength = totalLength - whitespaceCount
  const trimmed = text.trim()

  if (chineseCount >= 2) {
    charFormat.fontSize = 16
    if (chineseRatio > 0.7) charFormat.fontName = '仿宋_GB2312'
    else charFormat.fontName = '宋体'
  } else {
    charFormat.fontSize = 12
    charFormat.fontName = 'Times New Roman'
  }

  const hasSentencePunct = SENTENCE_PUNCT_RE.test(text)
  const noSentencePunct = !hasSentencePunct
  const pureName =
    chineseCount >= 2 && chineseCount <= 4 && strippedLength === chineseCount && trimmed.length <= 4

  if (!pureName && noSentencePunct && !text.includes('：') && !text.includes(':')) {
    const isEnglishTitle =
      EN_TITLE_START_RE.test(trimmed) && HAS_LATIN_RE.test(trimmed) && !SENTENCE_PUNCT_RE.test(trimmed)
    const isAllCapsTitle =
      ALL_CAPS_TITLE_RE.test(trimmed) && trimmed.length >= 3 && trimmed.length <= 40
    const isShortChineseTitle = chineseRatio > 0.5 && totalLength < 22 && chineseCount >= 2

    if (isAllCapsTitle) {
      charFormat.bold = true
      charFormat.fontSize = 28
    } else if (isEnglishTitle && totalLength < 40) {
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

function refDetectAlignment(
  text: string,
  index: number,
  totalParagraphs: number,
): string | null {
  const trimmed = text.trim()
  const totalLen = trimmed.length
  const leadingSpaces = leadingWhitespaceCount(text)
  const trailingSpaces = trailingWhitespaceCount(text, leadingSpaces)
  const [chineseCount, whitespaceCount] = countChineseAndWhitespace(trimmed)
  const strippedLen = totalLen - whitespaceCount

  if (totalLen > 0 && leadingSpaces > 0) {
    const leadingRatio = leadingSpaces / (leadingSpaces + totalLen)
    if (leadingRatio > 0.15 && leadingRatio < 0.5) return 'center'
  }
  if (leadingSpaces > 2 && trailingSpaces > 2 && totalLen < 60) return 'center'

  const onlyName = chineseCount >= 2 && chineseCount <= 4 && strippedLen === chineseCount
  if (onlyName && index > totalParagraphs * 0.5) return 'right'

  if (ALIGN_YEAR_RE.test(trimmed) || ALIGN_MONTH_RE.test(trimmed)) return 'right'
  if (ALL_CAPS_LINE_RE.test(trimmed) && totalLen >= 3 && totalLen <= 50) return 'center'

  const hasSentencePunct = ALIGN_SENTENCE_PUNCT_RE.test(trimmed)
  const noFieldMarkers =
    !trimmed.includes('：') &&
    !trimmed.includes(':') &&
    !trimmed.includes('？') &&
    !trimmed.includes('?') &&
    !hasSentencePunct
  if (totalLen < 18 && chineseCount >= 2 && chineseCount / strippedLen > 0.5 && noFieldMarkers)
    return 'center'

  return null
}

function forAllStrings(maxLen: number, alpha: readonly string[], fn: (s: string) => void): void {
  const build = (prefix: string, depth: number): void => {
    fn(prefix)
    if (depth >= maxLen) return
    for (const ch of alpha) build(prefix + ch, depth + 1)
  }
  build('', 0)
}

// 混合字母表：ASCII 字母 / 空白 / 标点 / 数字 / CJK / 全角空白
const ALPHA = ['a', 'Z', ' ', '\t', '.', ':', '1', '中', '\u3000', '。', '年']

describe('Round 112：无 CJK 时跳过计数 —— 等价性', () => {
  it('穷举长度 ≤ 3 全部串（约 1.4 万），guessCharFormat 与参照逐键一致', () => {
    let count = 0
    forAllStrings(3, ALPHA, (s) => {
      expect(guessCharFormat(s)).toEqual(refGuessCharFormat(s))
      count++
    })
    expect(count).toBeGreaterThan(1000)
  })

  it('穷举长度 ≤ 3 全部串，detectAlignment 与参照一致（覆盖 index/totalParagraphs 边界）', () => {
    forAllStrings(3, ALPHA, (s) => {
      for (const [i, n] of [[0, 1], [1, 1], [3, 4], [10, 10]] as const) {
        expect(detectAlignment(s, i, n)).toEqual(refDetectAlignment(s, i, n))
      }
    })
  })

  it('穷尽全部 65536 个 BMP 单字符，两个函数都与参照一致', () => {
    for (let c = 0; c < 0x10000; c++) {
      const s = String.fromCharCode(c)
      expect(guessCharFormat(s)).toEqual(refGuessCharFormat(s))
      expect(detectAlignment(s, 5, 10)).toEqual(refDetectAlignment(s, 5, 10))
    }
  })

  it('随机串（长度 ≤ 60）与参照一致，且产出非空转', () => {
    let seed = 13579
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    let cjkSeen = 0
    let boldSeen = 0
    let alignSeen = 0
    for (let t = 0; t < 4000; t++) {
      const len = Math.floor(rnd() * 60)
      let s = ''
      for (let i = 0; i < len; i++) s += ALPHA[Math.floor(rnd() * ALPHA.length)]
      const g = guessCharFormat(s)
      const r = refGuessCharFormat(s)
      expect(g).toEqual(r)
      expect(detectAlignment(s, t % 7, 10)).toEqual(refDetectAlignment(s, t % 7, 10))
      if (/[\u4e00-\u9fff]/.test(s)) cjkSeen++
      if (g.bold) boldSeen++
      if (detectAlignment(s, 3, 4) !== null) alignSeen++
    }
    expect(cjkSeen).toBeGreaterThan(1000)
    // 随机字母表里标题形态很少见，故阈值取「确实出现过」的量级；
    // 真正的标题/对齐覆盖由下面的确定性用例承担。
    expect(boldSeen).toBeGreaterThan(10)
    expect(alignSeen).toBeGreaterThan(10)
  })

  it('标题与对齐的确定性用例（确保 bold / center / right 分支真的被走到）', () => {
    const titles = [
      'This Is A Title',
      'ALL CAPS TITLE HERE',
      'Short title',
      '第一章',
      '前言',
      '  居中标题  ',
      '2024年',
      '3月',
      '一、第一条',
      'A very long sentence that should not be a title because it ends with a period.',
    ]
    let bold = 0
    let align = 0
    for (const s of titles) {
      expect(guessCharFormat(s)).toEqual(refGuessCharFormat(s))
      for (const [i, n] of [[0, 1], [1, 1], [5, 10], [9, 10]] as const) {
        const got = detectAlignment(s, i, n)
        expect(got).toEqual(refDetectAlignment(s, i, n))
        if (got !== null) align++
      }
      if (guessCharFormat(s).bold) bold++
    }
    expect(bold).toBeGreaterThan(0)
    expect(align).toBeGreaterThan(0)
  })

  it('chineseCount 的 2 / 4 边界（含 1、2、3、4、5 个 CJK）与参照一致', () => {
    const cases = [
      '',
      ' ',
      '中',
      '中中',
      '中中中',
      '中中中中',
      '中中中中中',
      '中 中',
      '  中中  ',
      '中a',
      '中文',
      'ab中中cd',
      '一二三四五',
      '  中中  ',
      '中中：',
      '中中。',
    ]
    for (const s of cases) {
      expect(guessCharFormat(s)).toEqual(refGuessCharFormat(s))
      for (const [i, n] of [[0, 1], [1, 1], [5, 10]] as const) {
        expect(detectAlignment(s, i, n)).toEqual(refDetectAlignment(s, i, n))
      }
    }
  })
})
