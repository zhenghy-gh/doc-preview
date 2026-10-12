import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { DocParser } from '../src/utils/docParser'
import {
  countChineseAndWhitespace,
  detectCharacterStyles,
  guessCharFormat,
} from '../src/utils/docparser/heuristics/textHeuristics'
import type { CharacterFormat } from '../src/utils/docFormat'

// Round140：oracle 来自 ac61466a268ffe4b051d25a4f1ae65363af8ee59 的 git HEAD。
// guessCharFormat 函数体逐字复写，仅改函数名；所有正则在此独立复刻。
// 只共享本轮未改动的 countChineseAndWhitespace / detectCharacterStyles，
// 因此差分边界是标题分支的控制流、完整格式对象和其 JSON 键序，不覆盖共享 helper 内部。
// 外层排除了 SENTENCE_PUNCT_RE，trim 只删除空白，不会引入句末标点。
// 被移动/删除的 test 使用私有且不带 g/y 的正则，输入为 typed string，没有 lastIndex 副作用；
// 提前用 totalLength 门控不会改变结果，totalLength 仍是原 text.length 而非 trimmed.length。
const HAS_CJK_RE = /[\u4e00-\u9fff]/
const SENTENCE_PUNCT_RE = /[，。！？、；.!?]/
const EN_TITLE_START_RE = /^[A-Z][a-z]/
const HAS_LATIN_RE = /[A-Za-z]/
const ALL_CAPS_TITLE_RE = /^[A-Z\s]{3,}$/
const CAPITAL_WORD_RE = /\b[A-Z][a-z]{2,}\b/g
const WORD_RE = /\b[a-zA-Z]{2,}\b/g

