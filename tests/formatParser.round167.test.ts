// Round 167 护栏：`parseChpxRunsFromFkp` / `parsePapxRunsFromFkp` 内层「每个 FKP
// 条目 × 全量 pieces」扫描，改为**只前进的 pieces 单调游标**。
//
// 背景（先量后改，计数插桩 20 轮）：
//   * CHPX：22 次调用/轮，内层迭代 **195,227** 次，真正相交仅 **26,651** 次；
//   * PAPX：27 次调用/轮，内层迭代 **248,540** 次，真正相交仅 **39,657** 次；
//   合计 **443,767 次迭代，85.1% 空转**。真实语料里 `pieces` 按 `fcStart` 升序、
//   且同一次调用内条目 `fcStart` 单调不减 ⇒ 可维护只前进的游标 + 早停 `break`。
//
// 本文件守住四件事：
//
//   1. **原语等价**：新实现 vs 改动前实现（本文件内逐行转写的
//      `round167OldParseChpxRunsFromFkp` / `round167OldParsePapxRunsFromFkp`）在
//      27 份真实语料、对抗性合成夹具与**随机模糊输入**上逐项相同。
//   2. **绝对锚点**：真实语料直接调用的 run 计数（chpx=26698 / papx=39657）。
//   3. **鉴别力**：骨架负控（缺升序守卫 / 缺回退重置 / 前进条件写错）必须与 oracle
//      不同；而**行为保持型回退（去掉 break）必须仍与 oracle 相同**——只能靠第 4 组
//      源码文本断言守住（Round164 通用教训 10）。
//   4. **接线元断言**：守卫常量、游标状态、写回点与早停 `break` 只能靠源码文本断言。
//
// 另附：本轮在写护栏时**发现并修正**一个等价性缺陷——`NaN` 与任何数比较恒为 false，
// 故用 `a < b` 判「升序」会把 `1005 → NaN → 990` 误判为升序、错误启用 `break` 丢掉
// 后方仍相交的 piece。判据改为取反式 `!(a >= b)` 后，任一侧出现 `NaN` 立即判非升序。
// A2 组钉死该回归。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { deepStrictEqual } from 'node:assert'
import {
  parseChpxRunsFromFkp,
  parsePapxRunsFromFkp,
  parseChpxGrpprlWithFont,
  parsePapxGrpprl,
  type ChpxRun,
  type PapxRun,
  type PieceFcRange,
} from '../src/utils/formatParser'
import { readUint16, readUint32 } from '../src/utils/binaryReader'
import { OleParser } from '../src/utils/oleParser'
import { parseFib } from '../src/utils/fibParser'
import { parseClxPieces } from '../src/utils/docparser/pieceTable'

type Kind = 'chpx' | 'papx'
const KINDS: Kind[] = ['chpx', 'papx']

// ── oracle：改动前实现（逐行转写自 HEAD，仅去 export / 改函数名） ──────────────
// 共享的字节读取与 grpprl 解析未变化，故只转写 FC→CP 与 FKP 遍历。

function round167ParseBinTable(
  tableData: Uint8Array,
  fc: number,
  lcb: number,
): Array<{ fcStart: number; fcEnd: number; pn: number }> {
  if (lcb < 12 || fc < 0 || fc + lcb > tableData.length) return []
  const n = Math.floor((lcb - 4) / 8)
  if (n <= 0 || n > 100000) return []
  const entries: Array<{ fcStart: number; fcEnd: number; pn: number }> = []
  for (let i = 0; i < n; i++) {
    const fcStart = readUint32(tableData, fc + i * 4)
    const fcEnd = readUint32(tableData, fc + (i + 1) * 4)
    if (fcEnd <= fcStart) return []
    const pnRaw = readUint32(tableData, fc + (n + 1) * 4 + i * 4)
    const pn = pnRaw & 0x3FFFFF
    entries.push({ fcStart, fcEnd, pn })
  }
  return entries
}

