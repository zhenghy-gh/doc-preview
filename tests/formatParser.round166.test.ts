// Round 166 护栏：两处「顺序游标」——`mergeCharFormatForParagraph` 的 runs 下界
// 查询，以及 `createParagraphsWithRealFormats` 的 papx run 包含查询。
//
// 背景（先量后改）：
//   * `mergeCharFormatForParagraph` 实测 **33,702 次/轮**（= 段落数），每次在
//     `runs` 上二分求「首个 `cpEnd > cpStart` 的下标」，**276,405 次迭代/轮**；
//   * papx 包含查询实测 **33,702 次/轮**、**429,089 次迭代/轮**（均 12.73 步/次）。
//   两者合计 **705,494 次二分迭代/轮**。调用方都按文档序逐段处理 ⇒ 查询键
//   （`cpStart` / `markCp`）**单调不减**，且 runs 已升序、互不重叠 ⇒ 上次的
//   下界/命中下标就是本次的合法下界 ⇒ 可加「顺序提示 + 有界线性前推」。
//
// 本文件守住四件事：
//
//   1. **原语等价**：新实现与改动前实现（本文件内逐行转写的
//      `refMergeCharFormatForParagraph` / `refFindPapxRunContaining`）在**任意**
//      调用序列上逐项相同——含回退式查询、跨数组身份、乱序随机访问、空数组、
//      首尾边界。**提示只抬高起点，其合法性由「hintLo 是上次查询的首个合法下界」
//      自证**，故即使调用方乱序，也只会退回全量二分而不会算错；本组正是钉住这点。
//   2. **真实语料上的差分**：27 份真实 DOC/DOT 经 `parseWithFormat()` 取出的
//      `chpxRuns` / `papxRuns`，在单调与随机两种访问序下与 oracle 逐项相同。
//   3. **鉴别力**：故意改错的骨架负控必须与 oracle 不同（缺回退守卫 / 缺数组身份
//      守卫 / 缺包含性确认），且**行为保持型回退（去掉提示写回）必须仍与 oracle
//      相同**——用以说明「行为保持型改动任何比输出的测试都抓不住」（Round164 通用
//      教训 10），只能靠第 4 组源码文本断言守住。
//   4. **接线元断言**：提示常量、守卫、写回次数与查询收口，只能靠源码文本断言守住。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { DocParser } from '../src/utils/docParser'
import { OleParser } from '../src/utils/oleParser'
import {
  mergeCharFormatForParagraph,
  findPapxRunContaining,
  type ChpxRun,
  type PapxRun,
} from '../src/utils/formatParser'
import type { CharacterFormat } from '../src/utils/docFormat'

// ── oracle 1：改动前 `mergeCharFormatForParagraph`（下界为纯二分） ─────────────
//
// 共享的「合并正文」逐行转写（`lo` 由调用方给出），供 oracle 与骨架复用。
function mergeBody(
  runs: ChpxRun[],
  cpStart: number,
  cpEnd: number,
  fontNames: string[] | undefined,
  styleFormats: ReadonlyMap<number, Partial<CharacterFormat>> | undefined,
  lo: number,
): Partial<CharacterFormat> {
  const totalChars = cpEnd - cpStart
  let boldCount = 0
  let italicCount = 0
  let underlineCount = 0
  let strikethroughCount = 0
  let superscriptCount = 0
  let subscriptCount = 0
  let smallCapsCount = 0
  let allCapsCount = 0
  let fontSizeSum = 0
  let fontSizeCount = 0
  let firstColor: string | undefined
  let firstHighlight: string | undefined
  let firstFontName: string | undefined

  for (let ri = lo; ri < runs.length; ri++) {
    const run = runs[ri]
    if (run.cpStart >= cpEnd) break
    const overlapStart = run.cpStart > cpStart ? run.cpStart : cpStart
    const overlapEnd = run.cpEnd < cpEnd ? run.cpEnd : cpEnd
    if (overlapEnd <= overlapStart) continue
    const len = overlapEnd - overlapStart
    const styleFormat = run.istd !== undefined ? styleFormats?.get(run.istd) : undefined
    const format = styleFormat ? { ...styleFormat, ...run.format } : run.format
    if (format.bold) boldCount += len
    if (format.italic) italicCount += len
    if (format.underline) underlineCount += len
    if (format.strikethrough) strikethroughCount += len
    if (format.superscript) superscriptCount += len
    if (format.subscript) subscriptCount += len
    if (format.smallCaps) smallCapsCount += len
    if (format.allCaps) allCapsCount += len
    if (format.fontSize !== undefined) {
      fontSizeSum += format.fontSize * len
      fontSizeCount += len
    }
    if (format.color && !firstColor) firstColor = format.color
    if (format.highlight && !firstHighlight) firstHighlight = format.highlight
    if (run.fontIndex !== undefined && fontNames && !firstFontName) {
      const fontName = fontNames[run.fontIndex]
      if (fontName) firstFontName = fontName
    }
    if (!firstFontName && format.fontName) firstFontName = format.fontName
  }

  const result: Partial<CharacterFormat> = {}
  if (boldCount > totalChars * 0.5) result.bold = true
  if (italicCount > totalChars * 0.3) result.italic = true
  if (underlineCount > totalChars * 0.3) result.underline = true
  if (strikethroughCount > totalChars * 0.3) result.strikethrough = true
  if (superscriptCount > totalChars * 0.3) result.superscript = true
  if (subscriptCount > totalChars * 0.3) result.subscript = true
  if (smallCapsCount > totalChars * 0.5) result.smallCaps = true
  if (allCapsCount > totalChars * 0.5) result.allCaps = true
  if (fontSizeCount > totalChars * 0.5 && fontSizeCount > 0) {
    result.fontSize = Math.round(fontSizeSum / fontSizeCount)
  }
  if (firstColor) result.color = firstColor
  if (firstHighlight) result.highlight = firstHighlight
  if (firstFontName) result.fontName = firstFontName
  return result
}

