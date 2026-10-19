// Round 170 护栏：`createParagraphsWithRealFormats` 里 charFormat 的「样式基数推迟展开」。
//
// 背景（先量后改，27 份 × 20 轮计数插桩）：
//   * `entry.charHasKeys && hasRealCharFormat` 同时成立 —— **32,261/轮 = 95.7% 的段落**
//   * 该组合下平均键数：`resolved.charFormat` = **1.00**、`newPara.charFormat` = **2.01**、
//     `merged` = **1.14** ⇒ 剖析里那两行展开（2.03% + 1.53% = 3.56%）主要花在
//     **每次展开的固定开销**（新建对象 + 巨型 IC），不是键复制。
//
// 原实现对该组合展开**两次**：
//   ① `{ ...resolved.charFormat, ...newPara.charFormat }`（样式块）
//   ② `{ ...newPara.charFormat, ...merged }`（真实格式块）
// ② 的输入正是 ① 的输出 ⇒ ① 在最终结果里**完全被覆盖**，只贡献键序。
// Round 170 把样式基数**推迟**到 ② 里三源一次展开，省掉整整一次对象分配与展开。
//
// **等价性前提（本文件的核心）**：对象展开按「首次出现顺序」插入键、重复键保留首次位置
// ⇒ `{...a, ...b}` 之后再 `{...x, ...c}`，与 `{...a, ...b, ...c}` 的**键集合与键序完全相同**。
// A 组用穷举叉积（含键重叠、含 `styles` 键）把这条钉死。
//
// **注意（R164 通用教训 10）**：本改动是**行为保持型**——把两次展开改回一次（或反过来）
// 输出**逐字节不变**，任何「比输出」的测试都抓不住它被整体回退。因此本文件必须同时具备：
//   * A/B 组：决策差分 + 真实语料锚定（证明输出未变）；
//   * C 组：**源码文本元断言**（唯一能钉死改动生效的手段）；
//   * D 组：骨架负控（证明本文件对「展开写错」有鉴别力）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DocParser } from '../src/utils/docParser'
import type { CharacterFormat } from '../src/utils/docFormat'

// ══════════════════════════════════════════════════════════════════════════
// oracle：改动前（两次展开）与改动后（三源一次展开）
// ══════════════════════════════════════════════════════════════════════════

type Fmt = Partial<CharacterFormat> & Record<string, unknown>

/** 改动前：样式块先展开一次，真实格式块再展开一次。 */
function round170OldMerge(base: Fmt | undefined, orig: Fmt, merged: Fmt): Fmt {
  const step1: Fmt = { ...(base as Fmt), ...orig }
  return { ...step1, ...merged }
}

/** 改动后：样式基数非空时三源一次展开；为空时退回两源。 */
function round170NewMerge(base: Fmt | undefined, orig: Fmt, merged: Fmt): Fmt {
  return base
    ? { ...base, ...orig, ...merged }
    : { ...orig, ...merged }
}

/** 完整的合并后处理：`'styles' in` 时整键丢弃（生产同形）。 */
function round170DropStyles(o: Fmt): Fmt {
  if ('styles' in o) {
    const { styles: _s, ...rest } = o
    return rest as Fmt
  }
  return o
}

function round170Pipeline(base: Fmt | undefined, orig: Fmt, merged: Fmt, fused: boolean): Fmt {
  const m = fused ? round170NewMerge(base, orig, merged) : round170OldMerge(base, orig, merged)
  return round170DropStyles(m)
}

// ══════════════════════════════════════════════════════════════════════════
// A 组：决策差分（穷举形状 × 键重叠 × styles 键）
// ══════════════════════════════════════════════════════════════════════════

const BASE_SHAPES: Array<Fmt | undefined> = [
  undefined,
  {},
  { fontSize: 12 },
  { fontSize: 12, bold: true },
  { color: 'red', fontSize: 12 },
  { styles: ['base'] },
  { fontSize: 12, styles: ['base'], bold: true },
]

