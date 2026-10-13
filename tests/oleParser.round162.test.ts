import { describe, it, expect } from 'vitest'
import { OleParser } from '../src/utils/oleParser'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

/**
 * Round 162 护栏：OLE FAT/MiniFAT 链遍历的循环检测，由「每次 `new Set<number>()`」
 * 改为「模块级共享 `Uint32Array` + 每调用自增世代号」（见 `oleParser.ts` 的 `beginVisit`）。
 *
 * ── 为什么这组护栏长这样 ──────────────────────────────────────────────
 * 输出等价性由 27 份真实文档的逐字节 dump 覆盖，这里**不重复**；本文件专攻这次改动
 * 独有的、dump 抓不到的风险：
 *
 *  1. **世代号必须自增**。共享位图从不清零，靠「上次调用留下的戳记 = 更小的世代号」
 *     来区分「已访问」与「未访问」。若世代号忘了自增，**第二次**调用会在链的第一个
 *     扇区就误判成循环 → 目录链少读一整段。这个 bug 在**单次调用**上完全看不出来，
 *     所以 A1/A2 必须**连续调用**同一夹具并比较两次结果。
 *  2. **不能误报**。健康的长链（多扇区目录链、多扇区流链）必须被完整走完；
 *     残留戳记若被误当成「本世代已访问」，链会被提前截断。A3/A4 直接断言走满。
 *  3. **只有下标有上界的 4 处能换成位图**。`_getExtendedDifat` / `_normalizeDifat`
 *     的 sector 值没有上界检查，位图会越界（TypedArray 越界写静默 no-op ⇒ 退化成
 *     不做循环检测），故必须保留 `Set` —— D2 把这条钉死。
 */

function writeDirectoryEntry(
  view: Uint8Array,
  offset: number,
  name: string,
  objectType: number,
  startSector: number,
  size: number,
) {
  for (let i = 0; i < name.length && offset + i * 2 + 1 < view.length; i++) {
    const code = name.charCodeAt(i)
    view[offset + i * 2] = code & 0xff
    view[offset + i * 2 + 1] = (code >> 8) & 0xff
  }
  view[offset + 64] = name.length * 2
  view[offset + 65] = 0
  view[offset + 66] = objectType
  view[offset + 67] = 1
  const put = (o: number, v: number) => {
    view[o] = v & 0xff
    view[o + 1] = (v >> 8) & 0xff
    view[o + 2] = (v >> 16) & 0xff
    view[o + 3] = (v >> 24) & 0xff
  }
  put(offset + 116, startSector)
  put(offset + 120, size)
}

const ENDOFCHAIN = 0xfffffffe
const FREESECT = 0xffffffff