function refMergeCharFormatForParagraph(
  runs: ChpxRun[],
  cpStart: number,
  cpEnd: number,
  fontNames?: string[],
  styleFormats?: ReadonlyMap<number, Partial<CharacterFormat>>,
): Partial<CharacterFormat> {
  const totalChars = cpEnd - cpStart
  if (totalChars <= 0 || runs.length === 0) return {}
  let lo = 0
  let hi = runs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (runs[mid].cpEnd > cpStart) hi = mid
    else lo = mid + 1
  }
  return mergeBody(runs, cpStart, cpEnd, fontNames, styleFormats, lo)
}

// ── oracle 2：改动前 papx 包含查询（[0, n-1] 上二分，返回包含 run 的下标） ────

function refFindPapxRunContaining(papxRuns: PapxRun[], markCp: number): number {
  let lo = 0
  let hi = papxRuns.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const run = papxRuns[mid]
    if (run.cpEnd <= markCp) lo = mid + 1
    else if (run.cpStart > markCp) hi = mid - 1
    else return mid
  }
  return -1
}

// ── 语料 ─────────────────────────────────────────────

interface DocRuns {
  name: string
  chpxRuns: ChpxRun[]
  papxRuns: PapxRun[]
}

let cachedDocs: DocRuns[] | null = null

/** 27 份真实 DOC/DOT 经生产路径取出的 chpxRuns / papxRuns。 */
function realDocs(): DocRuns[] {
  if (cachedDocs) return cachedDocs
  const docs = new URL('../docs/', import.meta.url)
  const files = fs.readdirSync(docs).filter((n) => /\.(doc|dot)$/.test(n)).sort()
  const out: DocRuns[] = []
  for (const name of files) {
    const buf = fs.readFileSync(new URL(name, docs))
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const ole = new OleParser(ab)
    if (!ole.isOleFile()) continue
    const header = ole.parseHeader()
    const directory = ole.getDirectorySectors(header, ole.getFatSectors(header))
    const stream = ole.findWordDocumentStream(directory)
    if (!stream) continue
    // `parseWithFormat()` 的公开返回不含 runs（只有 paragraphs/stories/…）；runs 由
    // 内部的 `extractFormattedText` 产出。这里经类型断言取真实 runs，用于差分——
    // 若该方法被改名，本护栏会立即失败（这本身也是对生产 API 的接线断言）。
    const parser = new DocParser(ab)
    const extracted = (
      parser as unknown as {
        extractFormattedText: (
          s: unknown,
          d: unknown,
        ) => { chpxRuns?: ChpxRun[]; papxRuns?: PapxRun[] } | undefined
      }
    ).extractFormattedText(stream, directory)
    if (!extracted || !Array.isArray(extracted.chpxRuns) || !Array.isArray(extracted.papxRuns)) {
      continue
    }
    out.push({ name, chpxRuns: extracted.chpxRuns, papxRuns: extracted.papxRuns })
  }
  cachedDocs = out
  return out
}

/** 从真实 runs 收集 istd 值，构造一个小样式表以驱动 `styleFormats.get` 分支。 */
function styleMapFor(runs: ChpxRun[]): Map<number, Partial<CharacterFormat>> {
  const m = new Map<number, Partial<CharacterFormat>>()
  for (const r of runs) {
    if (r.istd !== undefined && !m.has(r.istd)) {
      m.set(r.istd, r.istd % 2 === 0 ? { bold: true, fontSize: 12 } : { italic: true })
    }
  }
  return m
}

function makeRnd(seed: number) {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
}

