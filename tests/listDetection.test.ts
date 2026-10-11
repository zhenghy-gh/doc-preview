import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { DocParser } from '../src/utils/docParser'
import { detectListInfo } from '../src/utils/docparser/heuristics/textHeuristics'

/**
 * Tests for list marker detection (`DocParser.detectListInfo` / `detectParagraphFormat`).
 *
 * These verify the heuristic list-marker patterns supported without parsing
 * the real PAP/LST structures: Arabic / Latin / Roman / CJK ideographic /
 * circled numerals, parenthesized forms, multi-level numbering, and
 * indentation-based list level inference.
 */
describe('list detection', () => {
  function detect(text: string) {
    const parser = new DocParser(new ArrayBuffer(512))
    return (parser as any).detectListInfo(text)
  }

  describe('Arabic numerals', () => {
    it('should detect "1. item" as ordered decimal', () => {
      const r = detect('1. 第一项')
      expect(r).not.toBeNull()
      expect(r.listType).toBe('ordered')
      expect(r.listStyle).toBe('decimal')
      expect(r.listLevel).toBe(0)
    })

    it('should detect "2) item" as ordered decimal', () => {
      const r = detect('2) 第二项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('decimal')
    })

    it('should detect "(3) item" as ordered decimal', () => {
      const r = detect('(3) 第三项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('decimal')
    })

    it('should detect "（4） item" (full-width parens) as ordered decimal', () => {
      const r = detect('（4）第四项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('decimal')
    })
  })

  describe('multi-level Arabic', () => {
    it('should detect "1.1 sub-item" as ordered decimal', () => {
      const r = detect('1.1 子项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('decimal')
    })

    it('should detect "1.2.3 deeper sub-item" as ordered decimal', () => {
      const r = detect('1.2.3 更深的子项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('decimal')
    })
  })

  describe('Latin letters', () => {
    it('should detect "a. item" as ordered lower-alpha', () => {
      const r = detect('a. 子项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('lower-alpha')
    })

    it('should detect "B) item" as ordered lower-alpha', () => {
      const r = detect('B) 子项内容')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('lower-alpha')
    })

    it('should detect "(c) item" as ordered lower-alpha', () => {
      const r = detect('(c) 子项内容')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('lower-alpha')
    })
  })

  describe('Roman numerals', () => {
    it('should detect "i. item" as lower-roman', () => {
      const r = detect('i. 子项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('lower-roman')
    })

    it('should detect "iv. item" as lower-roman', () => {
      const r = detect('iv. 子项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('lower-roman')
    })

    it('should detect "II. item" as upper-roman', () => {
      const r = detect('II. 大项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('upper-roman')
    })
  })

  describe('CJK ideographic numerals', () => {
    it('should detect "一、第一项" as cjk-ideographic', () => {
      const r = detect('一、第一项')
      expect(r).not.toBeNull()
      expect(r.listType).toBe('ordered')
      expect(r.listStyle).toBe('cjk-ideographic')
    })

    it('should detect "二、第二项" as cjk-ideographic', () => {
      const r = detect('二、第二项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('cjk-ideographic')
    })

    it('should detect "十、第十项" as cjk-ideographic', () => {
      const r = detect('十、第十项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('cjk-ideographic')
    })

    it('should detect "甲、第一项" as cjk-ideographic', () => {
      const r = detect('甲、第一项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('cjk-ideographic')
    })

    it('should detect "（一）第一项" as cjk-ideographic', () => {
      const r = detect('（一）第一项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('cjk-ideographic')
    })
  })

  describe('circled numbers', () => {
    it('should detect "① 第一项" as cjk-ideographic', () => {
      const r = detect('① 第一项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('cjk-ideographic')
    })

    it('should detect "② 第二项" as cjk-ideographic', () => {
      const r = detect('② 第二项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('cjk-ideographic')
    })
  })

  describe('unordered bullets', () => {
    it('should detect "- item" as unordered disc', () => {
      const r = detect('- 无序项')
      expect(r).not.toBeNull()
      expect(r.listType).toBe('unordered')
      expect(r.listStyle).toBe('disc')
    })

    it('should detect "* item" as unordered disc', () => {
      const r = detect('* 无序项')
      expect(r).not.toBeNull()
      expect(r.listType).toBe('unordered')
    })

    it('should detect "• item" as unordered disc', () => {
      const r = detect('• 无序项')
      expect(r).not.toBeNull()
      expect(r.listType).toBe('unordered')
    })

    it('should detect "○ item" as unordered disc', () => {
      const r = detect('○ 无序项')
      expect(r).not.toBeNull()
      expect(r.listType).toBe('unordered')
    })
  })

  describe('list level (indentation)', () => {
    it('should infer level 0 for unindented items', () => {
      const r = detect('1. 顶级项')
      expect(r.listLevel).toBe(0)
    })

    it('should infer level 1 for 2-space indent', () => {
      const r = detect('  1.1 子项')
      expect(r.listLevel).toBe(1)
    })

    it('should infer level 2 for 4-space indent', () => {
      const r = detect('    a. 更深的子项')
      expect(r.listLevel).toBe(2)
    })

    it('should treat a full-width space as 2 spaces', () => {
      const r = detect('\u3000\u3000a. 子项')
      expect(r.listLevel).toBe(2)
    })
  })

  describe('non-list text', () => {
    it('should return null for plain prose', () => {
      expect(detect('这是一段普通的中文正文，没有任何列表标记。')).toBeNull()
    })

    it('should return null for short text', () => {
      expect(detect('一')).toBeNull()
    })

    it('should return null for a single character without a marker', () => {
      expect(detect('A')).toBeNull()
    })
  })
})

// Round 138：HEAD 的旧函数仅改名；空白判定、缩进扫描与全部 LIST_* 正则自包含。
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

export function round138OldListInfo(text: string): { listType: 'ordered' | 'unordered'; listStyle: string; listLevel: number } | null {
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

const ROUND138_TRIM_WHITESPACE = String.fromCharCode(
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
  0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
  0x205f, 0x3000, 0xfeff,
)

function round138Compare(text: string): ReturnType<typeof detectListInfo> {
  const expected = round138OldListInfo(text)
  const actual = detectListInfo(text)
  expect(actual).toEqual(expected)
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
  return actual
}

describe('Round 138：列表缩进惰性计算', () => {
  it('覆盖全部12返回分支、罗马优先级与ASCII/全角/混合trim缩进及键序', () => {
    const markers: Array<[string, 'ordered' | 'unordered', string]> = [
      ['1.2.3 item', 'ordered', 'decimal'],
      ['12) item', 'ordered', 'decimal'],
      ['[3]item', 'ordered', 'decimal'],
      ['iv. item', 'ordered', 'lower-roman'],
      ['a. item', 'ordered', 'lower-alpha'],
      ['（b）item', 'ordered', 'lower-alpha'],
      ['壹、item', 'ordered', 'cjk-ideographic'],
      ['（一）item', 'ordered', 'cjk-ideographic'],
      ['㊿ item', 'ordered', 'cjk-ideographic'],
      ['- item', 'unordered', 'disc'],
      ['○ item', 'unordered', 'disc'],
      ['▫ item', 'unordered', 'square'],
      ...['i', 'v', 'x', 'ii', 'ix'].map(marker => [`${marker}. item`, 'ordered', 'lower-roman'] as [string, 'ordered', string]),
      ...['I', 'V', 'X', 'II', 'IX'].map(marker => [`${marker}) item`, 'ordered', 'upper-roman'] as [string, 'ordered', string]),
      ['(i)item', 'ordered', 'lower-alpha'],
      ['▪ item', 'unordered', 'disc'],
    ]
    const prefixes: Array<[string, number]> = [
      ['', 0], [' ', 0], ['  ', 1], ['   ', 1], ['    ', 2],
      ['\t', 1], ['\u3000\u3000', 2], [' \t\u3000\u00a0\n', 3],
      [ROUND138_TRIM_WHITESPACE, 13],
    ]
    let count = 0
    for (const [marker, listType, listStyle] of markers) {
      for (const [prefix, listLevel] of prefixes) {
        const actual = round138Compare(prefix + marker + ROUND138_TRIM_WHITESPACE)
        expect(actual).toEqual({ listType, listStyle, listLevel })
        expect(Object.keys(actual!)).toEqual(['listType', 'listStyle', 'listLevel'])
        count++
      }
    }
    expect(count).toBe(216)
  })

  it('穷尽65536码元作为合法a. item前导，锁定全部25空白与两种双宽缩进', () => {
    let count = 0
    let lists = 0
    let levelOne = 0
    for (let code = 0; code <= 0xffff; code++) {
      const actual = round138Compare(String.fromCharCode(code) + 'a. item')
      if (actual) {
        lists++
        if (actual.listLevel === 1) levelOne++
      }
      count++
    }
    expect(count).toBe(65536)
    expect(lists).toBe(25)
    expect(levelOne).toBe(2)
  })

  it('穷尽15字符字母表长度0至3的3616短串，比较空白数字字母括号点与未命中', () => {
    const alphabet = [' ', '\t', '\u3000', '\n', '1', '2', 'a', 'i', 'I', '(', ')', '（', '）', '.', '-']
    let count = 0
    function visit(text: string, depth: number): void {
      round138Compare(text)
      count++
      if (depth === 3) return
      for (const character of alphabet) visit(text + character, depth + 1)
    }
    visit('', 0)
    expect(count).toBe(3616)
  })

  it('解析27真实doc/dot，捕获33702输入并严格锁定215非空列表输出', () => {
    const proto = DocParser.prototype as unknown as {
      detectParagraphFormat: (text: string, index: number, totalParagraphs: number) => unknown
    }
    const original = proto.detectParagraphFormat
    const inputs: string[] = []
    proto.detectParagraphFormat = function (text, index, totalParagraphs) {
      inputs.push(text)
      return original.call(this, text, index, totalParagraphs)
    }
    try {
      const directory = path.resolve(process.cwd(), 'docs')
      const files = fs.readdirSync(directory).filter(name => /\.(doc|dot)$/.test(name)).sort()
      expect(files.length).toBe(27)
      for (const name of files) {
        const bytes = fs.readFileSync(path.join(directory, name))
        const parsed = new DocParser(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).parseWithFormat()
        expect(parsed.success).toBe(true)
        expect(parsed.document!.paragraphs.length).toBeGreaterThan(0)
      }
    } finally {
      proto.detectParagraphFormat = original
    }
    expect(inputs.length).toBe(33702)
    let lists = 0
    for (const text of inputs) {
      if (round138Compare(text) !== null) lists++
    }
    expect(lists).toBe(215)
  }, 30000)

  it('长前导/全空白与trim移除末尾分隔符时保持命中边界及缩进', () => {
    const longWhitespace = ' \t\u3000\u00a0\n'.repeat(4096)
    for (const whitespace of ['', ' ', '\t', '\u3000', ROUND138_TRIM_WHITESPACE, longWhitespace]) {
      expect(round138Compare(whitespace)).toBeNull()
      expect(round138Compare(whitespace + '普通正文' + whitespace)).toBeNull()
      expect(round138Compare(whitespace + 'a. item' + whitespace)?.listLevel)
        .toBe(round138OldListInfo(whitespace + 'a. item')?.listLevel)
    }
    expect(detectListInfo(longWhitespace + 'a. item')?.listLevel).toBe(14336)
    for (const marker of ['a.', '1.', 'i)', '①', '-', '○', '▫', '1.2']) {
      expect(round138Compare('  ' + marker + ROUND138_TRIM_WHITESPACE)).toBeNull()
      expect(round138Compare('  ' + marker + '\u00a0item\u3000')?.listLevel).toBe(1)
    }
    for (const marker of ['(1)', '（a）', '（一）', '一、', '1.2.']) {
      expect(round138Compare('\t' + marker + ROUND138_TRIM_WHITESPACE)?.listLevel).toBe(1)
    }
    expect(round138Compare('\u200ba. item')).toBeNull()
    expect(round138Compare('\u0085a. item')).toBeNull()
  })
})
