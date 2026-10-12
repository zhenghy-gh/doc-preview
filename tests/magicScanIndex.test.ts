// Round 142 护栏：把 `WordDocument` 流上的 5 趟原生 `indexOf`（charts 0xD0+0x50 /
// shapes 0xF0 / equations 0xEF / wordart 0xE0）合并成「单趟扫描 + 按锚点分桶的位置表」。
//
// 本文件守住四件事：
//
//   1. **原语等价**：`nextMagicOffset`（桶上二分）与 `Uint8Array.prototype.indexOf`
//      恒等，覆盖回退式 `from`（charts 的 `from = endOffset + 5`、shapes 的
//      `offset = p - 3` 都会让 `from` 落后于已消费的游标）。
//   2. **索引完整**：分桶内容 == 逐个 `indexOf` 的完整枚举，且在 27 份真实流上
//      非空转（总命中数有下界断言）。
//   3. **扫描器双路径一致**：4 个扫描器「传索引」与「不传索引（原生路径）」输出
//      逐项相同。不传索引 = 旧实现，故这条把等价性接到生产路径上。
//   4. **鉴别力**：3 个故意改错的负控必须与 oracle 不同；1 个慢但等价的对照
//      （两趟计数建表 + 线性扫描）必须相同——证明本文件不是「只认某一种写法」。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { OleParser } from '../src/utils/oleParser'
import {
  buildMagicScanIndex,
  nextMagicOffset,
  type MagicScanIndex,
} from '../src/utils/docparser/magicScanIndex'
import { extractChartsFromWordDocumentStream } from '../src/utils/chartParser'
import { extractShapesFromWordDocumentStream } from '../src/utils/shapeParser'
import { extractEquationsFromWordDocumentStream } from '../src/utils/equationParser'
import { extractWordArtFromDrawingData } from '../src/utils/wordArtParser'

/** 与实现同序的 5 个锚点首字节。 */
const LEADS = [0xd0, 0x50, 0xf0, 0xef, 0xe0]

// ── oracle：原生 indexOf 的完整枚举 ─────────────────────────────

/** `[data.indexOf(lead, from) …]` 的全部结果，按升序。 */
function enumerate(data: Uint8Array, lead: number): number[] {
  const out: number[] = []
  let p = data.indexOf(lead, 0)
  while (p >= 0) {
    out.push(p)
    p = data.indexOf(lead, p + 1)
  }
  return out
}

/** 慢但等价的对照：纯线性扫描，不依赖任何索引。`from` 归一化与 `indexOf` 一致。 */
function nextLeadLinear(data: Uint8Array, lead: number, from: number): number {
  let start = Math.trunc(from)
  if (Number.isNaN(start)) start = 0
  else if (start < 0) start = Math.max(data.length + start, 0)
  for (let i = start; i < data.length; i++) if (data[i] === lead) return i
  return -1
}

// ── 独立重建的负控变体 ─────────────────────────────
// 为了让负控真的「改错」而不是复用被测实现，这里独立重写一份建表逻辑。

const SLOT = new Uint8Array(256)
const PAIR_SYM = new Uint8Array(65536)
const PAIR_ASYM = new Uint8Array(65536) // 负控 3 用：只填一半
for (let k = 0; k < LEADS.length; k++) {
  SLOT[LEADS[k]] = k + 1
  for (let o = 0; o < 256; o++) {
    PAIR_SYM[(LEADS[k] << 8) | o] = 1
    PAIR_SYM[(o << 8) | LEADS[k]] = 1
    PAIR_ASYM[(LEADS[k] << 8) | o] = 1 // 漏掉 (o << 8) | lead 那一半
  }
}

type Buckets = number[][]

function bucketize(data: Uint8Array, pair: Uint8Array, tail: boolean): Buckets {
  const buckets: Buckets = LEADS.map(() => [])
  const len = data.length
  let i = 0
  while (i + 1 < len) {
    if (pair[(data[i] << 8) | data[i + 1]] === 0) {
      i += 2
      continue
    }
    const s = SLOT[data[i]]
    if (s !== 0) buckets[s - 1].push(i)
    i++
  }
  if (tail && i < len) {
    const s = SLOT[data[i]]
    if (s !== 0) buckets[s - 1].push(i)
  }
  return buckets
}

