// Round 106 护栏：把「冒号位置收集」从单独一趟 O(n) 扫描并进主遍历后，
// detectCharacterStyles 的输出与改动前逐段逐位等价。
//
// 参照实现是**改动前** detectCharacterStyles 的逐行转写（冒号单独跑一趟），
// 只调用导出的 shouldHaveUnderline（不带预计算表，Round 104 已证明与带表等价）
// 与 isSameStyle；isWhitespaceCode 在本文件内按原定义复刻。
import { describe, it, expect } from 'vitest'
import { detectCharacterStyles, shouldHaveUnderline, isSameStyle } from '../src/utils/docparser/heuristics/textHeuristics'
import type { CharStyle, CharStyleSegment } from '../src/utils/docFormat'

// isWhitespaceCode 逐字复刻（源模块未导出）
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

// 改动前实现的逐行转写：冒号单独跑一趟（Round 106 之前）
function referenceDetectCharacterStyles(text: string): CharStyleSegment[] {
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

  // —— 改动前：冒号单独跑一趟 ——
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

const ALPHA = ['5', '年', '月', '：', ':', ' ', '\n', 'a', '中', '+', '。', '，']

function forAllStrings(maxLen: number, alpha: readonly string[], fn: (s: string) => void): void {
  const build = (prefix: string, depth: number): void => {
    fn(prefix)
    if (depth >= maxLen) return
    for (const ch of alpha) build(prefix + ch, depth + 1)
  }
  build('', 0)
}

describe('detectCharacterStyles 冒号并趟等价性', () => {
  it('穷举长度 ≤ 4 全部串，与改动前参照逐段逐位一致', () => {
    forAllStrings(4, ALPHA, (s) => {
      expect(detectCharacterStyles(s)).toEqual(referenceDetectCharacterStyles(s))
    })
  })

  it('随机串（长度 ≤ 60）与参照一致', () => {
    let seed = 246801357
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let t = 0; t < 3000; t++) {
      const len = 1 + Math.floor(rnd() * 60)
      let s = ''
      for (let i = 0; i < len; i++) s += ALPHA[Math.floor(rnd() * ALPHA.length)]
      expect(detectCharacterStyles(s)).toEqual(referenceDetectCharacterStyles(s))
    }
  })

  it('冒号密集串（触发下划线区间合并逻辑）与参照一致', () => {
    const cases = [
      '：5：6：7：8',
      'a:1 b:2 c:3 d:4 e:5',
      '：：：：',
      '1234：5678',
      '名：张三 日期：2024年1月1日',
      '：'.repeat(10) + '5',
      '5' + '：'.repeat(10),
      '：x：yy：zzz：1234',
    ]
    for (const s of cases) {
      expect(detectCharacterStyles(s)).toEqual(referenceDetectCharacterStyles(s))
    }
  })

  it('空串与无冒号串', () => {
    expect(detectCharacterStyles('')).toEqual(referenceDetectCharacterStyles(''))
    expect(detectCharacterStyles('中文abc123')).toEqual(referenceDetectCharacterStyles('中文abc123'))
  })
})
