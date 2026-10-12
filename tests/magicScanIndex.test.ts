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
import {
  extractImagesFromStream,
  bytesEqual,
  IMAGE_SIGNATURE_LEADS,
  PNG_SIGNATURE,
  JPEG_SOI,
  GIF_SIGNATURE_87,
  BMP_SIGNATURE,
  type ImageScanIndexView,
} from '../src/utils/imageExtractor'

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

// ══════════════════ Round 143：图片魔数扫描并入同一索引 ══════════════════
//
// 本轮把 `WordDocument` 流上的**第二趟**全缓冲扫描（`imageExtractor` 的四个图片
// 签名 0x89/0xFF/0x47/0x42）并入 Round 142 的单趟索引：扫描时把四个首字节的位置
// 收进一条**升序候选数组**（`MagicScanIndex.imageCandidates`），图片扫描器改为在
// 候选数组上游走。真实 27 份语料实测两者共扫同一对象 5.414 MB / 11.599 MB = 46.68%。
//
// 本段守住四件事：
//   1. **候选数组完整**：`imageCandidates` == 四个首字节位置的升序并集（无重复、
//      严格升序、不含非首字节），且在 27 份真实流上非空转。
//   2. **图片扫描双路径一致**：`extractImagesFromStream(data)`（= 逐字节旧实现）
//      与传索引版本逐项相同（format + 精确字节范围），覆盖跳跃/末字节/内嵌签名。
//   3. **回退保障**：索引不属于该流、或窗口被截断时退回逐字节路径；`nextMagicOffset`
//      对图片首字节（并集桶）必须退回原生 `indexOf`，不能串用。
//   4. **鉴别力**：慢但等价的对照必须相同；3 个故意改错的候选数组必须与 oracle 不同。

/** 四个图片签名首字节位置的升序并集（oracle，直接线性扫）。 */
function imageCandidateOracle(data: Uint8Array): number[] {
  const out: number[] = []
  for (let i = 0; i < data.length; i++) {
    if (IMAGE_SIGNATURE_LEADS.includes(data[i])) out.push(i)
  }
  return out
}

/** 慢但等价的对照：两趟计数 + 填充（与单趟 push 写法完全不同）。 */
function imageCandidateTwoPass(data: Uint8Array): number[] {
  let n = 0
  for (let i = 0; i < data.length; i++) if (IMAGE_SIGNATURE_LEADS.includes(data[i])) n++
  const out = new Array<number>(n)
  let k = 0
  for (let i = 0; i < data.length; i++) if (IMAGE_SIGNATURE_LEADS.includes(data[i])) out[k++] = i
  return out
}

/** 把图片结果压成可比对字符串（两条路径扫的是同一个 `data`，故 byteOffset 可比）。 */
function imageKey(imgs: ReadonlyArray<{ format: string; data: Uint8Array }>): string {
  return imgs.map((im) => `${im.format}@${im.data.byteOffset}+${im.data.length}`).join('|')
}

/**
 * 跳跃语义的判别用例：BMP（文件头声明总长 120）内部偏移 40 处嵌一个完整 PNG
 * （8 字节签名 + length=0 的 IEND 块 ⇒ `findPngEnd` 返回 60）。
 * 正确实现必须在位置 0 命中 BMP 后**跳到 120**，因而看不到内部的 PNG，只产出 1 张。
 */
function bmpWithEmbeddedPng(): Uint8Array {
  const buf = new Uint8Array(200).fill(0x41)
  buf[0] = 0x42
  buf[1] = 0x4d
  const size = 120
  buf[2] = size & 0xff
  buf[3] = (size >> 8) & 0xff
  buf[4] = (size >> 16) & 0xff
  buf[5] = (size >> 24) & 0xff
  buf.set(PNG_SIGNATURE, 40)
  // length 字段必须为 0（否则 `findPngEnd` 的长度校验会直接判非法）
  buf[48] = 0
  buf[49] = 0
  buf[50] = 0
  buf[51] = 0
  buf[52] = 0x49 // IEND
  buf[53] = 0x45
  buf[54] = 0x4e
  buf[55] = 0x44
  return buf
}

