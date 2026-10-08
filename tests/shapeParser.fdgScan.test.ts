import { describe, it, expect } from 'vitest'
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
})
