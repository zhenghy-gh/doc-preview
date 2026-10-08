import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { extractShapesFromDataStream } from '../src/utils/shapeParser'

/**
 * OfficeArt FDG 扫描的契约与复杂度护栏。
 *
 * 与同目录的 `shapeParser.test.ts` 互补：后者用合成结构覆盖提取逻辑，
 * 这里守住两件它守不住的事：
 *
 * 1. **前置筛选的既有契约**（见下方「已知局限」）。`extractShapes` 在进入
 *    `parseFdg` 前要求 `(readUint16(data, offset) & 0xC000) === 0xC000`，
 *    即 recInstance 低字节的高 2 位必须为 11。这不是 MS-ODRAW 的要求：
 *    规范形态的 OfficeArtFDG 是 recInstance = 0，会被这条筛选拒掉。
 *    结果是 27 份真实样本一份都提取不到形状。**这是既有行为，不是本轮引入的**；
 *    测试把它钉死，让日后的修复必须是显式、可见的决定。
 * 2. **复杂度护栏**。扫描对每个偏移都要做判断，一旦退化为超线性行为，
 *    小样本上结果仍然正确、只有大输入会变成性能悬崖，差分测试查不出来。
 */

// ── 最小 OfficeArt 链构造 ─────────────────────────────
function writeU16(d: Uint8Array, o: number, v: number) {
  d[o] = v & 0xff
  d[o + 1] = (v >> 8) & 0xff
}
function writeU32(d: Uint8Array, o: number, v: number) {
  d[o] = v & 0xff
  d[o + 1] = (v >> 8) & 0xff
  d[o + 2] = (v >> 16) & 0xff
  d[o + 3] = (v >> 24) & 0xff
}
function writeRecHeader(
  d: Uint8Array,
  o: number,
  recVer: number,
  recInstance: number,
  recType: number,
  recLen: number
) {
  d[o] = (recVer << 6) | ((recInstance >> 8) & 0x3f)
  d[o + 1] = recInstance & 0xff
  d[o + 2] = recType & 0xff
  d[o + 3] = (recType >> 8) & 0xff
  writeU32(d, o + 4, recLen)
}

/** FDG → DG → SP 链。`fdgRecInstance` 决定能否过前置筛选。 */
function buildChain(fdgRecInstance: number, spid = 0x50000001): Uint8Array {
  const SP_SIZE = 8 + 72
  const spContainerLen = SP_SIZE + 12 + 12 + 12 + 16
  const dgLen = 8 + spContainerLen
  const buf = new Uint8Array(8 + 8 + dgLen + 64)
  let off = 0
  writeRecHeader(buf, off, 3, fdgRecInstance, 0xf000, 8 + dgLen)
  off += 8
  writeRecHeader(buf, off, 3, 0, 0xf002, dgLen)
  off += 8
  writeRecHeader(buf, off, 3, 0, 0xf003, spContainerLen)
  off += 8
  writeRecHeader(buf, off, 3, 0, 0x0004, 72)
  off += 8
  writeU32(buf, off, spid)
  writeU16(buf, off + 4, 1)
  off += SP_SIZE
  writeRecHeader(buf, off, 3, 0, 0x0016, 4)
  writeU32(buf, off + 8, 0x12345678)
  off += 12
  writeRecHeader(buf, off, 3, 0, 0x0017, 4)
  writeU32(buf, off + 8, 0x0abcdef0)
  off += 12
  writeRecHeader(buf, off, 3, 0, 0x0018, 4)
  writeU32(buf, off + 8, 0x11111111)
  off += 12
  writeRecHeader(buf, off, 3, 0, 0x0010, 8)
  writeU32(buf, off + 8, 42)
  return buf
}

