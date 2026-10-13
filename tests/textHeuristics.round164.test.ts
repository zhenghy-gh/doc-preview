// Round 164 护栏：`textHeuristics.ts` 的两处「减少整串扫描」改动。
//
// 改动 1（`guessCharFormatCore` 标题分支）：原本对**同一串**做 3 次独立扫描
//   `!SENTENCE_PUNCT_RE.test(text) && !text.includes('：') && !text.includes(':')`
//   合并成一次 `!TITLE_STOP_RE.test(text)`，其中
//   `TITLE_STOP_RE = /[，。！？、；.!?:：]/`（= SENTENCE_PUNCT_RE 的字符集 ∪ {：,:}）。
//
// 改动 2（`detectAlignment` 日期分支）：`trimmed` 已无前导空白 ⇒ 模式里的 `^\s*`
//   只能匹配空串，故「首字符为数字」是两个日期模式的**必要条件**，可整次跳过。
//
// 本护栏的两条主线：
//   A 组 —— 把**改动前**的 `guessCharFormatCore(text, false)` 逐行转写成 oracle，
//           与生产 `guessCharFormatWithoutStyles` 做差分（穷举 BMP + 真实语料）。
//   E 组 —— 直接证明守卫的必要条件成立（穷举首字符），故守卫不可能抑制真实命中。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  countChineseAndWhitespace,
  detectAlignment,
  guessCharFormatWithoutStyles,
} from '../src/utils/docparser/heuristics/textHeuristics'
import type { CharacterFormat } from '../src/utils/docFormat'
import { DocParser } from '../src/utils/docParser'

// ── 改动前的模块级常量（逐字复刻）────────────────────────────────────────────
const HAS_CJK_RE = /[\u4e00-\u9fff]/
const SENTENCE_PUNCT_RE = /[，。！？、；.!?]/
const EN_TITLE_START_RE = /^[A-Z][a-z]/
const HAS_LATIN_RE = /[A-Za-z]/
const ALL_CAPS_TITLE_RE = /^[A-Z\s]{3,}$/
const CAPITAL_WORD_RE = /\b[A-Z][a-z]{2,}\b/g
const WORD_RE = /\b[a-zA-Z]{2,}\b/g
const ALIGN_YEAR_RE = /^\s*\d{4}\s*年/
const ALIGN_MONTH_RE = /^\s*\d{1,2}\s*月/

/** Round 164 合并后的字符类（期望值，独立于生产源码书写）。 */
const EXPECTED_TITLE_STOP = ['：', ':', '，', '。', '！', '？', '、', '；', '.', '!', '?']

/**
 * **改动前**的 `guessCharFormatCore(text, false)` —— 逐行转写（去掉 styles 分支）。
 * 差分边界：标题分支的控制流与完整格式对象的 JSON 键序。
 */
function oldCoreNoStyles(text: string): CharacterFormat {
  const charFormat: CharacterFormat = {}
  const totalLength = text.length
  let chineseCount = 0
  let chineseRatio = 0
  let strippedLength = 0
  if (HAS_CJK_RE.test(text)) {
    const [c, w] = countChineseAndWhitespace(text)
    chineseCount = c
    chineseRatio = c / totalLength
    strippedLength = totalLength - w
  }
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
  const pureName = chineseCount >= 2 && chineseCount <= 4 && strippedLength === chineseCount && trimmed.length <= 4
  if (!pureName && noSentencePunct && !text.includes('：') && !text.includes(':')) {
    const isEnglishTitle = EN_TITLE_START_RE.test(trimmed) && HAS_LATIN_RE.test(trimmed) && !SENTENCE_PUNCT_RE.test(trimmed)
    const isAllCapsTitle = ALL_CAPS_TITLE_RE.test(trimmed) && trimmed.length >= 3 && trimmed.length <= 40
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
  return charFormat
}

/** 大规模枚举用：只在不等时才构造 Vitest matcher。 */
function assertSame(text: string): void {
  const expected = oldCoreNoStyles(text)
  const actual = guessCharFormatWithoutStyles(text, 0)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    expect(actual, JSON.stringify(text)).toEqual(expected)
  }
}