/** 在 OLE 头 + 指定 FAT 布局上建一个最小复合文件。`setFat(idx, val)` 写入 FAT 条目。 */
function buildOle(opts: {
  sectors: number
  firstDirSector: number
  fatEntries: Array<[number, number]>
  dirEntries?: Array<{ sector: number; slot: number; name: string; objectType: number; startSector: number; size: number }>
  fill?: Array<{ sector: number; byte: number }>
}): ArrayBuffer {
  const sectorSize = 512
  const entriesPerSector = sectorSize / 4
  const buf = new ArrayBuffer((opts.sectors + 1) * sectorSize)
  const view = new Uint8Array(buf)
  const setU32 = (off: number, value: number) => {
    view[off] = value & 0xff
    view[off + 1] = (value >> 8) & 0xff
    view[off + 2] = (value >> 16) & 0xff
    view[off + 3] = (value >> 24) & 0xff
  }

  view[0] = 0xd0; view[1] = 0xcf; view[2] = 0x11; view[3] = 0xe0
  view[4] = 0xa1; view[5] = 0xb1; view[6] = 0x1a; view[7] = 0xe1
  view[26] = 0x03 // minor version
  view[30] = 0x09 // sector size power = 512
  view[32] = 0x06 // mini sector size power = 64
  setU32(44, 1)                 // fatSectorsCount
  setU32(48, opts.firstDirSector)
  setU32(56, 4096)              // miniStreamCutoffSize
  setU32(60, ENDOFCHAIN)        // firstMiniFatSector
  setU32(64, 0)                 // miniFatSectorsCount
  setU32(68, ENDOFCHAIN)        // firstDifatSector
  setU32(72, 0)                 // difatSectorsCount
  setU32(76, 0)                 // DIFAT[0] = sector 0 (the FAT itself)
  setU32(80, FREESECT)

  // 先把整张 FAT 填 ENDOFCHAIN，再写显式条目
  for (let idx = 0; idx < opts.sectors; idx++) {
    const off = (Math.floor(idx / entriesPerSector) + 1) * sectorSize + (idx % entriesPerSector) * 4
    if (off + 4 <= view.length) setU32(off, ENDOFCHAIN)
  }
  for (const [idx, val] of opts.fatEntries) {
    const off = (Math.floor(idx / entriesPerSector) + 1) * sectorSize + (idx % entriesPerSector) * 4
    setU32(off, val)
  }
  for (const e of opts.dirEntries ?? []) {
    writeDirectoryEntry(view, (e.sector + 1) * sectorSize + e.slot * 128, e.name, e.objectType, e.startSector, e.size)
  }
  for (const f of opts.fill ?? []) {
    view.fill(f.byte, (f.sector + 1) * sectorSize, (f.sector + 2) * sectorSize)
  }
  return buf
}

/** F1：目录 FAT 链自环（sector 1 → 1），且 sector 1 里放一条有效目录条目。 */
function cyclicDirectoryFixture(): ArrayBuffer {
  return buildOle({
    sectors: 3,
    firstDirSector: 1,
    fatEntries: [[0, ENDOFCHAIN], [1, 1]],
    dirEntries: [{ sector: 1, slot: 0, name: 'Root Entry', objectType: 5, startSector: 0, size: 0 }],
  })
}

/** F2：流 FAT 链自环（sector 2 → 2），WordDocument 从 sector 2 起、声明 1024 字节。 */
function cyclicStreamFixture(): ArrayBuffer {
  return buildOle({
    sectors: 4,
    firstDirSector: 1,
    fatEntries: [[0, ENDOFCHAIN], [1, ENDOFCHAIN], [2, 2]],
    dirEntries: [{ sector: 1, slot: 0, name: 'WordDocument', objectType: 2, startSector: 2, size: 1024 }],
    fill: [{ sector: 2, byte: 0x41 }],
  })
}

/** F4：健康的多扇区目录链 9 → 10 → 11，Root Entry 在 9、WordDocument 在 11。 */
function healthyDirectoryFixture(): ArrayBuffer {
  return buildOle({
    sectors: 12,
    firstDirSector: 9,
    fatEntries: [[9, 10], [10, 11], [11, ENDOFCHAIN]],
    dirEntries: [
      { sector: 9, slot: 0, name: 'Root Entry', objectType: 5, startSector: 0, size: 0 },
      { sector: 11, slot: 0, name: 'WordDocument', objectType: 2, startSector: 3, size: 512 },
    ],
    fill: [{ sector: 3, byte: 0x5a }],
  })
}

/** F3：健康的 8 扇区连续流链 2→3→…→9，每扇区填 0x41。 */
function healthyStreamFixture(): ArrayBuffer {
  const fatEntries: Array<[number, number]> = []
  for (let i = 2; i < 9; i++) fatEntries.push([i, i + 1])
  fatEntries.push([9, ENDOFCHAIN])
  const fill: Array<{ sector: number; byte: number }> = []
  for (let s = 2; s <= 9; s++) fill.push({ sector: s, byte: 0x41 })
  return buildOle({
    sectors: 11,
    firstDirSector: 1,
    fatEntries,
    dirEntries: [{ sector: 1, slot: 0, name: 'WordDocument', objectType: 2, startSector: 2, size: 8 * 512 }],
    fill,
  })
}