/** 慢但等价的对照：两趟计数建表（与单趟 push 版写法完全不同）。 */
function bucketizeTwoPass(data: Uint8Array): Buckets {
  const counts = new Array(LEADS.length).fill(0)
  for (let i = 0; i < data.length; i++) {
    const s = SLOT[data[i]]
    if (s !== 0) counts[s - 1]++
  }
  const buckets: Buckets = LEADS.map((_, k) => new Array(counts[k]))
  const cursor = new Array(LEADS.length).fill(0)
  for (let i = 0; i < data.length; i++) {
    const s = SLOT[data[i]]
    if (s !== 0) buckets[s - 1][cursor[s - 1]++] = i
  }
  return buckets
}

/** 负控 2：二分写成 `<=`，`from` 恰好等于某位置时会跳过它。 */
function nextInclusive(buckets: Buckets, lead: number, from: number): number {
  const s = SLOT[lead]
  if (s === 0) return -1
  const b = buckets[s - 1]
  let lo = 0
  let hi = b.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (b[mid] <= from) lo = mid + 1
    else hi = mid
  }
  return lo < b.length ? b[lo] : -1
}

// ── 语料 ─────────────────────────────

function realWordDocStreams(): Uint8Array[] {
  const docs = new URL('../docs/', import.meta.url)
  const files = fs.readdirSync(docs).filter((name) => /\.(doc|dot)$/.test(name)).sort()
  const out: Uint8Array[] = []
  for (const name of files) {
    const buf = fs.readFileSync(new URL(name, docs))
    const ole = new OleParser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    const header = ole.parseHeader()
    const directory = ole.getDirectorySectors(header, ole.getFatSectors(header))
    const stream = ole.findWordDocumentStream(directory)
    if (stream) out.push(stream.data)
  }
  return out
}

/** 线性同余伪随机（与既有护栏同款），保证用例可复现。 */
function makeRnd(seed: number) {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
}

/** 随机流：均匀字节 + 随机埋入锚点，保证分桶真的非空。 */
function randomStreams(seed: number, count: number, maxLen: number): Uint8Array[] {
  const rnd = makeRnd(seed)
  const out: Uint8Array[] = []
  for (let t = 0; t < count; t++) {
    const n = 1 + Math.floor(rnd() * maxLen)
    const buf = new Uint8Array(n)
    for (let i = 0; i < n; i++) buf[i] = Math.floor(rnd() * 256)
    const k = Math.floor(rnd() * 6)
    for (let j = 0; j < k; j++) {
      const at = Math.floor(rnd() * n)
      buf[at] = LEADS[Math.floor(rnd() * LEADS.length)]
    }
    out.push(buf)
  }
  return out
}

/** 对抗性用例：长度 0/1、锚点铺满、锚点只在首/末字节。 */
function adversarialStreams(): Uint8Array[] {
  const cases: Uint8Array[] = [
    new Uint8Array(0),
    new Uint8Array([0xf0]),
    new Uint8Array([0x41]),
    new Uint8Array([0xd0, 0xf0]),
    new Uint8Array([0x41, 0x42, 0x43, 0xf0]), // 锚点只在末字节
    new Uint8Array([0xf0, 0x41, 0x42, 0x43]), // 锚点只在首字节
    new Uint8Array(64).fill(0xf0), // 锚点铺满
    new Uint8Array(65).fill(0xd0),
    new Uint8Array(33).fill(0x00), // 全零（无锚点）
    new Uint8Array(64).fill(0xef),
  ]
  // 交替锚点/非锚点
  const alt = new Uint8Array(64)
  for (let i = 0; i < alt.length; i++) alt[i] = i % 2 === 0 ? 0x50 : 0x11
  cases.push(alt)
  return cases
}

/** 合成流：真的产出图表，用来给扫描器级差分提供非空转的输入。 */
const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0]
const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04]

function syntheticChartStreams(seed: number, count: number): Uint8Array[] {
  const rnd = makeRnd(seed)
  const out: Uint8Array[] = []
  for (let t = 0; t < count; t++) {
    const n = 900 + Math.floor(rnd() * 2000)
    const buf = new Uint8Array(n).fill(0x41)
    const at = 10 + Math.floor(rnd() * (n - 800))
    const sig = rnd() < 0.5 ? OLE_SIG : ZIP_SIG
    buf.set(sig, at)
    buf.fill(0x42, at + 600, at + 700)
    out.push(buf)
  }
  return out
}

