// Round 171 护栏：`applyStructuralFormats` 里 `prefixBodyCounts` 的 `\u0001` 前置扫描消除。
//
// 背景（先量后改，27 份 × 20 轮计数插桩 / 行级归因）：
//   * `prefixBodyCounts` 循环对**每个段落**做一次 `t.startsWith('\u0001')`
//     —— 34,800 段/轮，真正命中仅 **126 段**（0.36%），剖析里该行 **0.46%**。
//   * 而紧邻其上的 Step 2 循环已经做过一次更严格的 `text.includes('\u0001')`
//     （全串扫描，**包含「开头」这一情形**）。
//
// 改动：Step 2 里把「本段含 `\u0001`」记进 `picFlags: Uint8Array`；
// `prefixBodyCounts` 改为 `picFlags[i] === 0` 时直接用 `visibleTextLengths[i]`
// （不含占位符 ⇒ 两者相等），否则才取 `paragraphs[i].text` 并按原逻辑剥**开头那一个**。
//
// **等价性前提（本文件的核心）**：
//   `picFlags[i] === 0` ⟺ `!text.includes('\u0001')` ⟹ `!text.startsWith('\u0001')`
//   ⟹ 原实现不剥任何字符 ⟹ `text.length === visibleTextLengths[i]`（Step 2 只在含占位符时
//   才把它改成「去掉占位符后的长度」）。
//
// **注意（R164 通用教训 10）**：本改动**行为保持型**——把 `picFlags` 整套去掉、退回逐段
// `startsWith`，输出**逐字节不变**，任何「比输出」的测试都抓不住。因此本文件必须同时具备：
//   * A/B 组：决策差分 + 真实语料锚定（证明输出未变）；
//   * C 组：**源码文本元断言**（唯一能钉死改动生效的手段）；
//   * D 组：骨架负控（证明本文件对「长度算错」有鉴别力）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DocParser } from '../src/utils/docParser'
import { applyStructuralFormats } from '../src/utils/docparser/heuristics/paragraphFilter'
import type { ParserParagraph } from '../src/utils/docparser/heuristics/paragraphFilter'

const PIC = '\u0001'
const LIST_ITEM_MAX_LEN = 150

// ══════════════════════════════════════════════════════════════════════════
// oracle：改动前（逐段 startsWith）与改动后（复用 Step 2 的标志位）
// ══════════════════════════════════════════════════════════════════════════

/** 改动前：`let t = text; if (t.startsWith('\u0001')) t = t.substring(1); t.length` */
function round171OldBodyLen(text: string): number {
  let t = text
  if (t.startsWith(PIC)) t = t.substring(1)
  return t.length
}

/** Step 2 的两项产物（生产同形）：是否含占位符、去掉**全部**占位符后的长度。 */
function round171Step2(text: string): { hasPic: boolean; visibleLen: number } {
  const hasPic = text.includes(PIC)
  const visibleLen = hasPic ? text.split(PIC).join('').length : text.length
  return { hasPic, visibleLen }
}

/** 改动后：标志位为 0 时直接用 Step 2 的长度；否则按原逻辑剥开头那一个。 */
function round171NewBodyLen(text: string, hasPic: boolean, visibleLen: number): number {
  if (!hasPic) return visibleLen
  return (text.charCodeAt(0) === 1 ? text.substring(1) : text).length
}

/** 端到端：用 Step 2 的产物喂给新实现。 */
function round171Pipeline(text: string): { oldLen: number; newLen: number } {
  const { hasPic, visibleLen } = round171Step2(text)
  return { oldLen: round171OldBodyLen(text), newLen: round171NewBodyLen(text, hasPic, visibleLen) }
}

// ══════════════════════════════════════════════════════════════════════════
// A 组：决策差分（穷举形状 + 随机模糊）
// ══════════════════════════════════════════════════════════════════════════

