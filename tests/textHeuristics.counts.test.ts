// Round 105 护栏：countChineseAndWhitespace（一趟合并扫描）与
// 「countChineseChars + countWhitespaceChars 两趟」逐字等价。
import { describe, it, expect } from 'vitest'
import { countChineseAndWhitespace } from '../src/utils/docparser/heuristics/textHeuristics'
import { countChineseChars } from '../src/utils/docparser/encodingDetector'

// 空白判定参照（与 isWhitespaceCode 逐字一致）
function isWs(code: number): boolean {
  return (
    (code >= 0x09 && code <= 0x0d) || code === 0x20 || code === 0xa0 ||
    code === 0x1680 || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 ||
    code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff
  )
}
function refChinese(text: string): number {
  let c = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0x4e00 && code <= 0x9fff) c++
  }
  return c
}
function refWhitespace(text: string): number {
  let c = 0
  for (let i = 0; i < text.length; i++) if (isWs(text.charCodeAt(i))) c++
  return c
}

// 字母表覆盖各分支类别（数字/中文/日期单位/全半角冒号/各类空白/其它）
const ALPHA = ['5', '年', '月', '日', '：', ':', ' ', '\t', '\n', ' ', '　', ' ', ' ', 'a', '中', '+']

function forAllStrings(maxLen: number, alpha: readonly string[], fn: (s: string) => void): void {
  const build = (prefix: string, depth: number): void => {
    fn(prefix)
    if (depth >= maxLen) return
    for (const ch of alpha) build(prefix + ch, depth + 1)
  }
  build('', 0)
}

describe('countChineseAndWhitespace 等价性', () => {
  it('穷举长度 ≤ 4 全部串，与两个参照一致（并交叉验证 countChineseChars）', () => {
    forAllStrings(4, ALPHA, (s) => {
      const [cn, ws] = countChineseAndWhitespace(s)
      expect(cn).toBe(refChinese(s))
      expect(ws).toBe(refWhitespace(s))
      expect(cn).toBe(countChineseChars(s))
    })
  })

  it('随机串（长度 ≤ 40）两种路径都与参照一致', () => {
    let seed = 987654321
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let t = 0; t < 4000; t++) {
      const len = 1 + Math.floor(rnd() * 40)
      let s = ''
      for (let i = 0; i < len; i++) s += ALPHA[Math.floor(rnd() * ALPHA.length)]
      const [cn, ws] = countChineseAndWhitespace(s)
      expect(cn).toBe(refChinese(s))
      expect(ws).toBe(refWhitespace(s))
    }
  })

  it('空串与全空白 / 全中文边界', () => {
    expect(countChineseAndWhitespace('')).toEqual([0, 0])
    expect(countChineseAndWhitespace('   \t\n')).toEqual([0, 5])
    expect(countChineseAndWhitespace('中文测试')).toEqual([4, 0])
  })

  it('NBSP / ZWNBSP / 全角空格等 \s 等价空白都被计入', () => {
    // 用显式码点构造，避免手写字面量混入非预期字符
    const wsCodes = [0xa0, 0x3000, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0xfeff]
    const s = String.fromCharCode(...wsCodes)
    const [cn, ws] = countChineseAndWhitespace(s)
    expect(cn).toBe(0)
    expect(ws).toBe(wsCodes.length)
    expect(ws).toBe(refWhitespace(s))
  })
})
