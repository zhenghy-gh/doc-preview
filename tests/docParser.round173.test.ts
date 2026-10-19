// Round 173 护栏：`splitTextByParagraphMark` 把 `\u0007\u0007` 分支提到循环外。
//
// 背景：原实现**无条件**构造 `[paraText]`（每段一个单元素数组）再用 `for...of` 迭代，
// 只为在「表格行」这一极少数情形下多切几刀。实测 34,945 段/轮里含 `\u0007\u0007` 的极少，
// 常见路径白付一次数组分配 + 一次迭代器协议（剖析 L7323 0.73%）。
//
// 改动：`if (paraText.includes('\u0007\u0007')) { …原 split 分支… } else { parts.push(...) }`。
//
// **等价性**：无 `\u0007\u0007` 时原 `subParts` 恒为 `[paraText]`，循环只 push 一次且
// `cpStart = cp + 0 = cp` —— 与直接 push 逐字段相同。
//
// **本文件比 R171/R172 更强的地方**：A 组不是「本地 oracle vs 本地 oracle」，而是
// **直接对生产函数 `splitTextByParagraphMark` 做差分**（拿逐行转写的旧实现当 oracle），
// 因此对「生产代码被改错」**有真实鉴别力**。
//
// **注意（R164 通用教训 10）**：把分支提回循环内是**行为保持型**改动，输出逐字节不变
// ⇒ 只有 C 组源码文本元断言能抓住它被静默回退。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DocParser, splitTextByParagraphMark } from '../src/utils/docParser'

type Part = { text: string; cpStart: number; originalIndex: number }

