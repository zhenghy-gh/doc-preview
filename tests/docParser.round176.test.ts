// Round 176 护栏：`splitTextByParagraphMark` 用 `indexOf` + `slice` 替代 `split(/(?<=\u0007\u0007)/)`。
//
// 背景：剖析里 `RegExp: (?<=\u0007\u0007)` 节点独占 **0.69%**（V8 的零宽 lookbehind split 很慢），
// 而语义只是「在每个 `\u0007\u0007` **之后**切一刀」。
//
// **两个坑（本轮实测踩到并修好，护栏必须钉住）**：
//   ① lookbehind 零宽匹配**允许重叠**：`\u0007\u0007\u0007` 在位置 2、3 各切一次
//      ⇒ 下一次搜索必须从 `hit + 1` 起（不是 `hit + 2`）；
//   ② 位于**串末尾**的零宽匹配**不切**：`'\u0007\u0007'.split(/(?<=\u0007\u0007)/)`
//      只有 **1** 段 ⇒ 仅当 `from < paraText.length` 才补尾部 part。
//
// A 组是**直接对生产函数 `splitTextByParagraphMark` 做差分**（oracle = R173 之前的
// lookbehind 实现）⇒ 对生产改动有真实鉴别力。R173 的 A1/A2/A3 也在做同一件事，
// 构成**跨轮**双重验证。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DocParser, splitTextByParagraphMark } from '../src/utils/docParser'

type Part = { text: string; cpStart: number; originalIndex: number }

/** oracle：lookbehind split 版（R176 之前的实现，逐行转写）。 */
function round176Oracle(text: string): Part[] {
  const parts: Part[] = []
  let cp = 0, partStart = 0, partIndex = 0
  let nl = text.indexOf('\n')
  for (;;) {
    const cut = nl < 0 ? text.length : nl
    const paraText = text.slice(partStart, cut)
    const subParts = paraText.includes('\u0007\u0007')
      ? paraText.split(/(?<=\u0007\u0007)/)
      : [paraText]
    let subOffset = 0
    for (const subText of subParts) {
      parts.push({ text: subText, cpStart: cp + subOffset, originalIndex: partIndex })
      subOffset += subText.length
    }
    cp += paraText.length + 1
    partStart = cut + 1
    partIndex++
    if (nl < 0) break
    nl = text.indexOf('\n', partStart)
  }
  return parts
}

/** 本轮候选的骨架，可逐一注错。 */
type Mode = 'ok' | 'overlapOff' | 'tailAlways' | 'noTail'
function round176Skeleton(text: string, mode: Mode): Part[] {
  const parts: Part[] = []
  let cp = 0, partStart = 0, partIndex = 0
  let nl = text.indexOf('\n')
  for (;;) {
    const cut = nl < 0 ? text.length : nl
    const paraText = text.slice(partStart, cut)
    if (paraText.includes('\u0007\u0007')) {
      let subOffset = 0, from = 0
      let hit = paraText.indexOf('\u0007\u0007', 0)
      while (hit >= 0) {
        const c = hit + 2
        const subText = paraText.slice(from, c)
        parts.push({ text: subText, cpStart: cp + subOffset, originalIndex: partIndex })
        subOffset += subText.length
        from = c
        hit = paraText.indexOf('\u0007\u0007', mode === 'overlapOff' ? hit + 2 : hit + 1)
      }
      if (mode === 'tailAlways' || (mode !== 'noTail' && from < paraText.length)) {
        parts.push({ text: paraText.slice(from), cpStart: cp + subOffset, originalIndex: partIndex })
      }
    } else {
      parts.push({ text: paraText, cpStart: cp, originalIndex: partIndex })
    }
    cp += paraText.length + 1
    partStart = cut + 1
    partIndex++
    if (nl < 0) break
    nl = text.indexOf('\n', partStart)
  }
  return parts
}

const CASES: string[] = [
  '', 'a', '\n', 'a\nb',
  '\u0007\u0007',
  '\u0007\u0007\u0007',
  '\u0007\u0007\u0007\u0007',
  '\u0007\u0007\u0007\u0007\u0007',
  'a\u0007\u0007',
  '\u0007\u0007a',
  'ab\u0007\u0007cd',
  'a\u0007\u0007b\nc\u0007\u0007d',
  '\u0007\u0007\n\u0007\u0007',
  'x'.repeat(40) + '\u0007\u0007' + 'y'.repeat(40) + '\u0007\u0007',
  'a\u0007b\u0007c',
]

