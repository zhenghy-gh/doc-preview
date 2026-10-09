// Round 104 护栏：shouldHaveUnderline 的「零分配码点扫描 + 删冗余正则 + 预计算位置表」
// 与改动前的正则实现逐字节等价。
//
// 对照由脚本从**当前源码**生成（见 .neg104.mjs），每处只改一行，生成时断言 needle
// 恰好命中一次 —— 避免「改了但没改到」的假对照。本文件是**常驻**的穷尽差分护栏。
import { describe, it, expect } from 'vitest'
import { shouldHaveUnderline } from '../src/utils/docparser/heuristics/textHeuristics'

// 改动前的逐字转写（含被判定为冗余的 DATE_TIME_RE）：这是 oracle，不是新实现。
const DATE_COLON_BEFORE_RE = /[：:]\s*$/
const DATE_UNIT_RE = /[年日月时分秒]/
const DATE_TIME_RE = /[0-9]{2,4}[年月日时分秒]/
function oracle(text: string, index: number): boolean {
  const code = text.charCodeAt(index)
  if (!(code >= 0x30 && code <= 0x39)) return false
  const before = text.substring(Math.max(0, index - 30), index)
  const after = text.substring(index, Math.min(text.length, index + 30))
  const hasColonBefore = DATE_COLON_BEFORE_RE.test(before)
  const hasDatePattern = DATE_UNIT_RE.test(after) || DATE_UNIT_RE.test(before)
  const hasTimePattern = DATE_TIME_RE.test(after) || DATE_TIME_RE.test(before)
  return hasColonBefore || hasDatePattern || hasTimePattern
}

// 冗余正则判定：hasColonBefore || hasDatePattern || hasTimePattern 恒等于
// hasColonBefore || hasDatePattern（DATE_TIME_RE 匹配必含日期单位字符）。
function oracleNoTimeRegex(text: string, index: number): boolean {
  const code = text.charCodeAt(index)
  if (!(code >= 0x30 && code <= 0x39)) return false
  const before = text.substring(Math.max(0, index - 30), index)
  const after = text.substring(index, Math.min(text.length, index + 30))
  const hasColonBefore = DATE_COLON_BEFORE_RE.test(before)
  const hasDatePattern = DATE_UNIT_RE.test(after) || DATE_UNIT_RE.test(before)
  return hasColonBefore || hasDatePattern
}

// 字母表：每类分支取一个代表即可（shouldHaveUnderline 只按「数字 / 日期单位 /
// 全角冒号 / 半角冒号 / 空白 / 其它」分支，类别内取值不影响力）。保持小规模是为了
// 让穷举在毫秒级完成；等价性靠分支覆盖而非具体字符。
const ALPHA = ['5', '年', '：', ':', ' ', '\n', 'a', '+']

// 递归穷举长度 ≤ maxLen 的全部分支串，对每个完整串 s 立即执行 fn（不把整组数组
// 一次性展开，避免 24^4 量级 spread 触发 RangeError: Maximum call stack size
// exceeded）。递归深度 = maxLen，可控。
function forAllStrings(
  maxLen: number,
  alpha: readonly string[],
  fn: (s: string) => void,
): void {
  const build = (prefix: string, depth: number): void => {
    fn(prefix)
    if (depth >= maxLen) return
    for (const ch of alpha) build(prefix + ch, depth + 1)
  }
  build('', 0)
}

function collectUnits(text: string): number[] {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (
      c === 0x5e74 || c === 0x65e5 || c === 0x6708 ||
      c === 0x65f6 || c === 0x5206 || c === 0x79d2
    ) out.push(i)
  }
  return out
}

describe('shouldHaveUnderline: 穷尽差分（新旧实现一致）', () => {
  it('枚举长度 ≤ 4 的全部串 × 全部 index，no-precompute 路径', () => {
    forAllStrings(4, ALPHA, (s) => {
      for (let i = 0; i < s.length; i++) {
        expect(shouldHaveUnderline(s, i)).toBe(oracle(s, i))
      }
    })
  })

  it('枚举长度 ≤ 4 的全部串 × 全部 index，precompute 路径一致', () => {
    forAllStrings(4, ALPHA, (s) => {
      const units = collectUnits(s)
      for (let i = 0; i < s.length; i++) {
        expect(shouldHaveUnderline(s, i, units)).toBe(oracle(s, i))
      }
    })
  })

  it('窗口边界：长度 mod 30 与跨窗口位置', () => {
    // 构造一个 80 字符的串，数字在 index 0，单位依次排在 0..79，验证 30 半径窗口。
    for (let unitPos = 0; unitPos < 80; unitPos++) {
      const arr = new Array(80).fill('x')
      arr[0] = '5'
      arr[unitPos] = '年'
      const s = arr.join('')
      expect(shouldHaveUnderline(s, 0)).toBe(oracle(s, 0))
      expect(shouldHaveUnderline(s, 0, collectUnits(s))).toBe(oracle(s, 0))
    }
    // index 在靠后位置，单位在前方远处
    for (let idx = 0; idx < 80; idx++) {
      const arr = new Array(80).fill('x')
      arr[idx] = '5'
      arr[0] = '年'
      const s = arr.join('')
      expect(shouldHaveUnderline(s, idx)).toBe(oracle(s, idx))
    }
  })

  it('随机串（长度 ≤ 40）两种路径都与 oracle 一致', () => {
    let seed = 123456789
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let t = 0; t < 4000; t++) {
      const len = 1 + Math.floor(rnd() * 40)
      let s = ''
      for (let i = 0; i < len; i++) s += ALPHA[Math.floor(rnd() * ALPHA.length)]
      const units = collectUnits(s)
      for (let i = 0; i < s.length; i++) {
        expect(shouldHaveUnderline(s, i)).toBe(oracle(s, i))
        expect(shouldHaveUnderline(s, i, units)).toBe(oracle(s, i))
      }
    }
  })
})

describe('shouldHaveUnderline: 冗余正则可证明删除', () => {
  it('hasTimePattern 从不为结果提供额外信息', () => {
    forAllStrings(4, ALPHA, (s) => {
      for (let i = 0; i < s.length; i++) {
        expect(oracleNoTimeRegex(s, i)).toBe(oracle(s, i))
      }
    })
  })
})

describe('shouldHaveUnderline: 越界与空串', () => {
  it('index 越界视为非数字 → false', () => {
    expect(shouldHaveUnderline('年5月', -1)).toBe(false)
    expect(shouldHaveUnderline('年5月', 99)).toBe(false)
    expect(shouldHaveUnderline('', 0)).toBe(false)
  })
  it('非数字字符 → false', () => {
    expect(shouldHaveUnderline('年5月', 0)).toBe(false) // '年'
    expect(shouldHaveUnderline('年5月', 2)).toBe(false) // '月'
  })
})
