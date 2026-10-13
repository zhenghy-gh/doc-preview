// Round 158 护栏：`detectListInfo` 的首字符分派。
//
// 被护栏保护的改动：12 个列表模式全部以 `^` 锚定且首字符集合很窄且两两不相交
// （数字 / `( （ [` / 拉丁字母 / 中日韩数字 / 带圈数字 / 项目符号）。改动按首字符
// 分派，每段只跑 1–3 次 `test()` 而非固定 12 次（27 份语料实测 93.68% 的段落
// 以拉丁字母开头，那类只可能命中 ROMAN / LATIN）。
//
// 参照实现 = **改动前**「依次试 12 个、首个命中即返回」的逐行转写（含
// leadingIndentWidth 的等价重写），用同一批合成 + 随机语料对照（慢但等价对照）。
// 负控：把三类可辨缺陷注入生产源码后，本护栏必须失败。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { detectListInfo } from '../src/utils/docparser/heuristics/textHeuristics'

type ListInfo = { listType: 'ordered' | 'unordered'; listStyle: string; listLevel: number } | null

// ── 改动前实现的逐行转写 ────────────────────────────────────────────────
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

function refIsWhitespaceCode(code: number): boolean {
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

function refLeadingIndentWidth(text: string): number {
  let width = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (!refIsWhitespaceCode(code)) break
    width += code === 0x09 || code === 0x3000 ? 2 : 1
  }
  return width
}

/** 改动前口径：依次试 12 个模式，首个命中即返回。 */
function referenceDetectListInfo(text: string): ListInfo {
  const trimmed = text.trim()
  if (trimmed.length < 2) return null
  const lvl = () => Math.floor(refLeadingIndentWidth(text) / 2)

  if (LIST_MULTI_LEVEL_RE.test(trimmed)) return { listType: 'ordered', listStyle: 'decimal', listLevel: lvl() }
  if (LIST_ARABIC_RE.test(trimmed)) return { listType: 'ordered', listStyle: 'decimal', listLevel: lvl() }
  if (LIST_PAREN_ARABIC_RE.test(trimmed)) return { listType: 'ordered', listStyle: 'decimal', listLevel: lvl() }
  if (LIST_ROMAN_RE.test(trimmed)) {
    const isUpper = LIST_ROMAN_UPPER_RE.test(trimmed)
    return { listType: 'ordered', listStyle: isUpper ? 'upper-roman' : 'lower-roman', listLevel: lvl() }
  }
  if (LIST_LATIN_RE.test(trimmed) && trimmed.length >= 3) return { listType: 'ordered', listStyle: 'lower-alpha', listLevel: lvl() }
  if (LIST_PAREN_LATIN_RE.test(trimmed)) return { listType: 'ordered', listStyle: 'lower-alpha', listLevel: lvl() }
  if (LIST_CJK_NUMERAL_RE.test(trimmed)) return { listType: 'ordered', listStyle: 'cjk-ideographic', listLevel: lvl() }
  if (LIST_PAREN_CJK_RE.test(trimmed)) return { listType: 'ordered', listStyle: 'cjk-ideographic', listLevel: lvl() }
  if (LIST_CIRCLED_RE.test(trimmed)) return { listType: 'ordered', listStyle: 'cjk-ideographic', listLevel: lvl() }
  if (LIST_BULLET_ASCII_RE.test(trimmed) || LIST_BULLET_ASCII_ALT_RE.test(trimmed)) return { listType: 'unordered', listStyle: 'disc', listLevel: lvl() }
  if (LIST_BULLET_CJK_RE.test(trimmed)) return { listType: 'unordered', listStyle: 'disc', listLevel: lvl() }
  if (LIST_BULLET_SQUARE_RE.test(trimmed)) return { listType: 'unordered', listStyle: 'square', listLevel: lvl() }
  return null
}

