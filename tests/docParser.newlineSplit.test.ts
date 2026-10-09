/**
 * Round 108 常驻差分护栏：`splitTextByParagraphMark`（段落切分）。
 *
 * 被保护的控制流：把整篇文本按段落标记 '\n' 切成 parts（含 `\u0007\u0007` 表格行再切），
 * 并给出每个 part 的 CP 起点与段序号。改动把「逐字符 `charCodeAt(i) !== 10` 扫描」
 * 换成「`indexOf('\n')` 跳跃」，实测 3.8x。
 *
 * 参照实现是**改动前**的逐行转写（`referenceSplit`）。转写只保留被改动的控制流，
 * `\u0007\u0007` 子切分那段与改动前逐字相同（本就未改动）。
 *
 * 作用域边界：本护栏抓的是**切点与 CP 推进的控制流**，不覆盖调用方对
 * `cleanParagraph` / `shouldSkipParagraph` 的处理。
 */
import { describe, it, expect } from 'vitest'
import { splitTextByParagraphMark } from '../src/utils/docParser'

/** 改动前实现（逐行转写）：i 从 0 走到 text.length **含端点**。 */
function referenceSplit(text: string): Array<{ text: string; cpStart: number; originalIndex: number }> {
  const parts: Array<{ text: string; cpStart: number; originalIndex: number }> = []
  let cp = 0
  let partStart = 0
  let partIndex = 0
  for (let i = 0; i <= text.length; i++) {
    if (i !== text.length && text.charCodeAt(i) !== 10) continue
    const paraText = text.slice(partStart, i)
    const subParts = paraText.includes('\u0007\u0007')
      ? paraText.split(/(?<=\u0007\u0007)/)
      : [paraText]
    let subOffset = 0
    for (const subText of subParts) {
      parts.push({ text: subText, cpStart: cp + subOffset, originalIndex: partIndex })
      subOffset += subText.length
    }
    cp += paraText.length + 1
    partStart = i + 1
    partIndex++
  }
  return parts
}

const CASES: string[] = [
  '',
  'a',
  '\n',
  '\n\n',
  'a\n',
  'a\n\n',
  '\na',
  '\n\na',
  'a\nb',
  'a\n\nb',
  'a\n\n\nb',
  '中文\n段落\n标记',
  'a\u0007\u0007b\nc',
  '\u0007\u0007',
  'a\u0007\u0007',
  '\u0007\u0007\n\u0007\u0007',
  'x\u0007\u0007y\u0007\u0007z',
  'a\u0007\u0007b\u0007\u0007c\nd',
  '\r\n',
  'a\r\nb',
  '\u0007',
  '\u0007\u0007\u0007',
  '\u0007\u0007\u0007\u0007',
  '😀\n😀😀\n',
  '𝔘𝔫𝔦\n𝔠𝔬𝔡𝔢',
]

describe('splitTextByParagraphMark 差分护栏（Round 108）', () => {
  it('固定用例：与改动前实现逐字段一致', () => {
    for (const text of CASES) {
      expect(splitTextByParagraphMark(text), JSON.stringify(text)).toEqual(referenceSplit(text))
    }
  })

  it('非空转：确实切出了多个 part，且 CP 起点按切点推进', () => {
    let total = 0
    let multi = 0
    for (const text of CASES) {
      const parts = splitTextByParagraphMark(text)
      total += parts.length
      if (parts.length >= 3) multi++
      // CP 不变式：同一个 originalIndex（同一次 '\n' 切分、被 \u0007\u0007 再切）
      // 的相邻 part 相差前一个 part 的长度；跨 originalIndex 时再多加 1（段落标记）。
      for (let i = 0; i < parts.length; i++) {
        const prev = parts[i - 1]
        const expected = i === 0
          ? 0
          : prev.cpStart + prev.text.length + (parts[i].originalIndex === prev.originalIndex ? 0 : 1)
        expect(parts[i].cpStart, `${JSON.stringify(text)} #${i}`).toBe(expected)
      }
    }
    expect(total).toBeGreaterThan(0)
    expect(multi).toBeGreaterThanOrEqual(5)
  })

  it('穷尽短串：长度 ≤ 4 的 {a, \\n, \\u0007} 字母表全枚举', () => {
    const ALPHA = ['a', '\n', '\u0007']
    const gen = (prefix: string, depth: number) => {
      expect(splitTextByParagraphMark(prefix), JSON.stringify(prefix)).toEqual(referenceSplit(prefix))
      if (depth === 0) return
      for (const c of ALPHA) gen(prefix + c, depth - 1)
    }
    for (let len = 0; len <= 4; len++) gen('', len)
  })

  it('随机串 3000 组（长度 ≤ 80，含 \\n / \\u0007 / CR / 代理对）', () => {
    const ALPHA = ['a', 'Z', '\n', '\r', '\u0007', '中', '\u0000', '😀', '\u0007\u0007']
    let seed = 0x2545f491
    const rnd = () => {
      seed ^= seed << 13; seed >>>= 0
      seed ^= seed >> 17
      seed ^= seed << 5; seed >>>= 0
      return seed / 0x100000000
    }
    let mismatches = 0
    let produced = 0
    for (let t = 0; t < 3000; t++) {
      const n = Math.floor(rnd() * 81)
      let s = ''
      for (let k = 0; k < n; k++) s += ALPHA[Math.floor(rnd() * ALPHA.length)]
      const a = splitTextByParagraphMark(s)
      const b = referenceSplit(s)
      if (JSON.stringify(a) !== JSON.stringify(b)) mismatches++
      produced += a.length
    }
    expect(mismatches).toBe(0)
    expect(produced).toBeGreaterThan(3000)
  })

  it('长文本（10 万字符 / 5000 段）：与参照一致', () => {
    const line = '中文段落内容abc'
    const text = Array.from({ length: 5000 }, (_, i) => line + i).join('\n') + '\n'
    const a = splitTextByParagraphMark(text)
    const b = referenceSplit(text)
    expect(a.length).toBe(b.length)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(5000)
  })
})