/** 改动前实现：逐行转写（`[paraText]` + `for...of` 无条件走一遍）。 */
function round173OldSplit(text: string): Part[] {
  const parts: Part[] = []
  let cp = 0
  let partStart = 0
  let partIndex = 0
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

// ══════════════════════════════════════════════════════════════════════════
// A 组：直接对生产函数做差分
// ══════════════════════════════════════════════════════════════════════════

const TEXTS: string[] = [
  '',
  'a',
  'a\nb',
  'a\nb\n',
  '\n',
  '\n\n\n',
  'a\u0007\u0007b',
  'a\u0007\u0007b\nc\u0007\u0007d',
  '\u0007\u0007',
  '\u0007\u0007\u0007\u0007',
  'a\u0007b\u0007c',
  'a\u0007\u0007b\u0007\u0007c',
  'x'.repeat(300),
  'x'.repeat(300) + '\u0007\u0007' + 'y'.repeat(300),
  '\u0007\u0007\n\u0007\u0007',
  '表1\u0007\u0007表2\n下一段',
]

describe('Round 173 A 组：生产函数差分', () => {
  it('A1 穷举文本形状：生产实现与改动前 oracle 的 parts 完全一致', () => {
    for (const t of TEXTS) {
      expect(splitTextByParagraphMark(t), JSON.stringify(t.slice(0, 16))).toEqual(round173OldSplit(t))
    }
  })

  it('A2 随机模糊 2,000 条（字母/换行/单元格标记/长串）：逐条相同', () => {
    let seed = 0x173173
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const alphabet = ['a', 'b', '中', '\n', '\u0007', ' ', '\t']
    let withDoubleMark = 0
    let withNewline = 0
    for (let k = 0; k < 2000; k++) {
      const n = Math.floor(rnd() * 24)
      let s = ''
      for (let j = 0; j < n; j++) s += alphabet[Math.floor(rnd() * alphabet.length)]
      if (rnd() < 0.15) s += 'x'.repeat(Math.floor(rnd() * 400))
      expect(splitTextByParagraphMark(s)).toEqual(round173OldSplit(s))
      if (s.includes('\u0007\u0007')) withDoubleMark++
      if (s.includes('\n')) withNewline++
    }
    // 防空转：两条分支都必须被随机集覆盖到
    expect(withDoubleMark).toBeGreaterThan(10)
    expect(withNewline).toBeGreaterThan(100)
  })

  it('A3 表格行切分是绝对锚点：cpStart 连续且逐段相接', () => {
    const parts = splitTextByParagraphMark('ab\u0007\u0007cd\nnext')
    expect(parts.map((p) => p.text)).toEqual(['ab\u0007\u0007', 'cd', 'next'])
    expect(parts.map((p) => p.cpStart)).toEqual([0, 4, 7])
    expect(parts.map((p) => p.originalIndex)).toEqual([0, 0, 1])
    // 逐段相接：下一段 cpStart = 上一段 cpStart + 长度（同 part 内）/ 跨 part 再加 1
    expect(parts[1].cpStart).toBe(parts[0].cpStart + parts[0].text.length)
    expect(parts[2].cpStart).toBe(parts[1].cpStart + parts[1].text.length + 1)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// B 组：真实语料锚定 + 非空转
// ══════════════════════════════════════════════════════════════════════════

describe('Round 173 B 组：真实语料', () => {
  it('B1 27 份 parseWithFormat 全量输出 SHA-1 锚定（与历史证据一致）', () => {
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
    const sha1 = crypto.createHash('sha1').update(parts.join('\n')).digest('hex')
    expect(sha1).toBe('8f127d0bdbb0a63718a5663f48d267972c753b0e')
  })

  it('B2 真实语料里 `\\u0007\\u0007`（表格行）分支确实被走到', () => {
    const docs = fileURLToPath(new URL('../docs/', import.meta.url))
    const files = fs.readdirSync(docs).filter((n) => /\.(doc|dot)$/.test(n)).sort()
    let totalParts = 0
    let doubleMarkParts = 0
    for (const f of files) {
      const b = fs.readFileSync(path.join(docs, f))
      const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
      const out = new DocParser(ab).parseWithFormat() as {
        document: { paragraphs: Array<{ text?: string }> }
      }
      for (const p of out.document.paragraphs) {
        totalParts++
        if ((p.text || '').includes('\u0007\u0007')) doubleMarkParts++
      }
    }
    expect(totalParts).toBeGreaterThan(30000)
    expect(doubleMarkParts).toBeGreaterThan(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// D 组：骨架负控鉴别力
// ══════════════════════════════════════════════════════════════════════════

type SplitMode = 'ok' | 'forgetSubOffset' | 'neverSplit'

/** 与生产同形的切分骨架，可逐一注错。 */
function round173SplitSkeleton(text: string, mode: SplitMode): Part[] {
  const parts: Part[] = []
  let cp = 0
  let partStart = 0
  let partIndex = 0
  let nl = text.indexOf('\n')
  for (;;) {
    const cut = nl < 0 ? text.length : nl
    const paraText = text.slice(partStart, cut)
    const shouldSplit = mode === 'neverSplit' ? false : paraText.includes('\u0007\u0007')
    if (shouldSplit) {
      let subOffset = 0
      for (const subText of paraText.split(/(?<=\u0007\u0007)/)) {
        // forgetSubOffset：忘记累加 subOffset ⇒ 同一 part 内的子段 cpStart 全等于 cp
        parts.push({
          text: subText,
          cpStart: mode === 'forgetSubOffset' ? cp : cp + subOffset,
          originalIndex: partIndex,
        })
        subOffset += subText.length
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

describe('Round 173 D 组：骨架负控鉴别力', () => {
  it('D1 正控：ok 与 oracle 在全部形状上一致', () => {
    for (const t of TEXTS) {
      expect(round173SplitSkeleton(t, 'ok')).toEqual(round173OldSplit(t))
    }
  })

  it('D2 负控「从不切表格行」：含 `\\u0007\\u0007` 时必须分歧', () => {
    const t = 'ab\u0007\u0007cd'
    expect(round173SplitSkeleton(t, 'neverSplit')).not.toEqual(round173OldSplit(t))
  })

  it('D3 负控「忘记 subOffset 累加」：多子段时 cpStart 必须分歧', () => {
    const t = 'ab\u0007\u0007cd\u0007\u0007ef'
    expect(round173SplitSkeleton(t, 'forgetSubOffset')).not.toEqual(round173OldSplit(t))
    // 单子段时两者相同 ⇒ 该探针必须用**多子段**输入才有鉴别力
    expect(round173SplitSkeleton('ab', 'forgetSubOffset')).toEqual(round173OldSplit('ab'))
  })

  it('D4 元断言：无 `\\u0007\\u0007` 时 ok 与 neverSplit 完全相同（故输出测试对回退零鉴别力）', () => {
    for (const t of ['a\nb', 'plain', 'x'.repeat(50)]) {
      expect(round173SplitSkeleton(t, 'ok')).toEqual(round173SplitSkeleton(t, 'neverSplit'))
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════
// C 组：接线元断言（源码文本）
// ══════════════════════════════════════════════════════════════════════════

function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    })
    .join('\n')
}

function compact(src: string): string {
  return codeOnly(src).replace(/\s+/g, ' ').trim()
}

describe('Round 173 C 组：接线元断言', () => {
  const SRC = fs.readFileSync(new URL('../src/utils/docParser.ts', import.meta.url), 'utf8')
  const CODE = codeOnly(SRC)
  const C = compact(SRC)

  it('C1 `\\u0007\\u0007` 分支已提到循环外，旧单元素数组形态消失', () => {
    expect(C).toContain("if (paraText.includes('\\u0007\\u0007')) {")
    expect(C).not.toContain('const subParts = paraText.includes')
    expect(C).not.toContain(': [paraText]')
    expect(CODE).not.toContain('subParts')
  })

  it('C2 常见路径直接 push，且 cpStart 为 `cp`（无偏移）', () => {
    expect(C).toContain('parts.push({ text: paraText, cpStart: cp, originalIndex: partIndex })')
  })

  it('C3 表格行分支仍在每个 `\\u0007\\u0007` 后切分，且 subOffset 累加', () => {
    // Round 176 把 `split(/(?<=\u0007\u0007)/)` 换成了等价的 `indexOf` + `slice` 循环
    // （20,021 样本差分 0 不一致 + 27 份逐字节一致 + 本文件 A1/A2/A3/B1 全过）。
    // 故这里钉**契约**而非具体实现：分支必须仍搜索 `\u0007\u0007`、按 subText.length 累加、
    // 并以 `cp + subOffset` 落 cpStart。
    expect(C).toContain("indexOf('\\u0007\\u0007'")
    expect(C).toContain('subOffset += subText.length')
    expect(C).toContain('cpStart: cp + subOffset')
    // 旧 lookbehind 实现已移除（防止两条实现同时存在）
    expect(CODE).not.toContain('(?<=')
  })

  it('C4 循环收尾逻辑未被改动（cp += len + 1 / partStart / partIndex / 换行推进）', () => {
    expect(CODE).toContain('cp += paraText.length + 1')
    expect(CODE).toContain('partStart = cut + 1')
    expect(CODE).toContain('partIndex++')
    expect(CODE).toContain("nl = text.indexOf('\\n', partStart)")
  })
})