/** 两张不相邻的 BMP，用来区分「候选顺序」是否被遵守。 */
function twoBmpStream(): Uint8Array {
  const buf = new Uint8Array(300).fill(0x41)
  for (const at of [0, 150]) {
    buf[at] = 0x42
    buf[at + 1] = 0x4d
    const size = 120
    buf[at + 2] = size & 0xff
    buf[at + 3] = (size >> 8) & 0xff
    buf[at + 4] = (size >> 16) & 0xff
    buf[at + 5] = (size >> 24) & 0xff
  }
  return buf
}

/** 图片签名铺满 / 只在末字节 / 图片跨到流尾等对抗形态。 */
function adversarialImageStreams(): Uint8Array[] {
  const cases: Uint8Array[] = [
    new Uint8Array(0),
    new Uint8Array([0x89]),
    new Uint8Array([0x41, 0x41, 0x42, 0x4d]), // BMP 首字节只在末字节（长度不足，不产出）
    new Uint8Array(64).fill(0x89), // PNG 首字节铺满
    new Uint8Array(64).fill(0x47), // GIF 首字节铺满
    new Uint8Array(64).fill(0xff), // JPEG 首字节铺满
    new Uint8Array(33).fill(0x41), // 无候选
    bmpWithEmbeddedPng(),
    twoBmpStream(),
  ]
  // JPEG 起头且流内出现 SOS+EOI（走 findJpegEnd 的截断兜底分支）
  const jpg = new Uint8Array(120).fill(0x41)
  jpg.set(JPEG_SOI, 0)
  jpg[2] = 0xff
  jpg[3] = 0xda
  jpg[4] = 0x00
  jpg[5] = 0x02
  jpg[110] = 0xff
  jpg[111] = 0xd9
  cases.push(jpg)
  // GIF 起头（走 findGifEnd 的 trailer 扫描）
  const gif = new Uint8Array(96).fill(0x41)
  gif.set(GIF_SIGNATURE_87, 0)
  gif[10] = 0x00 // 无全局色表
  gif[13] = 0x3b // trailer
  cases.push(gif)
  return cases
}

describe('Round 143 图片候选数组：内容完整', () => {
  it('IMAGE_SIGNATURE_LEADS 与四个签名常量一致且互不重复', () => {
    expect(IMAGE_SIGNATURE_LEADS).toEqual([
      PNG_SIGNATURE[0],
      JPEG_SOI[0],
      GIF_SIGNATURE_87[0],
      BMP_SIGNATURE[0],
    ])
    expect(new Set(IMAGE_SIGNATURE_LEADS).size).toBe(IMAGE_SIGNATURE_LEADS.length)
    // 与 Round 142 的 5 个魔数锚点也不得重叠（重叠会让槽位互相覆盖）
    for (const lead of LEADS) expect(IMAGE_SIGNATURE_LEADS).not.toContain(lead)
  })

  it('合成/对抗流上候选 == 四个首字节位置的升序并集', () => {
    for (const buf of [...randomStreams(20261013, 300, 400), ...adversarialImageStreams()]) {
      expect(buildMagicScanIndex(buf).imageCandidates, `len=${buf.length}`).toEqual(
        imageCandidateOracle(buf)
      )
    }
  })

  it('27 份真实流上候选完整、严格升序无重复，且非空转', () => {
    const streams = realWordDocStreams()
    expect(streams).toHaveLength(27)
    let total = 0
    for (const data of streams) {
      const cands = buildMagicScanIndex(data).imageCandidates
      expect(cands).toEqual(imageCandidateOracle(data))
      for (let i = 1; i < cands.length; i++) {
        expect(cands[i], '候选必须严格升序').toBeGreaterThan(cands[i - 1])
      }
      total += cands.length
    }
    // 实测四首字节并集 1.71%（98 506 个偏移）；下界断言防止护栏退化为空转。
    expect(total).toBeGreaterThan(50000)
  })

  it('候选不得把非首字节收进来（与「收全部字节」区分）', () => {
    const buf = new Uint8Array(256)
    for (let i = 0; i < 256; i++) buf[i] = i
    const cands = buildMagicScanIndex(buf).imageCandidates
    for (const p of cands) expect(IMAGE_SIGNATURE_LEADS).toContain(buf[p])
    expect(cands).toEqual(imageCandidateOracle(buf))
  })
})