/** 改动前内层：对每个 piece 全量扫描，无游标、无早停。 */
function round167OldFcRangeToCpRanges(
  fcStart: number,
  fcEnd: number,
  pieces: PieceFcRange[],
): Array<{ cpStart: number; cpEnd: number }> {
  const out: Array<{ cpStart: number; cpEnd: number }> = []
  for (const p of pieces) {
    const bytesPerChar = p.compressed ? 1 : 2
    const pieceFcEnd = p.fcStart + (p.cpEnd - p.cpStart) * bytesPerChar
    const s = Math.max(fcStart, p.fcStart)
    const e = Math.min(fcEnd, pieceFcEnd)
    if (e <= s) continue
    const cpS = p.cpStart + Math.floor((s - p.fcStart) / bytesPerChar)
    const cpE = p.cpStart + Math.ceil((e - p.fcStart) / bytesPerChar)
    if (cpE > cpS) out.push({ cpStart: cpS, cpEnd: cpE })
  }
  return out
}

function round167OldParseChpxRunsFromFkp(
  tableData: Uint8Array,
  wordDocData: Uint8Array,
  fc: number,
  lcb: number,
  pieces: PieceFcRange[],
): ChpxRun[] {
  if (pieces.length === 0) return []
  const bins = round167ParseBinTable(tableData, fc, lcb)
  if (bins.length === 0) return []

  const runs: ChpxRun[] = []
  for (const bin of bins) {
    const base = bin.pn * 512
    if (base + 512 > wordDocData.length) continue
    const crun = wordDocData[base + 511]
    if (crun === 0 || (crun + 1) * 4 + crun > 511) continue

    for (let i = 0; i < crun; i++) {
      const fcStart = readUint32(wordDocData, base + i * 4)
      const fcEnd = readUint32(wordDocData, base + (i + 1) * 4)
      if (fcEnd <= fcStart) continue
      const rgb = wordDocData[base + (crun + 1) * 4 + i]
      if (rgb === 0) continue
      const chpxOffset = base + rgb * 2
      if (chpxOffset >= base + 511) continue
      const cb = wordDocData[chpxOffset]
      if (cb === 0 || chpxOffset + 1 + cb > base + 512) continue

      const { format, fontIndex, revision, isSpecial, fcPic, istd } =
        parseChpxGrpprlWithFont(wordDocData, chpxOffset + 1, cb)
      if (Object.keys(format).length === 0 && fontIndex === undefined &&
          !revision && !isSpecial && fcPic === undefined && istd === undefined) continue

      for (const cpRange of round167OldFcRangeToCpRanges(fcStart, fcEnd, pieces)) {
        const run: ChpxRun = { cpStart: cpRange.cpStart, cpEnd: cpRange.cpEnd, format, fontIndex, revision }
        if (isSpecial) run.isSpecial = true
        if (fcPic !== undefined) run.fcPic = fcPic
        if (istd !== undefined) run.istd = istd
        runs.push(run)
      }
    }
  }

  runs.sort((a, b) => a.cpStart - b.cpStart || a.cpEnd - b.cpEnd)
  return runs
}

function round167OldParsePapxRunsFromFkp(
  tableData: Uint8Array,
  wordDocData: Uint8Array,
  fc: number,
  lcb: number,
  pieces: PieceFcRange[],
): PapxRun[] {
  if (pieces.length === 0) return []
  const bins = round167ParseBinTable(tableData, fc, lcb)
  if (bins.length === 0) return []

  const runs: PapxRun[] = []
  for (const bin of bins) {
    const base = bin.pn * 512
    if (base + 512 > wordDocData.length) continue
    const cpara = wordDocData[base + 511]
    if (cpara === 0 || (cpara + 1) * 4 + cpara * 13 > 511) continue

    for (let i = 0; i < cpara; i++) {
      const fcStart = readUint32(wordDocData, base + i * 4)
      const fcEnd = readUint32(wordDocData, base + (i + 1) * 4)
      if (fcEnd <= fcStart) continue
      const bOffset = wordDocData[base + (cpara + 1) * 4 + i * 13]
      if (bOffset === 0) continue
      let papxOffset = base + bOffset * 2
      if (papxOffset >= base + 511) continue

      const cb = wordDocData[papxOffset]
      let payloadLen: number
      if (cb === 0) {
        const cbPrime = wordDocData[papxOffset + 1]
        payloadLen = cbPrime * 2
        papxOffset += 2
      } else {
        payloadLen = cb * 2 - 1
        papxOffset += 1
      }
      if (payloadLen < 2 || papxOffset + payloadLen > base + 512) continue

      const istd = readUint16(wordDocData, papxOffset)
      const grpprlLen = payloadLen - 2
      const { format, ilvl, ilst, ilfo, table } =
        parsePapxGrpprl(wordDocData, papxOffset + 2, grpprlLen)

      for (const cpRange of round167OldFcRangeToCpRanges(fcStart, fcEnd, pieces)) {
        const run: PapxRun = { cpStart: cpRange.cpStart, cpEnd: cpRange.cpEnd, format, istd }
        if (ilvl !== undefined) run.ilvl = ilvl
        if (ilst !== undefined) run.ilst = ilst
        if (ilfo !== undefined) run.ilfo = ilfo
        if (table) run.table = table
        runs.push(run)
      }
    }
  }

  runs.sort((a, b) => a.cpStart - b.cpStart || a.cpEnd - b.cpEnd)
  return runs
}

