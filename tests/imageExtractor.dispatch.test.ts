/**
 * Round 108 常驻护栏：`extractImagesFromStream` 的**首字节分派**。
 *
 * 被保护的控制流：把「四个 case 值稀疏（66 / 71 / 137 / 255）的 `switch`」换成
 * 「256 项 `LEAD_KIND` 查找表 + 稠密分支号分派」。实测整个扫描 1.32x。
 *
 * 等价性论证（写进断言里）：
 * - 表只把四个签名首字节映射到四个分支号，其余全为 0；四个首字节互不相同，
 *   因此任一偏移至多进入一个分支 —— 与 `switch` 逐位相同，且**无顺序依赖**。
 * - 把一个**非首字节**错映射到某个分支号是**可证明无害**的：该分支的第一步是
 *   `bytesEqual(data, i, <该分支的签名>)`，而 `bytesEqual` 会连 `data[i]` 一起比较，
 *   签名首字节就是被错映射的那个字节 —— 于是它必然为 false。所以只有
 *   「把真首字节映射错 / 映射丢」才会产生行为差异，本护栏正是针对这两种情况。
 *
 * 本护栏不转写 `find*`（改动未触及），而是用**最小合法图片字节**驱动真实的
 * `extractImagesFromStream`，覆盖四个分支体。
 */
import { describe, it, expect } from 'vitest'
import { extractImagesFromStream } from '../src/utils/imageExtractor'

// ── 最小合法图片 ─────────────────────────────────────────────
// PNG：签名 + 一个 length=0 的 IEND chunk（4 长度 + 4 类型 + 4 CRC）。
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00,
  0x49, 0x45, 0x4e, 0x44,
  0x00, 0x00, 0x00, 0x00,
])
// JPEG：SOI + EOI。
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
// GIF：GIF87a + 7 字节逻辑屏幕描述符（packed=0，无全局色表）+ 0x3B 结束符。
const GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x37, 0x61,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x3b,
])
// BMP：BM + 文件大小 54（LE32）+ 48 字节填充 = 54 字节。
const BMP = (() => {
  const a = new Uint8Array(54)
  a[0] = 0x42; a[1] = 0x4d
  a[2] = 0x36; a[3] = 0x00; a[4] = 0x00; a[5] = 0x00
  return a
})()

const FILL = 0x20 // 空格，不是任何签名的首字节

function concat(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
const filler = (n: number) => new Uint8Array(n).fill(FILL)

describe('extractImagesFromStream 首字节分派护栏（Round 108）', () => {
  it('四种格式各自单独出现时都能被识别（首字节映射未丢）', () => {
    const cases: Array<[Uint8Array, string, number]> = [
      [PNG, 'png', PNG.length],
      [JPEG, 'jpeg', JPEG.length],
      [GIF, 'gif', GIF.length],
      [BMP, 'bmp', BMP.length],
    ]
    for (const [img, format, size] of cases) {
      const stream = concat(filler(16), img, filler(16))
      const out = extractImagesFromStream(stream)
      expect(out.length, format).toBe(1)
      expect(out[0].format).toBe(format)
      expect(out[0].data.length).toBe(size)
    }
  })

  it('四图混排：顺序与数量与输入一致（无分支互换）', () => {
    const stream = concat(
      filler(5), PNG, filler(3), JPEG, filler(7), GIF, filler(2), BMP, filler(11),
    )
    const out = extractImagesFromStream(stream)
    expect(out.map(i => i.format)).toEqual(['png', 'jpeg', 'gif', 'bmp'])
    expect(out.map(i => i.data.length)).toEqual([PNG.length, JPEG.length, GIF.length, BMP.length])
  })

  it('顺序无关：任意排列都得到对应序列', () => {
    const items: Array<[string, Uint8Array]> = [['png', PNG], ['jpeg', JPEG], ['gif', GIF], ['bmp', BMP]]
    const perms = [
      [0, 1, 2, 3], [3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1], [3, 0, 2, 1],
    ]
    for (const p of perms) {
      const stream = concat(...p.flatMap(idx => [filler(4), items[idx][1]]), filler(4))
      const out = extractImagesFromStream(stream)
      expect(out.map(i => i.format)).toEqual(p.map(idx => items[idx][0]))
    }
  })

  it('非空转：本护栏确实产出了图片', () => {
    const stream = concat(PNG, JPEG, GIF, BMP)
    const out = extractImagesFromStream(stream)
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBe(4)
  })

  it('全部 256 个字节值循环三次：零误报', () => {
    const sweep = new Uint8Array(768)
    for (let i = 0; i < 768; i++) sweep[i] = i & 0xff
    expect(extractImagesFromStream(sweep).length).toBe(0)
  })

  it('只有签名首字节、没有后续字节：零误报', () => {
    for (const lead of [0x89, 0xff, 0x47, 0x42]) {
      const stream = concat(filler(8), new Uint8Array([lead]), filler(8))
      expect(extractImagesFromStream(stream).length, `lead=0x${lead.toString(16)}`).toBe(0)
    }
  })

  it('签名不完整时不产出（长度不足以让 find* 判定）', () => {
    // 注意：不能只砍掉 1 个字节——`findPngEnd` 不校验 CRC，少 1 字节的 PNG 仍会被
    // 判定为完整（这是改动前就有的行为，与本轮无关）。这里用明显不足的截断。
    const short = [
      PNG.subarray(0, 12),
      JPEG.subarray(0, 2),
      GIF.subarray(0, 5),
      BMP.subarray(0, 5),
    ]
    for (const s of short) {
      const stream = concat(filler(8), s, filler(8))
      expect(extractImagesFromStream(stream).length).toBe(0)
    }
  })
})