// ── 1. 原语等价 ─────────────────────────────

/** 收集 `nextMagicOffset` 与 `indexOf` 的失配，避免在热循环里逐次 expect。 */
function collectPrimitiveMismatches(buf: Uint8Array, froms: number[]): string[] {
  const index = buildMagicScanIndex(buf)
  const bad: string[] = []
  for (const lead of LEADS) {
    for (const from of froms) {
      const got = nextMagicOffset(index, buf, lead, from)
      const want = buf.indexOf(lead, from)
      if (got !== want) {
        bad.push(`lead=0x${lead.toString(16)} from=${from} got=${got} want=${want}`)
      }
    }
  }
  return bad
}

describe('Round 142 魔数扫描索引：原语等价', () => {
  it('对抗性用例上 nextMagicOffset 与 indexOf 恒等', () => {
    for (const buf of adversarialStreams()) {
      const froms: number[] = []
      for (let from = -3; from <= buf.length + 2; from++) froms.push(from)
      expect(collectPrimitiveMismatches(buf, froms), `len=${buf.length}`).toEqual([])
    }
  })

  it('随机小缓冲上穷尽 from（含负值与越界）', () => {
    for (const buf of randomStreams(20261012, 200, 48)) {
      const froms: number[] = []
      for (let from = -3; from <= buf.length + 2; from++) froms.push(from)
      expect(collectPrimitiveMismatches(buf, froms), `len=${buf.length}`).toEqual([])
    }
  })

  it('27 份真实 WordDocument 流上穷尽全部命中位置 + 回退式 from 序列', () => {
    const streams = realWordDocStreams()
    expect(streams).toHaveLength(27)
    let checked = 0
    let mismatches = 0
    for (const data of streams) {
      const index = buildMagicScanIndex(data)
      for (const lead of LEADS) {
        const positions = enumerate(data, lead)
        // from = 每个命中位置（边界：恰好等于桶内某元素）与其后一位
        for (const p of positions) {
          if (nextMagicOffset(index, data, lead, p) !== p) mismatches++
          if (nextMagicOffset(index, data, lead, p + 1) !== data.indexOf(lead, p + 1)) mismatches++
          checked += 2
        }
        // 回退式序列：from 前进/回退各半，正是 shapes 的 `offset = p - 3` 形态
        let from = 0
        for (let step = 0; step < 400; step++) {
          const got = nextMagicOffset(index, data, lead, from)
          if (got !== data.indexOf(lead, from)) mismatches++
          checked++
          if (got < 0) {
            from = 0
            continue
          }
          const advance = step % 2 === 0 ? 1 + (step % 97) : -(1 + (step % 41))
          from = Math.max(0, got + advance)
        }
        if (nextMagicOffset(index, data, lead, data.length) !== -1) mismatches++
        if (nextMagicOffset(index, data, lead, data.length + 10) !== -1) mismatches++
      }
    }
    expect(mismatches).toBe(0)
    expect(checked).toBeGreaterThan(50000)
  })

  it('负 from / NaN / ±Infinity 的归一化与 indexOf 一致', () => {
    // 0xd0 落在 1、3、4 —— 3 与 4 相邻，用来区分「向零截断」与「向下取整」。
    const buf = new Uint8Array([0x41, 0xd0, 0x41, 0xd0, 0xd0, 0x41])
    const index = buildMagicScanIndex(buf)
    for (const lead of LEADS) {
      for (const from of [-1, -2, -3, -6, -100, NaN, Infinity, -Infinity, 2.5, -2.5]) {
        expect(nextMagicOffset(index, buf, lead, from), `lead=0x${lead.toString(16)} from=${from}`).toBe(
          buf.indexOf(lead, from)
        )
      }
    }
    // 钉死语义：负数相对末尾，且非整数向零截断（不是向下取整）
    expect(buf.indexOf(0xd0, -1)).toBe(-1)
    expect(buf.indexOf(0xd0, -3)).toBe(3)
    expect(nextMagicOffset(index, buf, 0xd0, -3)).toBe(3)
    expect(buf.indexOf(0xd0, -2.5)).toBe(4)
    expect(nextMagicOffset(index, buf, 0xd0, -2.5)).toBe(4)
  })

  it('索引不属于该流、或锚点未入索引时退回原生 indexOf', () => {
    const a = new Uint8Array([0xd0, 0x41, 0x50, 0xf0])
    const b = new Uint8Array([0xf0, 0x42, 0xd0])
    const indexA = buildMagicScanIndex(a)
    // 索引属于 a，却拿去查 b → 必须退回原生
    expect(nextMagicOffset(indexA, b, 0xd0, 0)).toBe(b.indexOf(0xd0, 0))
    // 不传索引
    expect(nextMagicOffset(undefined, a, 0xd0, 0)).toBe(0)
    // 非锚点字节
    expect(nextMagicOffset(indexA, a, 0x41, 0)).toBe(a.indexOf(0x41, 0))
    expect(nextMagicOffset(indexA, a, 0x41, 0)).toBe(1)
  })
})