describe('Round 171 A 组：决策差分', () => {
  it('A1 穷举「占位符位置 × 长度边界」：新旧长度逐例相同', () => {
    const shapes: string[] = [
      '',
      PIC,
      PIC + PIC,
      'abc',
      PIC + 'abc',
      'abc' + PIC,
      PIC + 'a' + PIC + 'b',
      'a' + PIC + PIC + 'b',
      'x'.repeat(LIST_ITEM_MAX_LEN),
      PIC + 'x'.repeat(LIST_ITEM_MAX_LEN),
      PIC + 'x'.repeat(LIST_ITEM_MAX_LEN + 1),
      'x'.repeat(LIST_ITEM_MAX_LEN) + PIC,
      PIC + 'x'.repeat(9),
      PIC + 'x'.repeat(10),
    ]
    let cases = 0
    for (const t of shapes) {
      const { oldLen, newLen } = round171Pipeline(t)
      expect(newLen, JSON.stringify(t.slice(0, 12))).toBe(oldLen)
      cases++
    }
    expect(cases).toBe(shapes.length)
  })

  it('A2 前提：不含占位符时 `visibleLen` 必等于 `text.length`（标志位为 0 即可直接复用）', () => {
    for (const t of ['', 'a', 'x'.repeat(200), '中文段落', '\u0007cell\u0007']) {
      const { hasPic, visibleLen } = round171Step2(t)
      expect(hasPic).toBe(false)
      expect(visibleLen).toBe(t.length)
    }
  })

  it('A3 随机模糊 3,000 条（含占位符/控制符/长串）：新旧长度全等', () => {
    let seed = 0x171171
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const alphabet = ['a', 'Z', '中', PIC, '\u0007', ' ', '\t', '\n', '0']
    let withPic = 0
    for (let k = 0; k < 3000; k++) {
      const n = Math.floor(rnd() * 12)
      let s = ''
      for (let j = 0; j < n; j++) s += alphabet[Math.floor(rnd() * alphabet.length)]
      if (rnd() < 0.25) s += 'x'.repeat(Math.floor(rnd() * 200))
      const { oldLen, newLen } = round171Pipeline(s)
      expect(newLen).toBe(oldLen)
      if (s.includes(PIC)) withPic++
    }
    // 防空转：随机集里必须真的存在含占位符的样本
    expect(withPic).toBeGreaterThan(100)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// B 组：真实语料锚定 + 直接调用（绝对锚点）
// ══════════════════════════════════════════════════════════════════════════

describe('Round 171 B 组：真实语料锚定', () => {
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

  it('B2 真实语料里「以占位符开头」的段落确实存在（防止改动路径空转）', () => {
    const docs = fileURLToPath(new URL('../docs/', import.meta.url))
    const files = fs.readdirSync(docs).filter((n) => /\.(doc|dot)$/.test(n)).sort()
    let total = 0
    let startsWithPic = 0
    for (const f of files) {
      const b = fs.readFileSync(path.join(docs, f))
      const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
      const out = new DocParser(ab).parseWithFormat() as {
        document: { paragraphs: Array<{ text?: string }> }
      }
      for (const p of out.document.paragraphs) {
        total++
        if ((p.text || '').startsWith(PIC)) startsWithPic++
      }
    }
    expect(total).toBeGreaterThan(30000)
    expect(startsWithPic).toBeGreaterThan(0)
  })

  it('B3 直接调用 applyStructuralFormats：列表分组边界是绝对锚点（含占位符段落不干扰）', () => {
    const mk = (text: string): ParserParagraph => ({ text, charFormat: {}, paraFormat: {} })
    // 3 个短段（100 字）→ 构成一个候选列表组；前后各一个长正文段（200 字）打断
    const paras: ParserParagraph[] = [
      mk('y'.repeat(200)),
      mk('a'.repeat(100)),
      mk('b'.repeat(100)),
      mk('c'.repeat(100)),
      mk('y'.repeat(200)),
      mk(PIC + 'd'.repeat(100)),
      mk(PIC + 'e'.repeat(100)),
      mk(PIC + 'f'.repeat(100)),
      mk('y'.repeat(200)),
    ]
    applyStructuralFormats(paras)
    const listed = paras
      .map((p, i) => (p.paraFormat?.listType ? i : -1))
      .filter((i) => i >= 0)
    // 两个组都能成立（count 3、cv 0）；本用例只断言「恰有一组被标为列表」且落在预期区间内，
    // 用来钉死 prefixBodyCounts 参与的打分路径确实被走到。
    expect(listed.length).toBeGreaterThanOrEqual(3)
    const allInOneBlock =
      listed[listed.length - 1] - listed[0] === listed.length - 1
    expect(allInOneBlock).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// D 组：骨架负控鉴别力
// ══════════════════════════════════════════════════════════════════════════

type LenMode = 'ok' | 'ignoreFlag' | 'neverStrip' | 'stripAll'

/** 与生产同形的长度骨架，可逐一注错。 */
function round171LenSkeleton(text: string, hasPic: boolean, visibleLen: number, mode: LenMode): number {
  if (mode === 'ignoreFlag') return visibleLen
  if (mode === 'neverStrip') return text.length
  if (mode === 'stripAll') return text.split(PIC).join('').length
  return round171NewBodyLen(text, hasPic, visibleLen)
}

describe('Round 171 D 组：骨架负控鉴别力', () => {
  const PROBES: string[] = [PIC + 'x'.repeat(LIST_ITEM_MAX_LEN), PIC + 'abc', 'abc' + PIC, 'plain']

  it('D1 正控：ok 与 oracle 在全部探针上一致', () => {
    for (const t of PROBES) {
      const { hasPic, visibleLen } = round171Step2(t)
      expect(round171LenSkeleton(t, hasPic, visibleLen, 'ok')).toBe(round171OldBodyLen(t))
    }
  })

  it('D2 负控「忽略标志位、一律用 visibleLen」：占位符不在开头时必须偏差', () => {
    // 关键：占位符在**中部/尾部**时，`visibleLen`（去掉全部占位符）≠ 原逻辑（只剥开头那一个）
    const t = 'abc' + PIC
    const { hasPic, visibleLen } = round171Step2(t)
    expect(hasPic).toBe(true)
    expect(visibleLen).toBe(3)
    expect(round171OldBodyLen(t)).toBe(4)
    expect(round171LenSkeleton(t, hasPic, visibleLen, 'ignoreFlag')).not.toBe(round171OldBodyLen(t))
    // 对照：占位符恰在开头时两者相等 ⇒ 该情形对这条缺陷**零鉴别力**（故探针必须选非开头）
    const lead = PIC + 'abc'
    const s2 = round171Step2(lead)
    expect(round171LenSkeleton(lead, s2.hasPic, s2.visibleLen, 'ignoreFlag')).toBe(round171OldBodyLen(lead))
  })

  it('D3 负控「从不剥开头占位符」：以占位符开头时必须偏差', () => {
    const t = PIC + 'abc'
    const { hasPic, visibleLen } = round171Step2(t)
    expect(round171LenSkeleton(t, hasPic, visibleLen, 'neverStrip')).not.toBe(round171OldBodyLen(t))
  })

  it('D4 负控「剥掉全部占位符」：占位符在中部时必须偏差', () => {
    const t = 'abc' + PIC
    const { hasPic, visibleLen } = round171Step2(t)
    expect(round171LenSkeleton(t, hasPic, visibleLen, 'stripAll')).not.toBe(round171OldBodyLen(t))
  })

  it('D5 元断言：三个缺陷模式在探针上确有分歧点（护栏非空转）', () => {
    for (const mode of ['ignoreFlag', 'neverStrip', 'stripAll'] as LenMode[]) {
      const diffs = PROBES.filter((t) => {
        const { hasPic, visibleLen } = round171Step2(t)
        return round171LenSkeleton(t, hasPic, visibleLen, mode) !== round171OldBodyLen(t)
      })
      expect(diffs.length, mode).toBeGreaterThan(0)
    }
  })

  it('D6 行为保持型对照：标志位为 0 时两条路径长度相同（故输出测试抓不住回退）', () => {
    for (const t of ['plain', '', 'x'.repeat(300), '中文\u0007']) {
      const { hasPic, visibleLen } = round171Step2(t)
      expect(hasPic).toBe(false)
      expect(round171LenSkeleton(t, hasPic, visibleLen, 'ignoreFlag')).toBe(round171OldBodyLen(t))
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

describe('Round 171 C 组：接线元断言', () => {
  const SRC = fs.readFileSync(
    new URL('../src/utils/docparser/heuristics/paragraphFilter.ts', import.meta.url),
    'utf8'
  )
  const CODE = codeOnly(SRC)
  const C = compact(SRC)

  it('C1 标志位数组存在，且在 `includes` 为真的分支里被置位', () => {
    expect(CODE).toContain('const picFlags = new Uint8Array(paragraphs.length)')
    // 源码里写的是转义序列 `\u0001`（6 个字符），故断言串必须双写反斜杠
    expect(C).toContain("if (text.includes('\\u0001')) { picFlags[i] = 1")
    // `picFlags` 恰 3 处：声明 / 置位 / prefixBodyCounts 判断
    expect(CODE.split('picFlags').length - 1).toBe(3)
  })

  it('C2 `prefixBodyCounts` 已改读标志位，旧逐段 `startsWith` 形态消失', () => {
    expect(C).toContain('let bodyLen = visibleTextLengths[i]')
    expect(C).toContain('if (picFlags[i] !== 0) {')
    expect(C).not.toContain("let t = paragraphs[i].text; if (t.startsWith('\\u0001')) t = t.substring(1)")
    expect(CODE).toContain('prefixBodyCounts[i + 1] = prefixBodyCounts[i] + (bodyLen > LIST_ITEM_MAX_LEN ? 1 : 0)')
  })

  it('C3 剥开头占位符仍只剥一个，且用 charCodeAt 判首字符', () => {
    expect(C).toContain('bodyLen = (t.charCodeAt(0) === 1 ? t.substring(1) : t).length')
  })

  it('C4 `__hasEmbeddedPic` 置位与 `visibleTextLengths` 写入仍在（未被顺手删掉）', () => {
    expect(CODE).toContain('paragraphs[i].__hasEmbeddedPic = true')
    expect(CODE).toContain('visibleTextLengths[i] = len')
  })
})