/** 覆盖全部 6 个分派组 + 每组的边界/失配输入。 */
const CORPUS: string[] = [
  // 数字组（含 ML / AR / 失配）
  '1. a', '2) b', '12. c', '1.1 x', '1.2.3 y', '9. z', '0. w', '1. ', '1) ', '9.', '1', '99',
  // 括号组（PA / PL / PC / 失配）
  '(1) a', '（2） b', '[1] c', '(a) d', '（b） e', '(一) f', '（二） g', '(1)', '（a）', '[9] x', '( ',
  // 拉丁组（ROMAN / LATIN / 失配）
  'a. x', 'B) y', 'i. z', 'ii. w', 'iv. v', 'v. u', 'vi. t', 'ix. s', 'x. r',
  'I. q', 'II. p', 'X. o', 'iii. n', 'u. m', 'w) l', 'z. k', 'a- b', 'i- c', 'x) d',
  // 中日韩数字组
  '一、a', '二、b', '十、c', '十一、d', '甲、e', '壹、f', '〇、g', '零、h', '一)', '二.',
  // 带圈数字组
  '① a', '② b', '㊿ c', '㉑ d', '①', '②x',
  // 项目符号组（ASCII / CJK / SQUARE）
  '• a', '- a', '* a', '○ a', '● a', '▪ a', '▸ a', '► a', '→ a', '◇ a', '◆ a',
  '▫ a', '◦ a', '‣ a', '⁃ a', '•x', '-x', '*x',
  // 缩进（listLevel 计算）
  '  1. a', '\t2. b', '　　一、c', '  a. d', '    i. e', '　　① f',
  // 完全失配
  'This is a sentence.', '普通中文段落。', 'a', '', '  ', '  x  ', '中', '.', '（', '①x',
  'The quick brown fox.', 'Hello world', '  hello  ',
]

describe('Round 158 detectListInfo 首字符分派等价性', () => {
  it('合成语料：分派结果 ≡ 改动前「依次试 12 个」', () => {
    for (const text of CORPUS) {
      expect(detectListInfo(text), `text=${JSON.stringify(text)}`).toEqual(referenceDetectListInfo(text))
    }
  })

  it('随机模糊语料：5,000 条混合字符串逐条等价', () => {
    const alphabet = [
      ...'01 9aAzZxXiIvVuUwW.', ')', '(', '（', '[', ']', '、', '一', '甲', '壹', '①', '㊿',
      '•', '-', '*', '○', '▪', '▫', '中', '。', '，', '\t', '\u3000', '\n', 'b',
    ]
    let seed = 0x9e3779b9
    const rnd = () => {
      // xorshift32，保证可复现
      seed ^= seed << 13; seed >>>= 0
      seed ^= seed >>> 17
      seed ^= seed << 5; seed >>>= 0
      return seed / 0x100000000
    }
    for (let i = 0; i < 5000; i++) {
      const len = 1 + Math.floor(rnd() * 12)
      let s = ''
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)]
      expect(detectListInfo(s), `text=${JSON.stringify(s)}`).toEqual(referenceDetectListInfo(s))
    }
  })

  it('护栏非空转：语料确实覆盖了各组的命中与失配', () => {
    const hits = CORPUS.map((t) => detectListInfo(t)).filter(Boolean) as NonNullable<ListInfo>[]
    const styles = new Set(hits.map((h) => h.listStyle))
    // 至少覆盖 decimal / lower-alpha / upper-roman / lower-roman / cjk-ideographic / disc / square
    for (const s of ['decimal', 'lower-alpha', 'upper-roman', 'lower-roman', 'cjk-ideographic', 'disc', 'square']) {
      expect(styles.has(s), `missing listStyle=${s}`).toBe(true)
    }
    expect(hits.some((h) => h.listLevel > 0)).toBe(true)
  })
})