function readDirs(buf: ArrayBuffer) {
  const parser = new OleParser(buf)
  const header = parser.parseHeader()
  return parser.getDirectorySectors(header, parser.getFatSectors(header))
}

// ── A 组：世代号隔离（本轮独有的失败模式）────────────────────────────────

describe('round 162 — 世代戳位图：跨调用隔离', () => {
  it('A1 同一循环夹具连续两次解析，两次都检出循环且结果相同', () => {
    const buf = cyclicDirectoryFixture()
    const first = readDirs(buf)
    const second = readDirs(buf)
    const third = readDirs(buf)

    // 检出 = 读了恰好一个扇区的条目后停下（4 条槽位里只有 1 条有名字）
    expect(first.length, '第一次').toBe(1)
    expect(second.length, '第二次（世代号若未自增会变 0）').toBe(first.length)
    expect(third.length, '第三次').toBe(first.length)
  })

  it('A2 中间夹一次健康的多扇区目录链解析，循环仍被检出', () => {
    const cyc = cyclicDirectoryFixture()
    const healthy = healthyDirectoryFixture()

    const a = readDirs(cyc)
    const h = readDirs(healthy) // 健康链走 3 个扇区，把世代号往前推
    const b = readDirs(cyc)

    expect(h.map((e) => e.name).sort(), '健康链两条条目都要读到').toEqual(['Root Entry', 'WordDocument'])
    expect(a.length).toBe(1)
    expect(b.length, '健康解析之后仍须检出循环').toBe(1)
  })

  it('A3 两个不同站点（目录链 / 流链）共用位图但互不串扰', () => {
    const cyc = cyclicStreamFixture()
    const parser = new OleParser(cyc)
    const header = parser.parseHeader()
    const dirs = parser.getDirectorySectors(header, parser.getFatSectors(header))
    const stream = parser.findWordDocumentStream(dirs)
    // 流链自环：只读到第一个扇区 512 字节
    expect(stream?.size).toBe(512)
    expect(stream?.data.every((b) => b === 0x41)).toBe(true)
    // 紧接着再走一次目录链（同一 parser、同一共享位图），仍须正常
    const dirs2 = parser.getDirectorySectors(header, parser.getFatSectors(header))
    expect(dirs2.length).toBe(dirs.length)
  })
})

// ── B 组：健康长链不得误报 ──────────────────────────────────────────────

describe('round 162 — 健康链不得被残留戳记截断', () => {
  it('B1 8 扇区连续流链完整读出（无提前 break）', () => {
    const parser = new OleParser(healthyStreamFixture())
    const header = parser.parseHeader()
    const dirs = parser.getDirectorySectors(header, parser.getFatSectors(header))
    const stream = parser.findWordDocumentStream(dirs)
    expect(stream?.size, '8 × 512').toBe(4096)
    expect(stream?.data.length).toBe(4096)
    expect(stream?.data.every((b) => b === 0x41)).toBe(true)
  })

  it('B2 多扇区目录链 9→10→11 走满（两条条目都读到）', () => {
    const dirs = readDirs(healthyDirectoryFixture())
    expect(dirs.map((e) => e.name).sort()).toEqual(['Root Entry', 'WordDocument'])
  })

  it('B3 B1/B2 与循环夹具交替多轮，健康链始终走满', () => {
    const healthy = healthyDirectoryFixture()
    const cyc = cyclicDirectoryFixture()
    for (let i = 0; i < 5; i++) {
      expect(readDirs(cyc).length, `第 ${i} 轮循环夹具`).toBe(1)
      expect(readDirs(healthy).map((e) => e.name).sort(), `第 ${i} 轮健康夹具`).toEqual([
        'Root Entry',
        'WordDocument',
      ])
    }
  })
})

// ── C 组：骨架负控（证明 A 组判据非空转）────────────────────────────────

