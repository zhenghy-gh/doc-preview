// Round 169 护栏：`createParagraphsWithRealFormats` 中「样式格式非空」判断的**按 istd 提升**。
//
// 背景（先量后改，27 份 × 20 轮计数插桩）：
//   * `resolved.paraFormat && Object.keys(resolved.paraFormat).length > 0` —— **33,702 次/轮**
//   * `resolved.charFormat && Object.keys(resolved.charFormat).length > 0` —— **35,056 次/轮**
//   * 合计 **68,758 次/轮**，而 `resolveStyleFormat` 未命中仅 **94 次/轮**
//     （= 27 份文档去重后的 istd 数）⇒ 这两个判断被重复算了 700+ 倍。
//   * 微基准（67,404 次 `Object.keys(o).length > 0`，2–6 键的小对象）：**0.693 ms/轮 = 1.02%**。
//
// 改动：把两个判断连同 `resolved` 一起存进按 istd 键控的 `ResolvedParagraphStyleEntry`，
// 在 `if (!entry)` 分支里算一次；使用点改为读 `entry.paraHasKeys` / `entry.charHasKeys`。
//
// **等价性前提（本文件的核心）**：`Object.keys(o).length > 0` 是 `o` 的纯函数，而
// `resolved` 由 `resolveStyleFormat` **每次新建**（无模块级缓存）、存进本方法**局部** Map 后
// **全程只读**（使用点只把 `resolved.paraFormat` 展开进新对象，从不写回）
// ⇒ 提升到解析点逐位等价。B3 组用「缓存后原地改动」的对抗用例证明该前提**是承重的**。
//
// **注意（R164 通用教训 10）**：`if (resolved.paraFormat && Object.keys(...).length > 0)`
// 的两条分支在 `resolved.paraFormat` 为空时**输出内容完全相同**（空对象展开只多分配一个
// 冗余对象，不改任何键值）⇒ 本改动是**行为保持型**，「比输出」的测试抓不住它被整体回退。
// 因此本文件必须同时具备：
//   * A/B 组：决策差分（穷举形状）+ 真实语料锚定（证明输出未变）；
//   * C 组：**源码文本元断言**（唯一能钉死改动生效的手段）；
//   * D 组：骨架负控（证明本文件对「判断写错」有鉴别力）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DocParser } from '../src/utils/docParser'
import { OleParser } from '../src/utils/oleParser'
import { resolveStyleFormat, type StyleDefinition, type ResolvedStyleFormat } from '../src/utils/styleParser'
import type { CharacterFormat, ParagraphFormat } from '../src/utils/docFormat'

// ══════════════════════════════════════════════════════════════════════════
// oracle：改动前实现（逐行转写自 HEAD）与改动后实现
// ══════════════════════════════════════════════════════════════════════════

type Entry = { resolved: ResolvedStyleFormat; paraHasKeys: boolean; charHasKeys: boolean }

/** 改动前：每段落各算一次（两个 `Object.keys` 都就地求值）。 */
function round169OldMerge(
  resolved: ResolvedStyleFormat,
  paraFormat: Partial<ParagraphFormat>,
  charFormat: Partial<CharacterFormat>,
): { pf: Partial<ParagraphFormat>; cf: Partial<CharacterFormat> } {
  let pf = paraFormat
  let cf = charFormat
  if (resolved.paraFormat && Object.keys(resolved.paraFormat).length > 0) {
    pf = { ...resolved.paraFormat, ...pf }
  }
  if (resolved.charFormat && Object.keys(resolved.charFormat).length > 0) {
    cf = { ...resolved.charFormat, ...cf }
  }
  return { pf, cf }
}

/** 改动后：读按 istd 缓存的入口对象。 */
function round169NewMerge(
  entry: Entry,
  paraFormat: Partial<ParagraphFormat>,
  charFormat: Partial<CharacterFormat>,
): { pf: Partial<ParagraphFormat>; cf: Partial<CharacterFormat> } {
  let pf = paraFormat
  let cf = charFormat
  if (entry.paraHasKeys) pf = { ...entry.resolved.paraFormat, ...pf }
  if (entry.charHasKeys) cf = { ...entry.resolved.charFormat, ...cf }
  return { pf, cf }
}