const ORACLE: Record<Kind, (t: Uint8Array, w: Uint8Array, fc: number, lcb: number, p: PieceFcRange[]) => ChpxRun[] | PapxRun[]> = {
  chpx: round167OldParseChpxRunsFromFkp,
  papx: round167OldParsePapxRunsFromFkp,
}
const CANDIDATE: Record<Kind, (t: Uint8Array, w: Uint8Array, fc: number, lcb: number, p: PieceFcRange[]) => ChpxRun[] | PapxRun[]> = {
  chpx: parseChpxRunsFromFkp,
  papx: parsePapxRunsFromFkp,
}

function round167Assert(kind: Kind, table: Uint8Array, word: Uint8Array, pieces: PieceFcRange[], fc = 0, lcb = table.length): ChpxRun[] | PapxRun[] {
  const tBefore = table.slice()
  const wBefore = word.slice()
  const pBefore = pieces.map(p => ({ ...p }))
  const actual = CANDIDATE[kind](table, word, fc, lcb, pieces)
  const old = ORACLE[kind](table, word, fc, lcb, pieces)
  deepStrictEqual(actual, old)
  expect(JSON.stringify(actual)).toBe(JSON.stringify(old))
  for (let i = 0; i < actual.length; i++) expect(Object.keys(actual[i])).toEqual(Object.keys(old[i]))
  deepStrictEqual(table, tBefore)
  deepStrictEqual(word, wBefore)
  deepStrictEqual(pieces, pBefore)
  return actual
}

// ── 夹具构造 ────────────────────────────────────────────────────────────────

const align2 = (x: number): number => x + (x & 1)

function round167Bin(start = 1001, end = 1011, pn = 1): Uint8Array {
  const data = new Uint8Array(12)
  const view = new DataView(data.buffer)
  view.setUint32(0, start, true)
  view.setUint32(4, end, true)
  view.setUint32(8, pn, true)
  return data
}

interface RunSpec { fcStart: number; fcEnd: number; payload: number[] }

/** 构造一页合法 FKP（512B）：rgfc + 索引 + 各条目独立 payload。 */
function round167FkpPage(kind: Kind, runs: RunSpec[]): Uint8Array {
  const page = new Uint8Array(512)
  const view = new DataView(page.buffer)
  const n = runs.length
  if (n === 0) {
    page[511] = 0
    return page
  }
  for (let i = 0; i < n; i++) view.setUint32(i * 4, runs[i].fcStart, true)
  view.setUint32(n * 4, runs[n - 1].fcEnd, true)
  const indexBase = (n + 1) * 4
  const indexBytes = kind === 'chpx' ? n : n * 13
  let cursor = align2(indexBase + indexBytes + 4)
  for (let i = 0; i < n; i++) {
    const payload = runs[i].payload
    if (kind === 'chpx') {
      page[cursor] = payload.length
      page.set(payload, cursor + 1)
      page[indexBase + i] = cursor >> 1
      cursor = align2(cursor + 1 + payload.length + 2)
    } else {
      page[cursor] = 0
      page[cursor + 1] = payload.length / 2
      page.set(payload, cursor + 2)
      page[indexBase + i * 13] = cursor >> 1
      cursor = align2(cursor + 2 + payload.length + 2)
    }
  }
  page[511] = n
  return page
}

const CHPX_PAYLOADS: number[][] = [[0x35, 0x08, 1], [0x36, 0x08, 1], [0x3E, 0x2A, 1], [0x30, 0x4A, 37, 0], [0x30, 0x4A, 0, 0]]
const PAPX_PAYLOADS: number[][] = [[0, 37], [0, 0], [0, 255]]