/** 手工构造的定长 runs：已知 cpStart/cpEnd，含间隔（gap）与相邻（contiguous）。 */
function sampleChpxRuns(): ChpxRun[] {
  return [
    { cpStart: 0, cpEnd: 4, format: { bold: true }, fontIndex: 0, istd: 0 },
    { cpStart: 4, cpEnd: 8, format: { italic: true } },
    { cpStart: 10, cpEnd: 14, format: { underline: true }, istd: 2 }, // 8..10 是 gap
    { cpStart: 14, cpEnd: 20, format: { fontSize: 20, color: 'FF0000' } },
    { cpStart: 30, cpEnd: 33, format: {} }, // 20..30 是 gap
  ]
}

function samplePapxRuns(): PapxRun[] {
  return [
    { cpStart: 0, cpEnd: 5, format: {}, istd: 0 },
    { cpStart: 5, cpEnd: 11, format: {}, istd: 1 },
    { cpStart: 13, cpEnd: 17, format: {}, istd: 2 }, // 11..13 是 gap
    { cpStart: 17, cpEnd: 25, format: {}, istd: 0 },
    { cpStart: 40, cpEnd: 44, format: {}, istd: 3 }, // 25..40 是 gap
  ]
}

/** 对抗性 runs：单元素 / 相邻无间隔 / 密集小步长 / 大 gap。 */
function adversarialChpxRuns(): ChpxRun[][] {
  const one: ChpxRun[] = [{ cpStart: 3, cpEnd: 9, format: { bold: true } }]
  const contig: ChpxRun[] = []
  for (let i = 0; i < 40; i++) contig.push({ cpStart: i * 2, cpEnd: i * 2 + 2, format: {} })
  const dense: ChpxRun[] = []
  for (let i = 0; i < 40; i++) dense.push({ cpStart: i, cpEnd: i + 1, format: { bold: i % 3 === 0 } })
  const gappy: ChpxRun[] = [
    { cpStart: 0, cpEnd: 2, format: {} },
    { cpStart: 100, cpEnd: 101, format: {} },
    { cpStart: 1000, cpEnd: 1001, format: {} },
  ]
  return [[], one, contig, dense, gappy]
}

function adversarialPapxRuns(): PapxRun[][] {
  const one: PapxRun[] = [{ cpStart: 3, cpEnd: 9, format: {}, istd: 0 }]
  const contig: PapxRun[] = []
  for (let i = 0; i < 40; i++) contig.push({ cpStart: i * 2, cpEnd: i * 2 + 2, format: {}, istd: 0 })
  const dense: PapxRun[] = []
  for (let i = 0; i < 40; i++) dense.push({ cpStart: i, cpEnd: i + 1, format: {}, istd: 0 })
  const gappy: PapxRun[] = [
    { cpStart: 0, cpEnd: 2, format: {}, istd: 0 },
    { cpStart: 100, cpEnd: 101, format: {}, istd: 0 },
    { cpStart: 1000, cpEnd: 1001, format: {}, istd: 0 },
  ]
  return [[], one, contig, dense, gappy]
}

const j = (v: unknown) => JSON.stringify(v)

// ── A 组：与改动前实现的差分 ─────────────────────────────