// ── 2. 索引完整性 ─────────────────────────────

describe('Round 142 魔数扫描索引：分桶内容完整', () => {
  it('合成流上分桶 == 逐个 indexOf 的完整枚举', () => {
    for (const buf of [...randomStreams(777, 300, 400), ...adversarialStreams()]) {
      const { buckets } = buildMagicScanIndex(buf)
      for (let k = 0; k < LEADS.length; k++) {
        expect(buckets[k]).toEqual(enumerate(buf, LEADS[k]))
      }
    }
  })

  it('27 份真实流上分桶完整且非空转（总命中数有下界）', () => {
    const streams = realWordDocStreams()
    let total = 0
    for (const data of streams) {
      const { buckets } = buildMagicScanIndex(data)
      for (let k = 0; k < LEADS.length; k++) {
        const expected = enumerate(data, LEADS[k])
        expect(buckets[k]).toEqual(expected)
        total += expected.length
      }
    }
    // 实测五锚点并集 0.970%（55 957 个偏移）；下界断言防止护栏退化为空转。
    expect(total).toBeGreaterThan(50000)
  })

  it('末字节是锚点时也被收录（漏掉收尾会让该偏移永久失配）', () => {
    const buf = new Uint8Array([0x41, 0x42, 0x43, 0xf0])
    expect(buildMagicScanIndex(buf).buckets[2]).toEqual([3])
  })

  it('锚点铺满时不丢偏移，且桶长等于流长', () => {
    for (const lead of LEADS) {
      const buf = new Uint8Array(1000).fill(lead)
      const k = LEADS.indexOf(lead)
      const bucket = buildMagicScanIndex(buf).buckets[k]
      expect(bucket).toHaveLength(1000)
      expect(bucket[0]).toBe(0)
      expect(bucket[999]).toBe(999)
    }
  })
})

// ── 3. 扫描器双路径一致 ─────────────────────────────

describe('Round 142 魔数扫描索引：扫描器传索引与不传索引逐项一致', () => {
  const scanners: Array<[string, (d: Uint8Array, ix?: MagicScanIndex) => unknown]> = [
    ['charts', (d, ix) => extractChartsFromWordDocumentStream(d, ix)],
    ['shapes', (d, ix) => extractShapesFromWordDocumentStream(d, ix)],
    ['equations', (d, ix) => extractEquationsFromWordDocumentStream(d, ix)],
    ['wordart', (d, ix) => extractWordArtFromDrawingData(d, ix)],
  ]

  it('27 份真实流上四个扫描器双路径一致', () => {
    const streams = realWordDocStreams()
    expect(streams).toHaveLength(27)
    for (const data of streams) {
      const index = buildMagicScanIndex(data)
      for (const [name, run] of scanners) {
        expect(run(data, index), `${name} 双路径不一致`).toEqual(run(data))
      }
    }
  })

  it('合成流（真的产出图表）双路径一致，且产出非空', () => {
    const streams = syntheticChartStreams(4242, 120)
    let produced = 0
    for (const data of streams) {
      const index = buildMagicScanIndex(data)
      for (const [name, run] of scanners) {
        expect(run(data, index), `${name} 双路径不一致`).toEqual(run(data))
      }
      produced += extractChartsFromWordDocumentStream(data, index).length
    }
    // 鉴别力：合成语料必须真的产出图表，否则本用例只是空转
    expect(produced).toBeGreaterThan(0)
  })

  it('对抗性长度上四个扫描器双路径一致', () => {
    for (const data of adversarialStreams()) {
      const index = buildMagicScanIndex(data)
      for (const [name, run] of scanners) {
        expect(run(data, index), `${name} 双路径不一致`).toEqual(run(data))
      }
    }
  })
})

