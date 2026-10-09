// Round 111 护栏：detectCharacterStyles 的整段快路径。
//
// 参照实现是**改动前** detectCharacterStyles 的逐行转写（无条件走逐字符循环），
// 只调用导出的 shouldHaveUnderline（不带预计算表，Round 104 已证明与带表等价）
// 与 isSameStyle；isWhitespaceCode 在本文件内按原定义复刻。
// 本护栏抓的是**控制流**（快路径的触发条件与产出结构），不是那些被复刻的常量。
//
// 快路径的等价性依据（供审阅）：
//   A. 整段无 CJK、无冒号 ⇒ 每个字符的样式都是「无下划线的普通样式」：
//      · 无 CJK ⇒ chineseSoFar 恒为 0 ⇒ 兜底分支的 fontName 恒为 'Times New Roman'；
//      · 无 CJK ⇒ isDateUnitCode 的六个日期单位（年月日时分秒，全为 CJK）都不出现，
//        shouldHaveUnderline 的日期分支恒 false；无冒号 ⇒ 其冒号分支也恒 false
//        ⇒ 任何数字字符都不会带下划线。
//      故整段只产出 1 个样式段，style 即 text[0] 的对象，且无需冒号后处理。
//   B. 有冒号但无 CJK、无数字 ⇒ 同上，只多跑一次冒号下划线后处理。
//   其余情形一律退回通用逐字符循环。
import { describe, it, expect } from 'vitest'
import { detectCharacterStyles, shouldHaveUnderline, isSameStyle } from '../src/utils/docparser/heuristics/textHeuristics'
import type { CharStyle, CharStyleSegment } from '../src/utils/docFormat'

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

/** 改动前实现的逐行转写：无条件逐字符循环（无快路径）。 */
function reference(text: string): CharStyleSegment[] {
  const styles: CharStyleSegment[] = []
  let currentStyle: CharStyle | null = null
  let styleStart = 0
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

  const colonPositions: number[] = []
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 0xff1a || code === 0x3a) colonPositions.push(i)
  }
  if (colonPositions.length > 0) {
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

function forAllStrings(maxLen: number, alpha: readonly string[], fn: (s: string) => void): void {
  const build = (prefix: string, depth: number): void => {
    fn(prefix)
    if (depth >= maxLen) return
    for (const ch of alpha) build(prefix + ch, depth + 1)
  }
  build('', 0)
}

// 无数字、无 CJK 的字母表 —— 全部落在快路径上（含冒号以驱动后处理）
const FAST_ALPHA = ['a', 'Z', ' ', '\t', '.', ':', '：', '\u3000']
// 混合字母表 —— 跨越快路径边界
const MIXED_ALPHA = ['a', '5', '年', ':', '：', ' ', '\u3000']

describe('detectCharacterStyles 整段快路径等价性', () => {
  it('穷举「无数字无 CJK」长度 ≤ 5 全部串（约 3.7 万），与参照逐段逐位一致', () => {
    let count = 0
    forAllStrings(5, FAST_ALPHA, (s) => {
      expect(detectCharacterStyles(s)).toEqual(reference(s))
      count++
    })
    expect(count).toBeGreaterThan(30000)
  })

  it('穷举混合串长度 ≤ 4（含数字 / CJK / 冒号），覆盖快路径开关两侧', () => {
    forAllStrings(4, MIXED_ALPHA, (s) => {
      expect(detectCharacterStyles(s)).toEqual(reference(s))
    })
  })

  it('穷尽全部 65536 个 BMP 单字符，与参照一致', () => {
    for (let c = 0; c < 0x10000; c++) {
      const s = String.fromCharCode(c)
      expect(detectCharacterStyles(s)).toEqual(reference(s))
    }
  })

  it('随机串（长度 ≤ 80，混合字母表）与参照一致，且产出非空转', () => {
    let seed = 987654321
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    let produced = 0
    let multi = 0
    for (let t = 0; t < 5000; t++) {
      const len = 1 + Math.floor(rnd() * 80)
      let s = ''
      for (let i = 0; i < len; i++) s += MIXED_ALPHA[Math.floor(rnd() * MIXED_ALPHA.length)]
      const got = detectCharacterStyles(s)
      expect(got).toEqual(reference(s))
      if (got.length > 0) produced++
      if (got.length > 1) multi++
    }
    expect(produced).toBeGreaterThan(4900)
    expect(multi).toBeGreaterThan(100)
  })

  it('快路径 A 的结构不变式：无 CJK 无冒号时恰好 1 段（数字也不例外）', () => {
    // 首字符为空白 → { underline: false }（无 fontName）
    expect(detectCharacterStyles(' hello world ')).toEqual([
      { start: 0, end: 13, style: { underline: false } },
    ])
    // 首字符非空白 → { fontName: 'Times New Roman', underline: false }
    expect(detectCharacterStyles('hello world')).toEqual([
      { start: 0, end: 11, style: { fontName: 'Times New Roman', underline: false } },
    ])
    // 标点起头走兜底分支，i === 0 ⇒ fontName 也是 Times New Roman
    expect(detectCharacterStyles('.abc')).toEqual([
      { start: 0, end: 4, style: { fontName: 'Times New Roman', underline: false } },
    ])
    // 数字起头且无冒号：shouldHaveUnderline 恒 false ⇒ 仍为单段
    expect(detectCharacterStyles('2024 was a year')).toEqual([
      { start: 0, end: 15, style: { fontName: 'Times New Roman', underline: false } },
    ])
    // 空串 → 无段
    expect(detectCharacterStyles('')).toEqual([])
  })

  it('快路径 B：有冒号但无 CJK/数字 → 单段 + 冒号后处理', () => {
    const withColon = 'name: some very long value here'
    expect(detectCharacterStyles(withColon)).toEqual(reference(withColon))
    expect(detectCharacterStyles(withColon)[0].style.underline).toBe(true)
  })

  it('快路径边界：一旦出现 CJK 或「冒号 + 数字」就退回通用循环', () => {
    // 含 CJK → 通用循环
    expect(detectCharacterStyles('中文')).toEqual(reference('中文'))
    // 冒号 + 数字 → 通用循环（数字可被冒号触发下划线）
    const colonDigit = 'time: 12 and more'
    expect(detectCharacterStyles(colonDigit)).toEqual(reference(colonDigit))
    // 冒号 + 数字 + 日期单位 → 下划线
    const dateLine = '日期：2024年1月1日'
    expect(detectCharacterStyles(dateLine)).toEqual(reference(dateLine))
  })
})