describe('Round 166 A 组：与改动前实现逐项差分', () => {
  it('A1 merge：真实 27 份 chpxRuns，单调 + 随机 + 逐 run 边界，全部与 oracle 相同', () => {
    const docs = realDocs()
    expect(docs.length).toBeGreaterThanOrEqual(20)
    const rnd = makeRnd(20261014)
    let queries = 0
    let bad = 0
    let firstBad = ''
    for (const { name, chpxRuns } of docs) {
      const sm = styleMapFor(chpxRuns)
      const maxCp = chpxRuns.length ? chpxRuns[chpxRuns.length - 1].cpEnd : 0
      const probe = (cpStart: number, cpEnd: number) => {
        queries++
        const got = mergeCharFormatForParagraph(chpxRuns, cpStart, cpEnd, undefined, sm)
        const want = refMergeCharFormatForParagraph(chpxRuns, cpStart, cpEnd, undefined, sm)
        if (j(got) !== j(want)) {
          bad++
          if (!firstBad) firstBad = `${name} cp=[${cpStart},${cpEnd}) got=${j(got)} want=${j(want)}`
        }
      }
      // 逐 run 边界（含 gap、相邻、越界）
      for (const r of chpxRuns) {
        probe(r.cpStart, r.cpEnd)
        probe(r.cpStart, r.cpStart + 1)
        probe(Math.max(0, r.cpStart - 1), r.cpEnd + 1)
        probe(r.cpEnd, r.cpEnd + 1)
      }
      // 单调扫描（模拟「按文档序逐段」）
      const step = Math.max(1, Math.floor(maxCp / 200))
      for (let cp = 0; cp <= maxCp; cp += step) probe(cp, cp + 1 + (cp % 7))
      // 随机（含回退式 cpStart）
      for (let k = 0; k < 300; k++) {
        const a = Math.floor(rnd() * (maxCp + 3)) - 1
        const b = a + Math.floor(rnd() * 12)
        probe(a, b)
      }
    }
    expect(firstBad).toBe('')
    expect(bad).toBe(0)
    expect(queries).toBeGreaterThan(20000)
  })

  it('A2 papx：真实 27 份 papxRuns，单调 + 随机 + 全部边界，全部与 oracle 相同', () => {
    const docs = realDocs()
    const rnd = makeRnd(20261015)
    let queries = 0
    let bad = 0
    let firstBad = ''
    for (const { name, papxRuns } of docs) {
      const maxCp = papxRuns.length ? papxRuns[papxRuns.length - 1].cpEnd : 0
      const probe = (markCp: number) => {
        queries++
        const got = findPapxRunContaining(papxRuns, markCp)
        const want = refFindPapxRunContaining(papxRuns, markCp)
        if (got !== want) {
          bad++
          if (!firstBad) firstBad = `${name} markCp=${markCp} got=${got} want=${want}`
        }
      }
      for (const r of papxRuns) {
        probe(r.cpStart - 1)
        probe(r.cpStart)
        probe(r.cpEnd - 1)
        probe(r.cpEnd)
      }
      const step = Math.max(1, Math.floor(maxCp / 200))
      for (let cp = 0; cp <= maxCp; cp += step) probe(cp)
      for (let k = 0; k < 300; k++) probe(Math.floor(rnd() * (maxCp + 3)) - 1)
    }
    expect(firstBad).toBe('')
    expect(bad).toBe(0)
    expect(queries).toBeGreaterThan(20000)
  })

  it('A3 对抗性 runs（空 / 单元素 / 相邻 / 密集 / 大 gap）穷举查询与 oracle 相同', () => {
    let bad = 0
    let firstBad = ''
    for (const runs of adversarialChpxRuns()) {
      const maxCp = runs.length ? runs[runs.length - 1].cpEnd : 2
      for (let a = -1; a <= maxCp + 1; a++) {
        for (let b = a; b <= a + 4; b++) {
          const got = mergeCharFormatForParagraph(runs, a, b)
          const want = refMergeCharFormatForParagraph(runs, a, b)
          if (j(got) !== j(want)) {
            bad++
            if (!firstBad) firstBad = `merge runs=${runs.length} cp=[${a},${b})`
          }
        }
      }
    }
    for (const runs of adversarialPapxRuns()) {
      const maxCp = runs.length ? runs[runs.length - 1].cpEnd : 2
      for (let cp = -1; cp <= maxCp + 1; cp++) {
        const got = findPapxRunContaining(runs, cp)
        const want = refFindPapxRunContaining(runs, cp)
        if (got !== want) {
          bad++
          if (!firstBad) firstBad = `papx runs=${runs.length} markCp=${cp} got=${got} want=${want}`
        }
      }
    }
    expect(firstBad).toBe('')
    expect(bad).toBe(0)
  })

  it('A4 乱序 / 跨数组身份 / 交替访问：提示守卫不得让结果偏离 oracle', () => {
    const docs = realDocs().slice(0, 8)
    const rnd = makeRnd(20261016)
    let bad = 0
    let firstBad = ''
    for (const { chpxRuns, papxRuns } of docs) {
      const sm = styleMapFor(chpxRuns)
      // 另一组「不同数组对象、内容相同」的 runs，用来打击数组身份守卫
      const chpxTwin = chpxRuns.map((r) => ({ ...r }))
      const papxTwin = papxRuns.map((r) => ({ ...r }))
      for (let k = 0; k < 400; k++) {
        const useTwin = rnd() < 0.4
        const runs = useTwin ? chpxTwin : chpxRuns
        const maxCp = runs.length ? runs[runs.length - 1].cpEnd : 0
        const a = Math.floor(rnd() * (maxCp + 3)) - 1
        const b = a + 1 + Math.floor(rnd() * 10)
        const got = mergeCharFormatForParagraph(runs, a, b, undefined, sm)
        const want = refMergeCharFormatForParagraph(runs, a, b, undefined, sm)
        if (j(got) !== j(want)) {
          bad++
          if (!firstBad) firstBad = `merge twin=${useTwin} cp=[${a},${b})`
        }

        const pruns = rnd() < 0.4 ? papxTwin : papxRuns
        const pmax = pruns.length ? pruns[pruns.length - 1].cpEnd : 0
        const cp = Math.floor(rnd() * (pmax + 3)) - 1
        const pgot = findPapxRunContaining(pruns, cp)
        const pwant = refFindPapxRunContaining(pruns, cp)
        if (pgot !== pwant) {
          bad++
          if (!firstBad) firstBad = `papx markCp=${cp} got=${pgot} want=${pwant}`
        }
      }
    }
    expect(firstBad).toBe('')
    expect(bad).toBe(0)
  })

  it('A5 跨文档交替访问（不同 runs 内容）：数组身份守卫必须在行为层被触发', () => {
    // A4 的 twin 与本体内容相同，陈旧提示仍然合法 ⇒ 抓不住「缺数组身份守卫」。
    // 这里在两个**内容不同**的真实文档之间交替，使陈旧提示的下标越界/错位。
    const docs = realDocs()
    const rnd = makeRnd(20261017)
    let bad = 0
    let firstBad = ''
    for (let i = 0; i + 1 < docs.length; i += 2) {
      const A = docs[i]
      const B = docs[i + 1]
      const smA = styleMapFor(A.chpxRuns)
      const smB = styleMapFor(B.chpxRuns)
      const maxA = A.chpxRuns.length ? A.chpxRuns[A.chpxRuns.length - 1].cpEnd : 0
      const maxB = B.chpxRuns.length ? B.chpxRuns[B.chpxRuns.length - 1].cpEnd : 0
      for (let k = 0; k < 600; k++) {
        const cpA = Math.floor(rnd() * (maxA + 1))
        const gotA = mergeCharFormatForParagraph(A.chpxRuns, cpA, cpA + 5, undefined, smA)
        const wantA = refMergeCharFormatForParagraph(A.chpxRuns, cpA, cpA + 5, undefined, smA)
        if (j(gotA) !== j(wantA)) {
          bad++
          if (!firstBad) firstBad = `merge A#${i} cp=${cpA}`
        }
        const cpB = Math.floor(rnd() * (maxB + 1))
        const gotB = mergeCharFormatForParagraph(B.chpxRuns, cpB, cpB + 5, undefined, smB)
        const wantB = refMergeCharFormatForParagraph(B.chpxRuns, cpB, cpB + 5, undefined, smB)
        if (j(gotB) !== j(wantB)) {
          bad++
          if (!firstBad) firstBad = `merge B#${i + 1} cp=${cpB}`
        }
        const pmA = Math.floor(rnd() * (maxA + 1))
        const pgA = findPapxRunContaining(A.papxRuns, pmA)
        const pwA = refFindPapxRunContaining(A.papxRuns, pmA)
        if (pgA !== pwA) {
          bad++
          if (!firstBad) firstBad = `papx A#${i} markCp=${pmA} got=${pgA} want=${pwA}`
        }
        const pmB = Math.floor(rnd() * (maxB + 1))
        const pgB = findPapxRunContaining(B.papxRuns, pmB)
        const pwB = refFindPapxRunContaining(B.papxRuns, pmB)
        if (pgB !== pwB) {
          bad++
          if (!firstBad) firstBad = `papx B#${i + 1} markCp=${pmB} got=${pgB} want=${pwB}`
        }
      }
    }
    expect(firstBad).toBe('')
    expect(bad).toBe(0)
  })
})