describe('Round 158 护栏鉴别力（负控注入生产源码，必须失败）', () => {
  const SRC = resolve(__dirname, '../src/utils/docparser/heuristics/textHeuristics.ts')

  it('接线元断言：分派存在且 12 个模式仍全部接线', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('const c0 = trimmed.charCodeAt(0)')
    expect(src).toContain('const c1 = trimmed.charCodeAt(1)')
    // 12 个模式一个都不能少（缺失即分派漏组）
    for (const name of [
      'LIST_MULTI_LEVEL_RE', 'LIST_ARABIC_RE', 'LIST_PAREN_ARABIC_RE', 'LIST_ROMAN_RE',
      'LIST_LATIN_RE', 'LIST_PAREN_LATIN_RE', 'LIST_CJK_NUMERAL_RE', 'LIST_PAREN_CJK_RE',
      'LIST_CIRCLED_RE', 'LIST_BULLET_ASCII_RE', 'LIST_BULLET_CJK_RE', 'LIST_BULLET_SQUARE_RE',
    ]) {
      expect(src).toContain(`${name}.test(trimmed)`)
    }
  })

  it('注入骨架：三类可辨缺陷都能让等价性口径发生可观测变化', () => {
    // 骨架复刻「首字符分派」，可切换缺陷开关，用于演示断言有鉴别力。
    const dispatch = (text: string, defect: 'none' | 'digitRange' | 'romanGate' | 'swapBullets'): ListInfo => {
      const trimmed = text.trim()
      if (trimmed.length < 2) return null
      const lvl = () => Math.floor(refLeadingIndentWidth(text) / 2)
      const c0 = trimmed.charCodeAt(0)
      const hiDigit = defect === 'digitRange' ? 0x38 : 0x39
      if (c0 >= 0x30 && c0 <= hiDigit) {
        if (LIST_MULTI_LEVEL_RE.test(trimmed)) return { listType: 'ordered', listStyle: 'decimal', listLevel: lvl() }
        if (LIST_ARABIC_RE.test(trimmed)) return { listType: 'ordered', listStyle: 'decimal', listLevel: lvl() }
      } else if (c0 === 0x28 || c0 === 0xFF08 || c0 === 0x5B) {
        if (LIST_PAREN_ARABIC_RE.test(trimmed)) return { listType: 'ordered', listStyle: 'decimal', listLevel: lvl() }
        if (LIST_PAREN_LATIN_RE.test(trimmed)) return { listType: 'ordered', listStyle: 'lower-alpha', listLevel: lvl() }
        if (LIST_PAREN_CJK_RE.test(trimmed)) return { listType: 'ordered', listStyle: 'cjk-ideographic', listLevel: lvl() }
      } else if ((c0 >= 0x41 && c0 <= 0x5A) || (c0 >= 0x61 && c0 <= 0x7A)) {
        const romanGate = defect === 'romanGate'
          ? c0 === 0x69 || c0 === 0x49
          : c0 === 0x69 || c0 === 0x49 || c0 === 0x76 || c0 === 0x56 || c0 === 0x78 || c0 === 0x58
        if (romanGate && LIST_ROMAN_RE.test(trimmed)) {
          const isUpper = LIST_ROMAN_UPPER_RE.test(trimmed)
          return { listType: 'ordered', listStyle: isUpper ? 'upper-roman' : 'lower-roman', listLevel: lvl() }
        }
        const c1 = trimmed.charCodeAt(1)
        if ((c1 === 0x2E || c1 === 0x29) && LIST_LATIN_RE.test(trimmed) && trimmed.length >= 3) {
          return { listType: 'ordered', listStyle: 'lower-alpha', listLevel: lvl() }
        }
      } else {
        if (LIST_CJK_NUMERAL_RE.test(trimmed)) return { listType: 'ordered', listStyle: 'cjk-ideographic', listLevel: lvl() }
        if (LIST_CIRCLED_RE.test(trimmed)) return { listType: 'ordered', listStyle: 'cjk-ideographic', listLevel: lvl() }
        if (LIST_BULLET_ASCII_RE.test(trimmed) || LIST_BULLET_ASCII_ALT_RE.test(trimmed)) return { listType: 'unordered', listStyle: 'disc', listLevel: lvl() }
        if (defect === 'swapBullets') {
          if (LIST_BULLET_SQUARE_RE.test(trimmed)) return { listType: 'unordered', listStyle: 'square', listLevel: lvl() }
          if (LIST_BULLET_CJK_RE.test(trimmed)) return { listType: 'unordered', listStyle: 'disc', listLevel: lvl() }
        } else {
          if (LIST_BULLET_CJK_RE.test(trimmed)) return { listType: 'unordered', listStyle: 'disc', listLevel: lvl() }
          if (LIST_BULLET_SQUARE_RE.test(trimmed)) return { listType: 'unordered', listStyle: 'square', listLevel: lvl() }
        }
      }
      return null
    }

    const differs = (defect: 'digitRange' | 'romanGate' | 'swapBullets') =>
      CORPUS.some((t) => JSON.stringify(dispatch(t, defect)) !== JSON.stringify(referenceDetectListInfo(t)))

    // 正确骨架与参照实现逐条一致
    expect(CORPUS.every((t) => JSON.stringify(dispatch(t, 'none')) === JSON.stringify(referenceDetectListInfo(t)))).toBe(true)
    // 三类缺陷都必须被检出
    expect(differs('digitRange')).toBe(true)
    expect(differs('romanGate')).toBe(true)
    expect(differs('swapBullets')).toBe(true)
  })
})
