/**
 * Round 109 常驻护栏：`extractImagesFromStream` 的**整对跳过**。
 *
 * 被保护的控制流：把「逐字节查 `LEAD_KIND`」换成「先查 65536 项 `PAIR_HAS_LEAD`
 * （索引 `(data[i] << 8) | data[i + 1]`），两个字节都不是签名首字节时 `i += 2`」。
 * 真实流（72 条 / 7.49 MB）实测 1.377x。
 *
 * ── 等价性论证 ──────────────────────────────────────────────────────
 * 只有「两个字节都**不是**首字节」时才会跳过。此时逐字节版本在这两个位置上
 * 都只会走 `kind === 0 → continue`，没有任何副作用 —— 所以被跳过的每一步都是
 * 逐字节版本的空转。唯一可能的失效模式是**把含首字节的字节对误判为不含**，
 * 从而漏掉一张图片；本护栏正是针对这一点设计的：
 *
 * - 用例 1 用「填充长度 × 填充字节」的笛卡尔积把图片放在 **0..9 的全部偏移**上，
 *   并让填充字节取遍四个首字节本身 —— 若某个含首字节的字节对被误判，图片就会漏。
 * - 用例 2 **穷尽 65536 个字节对**放在缓冲区最前面，后面紧跟一张最小 JPEG。
 * - 用例 3 穷尽「长度 ≤ 3 的、取值含四个首字节的全部前缀」。
 *
 * 断言都写成「恰好 1 张且字节完全相同」，而不是「至少 1 张」——这样既能抓漏报，
 * 也能抓出误报（多产出一张）。
 *
 * 作用域边界：本护栏只驱动真实的 `extractImagesFromStream`，**不转写** `find*`
 * （本轮未触及它们）。最小合法图片字节与 Round 108 的
 * `imageExtractor.dispatch.test.ts` 保持一致。
 */
import { describe, it, expect } from 'vitest'
import { extractImagesFromStream } from '../src/utils/imageExtractor'

// ── 最小合法图片（与 Round 108 护栏同源） ─────────────────────
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00,
  0x49, 0x45, 0x4e, 0x44,
  0x00, 0x00, 0x00, 0x00,
])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
const GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x37, 0x61,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x3b,
])
const BMP = (() => {
  const a = new Uint8Array(54)
  a[0] = 0x42; a[1] = 0x4d
  a[2] = 0x36; a[3] = 0x00; a[4] = 0x00; a[5] = 0x00
  return a
})()

const IMAGES: Array<[string, Uint8Array]> = [
  ['png', PNG], ['jpeg', JPEG], ['gif', GIF], ['bmp', BMP],
]

function concat(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
const repeat = (byte: number, n: number) => new Uint8Array(n).fill(byte)

// 尾部填充用 0x00：它不是任何签名的首字节，也不会与图片结尾拼出签名。
const TAIL = repeat(0x00, 8)

describe('extractImagesFromStream 整对跳过护栏（Round 109）', () => {
  it('偏移 0..9 × 8 种填充字节：图片恰好被找到一次，字节完全相同', () => {
    // 填充字节刻意取遍四个签名首字节（0x89 / 0xff / 0x47 / 0x42）与若干普通值，
    // 这样「填充与图片首字节相邻」「填充自身成对」两种形态都被覆盖到。
    const padBytes = [0x00, 0x20, 0x0a, 0xe0, 0x89, 0xff, 0x47, 0x42]
    let cases = 0
    for (const [format, img] of IMAGES) {
      for (let padLen = 0; padLen <= 9; padLen++) {
        for (const padByte of padBytes) {
          const stream = concat(repeat(padByte, padLen), img, TAIL)
          const out = extractImagesFromStream(stream)
          const label = `${format} padLen=${padLen} pad=0x${padByte.toString(16)}`
          expect(out.length, label).toBe(1)
          expect(out[0].format, label).toBe(format)
          expect(Array.from(out[0].data), label).toEqual(Array.from(img))
          cases++
        }
      }
    }
    // 非空转：确实跑了 4 × 10 × 8 组。
    expect(cases).toBe(320)
  })

  it('穷尽 65536 个字节对：任一字节对之后的最小 JPEG 都不会被跳过', () => {
    // 缓冲区最前面放 (b0, b1)，紧随其后是 FF D8 FF D9。
    // 只有「含 0xff 的字节对被误判为不含」时，这张 JPEG 才会漏。
    let found = 0
    for (let b0 = 0; b0 < 256; b0++) {
      for (let b1 = 0; b1 < 256; b1++) {
        const stream = new Uint8Array(10)
        stream[0] = b0; stream[1] = b1
        stream.set(JPEG, 2)
        const out = extractImagesFromStream(stream)
        if (out.length !== 1 || out[0].format !== 'jpeg' ||
            out[0].data.length !== 4 || out[0].data[0] !== 0xff || out[0].data[3] !== 0xd9) {
          throw new Error(
            `字节对 (0x${b0.toString(16)}, 0x${b1.toString(16)}) 出错：` +
            `产出 ${out.length} 张 ${out.map(i => i.format).join(',')}`,
          )
        }
        found++
      }
    }
    // 非空转：65536 组全部产出。
    expect(found).toBe(65536)
  })

  it('穷尽长度 ≤ 3 的首字节前缀：连续首字节不会让后续图片被跳过', () => {
    const alphabet = [0x00, 0x01, 0x0a, 0x42, 0x47, 0x89, 0xff]
    let cases = 0
    const walk = (prefix: number[]) => {
      if (prefix.length > 0) {
        const stream = concat(new Uint8Array(prefix), JPEG, TAIL)
        const out = extractImagesFromStream(stream)
        const label = prefix.map(b => b.toString(16)).join(' ')
        expect(out.length, label).toBe(1)
        expect(out[0].format, label).toBe('jpeg')
        expect(Array.from(out[0].data), label).toEqual(Array.from(JPEG))
        cases++
      }
      if (prefix.length === 3) return
      for (const b of alphabet) walk([...prefix, b])
    }
    walk([])
    // 7 + 49 + 343 = 399
    expect(cases).toBe(399)
  })

  it('末字节边界：长度为 8 / 9 的缓冲区不越界，且不误报', () => {
    // length < 8 直接返回空。
    for (let n = 0; n < 8; n++) {
      const stream = repeat(0x89, n)
      expect(extractImagesFromStream(stream).length, `len=${n}`).toBe(0)
    }
    // 长度 8：单字节路径不会执行（i + 1 === len），零误报。
    expect(extractImagesFromStream(repeat(0x89, 8)).length).toBe(0)
    expect(extractImagesFromStream(repeat(0xff, 9)).length).toBe(0)
    expect(extractImagesFromStream(repeat(0x42, 9)).length).toBe(0)
  })

  it('整对跳过不改变多图顺序与去重（命中后从 end 继续）', () => {
    const stream = concat(
      repeat(0x89, 3), PNG,
      repeat(0xff, 2), JPEG,
      repeat(0x47, 4), GIF,
      repeat(0x42, 5), BMP,
      TAIL,
    )
    const out = extractImagesFromStream(stream)
    expect(out.map(i => i.format)).toEqual(['png', 'jpeg', 'gif', 'bmp'])
    expect(out.map(i => i.data.length)).toEqual([PNG.length, JPEG.length, GIF.length, BMP.length])
  })
})