// ── 真实语料 ────────────────────────────────────────────────────────────────
const realTexts: string[] = []
{
  const docsDir = resolve(process.cwd(), 'docs')
  const files = readdirSync(docsDir).filter((f) => f.endsWith('.doc') || f.endsWith('.dot')).sort()
  for (const name of files) {
    const buf = readFileSync(resolve(docsDir, name))
    const parser = new DocParser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    const parsed = parser.parseWithFormat()
    for (const p of parsed.document?.paragraphs ?? []) realTexts.push(p.text)
  }
}

const SYNTHETIC: string[] = [
  '', ' ', '\t', '\u3000', 'a', 'AB', 'ABC', 'ABCDEF', 'This Is A Title',
  'THIS IS A TITLE', '中文', '中文标题', '中文标题：', '中文标题:', '中文标题。',
  '一、列表', '1. item', '2024年', 'e.g. text', 'Hello: world',
  ...EXPECTED_TITLE_STOP.map((c) => 'This Is A Title' + c),
  ...EXPECTED_TITLE_STOP.map((c) => c + 'This Is A Title'),
  ...EXPECTED_TITLE_STOP.map((c) => 'This ' + c + ' Is A Title'),
]

describe('Round 164 标题分支 —— 差分（生产 ≡ 改动前逐行转写）', () => {
  it('A1 穷举全部 65536 个 BMP 码元插入标题中部', () => {
    for (let code = 0; code < 0x10000; code++) {
      const ch = String.fromCharCode(code)
      assertSame('This Is ' + ch + ' A Title')
      assertSame('ABC' + ch + 'DEF')
    }
  })

  it('A2 穷举全部 65536 个 BMP 码元作为首字符', () => {
    for (let code = 0; code < 0x10000; code++) {
      assertSame(String.fromCharCode(code) + 'ABCDEF')
    }
  })

  it('A3 真实语料：27 份文档全部段落逐段差分', () => {
    expect(realTexts.length).toBeGreaterThan(500)
    for (let i = 0; i < realTexts.length; i++) {
      assertSame(realTexts[i])
    }
  })

  it('A4 合成语料：11 个类字符 × 3 个位置全部差分', () => {
    for (const s of SYNTHETIC) assertSame(s)
  })
})

describe('Round 164 标题分支 —— 绝对锚点（独立于差分内部一致性）', () => {
  const TITLE = { fontSize: 22, fontName: 'Times New Roman', bold: true }
  const PLAIN = { fontSize: 12, fontName: 'Times New Roman' }
  const BASE = 'This Is A Title'

  it('B1 非空转：基准串本身确实是标题（fontSize 22 + bold）', () => {
    expect(guessCharFormatWithoutStyles(BASE, 0)).toEqual(TITLE)
  })

  it('B2 11 个类字符逐个追加/前插/内嵌都阻断标题分支', () => {
    for (const c of EXPECTED_TITLE_STOP) {
      expect(guessCharFormatWithoutStyles(BASE + c, 0), 'append ' + c).toEqual(PLAIN)
      expect(guessCharFormatWithoutStyles(c + BASE, 0), 'prepend ' + c).toEqual(PLAIN)
      expect(guessCharFormatWithoutStyles('This ' + c + ' Is A Title', 0), 'inline ' + c).toEqual(PLAIN)
    }
  })

  it('B3 非类字符不阻断标题分支（证明字符类没有被扩大）', () => {
    for (const c of [' ', 'a', 'Z', '中', '0', '（', '《', '#', '\u3000']) {
      expect(guessCharFormatWithoutStyles(BASE + c, 0), 'append ' + JSON.stringify(c)).toEqual(TITLE)
    }
  })
})

describe('Round 164 标题分支 —— 骨架负控（证明差分有鉴别力）', () => {
  const NEW_CLASS = new Set(EXPECTED_TITLE_STOP)
  /** 与生产同构的「合并字符类」判定骨架；drop 复刻「合并时漏掉一个字符」。 */
  const makeSkeleton = (drop: string | null) => (text: string) => {
    const cls = new Set(NEW_CLASS)
    if (drop !== null) cls.delete(drop)
    const merged = ![...text].some((c) => cls.has(c))
    const oldWay = !SENTENCE_PUNCT_RE.test(text) && !text.includes('：') && !text.includes(':')
    return { merged, oldWay }
  }

  it('C1 正控：不丢字符时 merged ≡ oldWay（对全部类字符与非类字符）', () => {
    const f = makeSkeleton(null)
    const corpus = [...EXPECTED_TITLE_STOP, 'a', '中', '0', ' ', '#', '', 'x：y', 'a.b']
    for (const s of corpus) {
      const r = f(s)
      expect(r.merged, JSON.stringify(s)).toBe(r.oldWay)
    }
  })

  it('C2 负控：丢掉「：」后 merged 与 oldWay 在含全角冒号的串上分歧（可辨）', () => {
    const f = makeSkeleton('：')
    const r = f('中文：冒号')
    expect(r.merged).not.toBe(r.oldWay)
  })

  it('C3 负控：丢掉「.」后 merged 与 oldWay 在含 ASCII 句点的串上分歧（可辨）', () => {
    const f = makeSkeleton('.')
    const r = f('e.g. text')
    expect(r.merged).not.toBe(r.oldWay)
  })
})