// ── B 组：绝对锚点（非空转 / 语义钉死） ─────────────────────────────

describe('Round 166 B 组：绝对锚点', () => {
  const RUNS = sampleChpxRuns()
  const PAPX = samplePapxRuns()

  it('B1 merge：各段落的合并结果逐字段固定', () => {
    // [0,4) 全 bold ⇒ bold（>50%）
    expect(mergeCharFormatForParagraph(RUNS, 0, 4)).toEqual({ bold: true })
    // [4,8) 全 italic ⇒ italic（>30%）
    expect(mergeCharFormatForParagraph(RUNS, 4, 8)).toEqual({ italic: true })
    // [10,14) 全 underline ⇒ underline
    expect(mergeCharFormatForParagraph(RUNS, 10, 14)).toEqual({ underline: true })
    // [14,20) fontSize=20 全覆盖 ⇒ fontSize=20；color 取首个
    expect(mergeCharFormatForParagraph(RUNS, 14, 20)).toEqual({
      fontSize: 20,
      color: 'FF0000',
    })
  })

  it('B2 merge：落在 gap 或段间的查询只看到重叠部分', () => {
    // [8,10) 无任何 run 覆盖 ⇒ {}
    expect(mergeCharFormatForParagraph(RUNS, 8, 10)).toEqual({})
    // [20,30) 全在 gap ⇒ {}
    expect(mergeCharFormatForParagraph(RUNS, 20, 30)).toEqual({})
    // [0,20) 横跨前 4 个 run：bold 4/20、italic 4/20、underline 4/20 都不够阈值；
    // 但 color/highlight/fontName 是「取首个出现」而非按比例，故 color=FF0000 必设。
    expect(mergeCharFormatForParagraph(RUNS, 0, 20)).toEqual({ color: 'FF0000' })
  })

  it('B3 merge：空 runs / 非正长度返回 {}', () => {
    expect(mergeCharFormatForParagraph([], 0, 10)).toEqual({})
    expect(mergeCharFormatForParagraph(RUNS, 5, 5)).toEqual({})
    expect(mergeCharFormatForParagraph(RUNS, 10, 3)).toEqual({})
  })

  it('B4 papx：每个 run 内任意点都命中该 run，gap 返回 -1', () => {
    expect(findPapxRunContaining(PAPX, 0)).toBe(0)
    expect(findPapxRunContaining(PAPX, 4)).toBe(0)
    expect(findPapxRunContaining(PAPX, 5)).toBe(1)
    expect(findPapxRunContaining(PAPX, 10)).toBe(1)
    expect(findPapxRunContaining(PAPX, 11)).toBe(-1) // gap 11..13
    expect(findPapxRunContaining(PAPX, 12)).toBe(-1)
    expect(findPapxRunContaining(PAPX, 13)).toBe(2)
    expect(findPapxRunContaining(PAPX, 16)).toBe(2)
    expect(findPapxRunContaining(PAPX, 17)).toBe(3)
    expect(findPapxRunContaining(PAPX, 24)).toBe(3)
    expect(findPapxRunContaining(PAPX, 25)).toBe(-1) // gap 25..40
    expect(findPapxRunContaining(PAPX, 39)).toBe(-1)
    expect(findPapxRunContaining(PAPX, 40)).toBe(4)
    expect(findPapxRunContaining(PAPX, 43)).toBe(4)
    expect(findPapxRunContaining(PAPX, 44)).toBe(-1)
    expect(findPapxRunContaining(PAPX, 999)).toBe(-1)
  })

  it('B5 papx：空数组恒为 -1', () => {
    expect(findPapxRunContaining([], 0)).toBe(-1)
    expect(findPapxRunContaining([], 5)).toBe(-1)
  })
})

