// Round 165 护栏：`nextMagicOffset` 的桶上二分改为「按 lead 分槽的顺序提示 + 有界线性前推」。
//
// 背景：真实 27 份语料实测 `nextMagicOffset` **57,189 次/轮**（0x50 一个锚点就占
// 30,447 次，单份文档桶最大 18,380 项），每次二分 ~15 步 ⇒ 合计 ~660,000 次
// 迭代/轮。所有调用方都是「按 `from` 单调递增枚举同一个桶」，故可把上次的
// lower bound 当下次的起点。
//
// 本文件守住四件事：
//
//   1. **原语等价**：新实现与改动前实现（本文件内逐行转写的 `refNextMagicOffset`）
//      在**任意**调用序列上逐项相同——包含回退式 `from`、跨桶、跨索引对象、
//      负值/NaN/非整数 `from`、乱序随机访问。**提示只抬高二分起点，其合法性由
//      `bucket === hintBucket[si] && target >= hintTarget[si]` 自证**，所以即使
//      调用方乱序，也只会退回全量二分而不会算错；本组用例正是钉住这一点。
//   2. **顺序提示真的生效（非空转）**：真实流上按 from 单调枚举时，命中数、
//      返回序列都必须等于桶本身，且总命中数有下界。
//   3. **鉴别力**：3 个故意改错的骨架负控必须与 oracle 不同（缺回退守卫 / 缺桶身份
//      守卫 / 把「到上限」当成「已命中」）。
//   4. **接线元断言**：提示状态的分槽形状与两条返回路径的写回，只能靠源码文本断言
//      守住（行为保持型改动任何「比输出」的测试都抓不住，见 Round164 通用教训 10）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { OleParser } from '../src/utils/oleParser'
import {
  buildMagicScanIndex,
  nextMagicOffset,
  type MagicScanIndex,
} from '../src/utils/docparser/magicScanIndex'

/** 与实现同序的 5 个锚点首字节。 */
const LEADS = [0xd0, 0x50, 0xf0, 0xef, 0xe0]
const MAGIC_LEAD_COUNT = LEADS.length

/** 与实现同构的「首字节 → 槽位」表（本文件独立重建，不复用被测模块内部表）。 */
const LEAD_SLOT = new Uint8Array(256)
for (let k = 0; k < LEADS.length; k++) LEAD_SLOT[LEADS[k]] = k + 1

// ── oracle：改动前 `nextMagicOffset` 的逐行转写（桶上二分，无顺序提示） ──────

