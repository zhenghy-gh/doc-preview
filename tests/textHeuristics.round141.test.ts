import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { DocParser } from '../src/utils/docParser'
import { detectListInfo } from '../src/utils/docparser/heuristics/textHeuristics'

// Round141：oracle 来自 git show HEAD（da5fcb3）的优化前实现。
// detectListInfo 函数体逐行复制，仅重命名；14个正则和两个helper独立复制，不共享生产helper。
// ASCII字母中只有I/V/X/i/v/x可能启动罗马分支，其他字母只有第二码元为.或)才可能匹配。
// 比较完整对象及JSON键序，不约束正则次数、函数源码或执行时间，慢但等价实现也能通过。
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

function leadingIndentWidth(text: string): number {
  let width = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (!isWhitespaceCode(code)) break
    width += code === 0x09 || code === 0x3000 ? 2 : 1
  }
  return width
}

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

function round141OldDetectListInfo(text: string): { listType: 'ordered' | 'unordered'; listStyle: string; listLevel: number } | null {
    // Count leading whitespace (spaces / tabs / full-width spaces) as an indent width.
    // 原先 match(/^[\s\u3000\t]*/) + 两次 replace 共 3 次整串分配，现单趟扫描。
    // Round 138: compute indentation only for a matching list marker.

    const trimmed = text.trim()
    if (trimmed.length < 2) return null

    // 1. Multi-level Arabic: 1.1 / 1.2.3 (at least one dot-separated number followed by space or end)
    if (LIST_MULTI_LEVEL_RE.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'decimal', listLevel: Math.floor(leadingIndentWidth(text) / 2) }
    }

    // 2. Arabic numeral with . or ) then space: 1. / 2) / 12.
    if (LIST_ARABIC_RE.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'decimal', listLevel: Math.floor(leadingIndentWidth(text) / 2) }
    }

    // 3. Parenthesized Arabic: (1) / （2） / [1] — allow optional space after closing paren.
    if (LIST_PAREN_ARABIC_RE.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'decimal', listLevel: Math.floor(leadingIndentWidth(text) / 2) }
    }

    // 4. Roman numerals: i. / ii. / iv. / I. / II. (checked BEFORE single Latin letter
    //    so "i." / "v." / "x." are treated as Roman rather than lower-alpha).
    if (LIST_ROMAN_RE.test(trimmed)) {
      const isUpper = LIST_ROMAN_UPPER_RE.test(trimmed)
      return { listType: 'ordered', listStyle: isUpper ? 'upper-roman' : 'lower-roman', listLevel: Math.floor(leadingIndentWidth(text) / 2) }
    }

    // 5. Latin letter with . or ): a. / B) / (a)
    if (LIST_LATIN_RE.test(trimmed) && trimmed.length >= 3) {
      return { listType: 'ordered', listStyle: 'lower-alpha', listLevel: Math.floor(leadingIndentWidth(text) / 2) }
    }
    if (LIST_PAREN_LATIN_RE.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'lower-alpha', listLevel: Math.floor(leadingIndentWidth(text) / 2) }
    }

    // 6. CJK ideographic numerals: 一、二、三、...、十、十一、... / 甲、乙、... / 壹、贰、...
    //    Also accept （一）（二） parenthesized form (no trailing space required,
    //    since Chinese numbered items often have no separator).
    //    原实现用 match() 但只用其结果做真值判断，改用 test() 等价且不产出数组。
    if (LIST_CJK_NUMERAL_RE.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'cjk-ideographic', listLevel: Math.floor(leadingIndentWidth(text) / 2) }
    }
    if (LIST_PAREN_CJK_RE.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'cjk-ideographic', listLevel: Math.floor(leadingIndentWidth(text) / 2) }
    }

    // 7. Circled numbers: ① ② ... ㊿ (U+2460..U+2473, U+3251..U+325F, U+32B1..U+32BF)
    if (LIST_CIRCLED_RE.test(trimmed)) {
      return { listType: 'ordered', listStyle: 'cjk-ideographic', listLevel: Math.floor(leadingIndentWidth(text) / 2) }
    }

    // 8. Unordered: ASCII and CJK bullets
    if (LIST_BULLET_ASCII_RE.test(trimmed) || LIST_BULLET_ASCII_ALT_RE.test(trimmed)) {
      return { listType: 'unordered', listStyle: 'disc', listLevel: Math.floor(leadingIndentWidth(text) / 2) }
    }
    if (LIST_BULLET_CJK_RE.test(trimmed)) {
      return { listType: 'unordered', listStyle: 'disc', listLevel: Math.floor(leadingIndentWidth(text) / 2) }
    }
    if (LIST_BULLET_SQUARE_RE.test(trimmed)) {
      return { listType: 'unordered', listStyle: 'square', listLevel: Math.floor(leadingIndentWidth(text) / 2) }
    }

    return null
  }

