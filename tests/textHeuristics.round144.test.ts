// Round 144 护栏：`detectCharacterStyles` 慢路径从「每字符物化一个 CharStyle 对象、
// 再交给 isSameStyle 比较」改为「只跟踪标量 (fontName, underline)，真正产出一个样式段
// 时才物化对象」后，输出必须**逐段、逐键、逐值**不变。
//
// 参照实现 = 改动前 `detectCharacterStyles` 的**逐行转写**（仍每字符构造 charStyle 并
// 调用 isSameStyle）。其中：
//   - `isWhitespaceCode` 在源模块未导出，按原定义逐字复刻（与
//     `tests/textHeuristics.charStyles.test.ts` 一致）；
//   - `applyColonUnderline` / `uniformStyleForFirstCode` / 两个快路径正则同样按原文复刻；
//   - `shouldHaveUnderline` 用导出签名、**不传预计算表**（Round 104 已证明带表与不带表等价，
//     且本文件断言的是「表的有无不影响结果」，不是被测变换本身）。
//
// ── 为什么用 `toStrictEqual` 而不是 `toEqual` ──────────────────────────────
// 本改动最容易犯的错是把空白字符的 `{ underline: false }` 写成
// `{ fontName: undefined, underline: false }`（多一个键）。`toEqual` 会**忽略值为
// undefined 的属性**，恰好放过这类错误；`toStrictEqual` 不会。批量比对另用
// `strictSameStyles`（显式比较 Object.keys 与每个值），其严格度不低于 `toStrictEqual`，
// 并由「负控 1」证明它确实能抓到多出的 undefined 键。
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import {
  detectCharacterStyles,
  shouldHaveUnderline,
  isSameStyle,
} from '../src/utils/docparser/heuristics/textHeuristics'
import { DocParser } from '../src/utils/docParser'
import type { CharStyle, CharStyleSegment } from '../src/utils/docFormat'

// ─────────────────────────── 参照实现（改动前逐行转写） ───────────────────────────

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

const HAS_CJK_OR_COLON_RE = /[\u4e00-\u9fff:\uff1a]/
const HAS_CJK_OR_DIGIT_RE = /[\u4e00-\u9fff0-9]/

function collectColonPositions(text: string): number[] {
  const positions: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 0xff1a || c === 0x3a) positions.push(i)
  }
  return positions
}

function uniformStyleForFirstCode(code: number): CharStyle {
  return isWhitespaceCode(code)
    ? { underline: false }
    : { fontName: 'Times New Roman', underline: false }
}

function applyColonUnderline(
  styles: CharStyleSegment[],
  colonPositions: readonly number[],
  textLength: number,
): void {
  if (colonPositions.length === 0) return
  const underlineRanges: Array<{ start: number; end: number }> = []
  for (let ci = 0; ci < colonPositions.length; ci++) {
    const start = colonPositions[ci] + 1
    const end = ci + 1 < colonPositions.length ? colonPositions[ci + 1] - 4 : textLength
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

function referenceDetectCharacterStyles(text: string): CharStyleSegment[] {
  if (!HAS_CJK_OR_COLON_RE.test(text)) {
    if (text.length === 0) return []
    return [{ start: 0, end: text.length, style: uniformStyleForFirstCode(text.charCodeAt(0)) }]
  }

  if (!HAS_CJK_OR_DIGIT_RE.test(text)) {
    const fastStyles: CharStyleSegment[] = [
      { start: 0, end: text.length, style: uniformStyleForFirstCode(text.charCodeAt(0)) },
    ]
    applyColonUnderline(fastStyles, collectColonPositions(text), text.length)
    return fastStyles
  }

  const styles: CharStyleSegment[] = []
  let currentStyle: CharStyle | null = null
  let styleStart = 0
  let chineseSoFar = 0
  let dateUnitPositions: number[] | null = null
  const colonPositions: number[] = []

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 0xff1a || code === 0x3a) colonPositions.push(i)
    const isDigit = code >= 0x30 && code <= 0x39
    const isChinese = code >= 0x4e00 && code <= 0x9fff
    const isUpperCase = code >= 0x41 && code <= 0x5a
    const isLowerCase = code >= 0x61 && code <= 0x7a
    const isWhitespace = isWhitespaceCode(code)

    let charStyle: CharStyle | null = null
    if (isWhitespace) charStyle = { underline: false }
    else if (isDigit) {
      if (dateUnitPositions === null) dateUnitPositions = collectDateUnitPositionsRef(text)
      charStyle = { fontName: 'Times New Roman', underline: shouldHaveUnderline(text, i, dateUnitPositions) }
    }
    else if (isUpperCase || isLowerCase) charStyle = { fontName: 'Times New Roman', underline: false }
    else if (isChinese) charStyle = { fontName: '仿宋', underline: false }
    else {
      const fontName = (i === 0 || chineseSoFar === 0)
        ? 'Times New Roman'
        : (chineseSoFar / i > 0.7 ? '宋体' : '仿宋')
      charStyle = { fontName, underline: false }
    }

    if (isChinese) chineseSoFar++

    if (currentStyle) {
      if (isSameStyle(currentStyle, charStyle)) continue
      styles.push({ start: styleStart, end: i, style: currentStyle })
    }
    currentStyle = charStyle
    styleStart = i
  }

  if (currentStyle) styles.push({ start: styleStart, end: text.length, style: currentStyle })

  applyColonUnderline(styles, colonPositions, text.length)
  return styles
}