function refNextMagicOffset(
  index: MagicScanIndex | undefined,
  data: Uint8Array,
  lead: number,
  from: number,
): number {
  if (index === undefined || index.data !== data) return data.indexOf(lead, from)
  if (lead < 0 || lead > 0xff) return data.indexOf(lead, from)
  const slot = LEAD_SLOT[lead]
  if (slot === 0 || slot > MAGIC_LEAD_COUNT) return data.indexOf(lead, from)
  let target = Math.trunc(from)
  if (Number.isNaN(target)) target = 0
  else if (target < 0) target = Math.max(data.length + target, 0)
  const bucket = index.buckets[slot - 1]
  let lo = 0
  let hi = bucket.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (bucket[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo < bucket.length ? bucket[lo] : -1
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

/** 对抗性用例：长度 0/1、锚点铺满、锚点只在首/末字节、交替锚点。 */
function adversarialStreams(): Uint8Array[] {
  const cases: Uint8Array[] = [
    new Uint8Array(0),
    new Uint8Array([0xf0]),
    new Uint8Array([0x41]),
    new Uint8Array([0xd0, 0xf0]),
    new Uint8Array([0x41, 0x42, 0x43, 0xf0]),
    new Uint8Array([0xf0, 0x41, 0x42, 0x43]),
    new Uint8Array(64).fill(0xf0),
    new Uint8Array(65).fill(0xd0),
    new Uint8Array(33).fill(0x00),
    new Uint8Array(64).fill(0xef),
  ]
  const alt = new Uint8Array(64)
  for (let i = 0; i < alt.length; i++) alt[i] = i % 2 === 0 ? 0x50 : 0x11
  cases.push(alt)
  return cases
}

/** 手工构造的定长样本：5 个锚点各出现在已知偏移上。 */
function anchoredSample(): Uint8Array {
  const d = new Uint8Array(16).fill(0x41)
  d[0] = 0xd0
  d[3] = 0x50
  d[6] = 0xf0
  d[9] = 0xef
  d[12] = 0xe0
  return d
}

/** 稀疏/密集两种锚点分布，供「顺序提示是否真的生效」与「乱序」用例复用。 */
function denseAnchors(n: number, lead: number): Uint8Array {
  const d = new Uint8Array(n * 4).fill(0x41)
  for (let i = 0; i < n; i++) d[i * 4] = lead
  return d
}

// ── A 组：与改动前实现的差分 ─────────────────────────────

describe('Round 165 A 组：与改动前实现逐项差分', () => {
  it('A1 对抗流上穷尽 from ∈ [-3, len+2] × 5 个锚点', () => {
    let bad = 0
    let firstBad = ''
    for (const data of adversarialStreams()) {
      const index = buildMagicScanIndex(data)
      for (const lead of LEADS) {
        for (let from = -3; from <= data.length + 2; from++) {
          const got = nextMagicOffset(index, data, lead, from)
          const want = refNextMagicOffset(index, data, lead, from)
          if (got !== want) {
            bad++
            if (!firstBad) firstBad = `len=${data.length} lead=${lead} from=${from} got=${got} want=${want}`
          }
        }
      }
    }
    expect(firstBad).toBe('')
    expect(bad).toBe(0)
  })

  it('A2 真实 27 份 WordDocument 流：按 from 单调枚举，且返回序列 == 桶本身（非空转）', () => {
    const streams = realWordDocStreams()
    expect(streams.length).toBe(27)
    let bad = 0
    let firstBad = ''
    let totalHits = 0
    for (const data of streams) {
      const index = buildMagicScanIndex(data)
      for (const lead of LEADS) {
        const bucket = index.buckets[LEAD_SLOT[lead] - 1]
        const found: number[] = []
        let from = 0
        for (;;) {
          const got = nextMagicOffset(index, data, lead, from)
          const want = refNextMagicOffset(index, data, lead, from)
          if (got !== want) {
            bad++
            if (!firstBad) firstBad = `lead=${lead} from=${from} got=${got} want=${want}`
          }
          if (got < 0) break
          found.push(got)
          from = got + 1
        }
        if (found.length !== bucket.length) {
          bad++
          if (!firstBad) firstBad = `bucket length mismatch lead=${lead}: ${found.length} vs ${bucket.length}`
        } else {
          for (let i = 0; i < found.length; i++) {
            if (found[i] !== bucket[i]) {
              bad++
              if (!firstBad) firstBad = `bucket[${i}] mismatch lead=${lead}`
              break
            }
          }
        }
        totalHits += found.length
      }
    }
    expect(firstBad).toBe('')
    expect(bad).toBe(0)
    // 真实语料 5 个锚点命中总数（R142 实测口径）约 55,957，下界给 50,000。
    expect(totalHits).toBeGreaterThan(50000)
  })

  it('A3 乱序访问：回退式 from / 跨索引对象 / 跨文档 / 负值·NaN·非整数，全部与 oracle 相同', () => {
    const rnd = makeRnd(20261013)
    const streams = [...realWordDocStreams(), ...adversarialStreams(), denseAnchors(40, 0xd0)]
    let bad = 0
    let firstBad = ''
    for (let si = 0; si < streams.length; si++) {
      const data = streams[si]
      const index = buildMagicScanIndex(data)
      // 第二个索引对象（**不同的桶数组**）——用于验证「桶身份守卫」在真实使用下也成立。
      const index2 = buildMagicScanIndex(data)
      for (let step = 0; step < 500; step++) {
        const idx = rnd() < 0.3 ? index2 : index
        const lead = rnd() < 0.85 ? LEADS[Math.floor(rnd() * LEADS.length)] : Math.floor(rnd() * 256)
        const r = rnd()
        let from: number
        if (r < 0.25) from = Math.floor(rnd() * (data.length + 4)) - 2
        else if (r < 0.45) from = data.length - Math.floor(rnd() * 4) // 从尾部往回（回退式）
        else if (r < 0.55) from = -Math.floor(rnd() * 4)
        else if (r < 0.65) from = Number.NaN
        else if (r < 0.75) from = Math.floor(rnd() * (data.length + 1)) + 0.9 // 非整数（向零截断）
        else if (r < 0.85) from = -0.9
        else from = Math.floor(rnd() * (data.length + 8)) - 4
        const got = nextMagicOffset(idx, data, lead, from)
        const want = refNextMagicOffset(idx, data, lead, from)
        if (got !== want) {
          bad++
          if (!firstBad) firstBad = `stream#${si} len=${data.length} lead=${lead} from=${from} got=${got} want=${want}`
        }
      }
    }
    expect(firstBad).toBe('')
    expect(bad).toBe(0)
  })

  it('A4 跨桶回退：先在大桶深部搜索，再从 0 搜同 lead，必须回到首个锚点', () => {
    const data = denseAnchors(40, 0xd0) // 0xd0 在 0,4,8,…,156
    const index = buildMagicScanIndex(data)
    const bucket = index.buckets[LEAD_SLOT[0xd0] - 1]
    expect(bucket.length).toBe(40)
    // 深部搜索：把 hint 推到桶尾附近
    expect(nextMagicOffset(index, data, 0xd0, 140)).toBe(140)
    // 回退到 0：守卫必须拒绝陈旧提示，返回首个锚点
    expect(nextMagicOffset(index, data, 0xd0, 0)).toBe(0)
    expect(refNextMagicOffset(index, data, 0xd0, 0)).toBe(0)
    // 中间任意 from 也都要对
    for (const from of [0, 1, 4, 5, 37, 138, 139, 140, 141, 156, 157, 999]) {
      expect(nextMagicOffset(index, data, 0xd0, from)).toBe(refNextMagicOffset(index, data, 0xd0, from))
    }
  })

  it('A5 穷尽枚举后（hintLo == bucket.length）再从 0 搜索仍返回首个锚点', () => {
    const data = denseAnchors(12, 0x50)
    const index = buildMagicScanIndex(data)
    let from = 0
    for (;;) {
      const p = nextMagicOffset(index, data, 0x50, from)
      if (p < 0) break
      from = p + 1
    }
    expect(nextMagicOffset(index, data, 0x50, 0)).toBe(0)
    expect(nextMagicOffset(index, data, 0x50, 0)).toBe(refNextMagicOffset(index, data, 0x50, 0))
  })

  it('A6 同一调用重复执行幂等（提示写回不改变结果）', () => {
    const data = denseAnchors(30, 0xf0)
    const index = buildMagicScanIndex(data)
    for (const from of [0, 7, 40, 100, 119, 120, 121]) {
      const a = nextMagicOffset(index, data, 0xf0, from)
      const b = nextMagicOffset(index, data, 0xf0, from)
      const c = nextMagicOffset(index, data, 0xf0, from)
      expect(a).toBe(b)
      expect(b).toBe(c)
      expect(a).toBe(refNextMagicOffset(index, data, 0xf0, from))
    }
  })
})

// ── B 组：绝对锚点（非空转 / 归一化语义） ─────────────────────────────

describe('Round 165 B 组：绝对锚点', () => {
  const DATA = anchoredSample()
  const idx = buildMagicScanIndex(DATA)

  it('B1 五个锚点各自的首个命中位置', () => {
    expect(nextMagicOffset(idx, DATA, 0xd0, 0)).toBe(0)
    expect(nextMagicOffset(idx, DATA, 0x50, 0)).toBe(3)
    expect(nextMagicOffset(idx, DATA, 0xf0, 0)).toBe(6)
    expect(nextMagicOffset(idx, DATA, 0xef, 0)).toBe(9)
    expect(nextMagicOffset(idx, DATA, 0xe0, 0)).toBe(12)
  })

  it('B2 from 越过唯一命中即返回 -1', () => {
    expect(nextMagicOffset(idx, DATA, 0xd0, 1)).toBe(-1)
    expect(nextMagicOffset(idx, DATA, 0x50, 4)).toBe(-1)
    expect(nextMagicOffset(idx, DATA, 0xe0, 13)).toBe(-1)
    expect(nextMagicOffset(idx, DATA, 0xd0, 999)).toBe(-1)
  })

  it('B3 from 恰好等于命中位置仍命中', () => {
    expect(nextMagicOffset(idx, DATA, 0x50, 3)).toBe(3)
    expect(nextMagicOffset(idx, DATA, 0xf0, 6)).toBe(6)
  })

  it('B4 非整数 from 向零截断（不是 floor）', () => {
    expect(nextMagicOffset(idx, DATA, 0x50, 2.9)).toBe(3) // trunc(2.9)=2 → 首个 >=2 是 3
    expect(nextMagicOffset(idx, DATA, 0x50, 3.9)).toBe(3) // trunc=3
    expect(nextMagicOffset(idx, DATA, 0xd0, -0.9)).toBe(0) // trunc(-0.9)=0
  })

  it('B5 NaN 视作 0', () => {
    expect(nextMagicOffset(idx, DATA, 0x50, Number.NaN)).toBe(3)
    expect(nextMagicOffset(idx, DATA, 0x50, Number.NaN)).toBe(refNextMagicOffset(idx, DATA, 0x50, Number.NaN))
  })

  it('B6 负数 from 相对流末尾（max(len+from, 0)）', () => {
    expect(nextMagicOffset(idx, DATA, 0x50, -13)).toBe(3) // 16-13=3
    expect(nextMagicOffset(idx, DATA, 0xf0, -10)).toBe(6) // 16-10=6
    expect(nextMagicOffset(idx, DATA, 0xd0, -16)).toBe(0) // 16-16=0
    expect(nextMagicOffset(idx, DATA, 0xd0, -100)).toBe(0) // max(16-100,0)=0
  })

  it('B7 非锚点 lead / 越界 lead / 索引不属于该流 ⇒ 退回原生 indexOf', () => {
    expect(nextMagicOffset(idx, DATA, 0x41, 0)).toBe(DATA.indexOf(0x41, 0))
    expect(nextMagicOffset(idx, DATA, 0x00, 0)).toBe(DATA.indexOf(0x00, 0))
    expect(nextMagicOffset(idx, DATA, 0x00, 0)).toBe(-1)
    expect(nextMagicOffset(idx, DATA, 300, 0)).toBe(DATA.indexOf(300, 0))
    expect(nextMagicOffset(idx, DATA, -1, 0)).toBe(DATA.indexOf(-1, 0))
    expect(nextMagicOffset(undefined, DATA, 0x50, 0)).toBe(3)
    const otherData = new Uint8Array([0x50, 0x50])
    expect(nextMagicOffset(idx, otherData, 0x50, 0)).toBe(otherData.indexOf(0x50, 0))
  })

  it('B8 第二个索引对象（不同桶数组）结果与第一个一致', () => {
    const idx2 = buildMagicScanIndex(DATA)
    for (const lead of LEADS) {
      for (const from of [0, 1, 3, 6, 12, 16, -1, -16]) {
        expect(nextMagicOffset(idx2, DATA, lead, from)).toBe(nextMagicOffset(idx, DATA, lead, from))
      }
    }
  })
})

// ── C 组：骨架负控（证明本文件有鉴别力） ─────────────────────────────

describe('Round 165 C 组：骨架负控必须与 oracle 不同', () => {
  /** 骨架：与实现同形的顺序提示，按 mode 去掉一处守卫。 */
  function makeSkeleton(mode: 'ok' | 'noBackGuard' | 'noBucketGuard' | 'capAsAnswer') {
    const CAP = 8
    const hB: Array<number[] | null> = new Array(MAGIC_LEAD_COUNT).fill(null)
    const hT: number[] = new Array(MAGIC_LEAD_COUNT).fill(-1)
    const hL: number[] = new Array(MAGIC_LEAD_COUNT).fill(0)
    return (bucket: number[], si: number, target: number): number => {
      let lo = 0
      const bucketOk = mode === 'noBucketGuard' ? true : bucket === hB[si]
      const backOk = mode === 'noBackGuard' ? true : target >= hT[si]
      if (bucketOk && backOk) lo = hL[si]
      const limit = lo + CAP
      while (lo < bucket.length && bucket[lo] < target && lo < limit) lo++
      if (mode === 'capAsAnswer' && lo < bucket.length && lo === limit) return bucket[lo]
      if (lo < bucket.length && bucket[lo] >= target) {
        hB[si] = bucket
        hT[si] = target
        hL[si] = lo
        return bucket[lo]
      }
      let hi = bucket.length
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (bucket[mid] < target) lo = mid + 1
        else hi = mid
      }
      hB[si] = bucket
      hT[si] = target
      hL[si] = lo
      return lo < bucket.length ? bucket[lo] : -1
    }
  }

  it('C1 正控：骨架「保留全部守卫」与 oracle 完全一致', () => {
    const data = denseAnchors(50, 0xd0)
    const index = buildMagicScanIndex(data)
    const bucket = index.buckets[LEAD_SLOT[0xd0] - 1]
    const sk = makeSkeleton('ok')
    for (const from of [0, 1, 5, 40, 100, 197, 198, 199, 200, 999]) {
      expect(sk(bucket, 0, from)).toBe(refNextMagicOffset(index, data, 0xd0, from))
    }
  })

  it('C2 负控「去掉回退守卫」在回退式 from 上必须与 oracle 不同', () => {
    const data = denseAnchors(50, 0xd0)
    const index = buildMagicScanIndex(data)
    const bucket = index.buckets[LEAD_SLOT[0xd0] - 1]
    const sk = makeSkeleton('noBackGuard')
    expect(sk(bucket, 0, 100)).toBe(100) // 推高提示
    const got = sk(bucket, 0, 0) // 回退到 0
    const want = refNextMagicOffset(index, data, 0xd0, 0)
    expect(want).toBe(0)
    expect(got).not.toBe(want)
  })

  it('C3 负控「去掉桶身份守卫」在跨文档同 lead 上必须与 oracle 不同', () => {
    // 关键：第二次调用的 target 必须**通过回退守卫**（target >= hT），否则提示被
    // 回退守卫拦下、桶身份守卫根本没被用到，负控就抓不住（初版正是栽在这里）。
    // 因此让 A 上第一次搜索把 hT 压到一个较小的值，再用「同 target、不同桶」触发。
    const dataA = denseAnchors(4, 0xd0) // A 的 0xd0 桶 = [0, 4, 8, 12]
    const dataB = new Uint8Array(24).fill(0x41)
    dataB[10] = 0xd0 // B 的 0xd0 桶 = [10, 20]，与 A 的桶内容/长度都不同
    dataB[20] = 0xd0
    const idxA = buildMagicScanIndex(dataA)
    const idxB = buildMagicScanIndex(dataB)
    const bucketA = idxA.buckets[LEAD_SLOT[0xd0] - 1]
    const bucketB = idxB.buckets[LEAD_SLOT[0xd0] - 1]
    expect(bucketA).toEqual([0, 4, 8, 12])
    expect(bucketB).toEqual([10, 20])
    const sk = makeSkeleton('noBucketGuard')
    // A 上搜索 target=8 → lower bound 索引 = 2（写回 hT=8、hL=2）
    expect(sk(bucketA, 0, 8)).toBe(8)
    // 换到 B 的桶，target 仍为 8（>= hT=8，回退守卫放行）；但 B 的正确 lower bound 是索引 0。
    const got = sk(bucketB, 0, 8)
    const want = refNextMagicOffset(idxB, dataB, 0xd0, 8)
    expect(want).toBe(10)
    expect(got).not.toBe(want)
  })

  it('C4 负控「把到上限当成已命中」必须与 oracle 不同', () => {
    const data = denseAnchors(40, 0xd0) // 0,4,8,…,156
    const index = buildMagicScanIndex(data)
    const bucket = index.buckets[LEAD_SLOT[0xd0] - 1]
    const sk = makeSkeleton('capAsAnswer')
    expect(sk(bucket, 0, 0)).toBe(0) // 提示 lo=0
    const got = sk(bucket, 0, 100) // 需前推 25 步 > CAP
    const want = refNextMagicOffset(index, data, 0xd0, 100)
    expect(want).toBe(100)
    expect(got).not.toBe(want)
  })
})

// ── D 组：接线元断言（源码文本） ─────────────────────────────

describe('Round 165 D 组：接线元断言', () => {
  const SRC = fs.readFileSync(
    new URL('../src/utils/docparser/magicScanIndex.ts', import.meta.url),
    'utf8',
  )

  it('D1 提示常量与三个分槽状态数组存在且形状正确', () => {
    expect(SRC).toContain('const HINT_MAX_STEPS = 8')
    expect(SRC).toContain('const hintBucket: Array<number[] | null> = new Array(MAGIC_LEAD_COUNT).fill(null)')
    expect(SRC).toContain('const hintTarget: number[] = new Array(MAGIC_LEAD_COUNT).fill(-1)')
    expect(SRC).toContain('const hintLo: number[] = new Array(MAGIC_LEAD_COUNT).fill(0)')
  })

  it('D2 守卫与新起点计算存在', () => {
    expect(SRC).toContain('if (bucket === hintBucket[si] && target >= hintTarget[si]) lo = hintLo[si]')
    expect(SRC).toContain('const scanLimit = lo + HINT_MAX_STEPS')
    expect(SRC).toContain('while (lo < bucket.length && bucket[lo] < target && lo < scanLimit) lo++')
  })

  it('D3 两条返回路径都写回提示（计数恰为 2）', () => {
    const writebacks = SRC.split('hintBucket[si] = bucket').length - 1
    expect(writebacks).toBe(2)
    expect(SRC.split('hintLo[si] = lo').length - 1).toBe(2)
    expect(SRC.split('hintTarget[si] = target').length - 1).toBe(2)
  })

  it('D4 桶索引已改为 si（不再是内联的 slot - 1）', () => {
    expect(SRC).toContain('const si = slot - 1')
    expect(SRC).toContain('const bucket = index.buckets[si]')
    expect(SRC).not.toContain('const bucket = index.buckets[slot - 1]')
  })
})