// ── 4. 鉴别力：负控必须失败，慢但等价的对照必须通过 ─────────────────────────────

describe('Round 142 魔数扫描索引：护栏鉴别力', () => {
  it('慢但等价的对照（两趟计数建表 + 线性扫描）与 oracle 相同', () => {
    for (const buf of [...randomStreams(31337, 120, 300), ...adversarialStreams()]) {
      const twoPass = bucketizeTwoPass(buf)
      for (let k = 0; k < LEADS.length; k++) {
        expect(twoPass[k]).toEqual(buildMagicScanIndex(buf).buckets[k])
        expect(twoPass[k]).toEqual(enumerate(buf, LEADS[k]))
      }
      const bad: string[] = []
      for (const lead of LEADS) {
        for (let from = -2; from <= buf.length + 1; from++) {
          const got = nextLeadLinear(buf, lead, from)
          const want = buf.indexOf(lead, from)
          if (got !== want) bad.push(`lead=0x${lead.toString(16)} from=${from} got=${got} want=${want}`)
        }
      }
      expect(bad, `len=${buf.length}`).toEqual([])
    }
  })

  it('负控 1（漏掉末字节收尾）必须与 oracle 不同', () => {
    const buf = new Uint8Array([0x41, 0x42, 0x43, 0xf0])
    const broken = bucketize(buf, PAIR_SYM, false)
    // oracle：末字节的 0xF0 应被收录
    expect(enumerate(buf, 0xf0)).toEqual([3])
    expect(broken[2]).toEqual([])
    expect(nextInclusive(broken, 0xf0, 0)).not.toBe(buf.indexOf(0xf0, 0))
  })

  it('负控 2（二分写成 <=，跳过恰好相等的 from）必须与 oracle 不同', () => {
    const buf = new Uint8Array([0xd0, 0x41, 0xd0])
    const buckets = bucketize(buf, PAIR_SYM, true)
    expect(enumerate(buf, 0xd0)).toEqual([0, 2])
    expect(nextInclusive(buckets, 0xd0, 0)).toBe(2)
    expect(buf.indexOf(0xd0, 0)).toBe(0)
    expect(nextInclusive(buckets, 0xd0, 0)).not.toBe(buf.indexOf(0xd0, 0))
  })

  it('负控 3（字节对查表只填一半）必须漏掉偶数位之后的锚点', () => {
    const buf = new Uint8Array([0x41, 0xd0, 0x41, 0x41])
    const broken = bucketize(buf, PAIR_ASYM, true)
    const good = bucketize(buf, PAIR_SYM, true)
    expect(good[0]).toEqual([1])
    expect(broken[0]).toEqual([])
    expect(nextInclusive(broken, 0xd0, 0)).not.toBe(buf.indexOf(0xd0, 0))
  })
})

// ── 5. 复杂度护栏 ─────────────────────────────

describe('Round 142 魔数扫描索引：线性时间', () => {
  it('5.8 MB 全锚点缓冲区建表在线性时间内完成', () => {
    const N = 5_800_000
    for (const lead of LEADS) {
      const buf = new Uint8Array(N).fill(lead)
      const t = performance.now()
      const { buckets } = buildMagicScanIndex(buf)
      const ms = performance.now() - t
      const k = LEADS.indexOf(lead)
      expect(buckets[k]).toHaveLength(N)
      expect(ms, `fill=0x${lead.toString(16)} 建表耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
    }
  })

  it('5.8 MB 稀疏锚点缓冲区建表在线性时间内完成', () => {
    const N = 5_800_000
    const buf = new Uint8Array(N).fill(0x41)
    for (let o = 0; o < N; o += 751) buf[o] = 0xe0
    const t = performance.now()
    const { buckets } = buildMagicScanIndex(buf)
    const ms = performance.now() - t
    expect(buckets[4].length).toBeGreaterThan(7000)
    expect(ms, `稀疏建表耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
  })
})