const ORIG_SHAPES: Fmt[] = [
  {},
  { fontSize: 10.5 },
  { fontSize: 10.5, bold: false },
  { bold: false, italic: true, underline: false },
  { styles: ['heur'] },
  { color: 'blue', fontSize: 10.5, styles: ['heur'] },
]

const MERGED_SHAPES: Fmt[] = [
  {},
  { bold: true },
  { fontSize: 14 },
  { fontSize: 14, color: 'green' },
  { styles: ['merged'] },
  { bold: true, italic: true, styles: ['merged'] },
]

describe('Round 170 A 组：决策差分', () => {
  it('A1 穷举「样式基数 × 启发式 × 真实格式」：键集合、键序、值与 oracle 完全一致', () => {
    let cases = 0
    for (const base of BASE_SHAPES) {
      for (const orig of ORIG_SHAPES) {
        for (const merged of MERGED_SHAPES) {
          const oldR = round170Pipeline(base, orig, merged, false)
          const newR = round170Pipeline(base, orig, merged, true)
          // 值 + 键序（JSON.stringify 保序）
          expect(JSON.stringify(newR)).toBe(JSON.stringify(oldR))
          // 键序单独再钉一次（防 JSON 序列化口径差异）
          expect(Object.keys(newR)).toEqual(Object.keys(oldR))
          cases++
        }
      }
    }
    expect(cases).toBe(BASE_SHAPES.length * ORIG_SHAPES.length * MERGED_SHAPES.length)
  })

  it('A2 键重叠三向扫：三源共享同一键时，最终值必须来自 merged（优先级不变）', () => {
    for (let n = 1; n <= 6; n++) {
      const base: Fmt = {}
      const orig: Fmt = {}
      const merged: Fmt = {}
      for (let k = 0; k < n; k++) {
        base[`k${k}`] = `base${k}`
        orig[`k${k}`] = `orig${k}`
        merged[`k${k}`] = `merged${k}`
      }
      const newR = round170Pipeline(base, orig, merged, true)
      expect(newR[`k${n - 1}`]).toBe(`merged${n - 1}`)
      expect(Object.keys(newR)).toEqual(Object.keys(round170Pipeline(base, orig, merged, false)))
    }
  })

  it('A3 键序「首次出现位置」：base 独有的键必须排在最前，merged 独有的键排在最后', () => {
    const newR = round170Pipeline({ onlyBase: 1 }, { onlyOrig: 2 }, { onlyMerged: 3 }, true)
    expect(Object.keys(newR)).toEqual(['onlyBase', 'onlyOrig', 'onlyMerged'])
    const oldR = round170Pipeline({ onlyBase: 1 }, { onlyOrig: 2 }, { onlyMerged: 3 }, false)
    expect(Object.keys(oldR)).toEqual(['onlyBase', 'onlyOrig', 'onlyMerged'])
  })

  it('A4 `styles` 键必须被整键丢弃（三源里任一来源带入都要丢）', () => {
    expect('styles' in round170Pipeline({ styles: ['b'] }, {}, {}, true)).toBe(false)
    expect('styles' in round170Pipeline(undefined, { styles: ['h'] }, {}, true)).toBe(false)
    expect('styles' in round170Pipeline(undefined, {}, { styles: ['m'] }, true)).toBe(false)
    // 丢弃后其它键必须原样保留
    const r = round170Pipeline({ styles: ['b'], fontSize: 12 }, { bold: true }, {}, true)
    expect(r).toEqual({ fontSize: 12, bold: true })
  })
})

// ══════════════════════════════════════════════════════════════════════════
// B 组：真实语料锚定（证明输出未变 + 融合路径确实被走到）
// ══════════════════════════════════════════════════════════════════════════