describe('round 162 — 骨架负控：世代号必须自增', () => {
  /** 与生产同构的世代戳遍历骨架；`increment=false` 复刻「忘了自增」的缺陷。 */
  function makeWalker(increment: boolean) {
    const stamps = new Uint32Array(64)
    // 生产实现里 `beginVisit` 返回 `++visitEpoch`，故世代号恒 ≥ 1，绝不会与
    // 「零值数组 = 未访问」的 0 相撞。骨架必须同样从 1 起，否则 `increment=false`
    // 会退化成「第一次就误判」，与真实缺陷形状不符。
    let epoch = 1
    return function walk(fat: Int32Array, start: number): number {
      if (increment) epoch++
      let cur = start
      let n = 0
      while (cur >= 0 && cur < fat.length && fat[cur] !== -1 && n < 64) {
        if (stamps[cur] === epoch) break
        stamps[cur] = epoch
        n++
        cur = fat[cur]
      }
      return n
    }
  }

  // 与 cyclicDirectoryFixture 同构的 FAT：0→END，1→1（自环）
  const fat = new Int32Array([-2, 1, -2, -2])

  it('C1 自增版：两次遍历结果一致', () => {
    const walk = makeWalker(true)
    const a = walk(fat, 1)
    const b = walk(fat, 1)
    expect(a).toBe(1)
    expect(b).toBe(a)
  })

  it('C2 不自增版：第二次退化为 0（正是 A1 要抓的缺陷）', () => {
    const walk = makeWalker(false)
    expect(walk(fat, 1)).toBe(1)
    expect(walk(fat, 1), '不自增 ⇒ 第二次在首扇区即误判循环').toBe(0)
  })

  it('C3 不自增版在健康长链上同样退化（A2/B 组判据有效）', () => {
    const chain = new Int32Array([-2, -2, 3, 4, -2]) // 2→3→4
    const walk = makeWalker(false)
    expect(walk(chain, 2)).toBe(3)
    expect(walk(chain, 2), '第二次误判').toBe(0)
  })
})

// ── D 组：接线元断言 ────────────────────────────────────────────────────

describe('round 162 — 接线元断言', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(resolve(here, '../src/utils/oleParser.ts'), 'utf8')

  it('D1 四处链遍历改用共享世代戳位图', () => {
    expect(src.match(/const epoch = beginVisit\(/g)?.length, 'beginVisit 调用点').toBe(4)
    expect(src.match(/const stamps = visitStamps/g)?.length, '位图局部快照').toBe(4)
    expect(src).toContain('function beginVisit(size: number): number')
    expect(src).toContain('let visitStamps = new Uint32Array(0)')
  })

  it('D2 下标无上界的两处仍保留 Set（位图会越界静默失效）', () => {
    // 只看真正的声明行，避免把注释里提到的 `new Set<number>()` 也数进去
    const setSites = src.match(/^\s*const \w+ = new Set<number>\(\)$/gm) ?? []
    expect(setSites.length, '保留的 Set 声明站点数').toBe(2)
    expect(src).toContain('const visited = new Set<number>()') // _getExtendedDifat
    expect(src).toContain('const seen = new Set<number>()') // _normalizeDifat
    expect(src).toContain('private _getExtendedDifat')
    expect(src).toContain('private _normalizeDifat')
  })

  it('D3 四处旧的 visited Set 已移除，恰好剩下标无上界的两处', () => {
    // 4 处转换：getDirectorySectors / readRegularStream / getMiniFatSectors / readMiniStream
    expect(src.match(/stamps\[currentSector\] === epoch/g)?.length ?? 0, '扇区站点').toBe(3)
    expect(src.match(/stamps\[currentMiniSector\] === epoch/g)?.length ?? 0, '迷你扇区站点').toBe(1)
    // 未转换的两处（_getExtendedDifat 用 visited、_normalizeDifat 用 seen）各自保留
    expect(src.match(/visited\.has\(/g)?.length ?? 0, '残留 visited.has').toBe(1)
    expect(src.match(/visited\.add\(/g)?.length ?? 0, '残留 visited.add').toBe(1)
    expect(src.match(/seen\.has\(/g)?.length ?? 0, '残留 seen.has').toBe(1)
    expect(src.match(/seen\.add\(/g)?.length ?? 0, '残留 seen.add').toBe(1)
  })
})