// ── C 组：骨架负控（证明本文件有鉴别力） ─────────────────────────────

describe('Round 166 C 组：骨架负控必须与 oracle 不同', () => {
  type MergeMode = 'ok' | 'noBackGuard' | 'noArrayGuard' | 'noWriteback'
  /** 与生产同形的 merge 骨架：按 mode 去掉一处守卫 / 写回。 */
  function makeMergeSkeleton(mode: MergeMode) {
    const CAP = 8
    let hRuns: ChpxRun[] | null = null
    let hCpStart = -1
    let hLo = 0
    return (runs: ChpxRun[], cpStart: number, cpEnd: number) => {
      const totalChars = cpEnd - cpStart
      if (totalChars <= 0 || runs.length === 0) return {}
      let lo = 0
      const arrayOk = mode === 'noArrayGuard' ? true : runs === hRuns
      const backOk = mode === 'noBackGuard' ? true : cpStart >= hCpStart
      if (arrayOk && backOk) lo = hLo
      const limit = lo + CAP
      while (lo < runs.length && runs[lo].cpEnd <= cpStart && lo < limit) lo++
      if (!(lo < runs.length && runs[lo].cpEnd > cpStart)) {
        let hi = runs.length
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (runs[mid].cpEnd > cpStart) hi = mid
          else lo = mid + 1
        }
      }
      if (mode !== 'noWriteback') {
        hRuns = runs
        hCpStart = cpStart
        hLo = lo
      }
      return mergeBody(runs, cpStart, cpEnd, undefined, undefined, lo)
    }
  }

  type PapxMode = 'ok' | 'noBackGuard' | 'noArrayGuard' | 'noContainment' | 'noWriteback'
  /** 与生产同形的 papx 骨架：按 mode 去掉一处守卫 / 包含性确认 / 写回。 */
  function makePapxSkeleton(mode: PapxMode) {
    const CAP = 8
    let hRuns: PapxRun[] | null = null
    let hMark = -1
    let hLo = 0
    return (papxRuns: PapxRun[], markCp: number): number => {
      let lo = 0
      const hi = papxRuns.length - 1
      const arrayOk = mode === 'noArrayGuard' ? true : papxRuns === hRuns
      const backOk = mode === 'noBackGuard' ? true : markCp >= hMark
      if (arrayOk && backOk) {
        lo = hLo
        const lim = lo + CAP
        while (lo <= hi && papxRuns[lo].cpEnd <= markCp && lo < lim) lo++
        const contained =
          mode === 'noContainment'
            ? lo <= hi && papxRuns[lo].cpEnd > markCp
            : lo <= hi && papxRuns[lo].cpEnd > markCp && papxRuns[lo].cpStart <= markCp
        if (contained) {
          if (mode !== 'noWriteback') {
            hMark = markCp
            hLo = lo
          }
          return lo
        }
      }
      let a = lo
      let b = hi
      let found = -1
      while (a <= b) {
        const mid = (a + b) >> 1
        const run = papxRuns[mid]
        if (run.cpEnd <= markCp) a = mid + 1
        else if (run.cpStart > markCp) b = mid - 1
        else {
          found = mid
          break
        }
      }
      if (mode !== 'noWriteback') {
        hRuns = papxRuns
        hMark = markCp
        hLo = found >= 0 ? found : lo
      }
      return found
    }
  }

  it('C1 正控：两个骨架「保留全部守卫」与 oracle 完全一致', () => {
    const runs = sampleChpxRuns()
    const papx = samplePapxRuns()
    const msk = makeMergeSkeleton('ok')
    const psk = makePapxSkeleton('ok')
    for (const [a, b] of [
      [0, 4],
      [4, 8],
      [8, 10],
      [14, 20],
      [0, 20],
      [20, 30],
      [30, 33],
      [0, 40],
    ]) {
      expect(j(msk(runs, a, b))).toBe(j(refMergeCharFormatForParagraph(runs, a, b)))
    }
    for (const cp of [-1, 0, 4, 5, 10, 11, 12, 13, 16, 17, 24, 25, 39, 40, 43, 44, 999]) {
      expect(psk(papx, cp)).toBe(refFindPapxRunContaining(papx, cp))
    }
  })

  it('C2 负控「去掉回退守卫」：回退式查询必须与 oracle 不同', () => {
    const runs = sampleChpxRuns()
    const msk = makeMergeSkeleton('noBackGuard')
    expect(msk(runs, 30, 33)).toEqual(refMergeCharFormatForParagraph(runs, 30, 33)) // 推高提示到 lo=4
    const got = msk(runs, 0, 4) // 回退到 0；陈旧提示 lo=4 会漏掉 run0
    const want = refMergeCharFormatForParagraph(runs, 0, 4)
    expect(want).toEqual({ bold: true })
    expect(j(got)).not.toBe(j(want))

    const papx = samplePapxRuns()
    const psk = makePapxSkeleton('noBackGuard')
    expect(psk(papx, 43)).toBe(4) // 推高提示
    const pgot = psk(papx, 0)
    const pwant = refFindPapxRunContaining(papx, 0)
    expect(pwant).toBe(0)
    expect(pgot).not.toBe(pwant)
  })

  it('C3 负控「去掉数组身份守卫」：换到另一个数组对象必须与 oracle 不同', () => {
    // 关键：第二次调用必须**通过回退守卫**（cpStart/markCp 足够大），否则陈旧提示
    // 会被回退守卫拦下、数组身份守卫根本没被用到，负控就抓不住（Round165 C3 的坑）。
    const runsA = sampleChpxRuns()
    // 另一数组：对象不同、内容不同，但同样升序互不重叠；cpEnd=40 覆盖 cpStart=30。
    const runsB: ChpxRun[] = [{ cpStart: 0, cpEnd: 40, format: { bold: true } }]
    const msk = makeMergeSkeleton('noArrayGuard')
    // A 上把提示推到 hLo=4、hCpStart=30
    expect(msk(runsA, 30, 33)).toEqual(refMergeCharFormatForParagraph(runsA, 30, 33))
    // 换到 B 的数组、cpStart=30（>= 30，回退守卫放行）；B 的正确 lo=0，陈旧提示 4 越界
    const got = msk(runsB, 30, 40)
    const want = refMergeCharFormatForParagraph(runsB, 30, 40)
    expect(want).toEqual({ bold: true })
    expect(j(got)).not.toBe(j(want))

    const papxA = samplePapxRuns()
    const papxB: PapxRun[] = [
      { cpStart: 0, cpEnd: 2, format: {}, istd: 0 },
      { cpStart: 50, cpEnd: 60, format: {}, istd: 0 },
    ]
    const psk = makePapxSkeleton('noArrayGuard')
    expect(psk(papxA, 43)).toBe(4) // A 上把提示推到 lo=4、hMark=43
    const pgot = psk(papxB, 50) // B 的正确答案 = 1，但陈旧提示 lo=4 越界 ⇒ -1
    const pwant = refFindPapxRunContaining(papxB, 50)
    expect(pwant).toBe(1)
    expect(pgot).not.toBe(pwant)
  })

  it('C4 负控「缺包含性确认」：gap 上必须与 oracle 不同（papx）', () => {
    const papx = samplePapxRuns()
    const psk = makePapxSkeleton('noContainment')
    expect(psk(papx, 16)).toBe(2) // 命中 run2，写回 lo=2
    const pgot = psk(papx, 25) // gap 25..40：正确 -1；缺 cpStart 检查会返回 3
    const pwant = refFindPapxRunContaining(papx, 25)
    expect(pwant).toBe(-1)
    expect(pgot).not.toBe(pwant)
  })

  it('C5 行为保持型回退「去掉提示写回」：输出仍与 oracle 相同（只能靠 D 组源码断言守住）', () => {
    const runs = sampleChpxRuns()
    const papx = samplePapxRuns()
    const msk = makeMergeSkeleton('noWriteback')
    const psk = makePapxSkeleton('noWriteback')
    // 单调访问：即便从不写回提示，结果也必须与 oracle 逐项相同
    for (const [a, b] of [
      [0, 4],
      [4, 8],
      [8, 10],
      [10, 14],
      [14, 20],
      [20, 30],
      [30, 33],
      [0, 40],
    ]) {
      expect(j(msk(runs, a, b))).toBe(j(refMergeCharFormatForParagraph(runs, a, b)))
    }
    for (const cp of [0, 4, 5, 10, 11, 13, 16, 17, 24, 25, 40, 43, 44]) {
      expect(psk(papx, cp)).toBe(refFindPapxRunContaining(papx, cp))
    }
  })
})