describe('Round 176 A 组：生产函数差分', () => {
  it('A1 穷举（含重叠切点与末尾切点）：parts 完全一致', () => {
    for (const t of CASES) {
      expect(splitTextByParagraphMark(t), JSON.stringify(t.slice(0, 14))).toEqual(round176Oracle(t))
    }
  })

  it('A2 随机模糊 5,000 条（单元格标记密度高）：逐条相同', () => {
    let seed = 0x176176
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    const al = ['a', '中', '\n', '\u0007', ' ', 'b']
    let withDouble = 0
    for (let k = 0; k < 5000; k++) {
      const n = Math.floor(rnd() * 18)
      let s = ''
      for (let j = 0; j < n; j++) s += al[Math.floor(rnd() * al.length)]
      expect(splitTextByParagraphMark(s)).toEqual(round176Oracle(s))
      if (s.includes('\u0007\u0007')) withDouble++
    }
    expect(withDouble).toBeGreaterThan(200)
  })

  it('A3 末尾零宽不切是绝对锚点', () => {
    expect(splitTextByParagraphMark('\u0007\u0007').map((p) => p.text)).toEqual(['\u0007\u0007'])
    expect(splitTextByParagraphMark('\u0007\u0007\u0007').map((p) => p.text)).toEqual(['\u0007\u0007', '\u0007'])
    expect(splitTextByParagraphMark('a\u0007\u0007').map((p) => p.text)).toEqual(['a\u0007\u0007'])
  })
})

describe('Round 176 B 组：真实语料', () => {
  it('B1 27 份 parseWithFormat 全量输出 SHA-1 锚定', () => {
    const docs = fileURLToPath(new URL('../docs/', import.meta.url))
    const files = fs.readdirSync(docs).filter((n) => /\.(doc|dot)$/.test(n)).sort()
    expect(files.length).toBe(27)
    const parts: string[] = []
    let chars = 0
    for (const f of files) {
      const b = fs.readFileSync(path.join(docs, f))
      const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
      const s = JSON.stringify(new DocParser(ab).parseWithFormat())
      parts.push(f + '\u0000' + s)
      chars += s.length
    }
    expect(chars).toBe(16247039)
    expect(crypto.createHash('sha1').update(parts.join('\n')).digest('hex'))
      .toBe('8f127d0bdbb0a63718a5663f48d267972c753b0e')
  })
})

describe('Round 176 D 组：骨架负控鉴别力', () => {
  it('D1 正控：ok 与 oracle 在全部用例上一致', () => {
    for (const t of CASES) expect(round176Skeleton(t, 'ok')).toEqual(round176Oracle(t))
  })

  it('D2 负控「不允许重叠」（从 hit+2 继续搜）：四连标记必须分歧', () => {
    // 注意：**三连**标记在两种搜法下结果恰好相同（`['\u0007\u0007','\u0007']`），
    // 故探针必须用**四连**才有鉴别力 —— 这是本轮写护栏时实测踩到的。
    expect(round176Skeleton('\u0007\u0007\u0007', 'overlapOff')).toEqual(round176Oracle('\u0007\u0007\u0007'))
    expect(round176Skeleton('\u0007\u0007\u0007\u0007', 'overlapOff')).not.toEqual(round176Oracle('\u0007\u0007\u0007\u0007'))
    expect(round176Skeleton('ab\u0007\u0007cd', 'overlapOff')).toEqual(round176Oracle('ab\u0007\u0007cd'))
  })

  it('D3 负控「末尾总补尾段」：串以 \\u0007\\u0007 结尾时必须分歧', () => {
    expect(round176Skeleton('\u0007\u0007', 'tailAlways')).not.toEqual(round176Oracle('\u0007\u0007'))
  })

  it('D4 负控「从不补尾段」：有非空尾巴时必须分歧', () => {
    expect(round176Skeleton('ab\u0007\u0007cd', 'noTail')).not.toEqual(round176Oracle('ab\u0007\u0007cd'))
  })
})

describe('Round 176 C 组：接线元断言', () => {
  const SRC = fs.readFileSync(new URL('../src/utils/docParser.ts', import.meta.url), 'utf8')
  const CODE = SRC.split('\n').filter((l) => {
    const t = l.trim()
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
  }).join('\n')
  const C = CODE.replace(/\s+/g, ' ').trim()

  it('C1 旧 lookbehind split 已彻底移除', () => {
    expect(CODE).not.toContain('(?<=')
    expect(CODE).not.toContain('.split(/(?<')
  })

  it('C2 新实现：indexOf 搜索 + 重叠（hit + 1）+ slice 切分', () => {
    expect(C).toContain("let hit = paraText.indexOf('\\u0007\\u0007', 0)")
    expect(C).toContain("hit = paraText.indexOf('\\u0007\\u0007', hit + 1)")
    expect(C).toContain('const subText = paraText.slice(from, cut)')
  })

  it('C3 末尾零宽不切：尾段仅在 `from < paraText.length` 时补', () => {
    expect(C).toContain('if (from < paraText.length) {')
    expect(C).toContain('const tail = paraText.slice(from)')
  })
})