describe('extractShapesFromDataStream — FDG 前置筛选的既有契约', () => {
  it('recInstance 低字节高 2 位为 11 时提取到形状（当前放行的形态）', () => {
    for (const recInstance of [0x00c0, 0x00ff, 0x01c0, 0xffff]) {
      const shapes = extractShapesFromDataStream(buildChain(recInstance))
      expect(shapes.length, `recInstance=0x${recInstance.toString(16)}`).toBe(1)
      expect(shapes[0].spid).toBe(0x50000001)
      expect(shapes[0].type).toBe('picture')
    }
  })

  it('已知局限：规范形态 recInstance = 0 会被拒（MS-ODRAW 的 OfficeArtFDG 就是 0）', () => {
    // 这条断言描述的是**当前实现的行为**，不是期望的行为。
    // 若日后修正该筛选，本用例会失败——那正是提醒维护者显式确认改动的信号。
    for (const recInstance of [0x0000, 0x003f, 0x007f, 0x0080]) {
      const shapes = extractShapesFromDataStream(buildChain(recInstance))
      expect(
        shapes.length,
        `recInstance=0x${recInstance.toString(16)} 当前被前置筛选拒绝`
      ).toBe(0)
    }
  })

  it('recType 不是 0xF000 时一律不产出', () => {
    for (const recType of [0xf001, 0xf002, 0xf003, 0x0000, 0x00f0]) {
      const buf = buildChain(0x00c0)
      // 只改首个记录头的 recType 两个字节，其余（含 recLen）保持合法
      buf[2] = recType & 0xff
      buf[3] = (recType >> 8) & 0xff
      expect(extractShapesFromDataStream(buf).length, `recType=0x${recType.toString(16)}`).toBe(0)
    }
  })
})

describe('extractShapesFromDataStream — 跳跃路径不得漏掉候选', () => {
  // 扫描循环在「前置筛失败」时会用 `indexOf(FDG_TYPE_HI, offset + 4)` 跳到下一个
  // 0xF0 并回退 3 字节。回退量或起点写错都会**静默**漏掉真链——结果数组变空，
  // 而不是报错。下面几组用例从不同方向压这个边界。
  it('前面垫满 0xF0（锚点最密）时真链仍被提取', () => {
    const c = buildChain(0x00c0)
    for (const padLen of [0, 1, 2, 3, 5, 8, 17, 64, 137, 300]) {
      const buf = new Uint8Array(padLen + c.length + 64).fill(0xf0)
      buf.set(c, padLen)
      // 链尾之后换成 0x41，避免尾部填充与链本身混在一起
      for (let i = padLen + c.length; i < buf.length; i++) buf[i] = 0x41
      const shapes = extractShapesFromDataStream(buf)
      expect(shapes.length, `padLen=${padLen}`).toBe(1)
      expect(shapes[0].spid).toBe(0x50000001)
    }
  })

  it('前面垫满 0x00（前置筛的另一个字节最密）时真链仍被提取', () => {
    const c = buildChain(0x00c0)
    for (const padLen of [0, 1, 4, 9, 64, 257]) {
      const buf = new Uint8Array(padLen + c.length + 64)
      buf.set(c, padLen)
      const shapes = extractShapesFromDataStream(buf)
      expect(shapes.length, `padLen=${padLen}`).toBe(1)
    }
  })

  it('不会越过「前置筛通过但掩码拒绝」的假候选', () => {
    const c = buildChain(0x00c0)
    const padLen = 32
    const buf = new Uint8Array(padLen + c.length + 64).fill(0x41)
    buf.set(c, padLen)
    // 偏移 16 处：data[18]=0x00、data[19]=0xF0（前置筛通过），
    // 但 readUint16(16)=0x0000 的高 2 位不是 11（掩码拒绝）
    buf[16] = 0x00
    buf[17] = 0x00
    buf[18] = 0x00
    buf[19] = 0xf0
    const shapes = extractShapesFromDataStream(buf)
    expect(shapes.length).toBe(1)
    expect(shapes[0].spid).toBe(0x50000001)
  })

  it('被 0xF0 长串隔开的两条链都被提取', () => {
    const a = buildChain(0x00c0, 0x50000011)
    const b = buildChain(0x00c0, 0x50000022)
    const gap = 211
    const buf = new Uint8Array(24 + a.length + gap + b.length + 24)
    buf.fill(0xf0)
    buf.set(a, 24)
    buf.set(b, 24 + a.length + gap)
    for (let i = 24 + a.length; i < 24 + a.length + gap; i++) buf[i] = 0xf0
    for (let i = 24 + a.length + gap + b.length; i < buf.length; i++) buf[i] = 0x41
    const shapes = extractShapesFromDataStream(buf)
    expect(shapes.map((s) => s.spid).sort()).toEqual([0x50000011, 0x50000022])
  })
})

