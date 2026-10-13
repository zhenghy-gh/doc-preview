import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { bytesToBase64 } from '../src/utils/binaryReader'

/**
 * Round 161 护栏：`bytesToBase64` 的分块大小 `0x2000 → 0x800`。
 *
 * ── 为什么这个改动需要专门的护栏 ──────────────────────────────────────
 * 该函数**对任意块大小都输出同一个字符串**（分块只影响怎么攒中间串，不影响
 * `btoa` 的输入内容）。因此：
 *   - 任何「比输出」的测试都无法发现块大小被悄悄改回去；
 *   - 唯一能钉死「本轮真的生效了」的是**源码文本断言**（见 D1）。
 * 反过来说，真正可能出错的地方只有三处：块边界处丢字节 / 重复字节 / 顺序错乱，
 * 所以 A 组围绕新边界 `0x800` 逐点扫，负控（E 组）直接构造这三种破坏。
 *
 * oracle 用与分块完全无关的 `naive()`（逐字节拼接），而不是「另一份分块实现」——
 * 后者与本实现共享同一类错误假设，不构成独立证据。
 */

const CHUNK = 0x800

/** 与分块无关的朴素参照：逐字节拼接再 btoa。 */
function naive(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function mk(n: number, seed = 31, add = 7): Uint8Array {
  const b = new Uint8Array(n)
  for (let i = 0; i < n; i++) b[i] = (i * seed + add) & 0xff
  return b
}

const here = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(here, '../src/utils/binaryReader.ts')

// ── A 组：等价性 ────────────────────────────────────────────────────────

describe('round 161 — bytesToBase64 分块 0x800 与朴素参照等价', () => {
  it('A1 全部 256 个单字节值与全部 65536 个双字节组合', () => {
    for (let b = 0; b < 256; b++) {
      expect(bytesToBase64(new Uint8Array([b])), `byte=0x${b.toString(16)}`).toBe(naive(new Uint8Array([b])))
    }
    const buf = new Uint8Array(2)
    for (let v = 0; v < 0x10000; v++) {
      buf[0] = v & 0xff
      buf[1] = v >> 8
      expect(bytesToBase64(buf), `v=0x${v.toString(16)}`).toBe(naive(buf))
    }
  })

  it('A2 新分块边界 0x800 前后逐点扫', () => {
    const sizes = [
      0, 1, 2, 3,
      0x7fe, 0x7ff, 0x800, 0x801, 0x802, // 单块 → 双块的临界
      0xfff, 0x1000, 0x1001,
      0x17fe, 0x17ff, 0x1800, 0x1801, // 3 块临界
      0x1ffe, 0x1fff, 0x2000, 0x2001, // 旧块大小的边界（现已是第 4 块内）
      0x3fff, 0x4000, 0x4001,
      0x5fff, 0x6000, 0x6001,
    ]
    for (const n of sizes) {
      const buf = mk(n)
      const got = bytesToBase64(buf)
      expect(got, `n=${n}`).toBe(naive(buf))
      expect(got.length, `n=${n} 长度`).toBe(naive(buf).length)
    }
  })

  it('A3 长度 mod 3 的三种余数在每个块交界处都正确（base64 padding）', () => {
    for (const rem of [0, 1, 2]) {
      for (const base of [0x7ff, 0x800, 0x801, 0x1000, 0x1800, 0x2000]) {
        const n = base + rem
        const buf = mk(n, 131, 17)
        expect(bytesToBase64(buf), `n=${n}`).toBe(naive(buf))
      }
    }
  })

  it('A4 每个字节值都跨过 0x800 边界（块尾与下一块首字节的 256 种组合）', () => {
    const n = 0x801
    for (let b = 0; b < 256; b++) {
      const buf = new Uint8Array(n).fill(0x41)
      buf[0x7ff] = b
      buf[0x800] = (b + 1) & 0xff
      expect(bytesToBase64(buf), `b=0x${b.toString(16)}`).toBe(naive(buf))
    }
  })

  it('A5 真实语料切片与朴素参照一致，且确实走过分块路径', () => {
    const docsDir = resolve(here, '../docs')
    const files = existsSync(docsDir) ? readdirSync(docsDir).filter((f) => f.endsWith('.doc') || f.endsWith('.dot')).sort() : []
    expect(files.length, '样本数').toBeGreaterThan(20)

    let total = 0
    let chunkedSlices = 0
    for (const f of files) {
      const buf = new Uint8Array(readFileSync(resolve(docsDir, f)))
      const step = Math.max(1, Math.floor(buf.length / 6))
      for (let s = 0; s < buf.length; s += step) {
        const e = Math.min(s + step, buf.length)
        if (e <= s) continue
        const slice = buf.subarray(s, e)
        if (slice.length > CHUNK) chunkedSlices++
        expect(bytesToBase64(slice), `${f} ${s}..${e}`).toBe(naive(slice))
        total += slice.length
      }
    }
    expect(total, '实际比对字节数').toBeGreaterThan(5 * 1024 * 1024)
    // 非空转：确实有切片长到必须分块，否则这组测试对分块分支零覆盖
    expect(chunkedSlices, '分块切片数').toBeGreaterThan(0)
  })

  it('A6 1 MB 输入正确（跨 512 个块）', () => {
    const n = 1024 * 1024
    const buf = mk(n, 2654435761, 0)
    expect(bytesToBase64(buf)).toBe(naive(buf))
  })
})

// ── B 组：负控（骨架）──────────────────────────────────────────────────
// 把「分块」这一环节的三种真实破坏模式注入同一骨架，断言 A 组的判据能检出。
// 若这些骨架不被检出，说明 A 组是空转的。

/** 与生产同构的分块骨架，可注入缺陷。 */
function skeleton(bytes: Uint8Array, mode: 'ok' | 'dropLast' | 'reverse' | 'skipOdd', chunk = CHUNK): string {
  if (bytes.length <= chunk) return btoa(String.fromCharCode.apply(null, bytes as unknown as number[]))
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += chunk) {
    if (mode === 'dropLast' && i + chunk >= bytes.length) break // 丢最后一块
    if (mode === 'skipOdd' && (i / chunk) % 2 === 1) continue // 隔块丢弃
    const end = Math.min(i + chunk, bytes.length)
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, end) as unknown as number[]))
  }
  if (mode === 'reverse') parts.reverse() // 块顺序颠倒
  return btoa(parts.join(''))
}