type ListInfo = ReturnType<typeof round141OldDetectListInfo>
type Detector = (text: string) => ListInfo

function assertEquivalent(text: string, candidate: Detector = detectListInfo): ListInfo {
  const expected = round141OldDetectListInfo(text)
  const actual = candidate(text)
  // 穷举成功路径避免逐项创建matcher，同时保留完整deepEqual与序列化键序断言。
  if (!isDeepStrictEqual(actual, expected) || JSON.stringify(actual) !== JSON.stringify(expected)) {
    expect(actual, JSON.stringify(text)).toEqual(expected)
    expect(JSON.stringify(actual), JSON.stringify(text)).toBe(JSON.stringify(expected))
  }
  return actual
}

const JS_WHITESPACE = [
  '\t', '\n', '\v', '\f', '\r', ' ', '\u00a0', '\u1680',
  ...Array.from({ length: 11 }, (_, i) => String.fromCharCode(0x2000 + i)),
  '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff',
]
const ASCII_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function mutant(mode: 'reject-i' | 'omit-dot' | 'omit-paren'): Detector {
  return text => {
    const trimmed = text.trim()
    if (trimmed.length < 2) return null
    const first = trimmed.charCodeAt(0)
    const letter = (first >= 65 && first <= 90) || (first >= 97 && first <= 122)
    const roman = (mode === 'reject-i' ? 'VXvx' : 'IVXivx').includes(trimmed[0])
    const dot = mode !== 'omit-dot' && trimmed[1] === '.'
    const paren = mode !== 'omit-paren' && trimmed[1] === ')'
    if (letter && !roman && !dot && !paren) return null
    return round141OldDetectListInfo(text)
  }
}

// 故意多分配的等价对照，trim + split/join后保留原始前导缩进，尾空白不参与列表判定。
const slowEquivalent: Detector = text => {
  const leading = text.match(/^\s*/)?.[0] ?? ''
  return round141OldDetectListInfo(leading + text.trim().split('').join(''))
}