// ── D 组：接线元断言（源码文本） ─────────────────────────────

describe('Round 166 D 组：接线元断言', () => {
  const SRC = fs.readFileSync(new URL('../src/utils/formatParser.ts', import.meta.url), 'utf8')
  const DP = fs.readFileSync(new URL('../src/utils/docParser.ts', import.meta.url), 'utf8')

  it('D1 merge 提示常量与三个模块级状态存在', () => {
    expect(SRC).toContain('const MERGE_HINT_MAX_STEPS = 8')
    expect(SRC).toContain('let mergeHintRuns: ChpxRun[] | null = null')
    expect(SRC).toContain('let mergeHintCpStart = -1')
    expect(SRC).toContain('let mergeHintLo = 0')
  })

  it('D2 merge 守卫与新起点计算存在', () => {
    expect(SRC).toContain('if (runs === mergeHintRuns && cpStart >= mergeHintCpStart) lo = mergeHintLo')
    expect(SRC).toContain('const mergeScanLimit = lo + MERGE_HINT_MAX_STEPS')
    expect(SRC).toContain(
      'while (lo < runs.length && runs[lo].cpEnd <= cpStart && lo < mergeScanLimit) lo++',
    )
    expect(SRC).toContain('if (!(lo < runs.length && runs[lo].cpEnd > cpStart)) {')
  })

  it('D3 merge 提示写回恰有一次（三个状态各 1 次）', () => {
    expect(SRC.split('mergeHintRuns = runs').length - 1).toBe(1)
    expect(SRC.split('mergeHintCpStart = cpStart').length - 1).toBe(1)
    expect(SRC.split('mergeHintLo = lo').length - 1).toBe(1)
  })

  it('D4 papx 提示常量与三个模块级状态存在', () => {
    expect(SRC).toContain('const PAPX_HINT_MAX_STEPS = 8')
    expect(SRC).toContain('let papxHintRuns: PapxRun[] | null = null')
    expect(SRC).toContain('let papxHintMarkCp = -1')
    expect(SRC).toContain('let papxHintLo = 0')
  })

  it('D5 papx 守卫 + 有界前推 + 包含性确认存在', () => {
    expect(SRC).toContain('export function findPapxRunContaining(papxRuns: PapxRun[], markCp: number): number {')
    expect(SRC).toContain('if (papxRuns === papxHintRuns && markCp >= papxHintMarkCp) {')
    expect(SRC).toContain('const lim = lo + PAPX_HINT_MAX_STEPS')
    expect(SRC).toContain('while (lo <= hi && papxRuns[lo].cpEnd <= markCp && lo < lim) lo++')
    expect(SRC).toContain(
      'if (lo <= hi && papxRuns[lo].cpEnd > markCp && papxRuns[lo].cpStart <= markCp) {',
    )
  })

  it('D6 papx 提示写回：hint 命中路径 1 次 + 全量路径 1 次', () => {
    expect(SRC.split('papxHintMarkCp = markCp').length - 1).toBe(2)
    expect(SRC.split('papxHintLo = lo').length - 1).toBe(1)
    expect(SRC.split('papxHintLo = found >= 0 ? found : lo').length - 1).toBe(1)
  })

  it('D7 docParser 查询已收口到 findPapxRunContaining，且旧内联二分已移除', () => {
    expect(DP).toContain('const idx = findPapxRunContaining(papxRuns, markCp)')
    expect(DP).toContain('if (idx >= 0) papx = papxRuns[idx]')
    expect(DP).not.toContain('let hi = papxRuns.length - 1')
  })
})