describe('round 161 — 骨架负控：三种分块破坏模式必须可辨', () => {
  const sample = mk(0x2345, 97, 5) // 5 个块（0x2345 = 4*0x800 + 0x345）

  it('E1 正确骨架与生产一致（正控，零失配）', () => {
    expect(skeleton(sample, 'ok')).toBe(bytesToBase64(sample))
  })

  it('E2 丢最后一块 → 与朴素参照不同', () => {
    expect(skeleton(sample, 'dropLast')).not.toBe(naive(sample))
  })

  it('E3 块顺序颠倒 → 与朴素参照不同', () => {
    expect(skeleton(sample, 'reverse')).not.toBe(naive(sample))
  })

  it('E4 隔块丢弃 → 与朴素参照不同', () => {
    expect(skeleton(sample, 'skipOdd')).not.toBe(naive(sample))
  })

  it('E5 三种破坏在 A2 的边界集合上全部可辨（判据非空转）', () => {
    const sizes = [0x800, 0x801, 0x1000, 0x1001, 0x2345]
    for (const mode of ['dropLast', 'reverse', 'skipOdd'] as const) {
      let detected = 0
      for (const n of sizes) {
        const buf = mk(n, 97, 5)
        if (skeleton(buf, mode) !== naive(buf)) detected++
      }
      expect(detected, `${mode} 被检出数`).toBeGreaterThan(0)
    }
  })
})

// ── D 组：接线元断言 ───────────────────────────────────────────────────

describe('round 161 — 接线元断言', () => {
  it('D1 源码中的块大小确实是 0x800（输出对块大小不敏感，只能查源码）', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src, '块大小应为 0x800').toContain('const CHUNK = 0x800')
    expect(src, '不应残留旧的 0x2000').not.toContain('const CHUNK = 0x2000')
  })

  it('D2 长输入仍走「攒块 + 一次 join + 一次 btoa」，短输入走单次转换', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('if (bytes.length <= CHUNK)')
    expect(src).toContain('btoa(parts.join(')
    expect(src).toContain('bytes.subarray(i, end)')
  })

  it('D3 输出对块大小不敏感（说明 D1 为何必须查源码而非比输出）', () => {
    // 同一份输入在 0x800 / 0x1000 / 0x2000 三种块下输出逐字符相同
    const buf = mk(0x4321, 53, 11)
    expect(skeleton(buf, 'ok', 0x800)).toBe(skeleton(buf, 'ok', 0x1000))
    expect(skeleton(buf, 'ok', 0x1000)).toBe(skeleton(buf, 'ok', 0x2000))
    expect(skeleton(buf, 'ok', 0x800)).toBe(bytesToBase64(buf))
  })
})
