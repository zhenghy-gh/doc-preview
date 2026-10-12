/**
 * Round 146 护栏：一次解析内的表格流（0Table/1Table）共享缓存。
 *
 * 背景：一次 `parseWithFormat()` 经 5 个上游入口反复调 `findTableStream`，
 * 每次都 `readStream` 出一份新的表格流拷贝（真实 27 份语料实测
 * 141 次调用、重复读取 4.78 MB）。本轮把解析结果按 `which`(0|1) 在
 * `ClxContext.tableStreams` 里共享，miss 才走 `findTableStream`。
 *
 * 护栏分四组：
 *   1. 等价性：带缓存 / 不带缓存两条路径在 27 份真实语料上逐字节一致，
 *      重复命中返回同一对象且内容不变；oracle（不带缓存）同时充当
 *      「慢但等价的对照」。
 *   2. 真实覆盖：27 份文件每份都命中缓存（不是空转分支）；无表格流的
 *      合成目录下 miss 的 `null` 也被缓存（findTableStream 只解析一次）。
 *   3. 只读性：缓存对象会被多个消费方共享，逐一运行真实消费函数
 *      （CHPX/PAPX/STSH/Ffn/LST/LFO/Fld/RMark/书签/分节/DOP/PlcfHdd），
 *      断言共享数组字节不变——这是本优化可证明等价的关键前提。
 *   4. 鉴别力：3 个独立重写的负控变体（键错 / 跨文档不清 / 命中返回
 *      切片）必须与 oracle 不同；字节不变性断言本身有篡改检测的元断言。
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { readClxData, readTableStream, type ClxContext } from '../src/utils/docparser/clxReader'
import { OleParser } from '../src/utils/oleParser'
import { parseFib } from '../src/utils/fibParser'
import { readUint16, readUint32 } from '../src/utils/binaryReader'
import {
  parseChpxRuns,
  parseChpxRunsFromFkp,
  parsePapxRuns,
  parsePapxRunsFromFkp,
} from '../src/utils/formatParser'
import { parseSttbfRMark } from '../src/utils/revisionParser'
import { parseStylesheet } from '../src/utils/styleParser'
import { parseFontTable } from '../src/utils/fontParser'
import { parseListTable, parsePlcfLfo } from '../src/utils/listParser'
import { parsePlcfFld } from '../src/utils/fieldParser'
import { extractBookmarks } from '../src/utils/bookmarkParser'
import { extractSections } from '../src/utils/sectionParser'
import { parsePlcfHdd } from '../src/utils/headerFooterParser'
import { parseDop } from '../src/utils/dopParser'
import { parseClxPieces } from '../src/utils/docparser/pieceTable'
import type { FibData } from '../src/utils/fibParser'
import type { DirectoryEntry } from '../src/utils/oleParser'

const docsDir = new URL('../docs/', import.meta.url)

interface RealDoc {
  name: string
  ole: OleParser
  directory: DirectoryEntry[]
  word: Uint8Array
  fib: FibData
  /** 不带缓存的参照表格流（每次 findTableStream 的新副本）。 */
  refTable: Uint8Array
}

function loadRealDocs(): RealDoc[] {
  const files = readdirSync(docsDir).filter((f) => f.endsWith('.doc') || f.endsWith('.dot')).sort()
  const out: RealDoc[] = []
  for (const name of files) {
    const bytes = readFileSync(new URL(name, docsDir))
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const ole = new OleParser(ab)
    const header = ole.parseHeader()
    const directory = ole.getDirectorySectors(header, ole.getFatSectors(header))
    const word = ole.findWordDocumentStream(directory)?.data
    if (!word) throw new Error(`缺少 WordDocument：${name}`)
    const fib = parseFib(word)
    if (!fib) throw new Error(`缺少 FIB：${name}`)
    const which: 0 | 1 = fib.fWhichTblStm ? 1 : 0
    const refTable = ole.findTableStream(directory, which)?.data ?? new Uint8Array(0)
    out.push({ name, ole, directory, word, fib, refTable })
  }
  return out
}