/** 日期单位位置表（`[年月日时分秒]`），按源实现复刻。 */
function collectDateUnitPositionsRef(text: string): number[] {
  const positions: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 0x5e74 || c === 0x6708 || c === 0x65e5 || c === 0x65f6 || c === 0x5206 || c === 0x79d2) {
      positions.push(i)
    }
  }
  return positions
}

// ─────────────────────────── 严格比对 ───────────────────────────

/**
 * 严格结构比对：长度、start/end、以及 style 的 **Object.keys（含值为 undefined 的键）
 * 与每个键的值**都必须一致。严格度不低于 `toStrictEqual`。
 */
function strictSameStyles(a: CharStyleSegment[], b: CharStyleSegment[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].start !== b[i].start || a[i].end !== b[i].end) return false
    const sa = a[i].style as unknown as Record<string, unknown> | null
    const sb = b[i].style as unknown as Record<string, unknown> | null
    if (sa === sb) continue
    if (!sa || !sb) return false
    const ka = Object.keys(sa)
    const kb = Object.keys(sb)
    if (ka.length !== kb.length) return false
    for (let k = 0; k < ka.length; k++) {
      if (ka[k] !== kb[k]) return false
      if (sa[ka[k]] !== sb[kb[k]]) return false
    }
  }
  return true
}

const ALPHA = ['5', '年', '月', '：', ':', ' ', '\n', 'a', '中', '+', '。', '，']

/** 穷举 ALPHA 上长度 ≤ maxLen 的全部串（含空串）。 */
function forAllStrings(maxLen: number, fn: (s: string) => void): void {
  const build = (prefix: string, depth: number): void => {
    fn(prefix)
    if (depth >= maxLen) return
    for (const ch of ALPHA) build(prefix + ch, depth + 1)
  }
  build('', 0)
}

/** 在穷举串集合上收集与参照实现不一致的样本（最多 limit 个）。 */
function collectMismatches(
  impl: (text: string) => CharStyleSegment[],
  limit = 5,
): string[] {
  const bad: string[] = []
  forAllStrings(4, (s) => {
    if (bad.length >= limit) return
    if (!strictSameStyles(impl(s), referenceDetectCharacterStyles(s))) bad.push(JSON.stringify(s))
  })
  return bad
}

// ─────────────────────────── 负控实现（都必须被检出） ───────────────────────────

/**
 * 负控 1：物化时**总是**带 `fontName` 键（空白段会写出 `{ fontName: undefined, ... }`）。
 * 这正是 `toEqual` 会漏掉、而 `toStrictEqual` / `strictSameStyles` 必须抓到的错误。
 */
function ncAlwaysFontKey(text: string): CharStyleSegment[] {
  const styles: CharStyleSegment[] = []
  let hasCurrent = false
  let currentFont: string | undefined
  let currentUnderline = false
  let styleStart = 0
  let chineseSoFar = 0
  let dateUnitPositions: number[] | null = null
  const colonPositions: number[] = []

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 0xff1a || code === 0x3a) colonPositions.push(i)
    const isDigit = code >= 0x30 && code <= 0x39
    const isChinese = code >= 0x4e00 && code <= 0x9fff
    const isUpperCase = code >= 0x41 && code <= 0x5a
    const isLowerCase = code >= 0x61 && code <= 0x7a
    const isWhitespace = isWhitespaceCode(code)

    let fontName: string | undefined
    let underline = false
    if (isWhitespace) fontName = undefined
    else if (isDigit) {
      if (dateUnitPositions === null) dateUnitPositions = collectDateUnitPositionsRef(text)
      fontName = 'Times New Roman'
      underline = shouldHaveUnderline(text, i, dateUnitPositions)
    }
    else if (isUpperCase || isLowerCase) fontName = 'Times New Roman'
    else if (isChinese) fontName = '仿宋'
    else {
      fontName = (i === 0 || chineseSoFar === 0) ? 'Times New Roman' : (chineseSoFar / i > 0.7 ? '宋体' : '仿宋')
    }
    if (isChinese) chineseSoFar++

    if (hasCurrent) {
      if (
        (currentFont === undefined || fontName === undefined || currentFont === fontName) &&
        currentUnderline === underline
      ) continue
      styles.push({ start: styleStart, end: i, style: { fontName: currentFont, underline: currentUnderline } })
    }
    currentFont = fontName
    currentUnderline = underline
    hasCurrent = true
    styleStart = i
  }
  if (hasCurrent) {
    styles.push({ start: styleStart, end: text.length, style: { fontName: currentFont, underline: currentUnderline } })
  }
  applyColonUnderline(styles, colonPositions, text.length)
  return styles
}

