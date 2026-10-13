/**
 * Round 148 护栏：一次解析内的 `Data` 流读取共享缓存。
 *
 * 背景：一次 `parseWithFormat()`（及 `parse()`）经 4 个上游入口反复读同一条
 * `Data` 流——`docParser.parseFormatRuns` 的 `extractShapesFromDataStream`、
 * `documentAssets.extractImages`、`documentAssets.extractPictures`、
 * `storySplitter.splitHeaderParts` 的页眉页脚图片 `parsePicfAt`，每次都
 * `readStream` 出一份新的全流拷贝（真实 27 份语料实测：58 次调用、
 * 共读 2,236,262 字节，约 18–22 个文档有 Data 流、平均 3.25 次重复读）。
 * `OleParser.readStream` 每次 `new Uint8Array`，故按**目录条目对象**身份键控
 * 才可共享（Round 146 表格流缓存之后遗留的「同内容不同对象」型重复）。
 *
 * 护栏分五组：
 *   1. 等价性：带缓存 / 不带缓存两条路径在 27 份真实语料上逐字节一致，
 *      命中返回同一对象且内容不变；oracle（不带缓存）同时充当慢但等价对照。
 *   2. 真实覆盖：27 份文件每份 readStream('Data') 只发生一次（不是空转分支）。
 *   3. 端到端接线：真实 `DocParser.parseWithFormat` 内四个消费方合计只读一次
 *      Data 流；同一 DocParser 连续两次解析各读一次（入口 clear 生效）；
 *      有图文档的 document.images 仍非空（Data 路径没被缓存弄丢）。
 *   4. 只读性：四个真实消费函数在共享视图上逐一运行后字节不变（等价前提），
 *      含篡改检测元断言。
 *   5. 鉴别力：3 个独立重写的负控变体（命中返回切片 / 键退化为流名跨文档串流 /
 *      miss 时读错流）必须与 oracle 不同；源码接线元断言防止缓存被无声摘除。
 *      注：条目身份键控对「跨流/跨文档串键」结构免疫（Round 146 的 wrongKey
 *      失败类在此不存在），故负控针对本设计真实存在的失败模式。
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { readDataStreamShared, type DataStreamCache } from '../src/utils/docparser/dataStreamCache'
import { OleParser } from '../src/utils/oleParser'
import type { DirectoryEntry } from '../src/utils/oleParser'
import { parsePicfAt, extractPicturesFromDataStream } from '../src/utils/pictureParser'
import { extractImagesFromStream } from '../src/utils/imageExtractor'
import { extractShapesFromDataStream } from '../src/utils/shapeParser'
import { DocParser } from '../src/utils/docParser'

const docsDir = new URL('../docs/', import.meta.url)

interface RealDoc {
  name: string
  ole: OleParser
  directory: DirectoryEntry[]
  /** Data 流目录条目（不存在时为 null）。 */
  dataEntry: DirectoryEntry | null
  /** 不带缓存的参照 Data 流视图（每次 readStream 的新副本）；无 Data 流为 null。 */
  refData: Uint8Array | null
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
    const dataEntry = ole.findStreamByName(directory, 'Data')
    const refData = dataEntry ? ole.readStream(dataEntry).data : null
    out.push({ name, ole, directory, dataEntry, refData })
  }
  return out
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i])

/** 与生产四个消费点相同的守卫条件下运行全部真实消费函数。 */
function runAllConsumers(data: Uint8Array): number {
  let touched = 0
  touched += extractShapesFromDataStream(data).length
  const scanned = extractImagesFromStream(data)
  touched += scanned.length
  const pics = extractPicturesFromDataStream(data)
  touched += pics.length
  // PICF 路径（splitHeaderParts / extractPictures）：从流头尝试解析，失败返回 null。
  for (let off = 0; off < Math.min(data.length, 4096); off += 512) {
    const pic = parsePicfAt(data, off)
    if (pic) touched++
  }
  return touched
}

// ── 1. 等价性：带缓存 / 不带缓存在 27 份真实语料上逐字节一致 ──────────────