function makeCtx(doc: RealDoc, cache?: Map<0 | 1, unknown>): ClxContext {
  return {
    ole: doc.ole,
    maxTotalChars: 10 * 1024 * 1024,
    readUint16,
    readUint32,
    tableStreams: cache as ClxContext['tableStreams'],
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

/** 与生产 parseFormatRuns/storySplitter/documentAssets 相同的守卫条件下运行全部真实消费函数。 */
function runAllConsumers(table: Uint8Array, word: Uint8Array, fib: FibData): number {
  let touched = 0
  if (fib.lcbPlcfBteChpx > 0 && fib.fcPlcfBteChpx + fib.lcbPlcfBteChpx <= table.length) {
    touched += parseChpxRuns(table, fib.fcPlcfBteChpx, fib.lcbPlcfBteChpx).length
    const pieces = parseClxPieces(
      { maxTotalChars: 10 * 1024 * 1024, readUint16, readUint32 },
      table.subarray(fib.fcClx, fib.fcClx + fib.lcbClx),
    ).map((p) => ({ cpStart: p.cpStart, cpEnd: p.cpEnd, fcStart: p.fcValue, compressed: p.fCompressed }))
    touched += parseChpxRunsFromFkp(table, word, fib.fcPlcfBteChpx, fib.lcbPlcfBteChpx, pieces).length
    touched += parsePapxRunsFromFkp(table, word, fib.fcPlcfBtePapx, fib.lcbPlcfBtePapx, pieces).length
  }
  if (fib.lcbPlcfBtePapx > 0 && fib.fcPlcfBtePapx + fib.lcbPlcfBtePapx <= table.length) {
    touched += parsePapxRuns(table, fib.fcPlcfBtePapx, fib.lcbPlcfBtePapx).length
  }
  if (fib.fcSttbfRMark !== undefined && fib.lcbSttbfRMark !== undefined &&
      fib.lcbSttbfRMark > 0 && fib.fcSttbfRMark + fib.lcbSttbfRMark <= table.length) {
    touched += parseSttbfRMark(table, fib.fcSttbfRMark, fib.lcbSttbfRMark).length
  }
  if (fib.lcbStshf > 0 && fib.fcStshf + fib.lcbStshf <= table.length) {
    touched += parseStylesheet(table, fib.fcStshf, fib.lcbStshf).length
    touched += parseStylesheet(table, 0, table.length).length
  }
  if (fib.lcbSttbfFfn > 0 && fib.fcSttbfFfn + fib.lcbSttbfFfn <= table.length) {
    touched += parseFontTable(table, fib.fcSttbfFfn, fib.lcbSttbfFfn).length
  }
  if (fib.lcbLst > 0 && fib.fcLst + fib.lcbLst <= table.length) {
    touched += parseListTable(table, fib.fcLst, fib.lcbLst).length
  }
  if (fib.lcbPlcfLfo > 0 && fib.fcPlcfLfo + fib.lcbPlcfLfo <= table.length) {
    touched += parsePlcfLfo(table, fib.fcPlcfLfo, fib.lcbPlcfLfo).length
  }
  if (fib.lcbPlcfFldMom > 0 && fib.fcPlcfFldMom + fib.lcbPlcfFldMom <= table.length) {
    touched += parsePlcfFld(table, fib.fcPlcfFldMom, fib.lcbPlcfFldMom).length
  }
  if (fib.fcPlcfBkf !== undefined && fib.lcbPlcfBkf !== undefined &&
      fib.fcPlcfBkl !== undefined && fib.lcbPlcfBkl !== undefined &&
      fib.fcSttbfBkmk !== undefined && fib.lcbSttbfBkmk !== undefined) {
    touched += extractBookmarks(
      table, fib.fcPlcfBkf, fib.lcbPlcfBkf, fib.fcPlcfBkl, fib.lcbPlcfBkl,
      fib.fcSttbfBkmk, fib.lcbSttbfBkmk,
    ).length
  }
  if (fib.lcbPlcfSed > 0 && fib.fcPlcfSed + fib.lcbPlcfSed <= table.length) {
    touched += extractSections(table, word, fib.fcPlcfSed, fib.lcbPlcfSed).length
  }
  if (fib.lcbDop > 0 && fib.fcDop > 0 && fib.fcDop + fib.lcbDop <= table.length) {
    touched += parseDop(table.subarray(fib.fcDop, fib.fcDop + fib.lcbDop)) ? 1 : 0
  }
  if (fib.lcbPlcfHdd > 0 && fib.fcPlcfHdd > 0 && fib.fcPlcfHdd + fib.lcbPlcfHdd <= table.length) {
    touched += parsePlcfHdd(table.subarray(fib.fcPlcfHdd, fib.fcPlcfHdd + fib.lcbPlcfHdd), false, false) ? 1 : 0
  }
  return touched
}

// ── 1. 等价性：带缓存 / 不带缓存在 27 份真实语料上逐字节一致 ──────────────

describe('Round 146 表格流缓存：与不带缓存路径等价（真实语料）', () => {
  const docs = loadRealDocs()

  it('27 份真实文件 readTableStream 双路径逐字节一致，命中返回同一对象', () => {
    for (const doc of docs) {
      const plain = readTableStream(makeCtx(doc), doc.fib, doc.directory)
      const cache = new Map<0 | 1, unknown>()
      const cached1 = readTableStream(makeCtx(doc, cache), doc.fib, doc.directory)
      const cached2 = readTableStream(makeCtx(doc, cache), doc.fib, doc.directory)
      expect(plain, doc.name).not.toBeNull()
      expect(cached1, doc.name).not.toBeNull()
      expect(sameBytes(plain!, doc.refTable), doc.name).toBe(true)
      expect(sameBytes(cached1!, doc.refTable), doc.name).toBe(true)
      // 命中复用同一对象（这是本优化的目的），且两次内容一致。
      expect(cached2, doc.name).toBe(cached1)
      expect(sameBytes(cached2!, doc.refTable), doc.name).toBe(true)
    }
  })

  it('27 份真实文件 readClxData 双路径逐字节一致，重复调用稳定', () => {
    for (const doc of docs) {
      const plain = readClxData(makeCtx(doc), doc.fib, doc.word, doc.directory)
      const cache = new Map<0 | 1, unknown>()
      const cached1 = readClxData(makeCtx(doc, cache), doc.fib, doc.word, doc.directory)
      const cached2 = readClxData(makeCtx(doc, cache), doc.fib, doc.word, doc.directory)
      if (plain === null) {
        expect(cached1, doc.name).toBeNull()
        continue
      }
      expect(cached1, doc.name).not.toBeNull()
      expect(sameBytes(plain, cached1!), doc.name).toBe(true)
      expect(sameBytes(plain, cached2!), doc.name).toBe(true)
    }
  })

  it('which=0 与 which=1 在同一缓存里互不串键（合成双表格流文件）', () => {
    // 单缓存 Map 同时服务两个 which：各自解析一次、互不污染。
    const fixture = buildTwoTableOle()
    const ole = new OleParser(fixture.buf)
    const header = ole.parseHeader()
    const directory = ole.getDirectorySectors(header, ole.getFatSectors(header))
    const word = ole.findWordDocumentStream(directory)!.data
    const cache = new Map<0 | 1, unknown>()
    const ctx = (): ClxContext => ({
      ole, maxTotalChars: 1e7, readUint16, readUint32, tableStreams: cache as ClxContext['tableStreams'],
    })
    const fib1 = parseFib(word)!
    expect(fib1.fWhichTblStm).toBeTruthy()
    const via1 = readTableStream(ctx(), fib1, directory)
    expect(via1).not.toBeNull()
    expect(sameBytes(via1!, fixture.table1), 'which=1 必须拿到 1Table').toBe(true)
    const fib0 = { ...fib1, fWhichTblStm: false }
    const via0 = readTableStream(ctx(), fib0, directory)
    expect(via0).not.toBeNull()
    expect(sameBytes(via0!, fixture.table0), 'which=0 必须拿到 0Table').toBe(true)
    // readClxData 走 which=1 时必须切的是 1Table 的 CLX，不是 0Table 的垃圾。
    const clx = readClxData(ctx(), fib1, word, directory)
    expect(clx).not.toBeNull()
    expect(sameBytes(clx!, fixture.table1.subarray(0, 32))).toBe(true)
  })
})

// ── 2. 真实覆盖与 miss 缓存 ───────────────────────────────────────────────

describe('Round 146 表格流缓存：真实覆盖与 null miss', () => {
  const docs = loadRealDocs()

  it('27 份文件每份都命中缓存（findTableStream 每文件只解析一次）', () => {
    let filesWithHits = 0
    for (const doc of docs) {
      const counting = makeCountingOle(doc.ole)
      const cache = new Map<0 | 1, unknown>()
      const ctx: ClxContext = {
        ole: counting.ole, maxTotalChars: 1e7, readUint16, readUint32,
        tableStreams: cache as ClxContext['tableStreams'],
      }
      const CALLS = 5 // 真实均值 5.22 次/文件
      for (let i = 0; i < CALLS; i++) {
        const d = readTableStream(ctx, doc.fib, doc.directory)
        expect(d, doc.name).not.toBeNull()
        expect(sameBytes(d!, doc.refTable), doc.name).toBe(true)
      }
      expect(counting.calls(), doc.name).toBe(1) // 只有第一次 miss 解析
      filesWithHits++
    }
    expect(filesWithHits).toBe(27)
  })

  it('无表格流时 miss 的 null 也被缓存（不反复重解析）', () => {
    const doc = loadRealDocs()[0]
    const counting = makeCountingOle(doc.ole)
    const cache = new Map<0 | 1, unknown>()
    const ctx: ClxContext = {
      ole: counting.ole, maxTotalChars: 1e7, readUint16, readUint32,
      tableStreams: cache as ClxContext['tableStreams'],
    }
    const emptyDir: DirectoryEntry[] = [] // 没有任何流条目
    for (let i = 0; i < 5; i++) {
      expect(readTableStream(ctx, doc.fib, emptyDir)).toBeNull()
    }
    expect(counting.calls()).toBe(1)
    expect(cache.has(doc.fib.fWhichTblStm ? 1 : 0)).toBe(true)
    expect(cache.get(doc.fib.fWhichTblStm ? 1 : 0)).toBeNull()
  })
})

// ── 3. 只读性：共享数组经过全部真实消费函数后字节不变 ────────────────────

describe('Round 146 表格流缓存：共享数组对全部真实消费函数只读', () => {
  const docs = loadRealDocs()

  it('27 份真实文件运行全部消费函数后共享表格流逐字节不变', () => {
    let consumersRan = 0
    for (const doc of docs) {
      const cache = new Map<0 | 1, unknown>()
      const shared = readTableStream(makeCtx(doc, cache), doc.fib, doc.directory)!
      const before = Uint8Array.from(shared)
      consumersRan += runAllConsumers(shared, doc.word, doc.fib)
      expect(sameBytes(shared, before), doc.name).toBe(true)
      // 再跑一遍（模拟后续消费方依旧拿到未被污染的缓存）
      consumersRan += runAllConsumers(shared, doc.word, doc.fib)
      expect(sameBytes(shared, before), doc.name).toBe(true)
    }
    expect(consumersRan).toBeGreaterThan(1000) // 真实产出断言：消费函数确实跑过
  })

  it('元断言：字节比对方法对篡改敏感（证明上一条不是空转）', () => {
    const doc = loadRealDocs()[0]
    const cache = new Map<0 | 1, unknown>()
    const shared = readTableStream(makeCtx(doc, cache), doc.fib, doc.directory)!
    const before = Uint8Array.from(shared)
    shared[0] = shared[0] ^ 0xff
    expect(sameBytes(shared, before)).toBe(false)
  })
})

// ── 4. 鉴别力：负控必须与 oracle 不同 ─────────────────────────────────────

/**
 * 独立重写的缓存解析骨架（不复用被测实现），mode 注入 4 类典型错误。
 */
function resolveCached(
  ole: OleParser,
  directory: DirectoryEntry[],
  which: 0 | 1,
  cache: Map<0 | 1, unknown> | undefined,
  mode: 'none' | 'wrongKey' | 'sliceHit',
): Uint8Array | null {
  const key: 0 | 1 = mode === 'wrongKey' ? 0 : which
  if (cache) {
    const hit = cache.get(key)
    if (hit !== undefined) {
      const data = hit as Uint8Array | null
      if (mode === 'sliceHit' && data) return data.subarray(0, 4)
      return data
    }
  }
  const stream = ole.findTableStream(directory, key)
  const data = stream ? stream.data : null
  cache?.set(key, data)
  return data
}

describe('Round 146 表格流缓存：护栏鉴别力', () => {
  const docs = loadRealDocs()

  it('负控 wrongKey（键恒为 0）在双表格流文件上给出错误流', () => {
    const fixture = buildTwoTableOle()
    const ole = new OleParser(fixture.buf)
    const header = ole.parseHeader()
    const directory = ole.getDirectorySectors(header, ole.getFatSectors(header))
    const got = resolveCached(ole, directory, 1, new Map(), 'wrongKey')
    // which=1 却拿到 0Table 的垃圾（与 oracle=1Table 不同）。
    expect(sameBytes(got!, fixture.table0)).toBe(true)
    expect(sameBytes(got!, fixture.table1)).toBe(false)
  })

  it('负控 sliceHit（命中返回 4 字节切片）与 oracle 不同', () => {
    for (const doc of docs) {
      const shared = new Map<0 | 1, unknown>()
      resolveCached(doc.ole, doc.directory, doc.fib.fWhichTblStm ? 1 : 0, shared, 'sliceHit') // 首次 miss
      const got = resolveCached(doc.ole, doc.directory, doc.fib.fWhichTblStm ? 1 : 0, shared, 'sliceHit') // 命中返回切片
      expect(got!.length).toBe(4)
      expect(sameBytes(got!, doc.refTable), doc.name).toBe(false)
    }
  })

  it('负控 stale（跨文档不清缓存）会把上一份文档的流发给下一份', () => {
    const [a, b] = docs
    const shared = new Map<0 | 1, unknown>()
    const first = resolveCached(a.ole, a.directory, a.fib.fWhichTblStm ? 1 : 0, shared, 'none')
    const second = resolveCached(b.ole, b.directory, b.fib.fWhichTblStm ? 1 : 0, shared, 'none')
    expect(second).toBe(first) // 串文档：拿到的是 a 的流
    expect(sameBytes(second!, b.refTable)).toBe(false) // 与 b 的 oracle 不同
    // 对照：每次新 Map（=生产每轮 clear）时两份各自正确。
    const secondFresh = resolveCached(b.ole, b.directory, b.fib.fWhichTblStm ? 1 : 0, new Map(), 'none')
    expect(sameBytes(secondFresh!, b.refTable)).toBe(true)
  })

  it('慢但等价的对照（不带缓存）与生产带缓存路径在 27 份上一致', () => {
    for (const doc of docs) {
      const slow = resolveCached(doc.ole, doc.directory, doc.fib.fWhichTblStm ? 1 : 0, undefined, 'none')
      const fast = readTableStream(makeCtx(doc, new Map()), doc.fib, doc.directory)
      expect(sameBytes(slow!, fast!), doc.name).toBe(true)
    }
  })
})

// ── 辅助：计数包装与双表格流 OLE 夹具 ─────────────────────────────────────

function makeCountingOle(ole: OleParser): { ole: OleParser; calls: () => number } {
  let calls = 0
  const wrapped = new Proxy(ole, {
    get(target, prop, receiver) {
      if (prop === 'findTableStream') {
        return (...args: Parameters<OleParser['findTableStream']>) => {
          calls++
          return Reflect.apply(target.findTableStream, target, args)
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { ole: wrapped as unknown as OleParser, calls: () => calls }
}

/**
 * 合成 OLE：WordDocument + 0Table（0xAA 垃圾）+ 1Table（合法 CLX）。
 * FIB 的 fWhichTblStm=1，fcClx/lcbClx 指向 1Table 内的 CLX。
 */
function buildTwoTableOle(): { buf: ArrayBuffer; table0: Uint8Array; table1: Uint8Array } {
  const SECTOR = 512
  const buf = new ArrayBuffer(SECTOR * 6)
  const view = new Uint8Array(buf)
  const writeU16 = (off: number, val: number) => { view[off] = val & 0xff; view[off + 1] = (val >> 8) & 0xff }
  const writeU32 = (off: number, val: number) => {
    view[off] = val & 0xff; view[off + 1] = (val >> 8) & 0xff
    view[off + 2] = (val >> 16) & 0xff; view[off + 3] = (val >> 24) & 0xff
  }
  // Header
  view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
  view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
  writeU16(26, 3); writeU16(30, 9); writeU16(32, 6)
  writeU32(48, 1); writeU32(56, 4096)
  writeU32(60, 0xFFFFFFFE); writeU32(64, 0)
  writeU32(68, 0xFFFFFFFE); writeU32(72, 0)
  writeU32(76, 0)
  for (let i = 1; i < 109; i++) writeU32(76 + i * 4, 0xFFFFFFFF)
  // Sector 0: FAT（sector 0..5 各自成链）
  const fatBase = SECTOR
  writeU32(fatBase + 0 * 4, 0xFFFFFFFE)
  writeU32(fatBase + 1 * 4, 0xFFFFFFFE)
  writeU32(fatBase + 2 * 4, 0xFFFFFFFE)
  writeU32(fatBase + 3 * 4, 0xFFFFFFFE)
  writeU32(fatBase + 4 * 4, 0xFFFFFFFE)
  writeU32(fatBase + 5 * 4, 0xFFFFFFFE)
  for (let i = 6; i < 128; i++) writeU32(fatBase + i * 4, 0xFFFFFFFF)
  // Sector 1: Directory
  const dirBase = SECTOR * 2
  const writeDirEntry = (off: number, name: string, type: number, start: number, size: number) => {
    for (let i = 0; i < name.length; i++) writeU16(off + i * 2, name.charCodeAt(i))
    writeU16(off + 64, name.length * 2)
    view[off + 66] = type
    view[off + 67] = 1
    writeU32(off + 116, start)
    writeU32(off + 120, size)
  }
  writeDirEntry(dirBase + 0 * 128, 'Root Entry', 5, 0xFFFFFFFE, 0)
  writeDirEntry(dirBase + 1 * 128, 'WordDocument', 2, 2, 512)
  writeDirEntry(dirBase + 2 * 128, '0Table', 2, 3, 64)
  writeDirEntry(dirBase + 3 * 128, '1Table', 2, 4, 64)
  // Sector 2: WordDocument（FIB，fcClx 指向 1Table 偏移 0）
  const wdBase = SECTOR * 3
  writeU16(0 + wdBase, 0xA5EC)
  writeU16(2 + wdBase, 0x0101)
  writeU16(10 + wdBase, 1 << 9) // fComplex=0, fWhichTblStm=1
  writeU16(32 + wdBase, 0)
  writeU16(34 + wdBase, 22)
  writeU32(36 + 12 + wdBase, 11) // ccpText = 11
  writeU16(124 + wdBase, 34)
  const clxSize = 32
  writeU32(390 + wdBase, 0)       // fcClx = 0（1Table 内偏移）
  writeU32(394 + wdBase, clxSize) // lcbClx = 32
  const textOffset = 400
  const text = 'Hello World'
  for (let i = 0; i < text.length; i++) writeU16(textOffset + i * 2 + wdBase, text.charCodeAt(i))
  // Sector 3: 0Table = 0xAA 垃圾
  const t0Base = SECTOR * 4
  for (let i = 0; i < 64; i++) view[t0Base + i] = 0xAA
  // Sector 4: 1Table = 合法 CLX（bare Pcdt, 1 piece → WordDocument textOffset）
  const t1Base = SECTOR * 5
  view[t1Base + 0] = 0x02
  writeU32(t1Base + 1, 16)
  writeU32(t1Base + 5, 0)
  writeU32(t1Base + 9, 11)
  writeU32(t1Base + 13 + 2, textOffset)
  return {
    buf,
    table0: view.slice(t0Base, t0Base + 64),
    table1: view.slice(t1Base, t1Base + 64),
  }
}