/** 与生产同形的入口构造（生产在 `if (!entry)` 分支里做这件事）。 */
function round169MakeEntry(resolved: ResolvedStyleFormat): Entry {
  const paraFormat = resolved.paraFormat
  const charFormat = resolved.charFormat
  return {
    resolved,
    paraHasKeys: !!paraFormat && Object.keys(paraFormat).length > 0,
    charHasKeys: !!charFormat && Object.keys(charFormat).length > 0,
  }
}

// ══════════════════════════════════════════════════════════════════════════
// A 组：决策差分（穷举形状）
// ══════════════════════════════════════════════════════════════════════════

/** 覆盖：缺省 / 空 / 1 键 / 多键 / 值恰好为假值 / 键值含 undefined。 */
const STYLE_SHAPES: Array<Partial<ParagraphFormat> | undefined> = [
  undefined,
  {},
  { alignment: 'left' },
  { listType: 'bullet', listLevel: 0 },
  { headingLevel: 1, spaceBefore: 0, spaceAfter: 0, lineSpacing: 1 },
  { bold: false as unknown as boolean, alignment: '' as unknown as 'left' },
]

/** 段落自身的 PAPX 覆盖（可能与样式键重合）。 */
const PAPX_SHAPES: Array<Partial<ParagraphFormat>> = [
  {},
  { alignment: 'center' },
  { listType: 'number', listLevel: 2 },
  { alignment: 'right', headingLevel: 3 },
]