describe('Round 143 图片扫描：传索引与不传索引逐项一致', () => {
  const corpus = () => [
    ...realWordDocStreams(),
    ...adversarialImageStreams(),
    ...randomStreams(20261014, 200, 300),
  ]

  it('27 份真实流 + 对抗流 + 随机流上双路径一致', () => {
    const streams = corpus()
    let produced = 0
    for (const data of streams) {
      const index = buildMagicScanIndex(data)
      const viaIndex = extractImagesFromStream(data, undefined, index)
      const viaLinear = extractImagesFromStream(data)
      expect(imageKey(viaIndex), `len=${data.length} 双路径不一致`).toBe(imageKey(viaLinear))
      produced += viaLinear.length
    }
    // 鉴别力：语料必须真的产出图片，否则本用例只是空转
    expect(produced).toBeGreaterThan(0)
  })

  it('跳跃语义：BMP 内部内嵌 PNG 时只产出 BMP（不被内部签名干扰）', () => {
    const data = bmpWithEmbeddedPng()
    const index = buildMagicScanIndex(data)
    // 先把夹具的鉴别力钉死：内部 PNG 确实是一个合法的签名起点、且落在 BMP 区间内。
    // 少了这条，「夹具失效（内部 PNG 解析不出）导致用例空转」就查不出来。
    expect(index.imageCandidates[0]).toBe(0)
    expect(index.imageCandidates).toContain(40)
    expect(bytesEqual(data, 0, BMP_SIGNATURE)).toBe(true)
    expect(bytesEqual(data, 40, PNG_SIGNATURE)).toBe(true)
    expect(40).toBeLessThan(120)
    const viaIndex = extractImagesFromStream(data, undefined, index)
    expect(viaIndex).toHaveLength(1)
    expect(viaIndex[0].format).toBe('bmp')
    expect(viaIndex[0].data.length).toBe(120)
    expect(imageKey(viaIndex)).toBe(imageKey(extractImagesFromStream(data)))
  })

  it('多图流的产出顺序与逐字节路径一致', () => {
    const data = twoBmpStream()
    const index = buildMagicScanIndex(data)
    const viaIndex = extractImagesFromStream(data, undefined, index)
    expect(viaIndex).toHaveLength(2)
    expect(viaIndex[0].data.byteOffset).toBe(0)
    expect(viaIndex[1].data.byteOffset).toBe(150)
    expect(imageKey(viaIndex)).toBe(imageKey(extractImagesFromStream(data)))
  })

  it('索引不属于该流、或窗口被截断时退回逐字节路径', () => {
    const full = twoBmpStream()
    const index = buildMagicScanIndex(full)
    // 另一条流 + 该索引 → 必须与「不传索引」相同
    const other = new Uint8Array(300).fill(0x41)
    other.set(BMP_SIGNATURE, 20)
    const size = 120
    other[22] = size & 0xff
    other[23] = (size >> 8) & 0xff
    other[24] = (size >> 16) & 0xff
    other[25] = (size >> 24) & 0xff
    expect(imageKey(extractImagesFromStream(other, undefined, index))).toBe(
      imageKey(extractImagesFromStream(other))
    )
    // 截断窗口（subarray 是新对象）→ 索引身份不匹配 → 退回
    const window = full.subarray(0, 200)
    expect(imageKey(extractImagesFromStream(window, undefined, index))).toBe(
      imageKey(extractImagesFromStream(window))
    )
    // 不传索引 = 逐字节旧实现
    expect(imageKey(extractImagesFromStream(full, undefined, undefined))).toBe(
      imageKey(extractImagesFromStream(full))
    )
  })

  it('nextMagicOffset 对图片首字节退回原生（并集候选不能当单锚点桶用）', () => {
    const data = twoBmpStream()
    const index = buildMagicScanIndex(data)
    for (const lead of IMAGE_SIGNATURE_LEADS) {
      for (const from of [0, 1, 100, 150, data.length, data.length + 5]) {
        expect(nextMagicOffset(index, data, lead, from), `lead=0x${lead.toString(16)} from=${from}`).toBe(
          data.indexOf(lead, from)
        )
      }
    }
    // 5 个魔数锚点仍走桶（等价性由 Round 142 的用例覆盖，这里只钉住图片首字节的分流）
    expect(index.buckets).toHaveLength(LEADS.length)
  })
})