describe('Round 148 Data 流缓存：与不带缓存路径等价（真实语料）', () => {
  const docs = loadRealDocs()

  it('27 份真实文件 readDataStreamShared 双路径逐字节一致，命中返回同一对象', () => {
    let docsWithData = 0
    for (const doc of docs) {
      const plain = readDataStreamShared(doc.ole, doc.directory)
      const cache: DataStreamCache = new Map()
      const cached1 = readDataStreamShared(doc.ole, doc.directory, cache)
      const cached2 = readDataStreamShared(doc.ole, doc.directory, cache)
      if (doc.dataEntry === null || doc.refData === null || doc.refData.length === 0) {
        expect(plain, doc.name).toBeNull()
        expect(cached1, doc.name).toBeNull()
        expect(cache.size, doc.name).toBe(0) // 缺流/空流不占键位
        continue
      }
      docsWithData++
      expect(plain, doc.name).not.toBeNull()
      expect(sameBytes(plain!, doc.refData), doc.name).toBe(true)
      expect(sameBytes(cached1!, doc.refData), doc.name).toBe(true)
      // 命中复用同一对象（这是本优化的目的），且两次内容一致。
      expect(cached2, doc.name).toBe(cached1)
      expect(sameBytes(cached2!, doc.refData), doc.name).toBe(true)
    }
    // 真实覆盖断言：至少半数文档带 Data 流（实测 18/27），证明这条路径真被跑到。
    expect(docsWithData).toBeGreaterThanOrEqual(10)
  })
})

// ── 2. 真实覆盖：每份文件 readStream('Data') 只发生一次 ──────────────────