function round140OldGuessCharFormat(text: string, _paragraphIndex?: number): CharacterFormat {
    const charFormat: CharacterFormat = { styles: [] }
    const totalLength = text.length
    // ── Round 112：无 CJK 时跳过 O(n) 中文/空白计数 ──────────────────────
    // 真实语料 99.98 % 的段落不含 CJK。此时 `chineseCount` 必为 0，于是
    // `chineseCount >= 2` 的三处判断（字体选择、pureName、isShortChineseTitle）
    // 全部短路，`chineseRatio` 与 `strippedLength` 都不会被读取，整次逐字符计数
    // 可以省掉。探测本身是原生正则扫描，实测比逐字符计数快 20.9 倍。
    let chineseCount = 0
    let chineseRatio = 0
    let strippedLength = 0
    if (HAS_CJK_RE.test(text)) {
      const [c, w] = countChineseAndWhitespace(text)
      chineseCount = c
      chineseRatio = c / totalLength
      // 原先 `text.replace(/\s/g, '')` 只为拿长度，现直接计数，省掉一次整串分配。
      strippedLength = totalLength - w
    }
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

function assertEquivalent(text: string, index?: number): CharacterFormat {
  const expected = round140OldGuessCharFormat(text, index)
  const actual = guessCharFormat(text, index)
  // 大规模枚举避免为每个成功样本构造 Vitest matcher；两个比较仍覆盖完整对象与递归键序。
  if (!isDeepStrictEqual(actual, expected) || JSON.stringify(actual) !== JSON.stringify(expected)) {
    expect(actual, JSON.stringify(text)).toEqual(expected)
    expect(JSON.stringify(actual), JSON.stringify(text)).toBe(JSON.stringify(expected))
  }
  return actual
}

const TRIM_WHITESPACE = [
  '\t', '\n', '\v', '\f', '\r', ' ', '\u00a0', '\u1680',
  ...Array.from({ length: 11 }, (_, i) => String.fromCharCode(0x2000 + i)),
  '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff',
]

// 行为负控：<40 改 <=40、英文检测 && 改 ||、全大写字号28改22。
// 单独删除 HAS_LATIN 是语义等价（EN_TITLE_START 命中蕴含Latin），不能冒称行为负控。
// 慢但等价对照：trim 后 split('').join('')，旧实现及等价改写均须通过。
describe('Round 140：guessCharFormat 英文标题惰性求值', () => {

  it('锁定0/19/20/21/22/39/40/41原串长度、全大写优先、中文pureName与首尾各类空白', () => {
    for (const length of [0, 19, 20, 21, 22, 39, 40, 41]) {
      const cases = length === 0 ? [''] : [
        'Ab'.slice(0, length).padEnd(length, 'a'),
        'Alpha Beta'.slice(0, length).padEnd(length, 'x'),
        'A'.repeat(length),
        '中'.repeat(length),
      ]
      for (const text of cases) {
        expect(text.length).toBe(length)
        assertEquivalent(text)
      }
    }
    expect(assertEquivalent('Alpha Beta'.padEnd(39, 'x')).fontSize).toBe(22)
    expect(assertEquivalent('Alpha Beta'.padEnd(40, 'x')).fontSize).toBe(12)
    expect(assertEquivalent('Ab'.padEnd(19, 'a')).fontSize).toBe(22)
    expect(assertEquivalent('Ab'.padEnd(20, 'a')).fontSize).toBe(12)
    expect(assertEquivalent('中'.repeat(21)).fontSize).toBe(22)
    expect(assertEquivalent('中'.repeat(22)).fontSize).toBe(16)
    expect(assertEquivalent('ALL CAPS TITLE').fontSize).toBe(28)
    for (const whitespace of TRIM_WHITESPACE) {
      for (const text of ['Ab', 'Alpha Beta', 'ALL CAPS', '中文', '中文名', '中文姓名', '中文标题名']) {
        assertEquivalent(whitespace + text)
        assertEquivalent(text + whitespace)
        assertEquivalent(whitespace + text + whitespace)
      }
      // trimmed 长39，但原串长40/41，不得误用trim后的长度门控英文标题。
      expect(assertEquivalent(whitespace + 'Alpha Beta'.padEnd(39, 'x')).fontSize).toBe(12)
      expect(assertEquivalent('Alpha Beta'.padEnd(39, 'x') + whitespace).fontSize).toBe(12)
      expect(assertEquivalent(whitespace + 'Alpha Beta'.padEnd(39, 'x') + whitespace).fontSize).toBe(12)
      expect(assertEquivalent(whitespace + '中文' + whitespace).bold).toBeUndefined()
      // 全大写仍按trimmed长度判定，原串长41也应保留28号标题。
      expect(assertEquivalent(whitespace + 'A'.repeat(40)).fontSize).toBe(28)
    }
    for (const mark of ['：', ':', '，', '。', '！', '？', '、', '；', '.', '!', '?']) {
      for (const title of ['Alpha Beta', 'ALL CAPS', '中文标题名']) {
        for (const text of [mark + title, title + mark, title.slice(0, 2) + mark + title.slice(2)]) {
          expect(assertEquivalent(text).bold).toBeUndefined()
        }
      }
    }
    expect(Object.keys(assertEquivalent('ALL CAPS'))).toEqual(['styles', 'fontSize', 'fontName', 'bold'])
  })

  it('全部65536单码元分别插入首尾与标题内部，比较完整对象及JSON键序', () => {
    let cases = 0
    for (let code = 0; code <= 0xffff; code++) {
      const character = String.fromCharCode(code)
      for (const text of [character + 'Alpha Beta', 'Alpha Beta' + character, 'Al' + character + 'pha Beta', 'ALL' + character + ' CAPS', '中文' + character]) {
        assertEquivalent(text)
        cases++
      }
    }
    expect(cases).toBe(327680)
  })

  it('穷尽混合字母表长度不超过4的短串，保留空串、大小写、冒号标点与中文分支', () => {
    const alphabet = ['A', 'a', 'Z', '中', '文', ' ', '\t', ':', '。']
    let cases = 0
    const visit = (text: string, depth: number): void => {
      assertEquivalent(text)
      cases++
      if (depth === 4) return
      for (const character of alphabet) visit(text + character, depth + 1)
    }
    visit('', 0)
    expect(cases).toBe(7381)
  })

  it('重解析27真实文档，逐调用比较格式及JSON键序并断言段落与样式非空产出', () => {
    const proto = DocParser.prototype as unknown as {
      guessCharFormat: (text: string, paragraphIndex?: number) => CharacterFormat
    }
    const original = proto.guessCharFormat
    let calls = 0
    let styles = 0
    let paragraphs = 0
    proto.guessCharFormat = function (text, index) {
      const actual = original.call(this, text, index)
      const expected = round140OldGuessCharFormat(text, index)
      expect(actual).toEqual(expected)
      expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
      calls++
      if ((actual.styles?.length ?? 0) > 0) styles++
      return actual
    }
    try {
      const directory = path.resolve(process.cwd(), 'docs')
      const files = fs.readdirSync(directory).filter(name => /\.(doc|dot)$/.test(name)).sort()
      expect(files.length).toBe(27)
      for (const name of files) {
        const bytes = fs.readFileSync(path.join(directory, name))
        const parsed = new DocParser(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).parseWithFormat()
        expect(parsed.success, name).toBe(true)
        expect(parsed.document!.paragraphs.length, name).toBeGreaterThan(0)
        paragraphs += parsed.document!.paragraphs.length
      }
    } finally {
      proto.guessCharFormat = original
    }
    expect(calls).toBe(33702)
    expect(styles).toBe(calls)
    expect(paragraphs).toBeGreaterThan(0)
  })
})