describe('Round 170 B 组：真实语料锚定', () => {
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

  it('B2 融合路径在真实语料上确实被走到（防止 B1 成为空转锚定）', () => {
    const docs = fileURLToPath(new URL('../docs/', import.meta.url))
    const files = fs.readdirSync(docs).filter((n) => /\.(doc|dot)$/.test(n)).sort()
    let realCf = 0
    let withStyleName = 0
    let cfKeysAtLeast2 = 0
    for (const f of files) {
      const b = fs.readFileSync(path.join(docs, f))
      const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
      const out = new DocParser(ab).parseWithFormat() as {
        document: { paragraphs: Array<{ charFormat?: Fmt; charFormatFromReal?: boolean; paraFormat?: { styleName?: string } }> }
      }
      for (const p of out.document.paragraphs) {
        if (p.charFormatFromReal) realCf++
        if (p.paraFormat && p.paraFormat.styleName) withStyleName++
        if (p.charFormatFromReal && Object.keys(p.charFormat || {}).length >= 2) cfKeysAtLeast2++
      }
    }
    // 真实语料锚定（单次解析 27 份）：charFormatFromReal 32,690、styleName 33,702
    expect(realCf).toBe(32690)
    expect(withStyleName).toBeGreaterThan(30000)
    // 融合路径要求「有真实格式 + 有样式 + charFormat 至少 2 键」，实测同为 32,690
    expect(cfKeysAtLeast2).toBeGreaterThan(30000)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// D 组：骨架负控鉴别力
// ══════════════════════════════════════════════════════════════════════════

type MergeMode = 'ok' | 'dropBase' | 'wrongOrder' | 'ignoreMerged' | 'twoStep'

/** 与生产同形的合并骨架，可逐一注错。 */
function round170MergeSkeleton(base: Fmt | undefined, orig: Fmt, merged: Fmt, mode: MergeMode): Fmt {
  if (mode === 'dropBase') return { ...orig, ...merged }
  if (mode === 'wrongOrder') return base ? { ...orig, ...base, ...merged } : { ...orig, ...merged }
  if (mode === 'ignoreMerged') return base ? { ...base, ...orig } : { ...orig }
  if (mode === 'twoStep') return round170OldMerge(base, orig, merged)
  return round170NewMerge(base, orig, merged)
}

describe('Round 170 D 组：骨架负控鉴别力', () => {
  const PROBES: Array<[Fmt | undefined, Fmt, Fmt]> = [
    [{ onlyBase: 1, shared: 'b' }, { onlyOrig: 2, shared: 'o' }, { onlyMerged: 3, shared: 'm' }],
    [undefined, { a: 1 }, { b: 2 }],
    [{ fontSize: 12 }, { fontSize: 10.5, bold: true }, { fontSize: 14 }],
  ]

  it('D1 正控：ok 与 oracle 在全部探针上一致', () => {
    for (const [b, o, m] of PROBES) {
      expect(JSON.stringify(round170MergeSkeleton(b, o, m, 'ok'))).toBe(JSON.stringify(round170NewMerge(b, o, m)))
    }
  })

  it('D2 负控「丢掉样式基数」：base 独有的键必须丢失', () => {
    const [b, o, m] = PROBES[0]
    const ok = round170MergeSkeleton(b, o, m, 'ok')
    const bad = round170MergeSkeleton(b, o, m, 'dropBase')
    expect(JSON.stringify(bad)).not.toBe(JSON.stringify(ok))
    expect(bad.onlyBase).toBeUndefined()
    expect(ok.onlyBase).toBe(1)
  })

  it('D3 负控「展开顺序颠倒」：值相同但键序必须不同', () => {
    const [b, o, m] = PROBES[0]
    const ok = round170MergeSkeleton(b, o, m, 'ok')
    const bad = round170MergeSkeleton(b, o, m, 'wrongOrder')
    expect(Object.keys(bad)).not.toEqual(Object.keys(ok))
    expect(Object.keys(ok)).toEqual(['onlyBase', 'shared', 'onlyOrig', 'onlyMerged'])
    expect(Object.keys(bad)).toEqual(['onlyOrig', 'shared', 'onlyBase', 'onlyMerged'])
  })

  it('D4 负控「丢掉真实格式」：merged 独有的键必须丢失', () => {
    const [b, o, m] = PROBES[0]
    const ok = round170MergeSkeleton(b, o, m, 'ok')
    const bad = round170MergeSkeleton(b, o, m, 'ignoreMerged')
    expect(JSON.stringify(bad)).not.toBe(JSON.stringify(ok))
    expect(bad.onlyMerged).toBeUndefined()
  })

  it('D5 行为保持型对照：两次展开（twoStep）与一次展开输出完全相同', () => {
    // 这正是 R164 教训 10：把改动整体回退，任何「比输出」的断言都抓不住。
    for (const [b, o, m] of PROBES) {
      expect(JSON.stringify(round170MergeSkeleton(b, o, m, 'twoStep'))).toBe(
        JSON.stringify(round170MergeSkeleton(b, o, m, 'ok'))
      )
    }
  })

  it('D6 元断言：三个缺陷模式在探针上确有分歧点（护栏非空转）', () => {
    for (const mode of ['dropBase', 'wrongOrder', 'ignoreMerged'] as MergeMode[]) {
      const diffs = PROBES.filter(([b, o, m]) => {
        const ok = JSON.stringify(round170MergeSkeleton(b, o, m, 'ok'))
        const bad = JSON.stringify(round170MergeSkeleton(b, o, m, mode))
        return bad !== ok
      })
      expect(diffs.length, mode).toBeGreaterThan(0)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════
// C 组：接线元断言（源码文本）
// ══════════════════════════════════════════════════════════════════════════

/** 去掉注释行，只留可执行文本（避免注释里的示例串造成假匹配）。 */
function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    })
    .join('\n')
}

/** 去掉注释并把连续空白折叠为单空格，用于抗缩进变动的结构断言。 */
function compact(src: string): string {
  return codeOnly(src).replace(/\s+/g, ' ').trim()
}

describe('Round 170 C 组：接线元断言', () => {
  const DOC = fs.readFileSync(new URL('../src/utils/docParser.ts', import.meta.url), 'utf8')
  const CODE = codeOnly(DOC)
  const C = compact(DOC)

  it('C1 推迟基数变量存在且恰好 4 处引用（声明 / 赋值 / 三元式条件 / 三元式取值）', () => {
    expect(CODE).toContain('let charStyleBase: Partial<CharacterFormat> | undefined')
    expect(CODE.split('charStyleBase').length - 1).toBe(4)
  })

  it('C2 样式块在 hasRealCharFormat 时推迟，否则保留原两次展开', () => {
    expect(C).toContain('if (entry.charHasKeys) { if (hasRealCharFormat) { charStyleBase = resolved.charFormat } else {')
    // 推迟分支里**不得**再给 newPara.charFormat 赋值（否则等于没推迟）
    expect(C).not.toContain('if (hasRealCharFormat) { charStyleBase = resolved.charFormat newPara.charFormat')
    // 非推迟分支必须仍做样式合并（源码此处带尾随逗号）
    expect(C).toContain('newPara.charFormat = { ...resolved.charFormat, ...newPara.charFormat, }')
  })

  it('C3 真实格式块的三源展开三元式存在，且 else 分支保留两源展开', () => {
    expect(C).toContain(
      'const realCharFormat = charStyleBase ? { ...charStyleBase, ...newPara.charFormat, ...merged } : { ...newPara.charFormat, ...merged }'
    )
    // 旧的两源展开**只剩**三元式的 else 一支（不得再出现独立的第二次展开）
    expect(CODE.split('{ ...newPara.charFormat, ...merged }').length - 1).toBe(1)
  })

  it('C4 styles 丢弃守卫与 charFormatFromReal 标记仍在', () => {
    expect(CODE).toContain("if ('styles' in realCharFormat) {")
    expect(CODE).toContain('newPara.charFormatFromReal = true')
  })

  it('C5 推迟基数只用于 charFormat（paraFormat 的展开保持原样）', () => {
    expect(CODE).not.toContain('charStyleBase.paraFormat')
    // 段落样式合并处只有一处 `...resolved.paraFormat,`（另一处展开的是 `...papx.format`）
    expect(CODE.split('...resolved.paraFormat,').length - 1).toBe(1)
  })
})