const PAYLOADS: Record<Kind, number[][]> = { chpx: CHPX_PAYLOADS, papx: PAPX_PAYLOADS }

/** 确定性 LCG，保证可复现。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)]
}

function randomPieces(rnd: () => number, allowUnsorted: boolean, allowSpecial: boolean): PieceFcRange[] {
  const count = Math.floor(rnd() * 7)
  const pieces: PieceFcRange[] = []
  let cp = 0
  for (let i = 0; i < count; i++) {
    const cpStart = cp
    const cpEnd = cp + Math.floor(rnd() * 6)
    const fcStart = 950 + Math.floor(rnd() * 120)
    pieces.push({ cpStart, cpEnd, fcStart, compressed: rnd() < 0.5 })
    cp = cpEnd + Math.floor(rnd() * 4)
  }
  if (allowUnsorted && pieces.length >= 2 && rnd() < 0.5) {
    for (let i = pieces.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      const tmp = pieces[i]
      pieces[i] = pieces[j]
      pieces[j] = tmp
    }
  }
  if (allowSpecial && pieces.length > 0 && rnd() < 0.4) {
    const target = pieces[Math.floor(rnd() * pieces.length)] as unknown as Record<string, number>
    const field = pick(rnd, ['cpStart', 'cpEnd', 'fcStart'] as const)
    target[field] = pick(rnd, [NaN, Infinity, -Infinity])
  }
  return pieces
}

function randomRuns(rnd: () => number, kind: Kind): RunSpec[] {
  const n = 1 + Math.floor(rnd() * 4)
  const runs: RunSpec[] = []
  let fc = 980 + Math.floor(rnd() * 20)
  for (let i = 0; i < n; i++) {
    const width = 1 + Math.floor(rnd() * 14)
    runs.push({ fcStart: fc, fcEnd: fc + width, payload: pick(rnd, PAYLOADS[kind]) })
    fc += width + Math.floor(rnd() * 5)
  }
  return runs
}

/** 把一页 FKP 放到 WordDocument 流的第 1 页（base=512）。 */
function round167Word(runs: RunSpec[], kind: Kind): Uint8Array {
  const word = new Uint8Array(1024)
  word.set(round167FkpPage(kind, runs), 512)
  return word
}

// ══════════════════════════════════════════════════════════════════════════
// A 组：原语差分等价
// ══════════════════════════════════════════════════════════════════════════