describe('Round 141：detectListInfo ASCII非罗马字母快路径', () => {
  it('全部65536首UTF16码元与第二码元边界，覆盖单码元、括号、空白及完整标记', () => {
    const tails = ['', '.', ')', '. body', ') body', ' body', '\tbody', '(1)body', '] body', '\u3000body', '\0body']
    let cases = 0
    for (let code = 0; code <= 0xffff; code++) {
      const first = String.fromCharCode(code)
      for (const tail of tails) {
        assertEquivalent(first + tail)
        cases++
      }
    }
    expect(cases).toBe(720896)
    expect(assertEquivalent('▪ body')?.listStyle).toBe('disc')
    expect(assertEquivalent('▫ body')?.listStyle).toBe('square')
    expect(assertEquivalent('(a)')?.listStyle).toBe('lower-alpha')
    expect(assertEquivalent('（1）')?.listStyle).toBe('decimal')
  })

  it('52个ASCII字母分别跨全部65536第二UTF16码元，包括罗马起始和两种Latin分隔符', () => {
    let cases = 0
    for (const first of ASCII_LETTERS) {
      for (let code = 0; code <= 0xffff; code++) {
        assertEquivalent(first + String.fromCharCode(code) + ' body')
        cases++
      }
    }
    expect(cases).toBe(3407872)
    for (const first of ASCII_LETTERS) {
      for (const separator of ['.', ')']) {
        const actual = assertEquivalent(first + separator + ' body')
        expect(actual?.listStyle).toBe('IVX'.includes(first) ? 'upper-roman' : 'ivx'.includes(first) ? 'lower-roman' : 'lower-alpha')
        expect(Object.keys(actual!)).toEqual(['listType', 'listStyle', 'listLevel'])
      }
    }
  })

  it('罗马优先级、所有JS空白与缩进、三类语义负控及慢trim split/join等价对照', () => {
    const lowerRomans = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']
    const markers = ['a.', 'B)', '(a)', '（Z）', '1.', '12)', '(1)', '[1]', '1.2.', '一、', '（甲）', '壹)', '① ', '㊿ ', '• ', '- ', '* ', '○ ', '▪ ', '▫ ']
    for (const roman of lowerRomans) {
      for (const text of [roman, roman.toUpperCase()]) {
        for (const delimiter of ['.', ')']) {
          const body = text + delimiter + ' body'
          expect(assertEquivalent(body)?.listStyle).toBe(text === roman ? 'lower-roman' : 'upper-roman')
          assertEquivalent(body, slowEquivalent)
          expect(assertEquivalent(text + delimiter)).toBeNull()
        }
      }
    }
    for (const text of ['IIII. body', 'iiii) body', 'XL. body', 'ivx. body', 'iV. body', 'Viii. body', 'L. body', 'C) body', '+ body', '1.2', '(一)', '一、']) {
      assertEquivalent(text)
      assertEquivalent(text, slowEquivalent)
    }
    for (const whitespace of JS_WHITESPACE) {
      const width = whitespace === '\t' || whitespace === '\u3000' ? 2 : 1
      for (const marker of [...markers, 'ii.', 'IV)', 'a)', 'X.']) {
        const body = marker.trimEnd() + whitespace + 'body'
        for (const count of [0, 1, 2, 3, 4, 7]) {
          const text = whitespace.repeat(count) + body + whitespace
          const actual = assertEquivalent(text)
          expect(actual, JSON.stringify(text)).not.toBeNull()
          expect(actual!.listLevel).toBe(Math.floor(width * count / 2))
          assertEquivalent(text, slowEquivalent)
        }
      }
      expect(assertEquivalent(whitespace + 'a.' + whitespace)).toBeNull()
      assertEquivalent(whitespace.repeat(4))
    }
    for (const nearWhitespace of ['\u0085', '\u180e', '\u200b', '\u2060']) {
      expect(assertEquivalent(nearWhitespace + 'a. body')).toBeNull()
      expect(assertEquivalent('a.' + nearWhitespace + 'body')).toBeNull()
    }
    for (const [mode, witnesses] of [
      ['reject-i', ['II. body', 'ii) body', '  IV. body', '\tiii. body']],
      ['omit-dot', ['A. body', 'z. body', '\tB. body']],
      ['omit-paren', ['A) body', 'z) body', '\u3000B) body']],
    ] as const) {
      for (const text of witnesses) {
        expect(assertEquivalent(text)).not.toBeNull()
        expect(() => assertEquivalent(text, mutant(mode))).toThrow()
        assertEquivalent(text, slowEquivalent)
      }
    }
  })

  it('穷尽包含快路径字母、罗马、分隔符、括号、空白和中文的长度不超过4短串', () => {
    const alphabet = ['A', 'a', 'I', 'i', 'V', 'v', 'X', 'x', 'Z', '.', ')', '(', ' ', '\t', '1', '一']
    let cases = 0
    const visit = (text: string, depth: number): void => {
      assertEquivalent(text)
      cases++
      if (depth === 4) return
      for (const character of alphabet) visit(text + character, depth + 1)
    }
    visit('', 0)
    expect(cases).toBe(69905)
  })

  it('27份真实doc/dot均成功且段落非空，检查原型可拦截性后逐段委托差分并验证非空列表', () => {
    const proto = DocParser.prototype
    const original = proto.detectListInfo
    let nativeCalls = 0
    let replayCalls = 0
    let nativeLists = 0
    let replayLists = 0
    let paragraphs = 0
    let replaying = false
    proto.detectListInfo = function (text) {
      const actual = original.call(this, text)
      assertEquivalent(text, () => actual)
      if (replaying) {
        replayCalls++
        if (actual) replayLists++
      } else {
        nativeCalls++
        if (actual) nativeLists++
      }
      return actual
    }
    try {
      const directory = path.resolve(process.cwd(), 'docs')
      const files = fs.readdirSync(directory).filter(name => /\.(doc|dot)$/.test(name)).sort()
      expect(files.length).toBe(27)
      for (const name of files) {
        const bytes = fs.readFileSync(path.join(directory, name))
        const parser = new DocParser(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
        const parsed = parser.parseWithFormat()
        expect(parsed.success, name).toBe(true)
        expect(parsed.document, name).toBeDefined()
        expect(parsed.document!.paragraphs.length, name).toBeGreaterThan(0)
        paragraphs += parsed.document!.paragraphs.length
        // 原生解析经detectParagraphFormat调用模块内裸detectListInfo，并不经过此原型入口。
        // 所以这里明确是document.paragraphs文本重放，不声称覆盖全部实际解析调用。
        replaying = true
        for (const paragraph of parsed.document!.paragraphs) parser.detectListInfo(paragraph.text)
        replaying = false
      }
    } finally {
      proto.detectListInfo = original
    }
    expect(nativeCalls).toBe(0)
    expect(nativeLists).toBe(0)
    expect(paragraphs).toBeGreaterThan(0)
    expect(replayCalls).toBe(paragraphs)
    expect(replayLists).toBeGreaterThan(0)
  })
})