/**
 * 负控 2：fontName 用**严格相等**（丢掉「任一方 undefined 即视为同样式」的通配语义）。
 */
function ncStrictFontEquality(text: string): CharStyleSegment[] {
  const styles: CharStyleSegment[] = []
  let hasCurrent = false
  let currentFont: string | undefined
  let currentUnderline = false
  let styleStart = 0
  let chineseSoFar = 0
  let dateUnitPositions: number[] | null = null
  const colonPositions: number[] = []

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 0xff1a || code === 0x3a) colonPositions.push(i)
    const isDigit = code >= 0x30 && code <= 0x39
    const isChinese = code >= 0x4e00 && code <= 0x9fff
    const isUpperCase = code >= 0x41 && code <= 0x5a
    const isLowerCase = code >= 0x61 && code <= 0x7a
    const isWhitespace = isWhitespaceCode(code)

    let fontName: string | undefined
    let underline = false
    if (isWhitespace) fontName = undefined
    else if (isDigit) {
      if (dateUnitPositions === null) dateUnitPositions = collectDateUnitPositionsRef(text)
      fontName = 'Times New Roman'
      underline = shouldHaveUnderline(text, i, dateUnitPositions)
    }
    else if (isUpperCase || isLowerCase) fontName = 'Times New Roman'
    else if (isChinese) fontName = '仿宋'
    else {
      fontName = (i === 0 || chineseSoFar === 0) ? 'Times New Roman' : (chineseSoFar / i > 0.7 ? '宋体' : '仿宋')
    }
    if (isChinese) chineseSoFar++

    if (hasCurrent) {
      if (currentFont === fontName && currentUnderline === underline) continue
      styles.push({
        start: styleStart,
        end: i,
        style: currentFont === undefined ? { underline: currentUnderline } : { fontName: currentFont, underline: currentUnderline },
      })
    }
    currentFont = fontName
    currentUnderline = underline
    hasCurrent = true
    styleStart = i
  }
  if (hasCurrent) {
    styles.push({
      start: styleStart,
      end: text.length,
      style: currentFont === undefined ? { underline: currentUnderline } : { fontName: currentFont, underline: currentUnderline },
    })
  }
  applyColonUnderline(styles, colonPositions, text.length)
  return styles
}

/** 负控 3：段边界差一（`end: i + 1`）。 */
function ncOffByOneEnd(text: string): CharStyleSegment[] {
  const real = detectCharacterStyles(text)
  return real.map((s) => ({ ...s, end: s.end + (s.end < text.length ? 1 : 0) }))
}

// ─────────────────────────── 用例 ───────────────────────────