describe('Round 164 日期守卫 —— 必要条件证明与绝对锚点', () => {
  it('E1 必要条件：穷举首字符 × 后缀，日期模式命中 ⟹ 首字符必为数字', () => {
    const SUFFIXES = ['024年', '月', '2月', '2024年', '9月', '年', ' 月', '1234年']
    let hits = 0
    for (let code = 0; code < 0x10000; code++) {
      const ch = String.fromCharCode(code)
      if (ch.trim() === '') continue // trimmed 不含前导空白 ⇒ 跳过空白首字符
      for (const suf of SUFFIXES) {
        const t = ch + suf
        if (ALIGN_YEAR_RE.test(t) || ALIGN_MONTH_RE.test(t)) {
          hits++
          const c0 = t.charCodeAt(0)
          expect(c0 >= 48 && c0 <= 57, JSON.stringify(t)).toBe(true)
        }
      }
    }
    expect(hits, '非空转：必须有命中').toBeGreaterThan(0)
  })

  it('E2 绝对锚点：日期行 → right；非日期 → null（含前导空白用例，钉死守卫用 trimmed）', () => {
    const cases: Array<[string, string | null]> = [
      ['2024年', 'right'],
      ['2024 年', 'right'],
      ['12月', 'right'],
      ['1月', 'right'],
      ['0月', 'right'],
      ['9月', 'right'], // 边界：'9' 是 48..57 的上界
      ['99月', 'right'],
      ['9 月', 'right'],
      [' 2024年 abcdef', 'right'], // 前导空白：守卫必须落在 trimmed 上
      [' 12月 abcdef', 'right'],
      ['  9月 abcdefghij', 'right'],
      ['999月', null],
      ['abc2024年', null],
      ['x2024年', null],
      ['２０２４年', null], // 全角数字
      ['2024', null],
      ['', null],
      ['  ', null],
    ]
    for (const [s, expected] of cases) {
      expect(detectAlignment(s, 0, 10), JSON.stringify(s)).toBe(expected)
    }
  })
})

describe('Round 164 —— 接线元断言（源码文本）', () => {
  const SRC = readFileSync(
    resolve(process.cwd(), 'src/utils/docparser/heuristics/textHeuristics.ts'),
    'utf8',
  )
  const CODE = SRC.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  it('D1 合并字符类存在且字符集正确（11 个字符，一个不多一个不少）', () => {
    expect(SRC).toContain('const TITLE_STOP_RE = /[，。！？、；.!?:：]/')
  })

  it('D2 旧的三次扫描形式已消失（noSentencePunct 不再出现）', () => {
    expect(CODE).not.toContain('noSentencePunct')
    expect(CODE).not.toContain("text.includes('：')")
    expect(CODE).not.toContain("text.includes(':')")
  })

  it('D3 标题分支改用合并判定', () => {
    expect(CODE).toContain('if (!pureName && !TITLE_STOP_RE.test(text)) {')
  })

  it('D4 SENTENCE_PUNCT_RE 仍保留（isEnglishTitle 仍在用，不可误删）', () => {
    expect(CODE).toContain('const SENTENCE_PUNCT_RE = /[，。！？、；.!?]/')
    expect(CODE).toContain('!SENTENCE_PUNCT_RE.test(trimmed)')
  })

  it('D5 日期守卫落在 trimmed 上且范围为 48..57', () => {
    expect(CODE).toContain('const firstCode = trimmed.charCodeAt(0)')
    expect(CODE).toContain('firstCode >= 48 && firstCode <= 57 && (ALIGN_YEAR_RE.test(trimmed) || ALIGN_MONTH_RE.test(trimmed))')
  })
})