describe('Round 167 A 组：原语差分等价', () => {
  it('A1 27 份真实语料两种 FKP 与改动前 oracle 逐项一致，计数锚定 26698/39657', () => {
    const docs = new URL('../docs/', import.meta.url)
    const files = readdirSync(docs).filter(name => /\.(doc|dot)$/.test(name)).sort()
    expect(files).toHaveLength(27)
    const totals: Record<Kind, number> = { chpx: 0, papx: 0 }
    for (const name of files) {
      const bytes = readFileSync(new URL(name, docs))
      const ole = new OleParser(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const header = ole.parseHeader()
      const directory = ole.getDirectorySectors(header, ole.getFatSectors(header))
      const word = ole.findWordDocumentStream(directory)?.data
      if (!word) throw new Error(`缺少WordDocument：${name}`)
      const fib = parseFib(word)
      if (!fib) throw new Error(`缺少FIB：${name}`)
      const table = ole.findTableStream(directory, fib.fWhichTblStm ? 1 : 0)?.data ?? new Uint8Array(0)
      const pieces = parseClxPieces({ maxTotalChars: 10 * 1024 * 1024, readUint16, readUint32 }, table.subarray(fib.fcClx, fib.fcClx + fib.lcbClx))
        .map(p => ({ cpStart: p.cpStart, cpEnd: p.cpEnd, fcStart: p.fcValue, compressed: p.fCompressed }))
      for (const kind of KINDS) {
        const fc = kind === 'chpx' ? fib.fcPlcfBteChpx : fib.fcPlcfBtePapx
        const lcb = kind === 'chpx' ? fib.lcbPlcfBteChpx : fib.lcbPlcfBtePapx
        totals[kind] += round167Assert(kind, table, word, pieces, fc, lcb).length
      }
    }
    expect(totals).toEqual({ chpx: 26698, papx: 39657 })
  })

  it.each(KINDS)('A2 %s NaN 掩盖降序的回归：必须判非升序且产出与 oracle 一致', kind => {
    // 复现写护栏时发现的缺陷：1005 → NaN → 990，NaN 使 `a < b` 恒 false ⇒ 误判升序。
    const pieces: PieceFcRange[] = [
      { cpStart: 0, cpEnd: 5, fcStart: 1005, compressed: true },
      { cpStart: 10, cpEnd: 15, fcStart: NaN, compressed: true },
      { cpStart: 20, cpEnd: 40, fcStart: 990, compressed: true },
    ]
    const runs: RunSpec[] = [{ fcStart: 1000, fcEnd: 1002, payload: PAYLOADS[kind][0] }]
    const word = round167Word(runs, kind)
    const table = round167Bin(1000, 1002)
    const actual = round167Assert(kind, table, word, pieces) as Array<{ cpStart: number; cpEnd: number }>
    // 990 起点、宽 20 ⇒ 与 [1000,1002) 相交出 [30,32]；误判升序会丢掉它。
    expect(actual.map(r => [r.cpStart, r.cpEnd])).toEqual([[30, 32]])
  })

  it.each(KINDS)('A3 %s 乱序 / 全反序 / 跨 run 回退 / 同 cpStart tie 保持稳定序', kind => {
    // 单 run [1001,1011)：每个 piece 恰好产出一条，便于钉死绝对序。
    const word = round167Word([{ fcStart: 1001, fcEnd: 1011, payload: PAYLOADS[kind][0] }], kind)
    const table = round167Bin(1001, 1011)
    // 完全反序 pieces：必须回退完整排序
    const reversed = [30, 20, 10, 0].map(cpStart => ({ cpStart, cpEnd: cpStart + 3, fcStart: 1001, compressed: true }))
    const r1 = round167Assert(kind, table, word, reversed) as Array<{ cpStart: number; cpEnd: number }>
    expect(r1.map(r => [r.cpStart, r.cpEnd])).toEqual([[0, 3], [10, 13], [20, 23], [30, 33]])
    // 跨 run 逆序回退（末位 piece 的 fcStart 回落）
    const cross = [
      ...[1001, 1003, 1005].map(fcStart => ({ cpStart: 20, cpEnd: 22, fcStart, compressed: true })),
      { cpStart: 0, cpEnd: 2, fcStart: 1003, compressed: true },
    ]
    const r2 = round167Assert(kind, table, word, cross) as Array<{ cpStart: number; cpEnd: number }>
    expect(r2.map(r => [r.cpStart, r.cpEnd])).toEqual([[0, 2], [20, 22], [20, 22], [20, 22]])
    // 同 cpStart、不同 cpEnd：二级排序
    const ties = [13, 16, 20].map(cpEnd => ({ cpStart: 10, cpEnd, fcStart: 1001, compressed: true }))
    const r3 = round167Assert(kind, table, word, ties) as Array<{ cpStart: number; cpEnd: number }>
    expect(r3.map(r => [r.cpStart, r.cpEnd])).toEqual([[10, 13], [10, 16], [10, 20]])
  })

  it.each(KINDS)('A4 %s 空 piece / UTF16 奇数边界 / ±Infinity 与 oracle 一致', kind => {
    const payload = PAYLOADS[kind][0]
    // 单 run、UTF16 奇数起止
    for (const [start, end] of [[1001, 1003], [1001, 1002], [1002, 1003]] as const) {
      const word = round167Word([{ fcStart: start, fcEnd: end, payload }], kind)
      round167Assert(kind, round167Bin(start, end), word, [{ cpStart: 10, cpEnd: 20, fcStart: 1000, compressed: false }])
    }
    // 空 piece、倒退 FC、相切 FC
    for (const pieces of [
      [{ cpStart: 70, cpEnd: 70, fcStart: 1005, compressed: true }],
      [{ cpStart: 1, cpEnd: 0, fcStart: 1000, compressed: true }],
      [{ cpStart: 80, cpEnd: 85, fcStart: 1011, compressed: true }],
    ] as PieceFcRange[][]) {
      const word = round167Word([{ fcStart: 1001, fcEnd: 1011, payload }], kind)
      round167Assert(kind, round167Bin(), word, pieces)
    }
    // 公开 pieces 中的 ±Infinity
    for (const field of ['cpStart', 'cpEnd', 'fcStart'] as const) {
      for (const value of [Infinity, -Infinity]) {
        const pieces: PieceFcRange[] = [
          { cpStart: 10, cpEnd: 14, fcStart: 1001, compressed: true },
          { cpStart: 20, cpEnd: 24, fcStart: 1001, compressed: true, [field]: value } as PieceFcRange,
          { cpStart: 0, cpEnd: 4, fcStart: 1001, compressed: true },
        ]
        const word = round167Word([{ fcStart: 1001, fcEnd: 1011, payload }], kind)
        round167Assert(kind, round167Bin(), word, pieces)
      }
    }
  })

  it('A5 随机模糊：1200 组（乱序/特值/多 run）与 oracle 逐项一致', () => {
    const rnd = lcg(0x167_5eed)
    let cases = 0
    for (let t = 0; t < 1200; t++) {
      const kind: Kind = t % 2 === 0 ? 'chpx' : 'papx'
      const runs = randomRuns(rnd, kind)
      const word = round167Word(runs, kind)
      const table = round167Bin(runs[0].fcStart, runs[runs.length - 1].fcEnd)
      const pieces = randomPieces(rnd, true, true)
      round167Assert(kind, table, word, pieces)
      cases++
    }
    expect(cases).toBe(1200)
  })

  it.each(KINDS)('A6 %s 跨调用反映可变 piece 内容，且不改动输入', kind => {
    const payload = PAYLOADS[kind][0]
    const word = round167Word([{ fcStart: 1001, fcEnd: 1011, payload }], kind)
    const table = round167Bin()
    const pieces: PieceFcRange[] = [
      { cpStart: 0, cpEnd: 5, fcStart: 1000, compressed: true },
      { cpStart: 20, cpEnd: 26, fcStart: 1002, compressed: true },
    ]
    const first = round167Assert(kind, table, word, pieces) as Array<{ cpStart: number; cpEnd: number }>
    pieces[0].cpStart += 100
    pieces[0].cpEnd += 100
    const second = round167Assert(kind, table, word, pieces) as Array<{ cpStart: number; cpEnd: number }>
    expect(first.map(r => [r.cpStart, r.cpEnd])).toEqual([[1, 5], [20, 26]])
    expect(second.map(r => [r.cpStart, r.cpEnd])).toEqual([[20, 26], [101, 105]])
  })
})

// ══════════════════════════════════════════════════════════════════════════
// C 组：骨架负控（鉴别力）
// ══════════════════════════════════════════════════════════════════════════

type ScanMode = 'ok' | 'noAscGuard' | 'noReset' | 'noBreak' | 'badAdvance'
type FcRanges = Array<[number, number]>
type ScanOut = Array<Array<[number, number]>>

/** 与候选同源的升序判据（取反式，NaN ⇒ 非升序）。 */
function round167Ascending(pieces: readonly PieceFcRange[]): boolean {
  for (let z = 1; z < pieces.length; z++) {
    if (!(pieces[z].fcStart >= pieces[z - 1].fcStart)) return false
  }
  return true
}

/** 改动前内层（无游标、无早停）。 */
function round167NaiveScan(fcRanges: FcRanges, pieces: readonly PieceFcRange[]): ScanOut {
  return fcRanges.map(([fcStart, fcEnd]) => {
    const out: Array<[number, number]> = []
    for (const p of pieces) {
      const bpc = p.compressed ? 1 : 2
      const pieceFcEnd = p.fcStart + (p.cpEnd - p.cpStart) * bpc
      const s = Math.max(fcStart, p.fcStart)
      const e = Math.min(fcEnd, pieceFcEnd)
      if (e <= s) continue
      const cpS = p.cpStart + Math.floor((s - p.fcStart) / bpc)
      const cpE = p.cpStart + Math.ceil((e - p.fcStart) / bpc)
      if (cpE > cpS) out.push([cpS, cpE])
    }
    return out
  })
}

/** 候选内层骨架；`mode` 逐一注错。 */
function round167CursorScan(fcRanges: FcRanges, pieces: readonly PieceFcRange[], mode: ScanMode): ScanOut {
  const ascending = mode === 'noAscGuard' ? true : round167Ascending(pieces)
  let cursor = 0
  let cursorFc = -1
  return fcRanges.map(([fcStart, fcEnd]) => {
    const out: Array<[number, number]> = []
    let pi0 = 0
    if (ascending) {
      if (mode !== 'noReset' && fcStart < cursorFc) cursor = 0
      cursorFc = fcStart
      while (cursor < pieces.length) {
        const pc = pieces[cursor]
        const advances = mode === 'badAdvance'
          ? pc.fcStart > fcStart
          : pc.fcStart + (pc.cpEnd - pc.cpStart) * (pc.compressed ? 1 : 2) > fcStart
        if (advances) break
        cursor++
      }
      pi0 = cursor
    }
    for (let pi = pi0; pi < pieces.length; pi++) {
      const p = pieces[pi]
      if (mode !== 'noBreak' && ascending && p.fcStart >= fcEnd) break
      const bpc = p.compressed ? 1 : 2
      const pieceFcEnd = p.fcStart + (p.cpEnd - p.cpStart) * bpc
      const s = Math.max(fcStart, p.fcStart)
      const e = Math.min(fcEnd, pieceFcEnd)
      if (e <= s) continue
      const cpS = p.cpStart + Math.floor((s - p.fcStart) / bpc)
      const cpE = p.cpStart + Math.ceil((e - p.fcStart) / bpc)
      if (cpE > cpS) out.push([cpS, cpE])
    }
    return out
  })
}

const j = (v: unknown): string => JSON.stringify(v)

describe('Round 167 C 组：骨架负控鉴别力', () => {
  const ascendingPieces: PieceFcRange[] = [
    { cpStart: 0, cpEnd: 4, fcStart: 1000, compressed: true },
    { cpStart: 10, cpEnd: 16, fcStart: 1004, compressed: true },
    { cpStart: 20, cpEnd: 24, fcStart: 1010, compressed: false },
    { cpStart: 30, cpEnd: 40, fcStart: 1020, compressed: true },
  ]
  const monotoneRanges: FcRanges = [[1000, 1004], [1004, 1010], [1010, 1024], [1024, 1040], [980, 1000]]

  it('C1 正控：保留全部守卫的骨架与 naive 完全一致（含随机序）', () => {
    const rnd = lcg(0x167_c1)
    for (let t = 0; t < 600; t++) {
      const pieces = randomPieces(rnd, true, true)
      const ranges: FcRanges = []
      let fc = 970 + Math.floor(rnd() * 10)
      for (let i = 0; i < 1 + Math.floor(rnd() * 5); i++) {
        const w = 1 + Math.floor(rnd() * 20)
        ranges.push([fc, fc + w])
        fc += Math.floor(rnd() * 12) - 3 // 允许回退，触发重置守卫
      }
      expect(j(round167CursorScan(ranges, pieces, 'ok'))).toBe(j(round167NaiveScan(ranges, pieces)))
    }
    expect(j(round167CursorScan(monotoneRanges, ascendingPieces, 'ok'))).toBe(j(round167NaiveScan(monotoneRanges, ascendingPieces)))
  })

  it('C2 负控「去掉升序守卫」：乱序 pieces 上必须与 naive 不同', () => {
    const pieces: PieceFcRange[] = [
      { cpStart: 0, cpEnd: 2, fcStart: 1010, compressed: true },
      { cpStart: 10, cpEnd: 20, fcStart: 1000, compressed: true },
    ]
    const ranges: FcRanges = [[1000, 1010]]
    expect(j(round167CursorScan(ranges, pieces, 'ok'))).toBe(j(round167NaiveScan(ranges, pieces)))
    expect(round167Ascending(pieces)).toBe(false)
    const bad = round167CursorScan(ranges, pieces, 'noAscGuard')
    expect(j(bad)).not.toBe(j(round167NaiveScan(ranges, pieces)))
    expect(bad).toEqual([[]]) // break 在 1010 >= 1010 处误停
  })

  it('C3 负控「去掉回退重置」：run 的 fcStart 回退时必须与 naive 不同', () => {
    const pieces: PieceFcRange[] = [
      { cpStart: 0, cpEnd: 10, fcStart: 1000, compressed: true },
      { cpStart: 50, cpEnd: 60, fcStart: 1050, compressed: true },
    ]
    const ranges: FcRanges = [[1050, 1060], [1000, 1010]]
    const want = round167NaiveScan(ranges, pieces)
    expect(j(round167CursorScan(ranges, pieces, 'ok'))).toBe(j(want))
    const bad = round167CursorScan(ranges, pieces, 'noReset')
    expect(j(bad)).not.toBe(j(want))
    expect(bad[1]).toEqual([]) // 陈旧游标停在 1，回退后漏掉 piece0
  })

  it('C4 负控「前进条件写错」：忽略 piece 宽度时必须与 naive 不同', () => {
    const pieces: PieceFcRange[] = [{ cpStart: 0, cpEnd: 10, fcStart: 1000, compressed: true }]
    const ranges: FcRanges = [[1000, 1010]]
    const want = round167NaiveScan(ranges, pieces)
    expect(j(round167CursorScan(ranges, pieces, 'ok'))).toBe(j(want))
    expect(j(round167CursorScan(ranges, pieces, 'badAdvance'))).not.toBe(j(want))
  })

  it('C5 行为保持型回退「去掉 break」：输出仍与 naive 相同（只能靠 D 组源码断言守住）', () => {
    const rnd = lcg(0x167_c5)
    for (let t = 0; t < 600; t++) {
      const pieces = randomPieces(rnd, false, true) // 仅升序，使 break 分支可被启用
      const ranges: FcRanges = []
      let fc = 980 + Math.floor(rnd() * 10)
      for (let i = 0; i < 1 + Math.floor(rnd() * 5); i++) {
        const w = 1 + Math.floor(rnd() * 20)
        ranges.push([fc, fc + w])
        fc += w + Math.floor(rnd() * 6) // 单调，游标真正生效
      }
      expect(j(round167CursorScan(ranges, pieces, 'noBreak'))).toBe(j(round167NaiveScan(ranges, pieces)))
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════
// D 组：接线元断言（源码文本）
// ══════════════════════════════════════════════════════════════════════════

describe('Round 167 D 组：接线元断言', () => {
  const SRC = readFileSync(new URL('../src/utils/formatParser.ts', import.meta.url), 'utf8')
  const count = (needle: string): number => SRC.split(needle).length - 1

  it('D1 升序判据为取反式（NaN ⇒ 非升序），且只定义一次', () => {
    expect(count('function isAscendingByFcStart(')).toBe(1)
    expect(SRC).toContain('if (!(pieces[z].fcStart >= pieces[z - 1].fcStart)) return false')
    // 旧写法必须消失，否则 NaN 会再次掩盖降序。
    expect(SRC).not.toContain('if (pieces[z].fcStart < pieces[z - 1].fcStart) return false')
  })

  it('D2 两处构造函数各有一份游标状态与启用判据', () => {
    expect(count('const piecesAscending = isAscendingByFcStart(pieces)')).toBe(2)
    expect(count('let pieceCursor = 0')).toBe(2)
    expect(count('let pieceCursorFc = -1')).toBe(2)
    expect(count('let pi0 = 0')).toBe(2)
  })

  it('D3 回退重置守卫与游标前进恰各两次', () => {
    expect(count('if (fcStart < pieceCursorFc) pieceCursor = 0')).toBe(2)
    expect(count('pieceCursorFc = fcStart')).toBe(2)
    expect(count('if (pc.fcStart + (pc.cpEnd - pc.cpStart) * (pc.compressed ? 1 : 2) > fcStart) break')).toBe(2)
    expect(count('pi0 = pieceCursor')).toBe(2)
  })

  it('D4 内层早停 break 与游标起点恰各两次，旧全量扫描已消失', () => {
    expect(count('if (piecesAscending && p.fcStart >= fcEnd) break')).toBe(2)
    expect(count('for (let pi = pi0; pi < pieces.length; pi++)')).toBe(2)
    expect(SRC).not.toContain('for (const p of pieces)')
  })

  it('D5 Round 132 契约保持：稳定 sort 未被跳过，且无 sort-skip 残留', () => {
    expect(count('runs.sort((a, b) => a.cpStart - b.cpStart || a.cpEnd - b.cpEnd)')).toBe(2)
    expect(SRC).not.toContain('sortRunsIfNeeded')
    expect(SRC).not.toContain('isSortedByCp')
  })
})