function makeCountingOle(ole: OleParser): { ole: OleParser; calls: () => number } {
  let calls = 0
  const wrapped = new Proxy(ole, {
    get(target, prop, receiver) {
      if (prop === 'readStream') {
        return (...args: Parameters<OleParser['readStream']>) => {
          if (String((args[0] as DirectoryEntry).name) === 'Data') calls++
          return Reflect.apply(target.readStream, target, args)
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { ole: wrapped as unknown as OleParser, calls: () => calls }
}

describe('Round 148 Data 流缓存：真实覆盖（每文件只读一次）', () => {
  const docs = loadRealDocs()

  it('27 份真实文件每份 readStream("Data") 恰一次（重复查询全部命中）', () => {
    let filesWithData = 0
    for (const doc of docs) {
      if (doc.dataEntry === null) continue
      filesWithData++
      const counting = makeCountingOle(doc.ole)
      const cache: DataStreamCache = new Map()
      // 真实一次解析里该流平均被查 3.25 次（58 次 / 约 18 个有流文档），这里查 5 次。
      const results: Array<Uint8Array | null> = []
      for (let i = 0; i < 5; i++) {
        results.push(readDataStreamShared(counting.ole, doc.directory, cache))
      }
      expect(counting.calls(), doc.name).toBe(1)
      for (const r of results) {
        expect(r, doc.name).not.toBeNull()
        expect(sameBytes(r!, doc.refData!), doc.name).toBe(true)
      }
    }
    expect(filesWithData).toBeGreaterThanOrEqual(10)
  })

  it('无 Data 流时 miss 不写缓存（每次仍走廉价查找，键保持为空）', () => {
    const doc = loadRealDocs()[0]
    const counting = makeCountingOle(doc.ole)
    const cache: DataStreamCache = new Map()
    const emptyDir: DirectoryEntry[] = []
    for (let i = 0; i < 5; i++) {
      expect(readDataStreamShared(counting.ole, emptyDir, cache)).toBeNull()
    }
    expect(counting.calls()).toBe(0)
    expect(cache.size).toBe(0)
  })
})

// ── 3. 端到端接线：真实 DocParser 内四个消费方合计只读一次 ────────────────

describe('Round 148 Data 流缓存：生产接线（DocParser 端到端）', () => {
  const docs = loadRealDocs()

  it('有图文档 parseWithFormat 内 readStream("Data") 恰一次且 images 非空', () => {
    const origReadStream = OleParser.prototype.readStream
    let checked = 0
    try {
      for (const doc of docs) {
        if (doc.dataEntry === null) continue
        let calls = 0
        OleParser.prototype.readStream = function (entry: DirectoryEntry) {
          if (String(entry.name) === 'Data') calls++
          return origReadStream.call(this, entry)
        }
        const bytes = readFileSync(new URL(doc.name, docsDir))
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        const res = new DocParser(ab).parseWithFormat()
        if (res.success && res.document && res.document.images && res.document.images.length > 0) {
          checked++
          // 四个消费点（shapes / extractImages / extractPictures / splitHeaderParts）
          // 合计只读一次 —— 共享缓存已在 docParser / documentAssets / storySplitter 接线。
          expect(calls, `${doc.name} Data 读取次数`).toBe(1)
          // 图片路径没被缓存弄丢：data URL 仍是 base64 PNG/JPEG/GIF/BMP。
          for (const url of res.document.images) {
            expect(url.startsWith('data:image/'), doc.name).toBe(true)
          }
        }
      }
    } finally {
      OleParser.prototype.readStream = origReadStream
    }
    // 真实覆盖断言：至少 3 份有图文档走到这条断言（实测 9 份左右）。
    expect(checked).toBeGreaterThanOrEqual(3)
  })

  it('同一 DocParser 连续两次 parseWithFormat 各读一次（入口 clear 生效）', () => {
    const target = docs.find((d) => d.dataEntry !== null)
    expect(target, '语料中应存在带 Data 流的文档').toBeTruthy()
    const origReadStream = OleParser.prototype.readStream
    try {
      let calls = 0
      OleParser.prototype.readStream = function (entry: DirectoryEntry) {
        if (String(entry.name) === 'Data') calls++
        return origReadStream.call(this, entry)
      }
      const bytes = readFileSync(new URL(target!.name, docsDir))
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const parser = new DocParser(ab)
      const first = parser.parseWithFormat()
      expect(calls).toBe(1)
      const second = parser.parseWithFormat()
      expect(calls).toBe(2) // 第二次仍真读一次 = 未跨解析沿用旧视图
      expect(JSON.stringify(second.document)).toBe(JSON.stringify(first.document))
    } finally {
      OleParser.prototype.readStream = origReadStream
    }
  })
})

// ── 4. 只读性：共享数组经过全部真实消费函数后字节不变 ────────────────────

describe('Round 148 Data 流缓存：共享数组对全部真实消费函数只读', () => {
  const docs = loadRealDocs()

  it('27 份真实文件运行全部消费函数后共享 Data 流逐字节不变', () => {
    let consumersRan = 0
    let docsWithData = 0
    for (const doc of docs) {
      if (doc.dataEntry === null || doc.refData === null || doc.refData.length === 0) continue
      docsWithData++
      const cache: DataStreamCache = new Map()
      const shared = readDataStreamShared(doc.ole, doc.directory, cache)!
      const before = Uint8Array.from(shared)
      consumersRan += runAllConsumers(shared)
      expect(sameBytes(shared, before), doc.name).toBe(true)
      // 再跑一遍（模拟后续消费方依旧拿到未被污染的缓存）
      consumersRan += runAllConsumers(shared)
      expect(sameBytes(shared, before), doc.name).toBe(true)
    }
    expect(docsWithData).toBeGreaterThanOrEqual(10)
    expect(consumersRan).toBeGreaterThan(100) // 真实产出断言：消费函数确实跑过
  })

  it('元断言：字节比对方法对篡改敏感（证明上一条不是空转）', () => {
    const doc = docs.find((d) => d.dataEntry !== null)!
    const cache: DataStreamCache = new Map()
    const shared = readDataStreamShared(doc.ole, doc.directory, cache)!
    const before = Uint8Array.from(shared)
    shared[0] = shared[0] ^ 0xff
    expect(sameBytes(shared, before)).toBe(false)
  })
})

// ── 5. 鉴别力：负控必须与 oracle 不同 ─────────────────────────────────────

/**
 * 独立重写的缓存解析骨架（不复用被测实现），mode 注入 3 类典型错误。
 *
 * 说明：本缓存的键是**目录条目对象身份**，与 Round 146 按 `which` 键控不同——
 * 不同文档/不同流的条目天然是不同的键，「跨流串键」这一类失败在结构上不存在
 * （负控 nameKey 演示的是「把键退化为名称」后同一 Map 才会发生的事）。
 * 因此这里的三类负控对应本设计真实存在的失败模式：
 *   - sliceHit：命中返回截断视图；
 *   - nameKey：键退化为流名字符串（跨文档同 Map 时串流）；
 *   - wrongSource：miss 路径读错流（把别的流的数据缓存进 Data 的键）。
 */
function resolveCached(
  ole: OleParser,
  directory: DirectoryEntry[],
  cache: Map<unknown, unknown> | undefined,
  mode: 'none' | 'sliceHit' | 'nameKey' | 'wrongSource',
): Uint8Array | null {
  const entry = ole.findStreamByName(directory, 'Data')
  if (!entry) return null
  const key: unknown = mode === 'nameKey' ? 'Data' : entry
  if (cache) {
    const hit = cache.get(key)
    if (hit !== undefined) {
      const data = hit as Uint8Array | null
      if (mode === 'sliceHit' && data) return data.subarray(0, 4)
      return data
    }
  }
  const stream = mode === 'wrongSource'
    ? ole.readStream(ole.findStreamByName(directory, 'WordDocument') ?? entry)
    : ole.readStream(entry)
  const data = stream.data && stream.data.length > 0 ? stream.data : null
  cache?.set(key, data)
  return data
}

describe('Round 148 Data 流缓存：护栏鉴别力', () => {
  const docs = loadRealDocs()

  it('负控 nameKey（键退化为流名）在跨文档复用缓存时串流', () => {
    const withData = docs.filter((d) => d.dataEntry !== null && d.refData !== null && d.refData.length > 0)
    expect(withData.length).toBeGreaterThanOrEqual(2)
    const [a, b] = withData
    const shared = new Map<unknown, unknown>()
    const first = resolveCached(a.ole, a.directory, shared, 'nameKey')
    const second = resolveCached(b.ole, b.directory, shared, 'nameKey')
    expect(second).toBe(first) // 键退化为 'Data' 后 b 命中 a 的视图
    const bRef = readDataStreamShared(b.ole, b.directory)
    expect(sameBytes(second!, bRef!)).toBe(false) // 与 b 的 oracle 不同
    // 对照：按条目身份键控（=生产实现）时两份各自正确。
    const entryKeyed = new Map<unknown, unknown>()
    expect(sameBytes(resolveCached(a.ole, a.directory, entryKeyed, 'none')!, readDataStreamShared(a.ole, a.directory)!)).toBe(true)
    expect(sameBytes(resolveCached(b.ole, b.directory, entryKeyed, 'none')!, bRef!)).toBe(true)
  })

  it('负控 sliceHit（命中返回 4 字节切片）与 oracle 不同', () => {
    let checked = 0
    for (const doc of docs) {
      if (doc.dataEntry === null || doc.refData === null || doc.refData.length === 0) continue
      const shared = new Map<unknown, unknown>()
      resolveCached(doc.ole, doc.directory, shared, 'sliceHit') // 首次 miss
      const got = resolveCached(doc.ole, doc.directory, shared, 'sliceHit') // 命中返回切片
      expect(got!.length).toBe(4)
      expect(sameBytes(got!, doc.refData), doc.name).toBe(false)
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(10)
  })

  it('负控 wrongSource（miss 时读错流）与 oracle 不同', () => {
    let checked = 0
    for (const doc of docs) {
      if (doc.dataEntry === null || doc.refData === null || doc.refData.length === 0) continue
      const got = resolveCached(doc.ole, doc.directory, new Map(), 'wrongSource')
      expect(got, doc.name).not.toBeNull()
      expect(sameBytes(got!, doc.refData), doc.name).toBe(false)
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(10)
  })

  it('慢但等价的对照（不带缓存）与生产带缓存路径在 27 份上一致', () => {
    for (const doc of docs) {
      const slow = resolveCached(doc.ole, doc.directory, undefined, 'none')
      const fast = readDataStreamShared(doc.ole, doc.directory, new Map())
      if (slow === null) {
        expect(fast, doc.name).toBeNull()
        continue
      }
      expect(fast, doc.name).not.toBeNull()
      expect(sameBytes(slow, fast!), doc.name).toBe(true)
    }
  })
})

// ── 6. 接线元断言：生产四个调用点与两个注入点在位 ──────────────────────────

describe('Round 148 Data 流缓存：源码接线元断言', () => {
  const read = (rel: string) => readFileSync(new URL(rel, new URL('../src/', import.meta.url)), 'utf8')

  it('四个消费点均经 readDataStreamShared 读取 Data 流', () => {
    const parser = read('utils/docParser.ts')
    const assets = read('utils/docparser/assets/documentAssets.ts')
    const splitter = read('utils/docparser/storySplitter.ts')
    // docParser.parseFormatRuns（shapes）
    expect(parser).toContain('readDataStreamShared(this.ole, directory, this.dataStreamCache)')
    // documentAssets.extractImages / extractPictures
    expect((assets.match(/readDataStreamShared\(ctx\.ole, directory, ctx\.dataStreams\)/g) || []).length).toBe(2)
    // storySplitter.splitHeaderParts
    expect(splitter).toContain('readDataStreamShared(ctx.ole, directory, ctx.dataStreams)')
    // 不再有裸 readStream('Data') 写入点（缺流查找已收口到共享函数内）。
    expect(parser.includes("ole.readStream(") && /findStreamByName\([^)]*'Data'\)/.test(parser)).toBe(false)
    expect(/findStreamByName\([^)]*'Data'\)/.test(assets)).toBe(false)
  })

  it('assetCtx / clxCtx 注入 dataStreams，parse / parseWithFormat 入口 clear', () => {
    const parser = read('utils/docParser.ts')
    expect(parser).toContain('dataStreams: this.dataStreamCache')
    expect(parser).toContain('this.dataStreamCache.clear()')
    expect((parser.match(/this\.dataStreamCache\.clear\(\)/g) || []).length).toBe(2)
  })
})