describe('detectCharacterStyles Round 144 标量化等价性', () => {
  it('穷举全部 65536 个码元（3 种上下文）与改动前参照逐段逐键一致', () => {
    const bad: string[] = []
    for (let c = 0; c < 0x10000; c++) {
      const ch = String.fromCharCode(c)
      for (const t of [`中1${ch}中`, `${ch}中1中`, `中：${ch}5`]) {
        if (!strictSameStyles(detectCharacterStyles(t), referenceDetectCharacterStyles(t))) {
          if (bad.length < 10) bad.push(`U+${c.toString(16).padStart(4, '0')} in ${JSON.stringify(t)}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('穷举 ALPHA 上长度 ≤ 4 的全部串，与参照一致', () => {
    const bad: string[] = []
    forAllStrings(4, (s) => {
      if (!strictSameStyles(detectCharacterStyles(s), referenceDetectCharacterStyles(s))) {
        if (bad.length < 10) bad.push(JSON.stringify(s))
      }
    })
    expect(bad).toEqual([])
  })

  it('随机混合串（长度 ≤ 80）与参照一致', () => {
    let seed = 987654321
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const bad: string[] = []
    for (let t = 0; t < 4000; t++) {
      const len = Math.floor(rnd() * 81)
      let s = ''
      for (let i = 0; i < len; i++) s += ALPHA[Math.floor(rnd() * ALPHA.length)]
      if (!strictSameStyles(detectCharacterStyles(s), referenceDetectCharacterStyles(s))) {
        if (bad.length < 10) bad.push(JSON.stringify(s))
      }
    }
    expect(bad).toEqual([])
  })

  it('冒号 / 数字 / 日期单位密集串与参照一致（含下划线后处理）', () => {
    const cases = [
      '：5：6：7：8',
      'a:1 b:2 c:3 d:4 e:5',
      '：：：：',
      '1234：5678',
      '名：张三 日期：2024年1月1日',
      '：'.repeat(10) + '5',
      '5' + '：'.repeat(10),
      '：x：yy：zzz：1234',
      '中：5 ',
      '中：5 6',
      '：5\t6\n7',
      '年1月2日3时4分5秒',
      '中文：abc 123 中文',
      '中文abc中文',
      '　全角空格　5',
      'A：1 B：2',
    ]
    for (const s of cases) {
      expect(detectCharacterStyles(s)).toStrictEqual(referenceDetectCharacterStyles(s))
    }
  })

  it('空串 / 单字符 / 快路径 A 与 B 边界', () => {
    const cases = ['', ' ', 'a', '5', '中', '：', ':', 'a b', '中：', '：中', '5：', '：5', 'ab:cd']
    for (const s of cases) {
      expect(detectCharacterStyles(s)).toStrictEqual(referenceDetectCharacterStyles(s))
    }
  })

  it('真实语料：27 份文档的全部段落文本与参照一致', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const docsDir = resolve(here, '../docs')
    if (!existsSync(docsDir)) return
    const files = readdirSync(docsDir).filter((f) => f.endsWith('.doc') || f.endsWith('.dot')).sort()
    expect(files.length).toBeGreaterThan(0)

    let paragraphs = 0
    let slowPathParagraphs = 0
    const bad: string[] = []
    for (const f of files) {
      const data = readFileSync(resolve(docsDir, f))
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      const res = new DocParser(ab).parseWithFormat()
      for (const p of res.document?.paragraphs ?? []) {
        const text = p.text
        if (typeof text !== 'string') continue
        paragraphs++
        // 慢路径判定与实现一致：两条快路径都不命中
        if (HAS_CJK_OR_COLON_RE.test(text) && HAS_CJK_OR_DIGIT_RE.test(text)) slowPathParagraphs++
        if (!strictSameStyles(detectCharacterStyles(text), referenceDetectCharacterStyles(text))) {
          if (bad.length < 10) bad.push(`${f}: ${JSON.stringify(text.slice(0, 60))}`)
        }
      }
    }
    expect(bad).toEqual([])
    expect(paragraphs).toBeGreaterThan(1000)
    // 护栏必须真的覆盖到被改动的慢路径，否则等于没测。
    // 真实 27 份语料实测：34,945 段落 / 1,456,460 字符，其中 533 个段落走慢路径。
    expect(slowPathParagraphs).toBeGreaterThan(400)
  }, 120000)
})

describe('Round 144 护栏鉴别力（负控必须被检出）', () => {
  it('正控：真实实现与参照在穷举集上零失配', () => {
    expect(collectMismatches(detectCharacterStyles)).toEqual([])
  })

  it('负控 1（空白段也物化 fontName 键）必须被检出', () => {
    const bad = collectMismatches(ncAlwaysFontKey)
    expect(bad.length).toBeGreaterThan(0)
  })

  it('负控 2（fontName 严格相等，丢掉 undefined 通配）必须被检出', () => {
    const bad = collectMismatches(ncStrictFontEquality)
    expect(bad.length).toBeGreaterThan(0)
  })

  it('负控 3（段 end 差一）必须被检出', () => {
    const bad = collectMismatches(ncOffByOneEnd)
    expect(bad.length).toBeGreaterThan(0)
  })

  it('`toEqual` 会漏掉负控 1，`toStrictEqual` 不会（钉住断言严格度）', () => {
    const s = '中：5 '
    const real = detectCharacterStyles(s)
    const nc = ncAlwaysFontKey(s)
    // 语义等价（值相同）⇒ toEqual 判等
    expect(nc).toEqual(real)
    // 但键集合不同 ⇒ toStrictEqual 判不等
    expect(() => expect(nc).toStrictEqual(real)).toThrow()
    // 自实现的严格比对同样判不等
    expect(strictSameStyles(nc, real)).toBe(false)
  })
})