describe('extractShapesFromDataStream — 真实样本快照', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const docsDir = resolve(here, '../docs')

  it('docs/ 下每份样本都扫描过、且不产生任何假阳性', () => {
    const files = existsSync(docsDir)
      ? readdirSync(docsDir).filter((f) => f.endsWith('.doc')).sort()
      : []
    expect(files.length, '样本数').toBeGreaterThan(20)

    let scanned = 0
    let shapes = 0
    for (const f of files) {
      const buf = new Uint8Array(readFileSync(resolve(docsDir, f)))
      scanned += buf.length
      shapes += extractShapesFromDataStream(buf).length
    }
    // 没有这条断言的话，「一个样本都没读到」也会让下面的 0 通过
    expect(scanned, '实际扫描的字节数').toBeGreaterThan(5 * 1024 * 1024)
    expect(shapes, '真实语料上的形状数（已知为 0，见下方「已知局限」）').toBe(0)
  })
})

describe('extractShapesFromDataStream — 复杂度护栏', () => {
  // 1 MB 输入的 O(n) 扫描约 2–3 ms；上限 5000 ms 有约三个数量级余量，
  // 不会因并行测试的机器争用而误报，但能拦住任何超线性退化。
  const N = 1024 * 1024

  it('单一字节铺满 1MB 在线性时间内完成', () => {
    for (const fill of [0x00, 0xf0, 0xc0, 0xff, 0x3f, 0x89]) {
      const buf = new Uint8Array(N).fill(fill)
      const t = performance.now()
      const shapes = extractShapesFromDataStream(buf)
      const ms = performance.now() - t
      expect(shapes, `fill=0x${fill.toString(16)} 不应提取到形状`).toEqual([])
      expect(ms, `fill=0x${fill.toString(16)} 耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
    }
  })

  it('每 16 字节一个 FDG 记录头的 1MB 缓冲区在线性时间内完成', () => {
    const buf = new Uint8Array(N)
    for (let o = 0; o + 8 <= buf.length; o += 16) {
      writeRecHeader(buf, o, 3, 0x00c0, 0xf000, 8)
    }
    const t = performance.now()
    const shapes = extractShapesFromDataStream(buf)
    const ms = performance.now() - t
    expect(shapes).toEqual([])
    expect(ms, `密集 FDG 头耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
  })

  it('每 4 字节一个 FDG 记录头的 256KB 病态缓冲区在线性时间内完成', () => {
    const buf = new Uint8Array(262144)
    for (let o = 0; o + 8 <= buf.length; o += 4) {
      writeRecHeader(buf, o, 3, 0x00c0, 0xf000, 8)
    }
    const t = performance.now()
    const shapes = extractShapesFromDataStream(buf)
    const ms = performance.now() - t
    expect(shapes).toEqual([])
    expect(ms, `超密集 FDG 头耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
  })

  it('低于 64 字节的输入直接返回空数组', () => {
    expect(extractShapesFromDataStream(new Uint8Array(0))).toEqual([])
    expect(extractShapesFromDataStream(new Uint8Array(63))).toEqual([])
    expect(extractShapesFromDataStream(new Uint8Array(64))).toEqual([])
  })

  it('锚点 0xF0 每 4 字节一个但前置筛的 0x00 从不匹配的 1MB 缓冲区在线性时间内完成', () => {
    // 每次前置筛都失败、每次跳跃都命中紧邻的 0xF0 —— 跳跃路径最坏的一类输入。
    const buf = new Uint8Array(N).fill(0x41)
    for (let o = 0; o + 4 <= buf.length; o += 4) buf[o + 3] = 0xf0
    const t = performance.now()
    const shapes = extractShapesFromDataStream(buf)
    const ms = performance.now() - t
    expect(shapes).toEqual([])
    expect(ms, `密集锚点耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
  })

  it('锚点 0xF0 每 64 字节一个（稀疏，跳跃全程生效）的 1MB 缓冲区在线性时间内完成', () => {
    const buf = new Uint8Array(N).fill(0x41)
    for (let o = 0; o + 4 <= buf.length; o += 64) buf[o + 3] = 0xf0
    const t = performance.now()
    const shapes = extractShapesFromDataStream(buf)
    const ms = performance.now() - t
    expect(shapes).toEqual([])
    expect(ms, `稀疏锚点耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
  })
})