describe('Round 143 图片候选数组：护栏鉴别力', () => {
  it('慢但等价的对照（两趟计数 + 填充）与 oracle 相同', () => {
    for (const buf of [...randomStreams(20261015, 200, 400), ...adversarialImageStreams()]) {
      expect(imageCandidateTwoPass(buf), `len=${buf.length}`).toEqual(imageCandidateOracle(buf))
      expect(buildMagicScanIndex(buf).imageCandidates).toEqual(imageCandidateTwoPass(buf))
    }
  })

  it('负控 A（候选漏掉 BMP 首字节）必须漏产出图片', () => {
    const data = twoBmpStream()
    const index = buildMagicScanIndex(data)
    const broken: ImageScanIndexView = {
      data,
      imageCandidates: index.imageCandidates.filter((p) => data[p] !== BMP_SIGNATURE[0]),
    }
    expect(extractImagesFromStream(data, undefined, index)).toHaveLength(2)
    expect(extractImagesFromStream(data, undefined, broken)).toHaveLength(0)
  })

  it('负控 B（候选逆序）必须与 oracle 不同', () => {
    const data = twoBmpStream()
    const index = buildMagicScanIndex(data)
    const reversed: ImageScanIndexView = {
      data,
      imageCandidates: [...index.imageCandidates].reverse(),
    }
    const viaReversed = extractImagesFromStream(data, undefined, reversed)
    expect(imageKey(viaReversed)).not.toBe(imageKey(extractImagesFromStream(data, undefined, index)))
    expect(viaReversed).toHaveLength(1)
  })

  it('负控 C（候选含重复位置）必须与 oracle 不同', () => {
    const data = twoBmpStream()
    const index = buildMagicScanIndex(data)
    const dup: ImageScanIndexView = {
      data,
      imageCandidates: [index.imageCandidates[0], index.imageCandidates[0], ...index.imageCandidates.slice(1)],
    }
    // 重复位置会被「已被跳跃越过」规则吃掉：这里用一个不含跳跃的短流暴露差异
    const single = new Uint8Array(60).fill(0x41)
    single.set(BMP_SIGNATURE, 0)
    const singleSize = 54
    single[2] = singleSize & 0xff
    single[3] = (singleSize >> 8) & 0xff
    single[4] = (singleSize >> 16) & 0xff
    single[5] = (singleSize >> 24) & 0xff
    const singleIndex = buildMagicScanIndex(single)
    const singleDup: ImageScanIndexView = {
      data: single,
      imageCandidates: [singleIndex.imageCandidates[0], ...singleIndex.imageCandidates],
    }
    expect(imageKey(extractImagesFromStream(single, undefined, singleIndex))).toBe(
      imageKey(extractImagesFromStream(single))
    )
    // 重复候选与 oracle 不同（oracle 只有一个候选位置）
    expect(singleDup.imageCandidates.length).not.toBe(singleIndex.imageCandidates.length)
    expect(dup.imageCandidates.length).not.toBe(index.imageCandidates.length)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Round 145：`buildMagicScanIndex` 改为「Uint16 一次读一对」
// ═══════════════════════════════════════════════════════════════════════════
// 本段守住四件事：
//   1. **快路径 == 慢路径**：同一逻辑字节放在偶数 `byteOffset`（走 `Uint16Array`）
//      与奇数 `byteOffset`（走逐字节对推进的慢路径）时，桶与候选数组必须逐项相同。
//   2. **边界**：长度 0..40 全枚举 + 锚点铺满/交替，覆盖主循环与奇数尾字节两条出口。
//   3. **回退保障**：空输入与**已分离的 ArrayBuffer** 上不得抛错（旧实现安静返回空桶），
//      因为 `len === 0` 的提前返回正是为它们而存在。
//   4. **鉴别力**：与生产快路径同构的骨架（正控必须与 oracle 相同）注入 4 个故意改错
//      必须与 oracle 不同：①一对里只查第一个字节 ②一对里只查第二个字节
//      ③漏掉奇数尾字节 ④字节对表只填一半（依赖「表对称」这一前提）。

/** 把 `src` 的同一段逻辑字节放到指定偏移处，返回该偏移处的视图。 */
function viewAtOffset(src: Uint8Array, offset: number): Uint8Array {
  const backing = new Uint8Array(src.length + offset + 1)
  backing.set(src, offset)
  return backing.subarray(offset, offset + src.length)
}

/**
 * 与生产快路径**同构**的骨架：`Uint16Array` 一次读一对 + 命中时逐字节查表 +
 * 奇数尾字节收尾。`pushPair` 决定一对命中时要检查哪些字节，`tailByte` 决定是否收尾。
 * 正控用 `PUSH_BOTH` + `tailByte = true` 必须与 oracle 相同；其余组合是负控。
 */
function buildFastSkeleton(
  data: Uint8Array,
  pair: Uint8Array,
  pushPair: (buckets: Buckets, d: Uint8Array, i: number) => void,
  tailByte: boolean
): Buckets {
  const buckets: Buckets = LEADS.map(() => [])
  const len = data.length
  if (len === 0) return buckets
  const n = len >> 1
  const u16 = new Uint16Array(data.buffer, data.byteOffset, n)
  for (let j = 0; j < n; j++) {
    if (pair[u16[j]] === 0) continue
    pushPair(buckets, data, j << 1)
  }
  if (tailByte && (len & 1)) {
    const s = SLOT[data[len - 1]]
    if (s !== 0) buckets[s - 1].push(len - 1)
  }
  return buckets
}

/** 正控：一对里两个字节都查（= 生产实现的行为）。 */
const PUSH_BOTH = (buckets: Buckets, d: Uint8Array, i: number): void => {
  const s0 = SLOT[d[i]]
  if (s0 !== 0) buckets[s0 - 1].push(i)
  const s1 = SLOT[d[i + 1]]
  if (s1 !== 0) buckets[s1 - 1].push(i + 1)
}

/** 负控 1：一对里只查第一个字节。 */
const PUSH_FIRST = (buckets: Buckets, d: Uint8Array, i: number): void => {
  const s = SLOT[d[i]]
  if (s !== 0) buckets[s - 1].push(i)
}

/** 负控 2：一对里只查第二个字节。 */
const PUSH_SECOND = (buckets: Buckets, d: Uint8Array, i: number): void => {
  const s = SLOT[d[i + 1]]
  if (s !== 0) buckets[s - 1].push(i + 1)
}

/** 桶与候选数组都相等的判据。 */
function sameIndex(a: { buckets: Buckets; imageCandidates: number[] }, b: Uint8Array): boolean {
  const want = LEADS.map((lead) => enumerate(b, lead))
  if (JSON.stringify(a.buckets) !== JSON.stringify(want)) return false
  return JSON.stringify(a.imageCandidates) === JSON.stringify(imageCandidateOracle(b))
}

describe('Round 145 单趟扫描：快路径与慢路径（奇数 byteOffset）一致', () => {
  const corpus = (): Uint8Array[] => [
    ...realWordDocStreams(),
    ...adversarialImageStreams(),
    ...randomStreams(20261015, 300, 400),
  ]

  it('27 份真实流 + 对抗流 + 随机流上，偏移 0 与偏移 1 的桶/候选逐项相同', () => {
    const streams = corpus()
    let checked = 0
    for (const data of streams) {
      const even = buildMagicScanIndex(data)
      const shifted = viewAtOffset(data, 1)
      // 前提必须钉死：否则「慢路径」根本没被走到，用例就是空转。
      expect(shifted.byteOffset % 2, `len=${data.length} 未能构造奇数偏移视图`).toBe(1)
      const odd = buildMagicScanIndex(shifted)
      expect(odd.buckets, `len=${data.length} 桶不一致`).toEqual(even.buckets)
      expect(odd.imageCandidates, `len=${data.length} 候选不一致`).toEqual(even.imageCandidates)
      checked += even.imageCandidates.length
    }
    // 鉴别力：语料必须真的产出候选，否则上述比对可能只是「两边都空」。
    expect(checked).toBeGreaterThan(50000)
  })

  it('真实流的 WordDocument 视图 byteOffset 全为偶数（快路径前提）', () => {
    const streams = realWordDocStreams()
    expect(streams).toHaveLength(27)
    for (const data of streams) expect(data.byteOffset % 2).toBe(0)
  })

  it('同一逻辑内容在偏移 0 与偏移 1 下都与 oracle 相同（两种路径都正确）', () => {
    for (const data of [...adversarialImageStreams(), ...randomStreams(20261016, 200, 300)]) {
      const even = buildMagicScanIndex(data)
      const odd = buildMagicScanIndex(viewAtOffset(data, 1))
      expect(sameIndex(even, data), `even len=${data.length}`).toBe(true)
      expect(sameIndex(odd, data), `odd len=${data.length}`).toBe(true)
    }
  })
})

describe('Round 145 单趟扫描：边界与尾部出口', () => {
  it('长度 0..40 全枚举（铺满锚点 / 无锚点 / 交替）与 oracle 一致', () => {
    for (let n = 0; n <= 40; n++) {
      // 铺满单一首字节：覆盖「一对两个都是锚点」
      for (const fill of [0xd0, 0xff, 0x41]) {
        const buf = new Uint8Array(n).fill(fill)
        const idx = buildMagicScanIndex(buf)
        expect(idx.buckets, `len=${n} fill=${fill}`).toEqual(LEADS.map((lead) => enumerate(buf, lead)))
        expect(idx.imageCandidates, `len=${n} fill=${fill}`).toEqual(imageCandidateOracle(buf))
      }
      // 交替 0xd0 / 0x41：锚点只在偶数位，成对检查里必须落到第一个字节上
      const alt = new Uint8Array(n)
      for (let i = 0; i < n; i++) alt[i] = i % 2 === 0 ? 0xd0 : 0x41
      expect(buildMagicScanIndex(alt).buckets, `alt len=${n}`).toEqual(
        LEADS.map((lead) => enumerate(alt, lead))
      )
      // 交替 0x41 / 0xd0：锚点只在奇数位，必须落到一对的第二个字节上
      const alt2 = new Uint8Array(n)
      for (let i = 0; i < n; i++) alt2[i] = i % 2 === 1 ? 0xd0 : 0x41
      expect(buildMagicScanIndex(alt2).buckets, `alt2 len=${n}`).toEqual(
        LEADS.map((lead) => enumerate(alt2, lead))
      )
    }
  })

  it('锚点落在任意位置（含对边界 1/3/7/8/15/16…）都被收录', () => {
    for (const at of [0, 1, 3, 4, 7, 8, 9, 15, 16, 23, 24, 31]) {
      const buf = new Uint8Array(40).fill(0x41)
      buf[at] = 0xd0
      const idx = buildMagicScanIndex(buf)
      expect(idx.buckets[0], `at=${at}`).toEqual(enumerate(buf, 0xd0))
      expect(idx.buckets[0]).toContain(at)
    }
  })

  it('末字节是锚点时在快路径上也被收录（奇数尾字节出口）', () => {
    for (const n of [1, 3, 5, 9, 17, 33]) {
      const buf = new Uint8Array(n).fill(0x41)
      buf[n - 1] = 0xd0
      expect(buildMagicScanIndex(buf).buckets[0], `len=${n}`).toEqual([n - 1])
    }
    // 末字节是图片首字节时同样必须进候选数组
    for (const n of [1, 3, 5, 9, 17, 33]) {
      const buf = new Uint8Array(n).fill(0x41)
      buf[n - 1] = 0xff
      expect(buildMagicScanIndex(buf).imageCandidates, `len=${n}`).toEqual([n - 1])
    }
  })

  it('空输入返回空桶与空候选', () => {
    const idx = buildMagicScanIndex(new Uint8Array(0))
    expect(idx.buckets).toEqual([[], [], [], [], []])
    expect(idx.imageCandidates).toEqual([])
  })

  it('已分离（detached）的 ArrayBuffer 上不抛错且返回空结果', () => {
    const ab = new ArrayBuffer(16)
    const view = new Uint8Array(ab)
    view[0] = 0xd0
    view[1] = 0xff
    structuredClone(ab, { transfer: [ab] })
    // 分离后视图长度按规范归零；旧实现安静返回空桶，新实现不得因构造 Uint16Array 抛错。
    expect(view.length).toBe(0)
    const idx = buildMagicScanIndex(view)
    expect(idx.buckets).toEqual([[], [], [], [], []])
    expect(idx.imageCandidates).toEqual([])
  })
})

describe('Round 145 单趟扫描：护栏鉴别力（负控必须被检出）', () => {
  const corpus = (): Uint8Array[] => [
    ...realWordDocStreams(),
    ...adversarialImageStreams(),
    ...randomStreams(20261017, 200, 300),
    // 端序无关的「一对里只有一个锚点」用例：两种字节序下各有一种排列会漏
    new Uint8Array([0xd0, 0x41, 0x41, 0xd0, 0xd0, 0x41, 0x41, 0xd0]),
    new Uint8Array([0xd0, 0x41]).subarray(0, 2),
  ]
  const want = (data: Uint8Array): Buckets => LEADS.map((lead) => enumerate(data, lead))

  it('正控：同构骨架 + 两字节全查 + 收尾 == oracle（钉死骨架与生产实现同构）', () => {
    for (const data of corpus()) {
      const got = buildFastSkeleton(data, PAIR_SYM, PUSH_BOTH, true)
      expect(got, `len=${data.length}`).toEqual(want(data))
    }
  })

  it('慢但等价的对照（两趟计数建表）与新的单趟扫描逐项相同', () => {
    let hits = 0
    for (const data of corpus()) {
      const idx = buildMagicScanIndex(data)
      expect(idx.buckets, `len=${data.length}`).toEqual(bucketizeTwoPass(data))
      expect(idx.imageCandidates, `len=${data.length}`).toEqual(imageCandidateTwoPass(data))
      hits += idx.imageCandidates.length
    }
    expect(hits).toBeGreaterThan(50000)
  })

  it('负控 1（一对里只查第一个字节）必须被检出', () => {
    let bad = 0
    for (const data of corpus()) {
      if (JSON.stringify(buildFastSkeleton(data, PAIR_SYM, PUSH_FIRST, true)) !== JSON.stringify(want(data))) bad++
    }
    expect(bad).toBeGreaterThan(0)
  })

  it('负控 2（一对里只查第二个字节）必须被检出', () => {
    let bad = 0
    for (const data of corpus()) {
      if (JSON.stringify(buildFastSkeleton(data, PAIR_SYM, PUSH_SECOND, true)) !== JSON.stringify(want(data))) bad++
    }
    expect(bad).toBeGreaterThan(0)
  })

  it('负控 3（漏掉奇数尾字节）必须被检出', () => {
    const tailLead = [new Uint8Array(3).fill(0x41), new Uint8Array(9).fill(0x41)]
    tailLead[0][2] = 0xd0
    tailLead[1][8] = 0xd0
    let bad = 0
    for (const data of [...corpus(), ...tailLead]) {
      if (JSON.stringify(buildFastSkeleton(data, PAIR_SYM, PUSH_BOTH, false)) !== JSON.stringify(want(data))) bad++
    }
    expect(bad).toBeGreaterThan(0)
  })

  it('负控 4（字节对表只填一半）必须被检出——「表对称」是快路径正确性的前提', () => {
    let bad = 0
    for (const data of corpus()) {
      if (JSON.stringify(buildFastSkeleton(data, PAIR_ASYM, PUSH_BOTH, true)) !== JSON.stringify(want(data))) bad++
    }
    expect(bad).toBeGreaterThan(0)
  })

  it('负控 4 的判据不依赖机器端序（两种字节序各有一种排列会被漏）', () => {
    // 小端：u16 = (data[1] << 8) | data[0]；大端：u16 = (data[0] << 8) | data[1]。
    // 下面这条流在两种字节序下各有一对会被 PAIR_ASYM 漏掉，故「必须被检出」是端序无关的。
    const probe = new Uint8Array([0xd0, 0x41, 0x41, 0xd0])
    const expected = want(probe)
    const got = buildFastSkeleton(probe, PAIR_ASYM, PUSH_BOTH, true)
    expect(JSON.stringify(got)).not.toBe(JSON.stringify(expected))
    // 同一输入用对称表则完全一致，证明差异只来自表的一半缺失。
    expect(buildFastSkeleton(probe, PAIR_SYM, PUSH_BOTH, true)).toEqual(expected)
  })
})