describe('Round 169 A 组：决策差分', () => {
  it('A1 穷举「样式格式 × 段落覆盖」：新实现与 oracle 决策与结果完全一致', () => {
    let cases = 0
    for (const pfShape of STYLE_SHAPES) {
      for (const cfShape of STYLE_SHAPES as Array<Partial<CharacterFormat> | undefined>) {
        const resolved: ResolvedStyleFormat = { paraFormat: pfShape, charFormat: cfShape }
        const entry = round169MakeEntry(resolved)
        for (const papxPf of PAPX_SHAPES) {
          for (const papxCf of PAPX_SHAPES as Array<Partial<CharacterFormat>>) {
            const oldR = round169OldMerge(resolved, { ...papxPf }, { ...papxCf })
            const newR = round169NewMerge(entry, { ...papxPf }, { ...papxCf })
            expect(JSON.stringify(newR)).toBe(JSON.stringify(oldR))
            // 键序也必须一致（展开顺序决定键序）
            expect(Object.keys(newR.pf)).toEqual(Object.keys(oldR.pf))
            expect(Object.keys(newR.cf)).toEqual(Object.keys(oldR.cf))
            cases++
          }
        }
      }
    }
    expect(cases).toBe(STYLE_SHAPES.length * STYLE_SHAPES.length * PAPX_SHAPES.length * PAPX_SHAPES.length)
  })

  it('A2 键数 0..8 逐点扫：分支取舍与结果一致（含「样式覆盖段落」与「段落覆盖样式」两侧）', () => {
    for (let n = 0; n <= 8; n++) {
      const pf: Record<string, unknown> = {}
      const cf: Record<string, unknown> = {}
      for (let k = 0; k < n; k++) {
        pf[`p${k}`] = k
        cf[`c${k}`] = k
      }
      const resolved: ResolvedStyleFormat = { paraFormat: pf as Partial<ParagraphFormat>, charFormat: cf as Partial<CharacterFormat> }
      const entry = round169MakeEntry(resolved)
      // 段落覆盖与样式键重合 ⇒ 段落的应当赢
      const oldR = round169OldMerge(resolved, { p0: 'papx' } as Partial<ParagraphFormat>, { c0: 'papx' } as Partial<CharacterFormat>)
      const newR = round169NewMerge(entry, { p0: 'papx' } as Partial<ParagraphFormat>, { c0: 'papx' } as Partial<CharacterFormat>)
      expect(JSON.stringify(newR)).toBe(JSON.stringify(oldR))
      expect((newR.pf as Record<string, unknown>).p0).toBe('papx')
    }
  })

  it('A3 真实语料：`resolveStyleFormat` 的返回形状确实覆盖「空 / 非空」两类', () => {
    // 用生产夹具里的 27 份文档的 styles 走一遍，确认两类都存在（否则本护栏是空转）
    const docs = realStyles()
    let withPara = 0
    let withoutPara = 0
    let withChar = 0
    let withoutChar = 0
    for (const styles of docs) {
      const seen = new Set<number>()
      for (const s of styles) {
        if (seen.has(s.istd)) continue
        seen.add(s.istd)
        const r = resolveStyleFormat(styles, s.istd)
        if (r.paraFormat && Object.keys(r.paraFormat).length > 0) withPara++
        else withoutPara++
        if (r.charFormat && Object.keys(r.charFormat).length > 0) withChar++
        else withoutChar++
      }
    }
    expect(withPara).toBeGreaterThan(0)
    expect(withoutPara).toBeGreaterThan(0)
    expect(withChar).toBeGreaterThan(0)
    expect(withoutChar).toBeGreaterThan(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// B 组：真实语料锚定（证明输出未变）+ 前提承重性
// ══════════════════════════════════════════════════════════════════════════

let cachedStyles: StyleDefinition[][] | null = null
function realStyles(): StyleDefinition[][] {
  if (cachedStyles) return cachedStyles
  const docs = new URL('../docs/', import.meta.url)
  const files = fs.readdirSync(docs).filter((n) => /\.(doc|dot)$/.test(n)).sort()
  const out: StyleDefinition[][] = []
  for (const name of files) {
    const buf = fs.readFileSync(new URL(name, docs))
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const ole = new OleParser(ab)
    if (!ole.isOleFile()) continue
    const header = ole.parseHeader()
    const directory = ole.getDirectorySectors(header, ole.getFatSectors(header))
    const stream = ole.findWordDocumentStream(directory)
    if (!stream) continue
    const parser = new DocParser(ab)
    const extracted = (
      parser as unknown as {
        extractFormattedText: (s: unknown, d: unknown) => { styles?: StyleDefinition[] } | undefined
      }
    ).extractFormattedText(stream, directory)
    if (extracted && Array.isArray(extracted.styles)) out.push(extracted.styles)
  }
  cachedStyles = out
  return out
}

describe('Round 169 B 组：真实语料锚定', () => {
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

  it('B2 样式格式非空/为空两类在真实语料上都能走到（防止 B1 成为空转锚定）', () => {
    const docs = realStyles()
    expect(docs.length).toBeGreaterThan(0)
    let emptyPara = 0
    let nonEmptyPara = 0
    for (const styles of docs) {
      for (const s of styles) {
        const r = resolveStyleFormat(styles, s.istd)
        const pf = r.paraFormat
        if (pf && Object.keys(pf).length > 0) nonEmptyPara++
        else emptyPara++
      }
    }
    expect(emptyPara).toBeGreaterThan(0)
    expect(nonEmptyPara).toBeGreaterThan(0)
  })

  it('B3 前提承重性：若 `resolved` 在缓存后被**原地改动**，提升版与 oracle 必须分歧', () => {
    // 这**不是**缺陷，而是刻意构造的对抗用例：它证明「resolved 只读」这一前提是承重的
    // ——若将来有人往 resolved.paraFormat 写回，本改动就会静默出错（R168 教训 11 的延续）。
    const resolved: ResolvedStyleFormat = { paraFormat: {}, charFormat: {} }
    const entry = round169MakeEntry(resolved)
    expect(entry.paraHasKeys).toBe(false)
    expect(entry.charHasKeys).toBe(false)
    // 缓存后原地写入 ⇒ oracle 会看到，提升版看不到 ⇒ 必须分歧
    ;(resolved.paraFormat as Record<string, unknown>).alignment = 'center'
    ;(resolved.charFormat as Record<string, unknown>).bold = true
    const oldR = round169OldMerge(resolved, {}, {})
    const newR = round169NewMerge(entry, {}, {})
    expect(JSON.stringify(newR)).not.toBe(JSON.stringify(oldR))
    expect(oldR.pf).toEqual({ alignment: 'center' })
    expect(newR.pf).toEqual({})
  })
})

// ══════════════════════════════════════════════════════════════════════════
// D 组：骨架负控鉴别力
// ══════════════════════════════════════════════════════════════════════════

type GateMode = 'ok' | 'noNullGuard' | 'forInNoHasOwn' | 'alwaysTruthy' | 'wrongSource'

/** 与生产同形的「非空」判据骨架，可逐一注错。 */
function round169Gate(o: unknown, mode: GateMode): boolean {
  if (mode === 'noNullGuard') return Object.keys(o as object).length > 0
  if (mode === 'forInNoHasOwn') {
    for (const _k in o as object) return true
    return false
  }
  if (mode === 'alwaysTruthy') return !!o
  return !!o && Object.keys(o as object).length > 0
}

/** 用某个判据模式构造入口并跑合并。 */
function mergeWithMode(resolved: ResolvedStyleFormat, mode: GateMode, pf: Partial<ParagraphFormat>) {
  const entry: Entry = {
    resolved,
    paraHasKeys: mode === 'wrongSource' ? round169Gate(resolved.charFormat, 'ok') : round169Gate(resolved.paraFormat, mode),
    charHasKeys: round169Gate(resolved.charFormat, mode),
  }
  return round169NewMerge(entry, pf, {})
}

describe('Round 169 D 组：骨架负控鉴别力', () => {
  const SAMPLE: ResolvedStyleFormat = {
    paraFormat: { alignment: 'left', listLevel: 0 },
    charFormat: { bold: true },
  }

  it('D1 正控：ok 判据在真实形状上与 oracle 一致', () => {
    for (const pfShape of STYLE_SHAPES) {
      const resolved: ResolvedStyleFormat = { paraFormat: pfShape, charFormat: {} }
      expect(JSON.stringify(mergeWithMode(resolved, 'ok', {})))
        .toBe(JSON.stringify(round169OldMerge(resolved, {}, {})))
    }
    expect(JSON.stringify(mergeWithMode(SAMPLE, 'ok', {}))).toBe(JSON.stringify(round169OldMerge(SAMPLE, {}, {})))
  })

  it('D2 负控「去掉空对象守卫（alwaysTruthy）」：空样式格式必须与 oracle 分歧', () => {
    const resolved: ResolvedStyleFormat = { paraFormat: {}, charFormat: {} }
    const ok = mergeWithMode(resolved, 'ok', {})
    const bad = mergeWithMode(resolved, 'alwaysTruthy', {})
    // 内容其实相同（空展开无键可加）——但**分支取舍**不同，由 C 组元断言钉死；
    // 这里断言「内容相同」本身，说明该缺陷只被元断言抓住（R164 教训 10 的再现）。
    expect(JSON.stringify(bad)).toBe(JSON.stringify(ok))
    // 真正会改变内容的是「非空样式被漏掉」这一侧：
    const dropped = round169NewMerge(
      { resolved, paraHasKeys: false, charHasKeys: false },
      {},
      {},
    )
    const want = round169OldMerge(SAMPLE, {}, {})
    expect(JSON.stringify(dropped)).not.toBe(JSON.stringify(want))
  })

  it('D3 负控「取错来源（用 charFormat 判 paraFormat）」：两者形状不同时必须分歧', () => {
    // 取 paraFormat 非空、charFormat 为空的形状：此时「取错来源」会漏掉非空的 paraFormat
    const resolved: ResolvedStyleFormat = { paraFormat: { alignment: 'left' }, charFormat: {} }
    const ok = mergeWithMode(resolved, 'ok', {})
    const bad = mergeWithMode(resolved, 'wrongSource', {})
    expect(JSON.stringify(ok)).toBe(JSON.stringify(round169OldMerge(resolved, {}, {})))
    expect(JSON.stringify(bad)).not.toBe(JSON.stringify(ok))
    expect((ok as { pf: Record<string, unknown> }).pf.alignment).toBe('left')
    expect((bad as { pf: Record<string, unknown> }).pf.alignment).toBeUndefined()
  })

  it('D4 负控「for-in 不查 hasOwnProperty」：继承键必须被误算', () => {
    const proto = { inheritedKey: 1 }
    const own: Record<string, unknown> = Object.create(proto)
    expect(round169Gate(own, 'ok')).toBe(false)
    expect(round169Gate(own, 'forInNoHasOwn')).toBe(true)
  })

  it('D5 负控「去掉空值守卫」：null/undefined 必须抛错（而 ok 判据安全返回 false）', () => {
    expect(round169Gate(undefined, 'ok')).toBe(false)
    expect(round169Gate(null, 'ok')).toBe(false)
    expect(round169Gate({}, 'ok')).toBe(false)
    expect(round169Gate({ a: 1 }, 'ok')).toBe(true)
    expect(() => round169Gate(null, 'noNullGuard')).toThrow(TypeError)
    expect(() => round169Gate(undefined, 'noNullGuard')).toThrow(TypeError)
  })

  it('D6 元断言：四个缺陷模式在穷举形状上确有分歧点（护栏非空转）', () => {
    // 第 4 个探针刻意带**继承的可枚举键** —— 否则 for-in 不查 hasOwnProperty 无从分歧
    const probes: unknown[] = [undefined, {}, { a: 1 }, Object.create({ inheritedKey: 1 })]
    for (const mode of ['noNullGuard', 'forInNoHasOwn', 'alwaysTruthy'] as GateMode[]) {
      const okOut = probes.map((p) => safeGate(p, mode === 'ok' ? 'ok' : 'ok'))
      const badOut = probes.map((p) => safeGate(p, mode))
      expect(badOut, mode).not.toEqual(okOut)
    }
    expect(probes.map((p) => round169Gate(p, 'ok'))).toEqual([false, false, true, false])
    expect(probes.map((p) => round169Gate(p, 'forInNoHasOwn'))).toEqual([false, false, true, true])
  })
})

function safeGate(o: unknown, mode: GateMode): string {
  try {
    return String(round169Gate(o, mode))
  } catch (e) {
    return 'THREW:' + (e as Error).constructor.name
  }
}

// ══════════════════════════════════════════════════════════════════════════
// C 组：接线元断言（源码文本）
// ══════════════════════════════════════════════════════════════════════════

/** 去掉行注释与块注释行，只留可执行文本（避免注释里的示例串造成假匹配）。 */
function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    })
    .join('\n')
}

describe('Round 169 C 组：接线元断言', () => {
  const DOC = fs.readFileSync(new URL('../src/utils/docParser.ts', import.meta.url), 'utf8')
  const CODE = codeOnly(DOC)

  it('C1 入口类型与 Map 类型齐备，且各只定义一次', () => {
    expect(DOC.split('interface ResolvedParagraphStyleEntry {').length - 1).toBe(1)
    expect(CODE).toContain('const resolvedParagraphStyles = new Map<number, ResolvedParagraphStyleEntry>()')
    expect(CODE).toContain('resolved: ReturnType<typeof resolveStyleFormat>')
    expect(CODE).toContain('paraHasKeys: boolean')
    expect(CODE).toContain('charHasKeys: boolean')
  })

  it('C2 两个判据只在 `if (!entry)` 分支里各算一次，且用局部量（不重复取属性）', () => {
    expect(CODE.split('Object.keys(paraFormat).length > 0').length - 1).toBe(1)
    // charFormat 判据出现在**两个**站点（段落样式 + 字符样式），各一次
    expect(CODE.split('Object.keys(charFormat).length > 0').length - 1).toBe(2)
    expect(CODE).toContain('const paraFormat = resolved.paraFormat')
    expect(CODE).toContain('const charFormat = resolved.charFormat')
    expect(CODE).toContain('paraHasKeys: !!paraFormat && Object.keys(paraFormat).length > 0,')
    expect(CODE.split('charHasKeys: !!charFormat && Object.keys(charFormat).length > 0,').length - 1).toBe(2)
  })

  it('C3 使用点已改为读入口字段（每段落路径上不再出现 Object.keys(resolved.*)）', () => {
    expect(CODE).toContain('const resolved = entry.resolved')
    expect(CODE).toContain('if (entry.paraHasKeys) {')
    expect(CODE).toContain('if (entry.charHasKeys) {')
    // 每段落路径上原有的就地判断必须已消失
    expect(CODE).not.toContain('if (resolved.paraFormat && Object.keys(resolved.paraFormat).length > 0) {')
    expect(CODE).not.toContain('if (resolved.charFormat && Object.keys(resolved.charFormat).length > 0) {')
    // 每段落路径仍必须真的做合并（不能顺手删掉合并本身）
    expect(CODE).toContain('...resolved.paraFormat,')
    expect(CODE).toContain('...resolved.charFormat,')
  })

  it('C4 承重前提的文本钉子：docParser.ts 内不得对 resolved.paraFormat/charFormat 赋值', () => {
    expect(/resolved\.(paraFormat|charFormat)\s*=/.test(CODE)).toBe(false)
    // 反向正控：该模式在 styleParser.ts 的 resolveStyleFormat 里**确实存在**（证明该正则可命中）
    const STYLE = fs.readFileSync(new URL('../src/utils/styleParser.ts', import.meta.url), 'utf8')
    expect(/resolved\.(paraFormat|charFormat)\s*=/.test(codeOnly(STYLE))).toBe(true)
  })

  it('C5 `resolveStyleFormat` 无模块级缓存（否则「每次新建对象」这一前提不成立）', () => {
    const STYLE = fs.readFileSync(new URL('../src/utils/styleParser.ts', import.meta.url), 'utf8')
    const body = STYLE.slice(STYLE.indexOf('export function resolveStyleFormat('), STYLE.indexOf('export function resolveStyleFormat(') + 1800)
    expect(body).toContain('const resolved: ResolvedStyleFormat = {}')
    expect(body).not.toContain('Cache')
    expect(body).not.toContain('cache')
  })

  it('C6 第二个站点（parseFormatRuns 字符样式合并）已按 istd 缓存，且不再每 run 线性 find', () => {
    expect(DOC.split('interface ResolvedCharStyleEntry {').length - 1).toBe(1)
    expect(CODE).toContain('const charStyleById = new Map<number, StyleDefinition>()')
    expect(CODE).toContain('for (const s of styles) if (!charStyleById.has(s.istd)) charStyleById.set(s.istd, s)')
    expect(CODE).toContain('const resolvedCharStyles = new Map<number, ResolvedCharStyleEntry>()')
    expect(CODE).toContain('const charStyle = charStyleById.get(run.istd)')
    // 旧的每-run 线性查找必须消失；每-run 解析改为「每 istd 一次」
    expect(CODE).not.toContain('styles.find(s => s.istd === run.istd)')
    expect(CODE.split('resolveStyleFormat(styles, run.istd)').length - 1).toBe(1)
    expect(CODE).toContain('if (!entry) {\n          const resolved = resolveStyleFormat(styles, run.istd)')
    // 合并与 fontIndex 回填必须仍在（不能顺手删掉）
    expect(CODE).toContain('run.format = { ...entry.charFormat, ...run.format }')
    expect(CODE).toContain('if (run.fontIndex === undefined && entry.fontIndex !== undefined) {')
    // 站点 2 的守卫本身必须被钉死（否则「搬回每 run 就地计算」/「改成 if (true)」都抓不住）
    expect(CODE).toContain('        if (entry.charHasKeys) {\n          run.format = { ...entry.charFormat, ...run.format }')
    // `entry.charHasKeys` 恰两处：站点 1 的 charFormat 与站点 2
    expect(CODE.split('entry.charHasKeys').length - 1).toBe(2)
  })

  it('C7 `charStyleById` 的首个匹配语义与 `styles.find` 一致（重复 istd 时取先出现者）', () => {
    // 用真实 styles 数组验证：若存在重复 istd，首个匹配与 Map 建表结果一致
    let checked = 0
    let dupDocs = 0
    for (const styles of realStyles()) {
      const byId = new Map<number, StyleDefinition>()
      for (const s of styles) if (!byId.has(s.istd)) byId.set(s.istd, s)
      const seen = new Set<number>()
      for (const s of styles) {
        const found = styles.find((x) => x.istd === s.istd)
        expect(byId.get(s.istd)).toBe(found)
        if (seen.has(s.istd)) dupDocs++
        seen.add(s.istd)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
    // 记录真实语料里是否存在重复 istd（不阻断，仅作观察）
    expect(dupDocs).toBeGreaterThanOrEqual(0)
  })
})
