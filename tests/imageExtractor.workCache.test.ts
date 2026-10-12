/**
 * Round 139 常驻护栏：`ImageWorkCache` —— 同一次解析内的图片「魔数扫描 + base64 编码」去重。
 *
 * ── 被保护的控制流 ────────────────────────────────────────────────────
 * 1. `extractImagesFromStream(data, cache)`：按**视图对象身份**复用扫描结果；
 * 2. `bytesToBase64DataUrl(bytes, format, cache)` / `imagesToDataUrls(imgs, cache)`：
 *    按视图对象身份复用 data URL，命中时**校验 `format` 一致**；
 * 3. `extractPicturesFromDataStream(dataStream, cache)`：把 cache 透传给底层扫描；
 * 4. `DocParser.parseWithFormat()`：每次开始清空缓存（不跨解析驻留）。
 *
 * ── 为什么可证等价 ────────────────────────────────────────────────────
 * `cache` 省略时四条路径逐字节等价于旧实现（本文件用不带 cache 的旧路径作
 * 「慢但等价」oracle 逐字段比对）。传入 cache 时只复用**纯函数**的返回值：
 * `scanImagesFromStream` 只读遍历入参，`bytesToBase64DataUrl` 只读 `bytes`；
 * 两个消费方（`documentAssets.extractImages` / `extractPictures`）也都只读遍历
 * 结果数组与图片对象，从不改写。真实 27 份语料按「每次 parseWithFormat 为一个
 * epoch」实测：扫描 69 次 / 11.01 MB → 54 次 / 6.39 MB（省 4.61 MB = 41.9%），
 * base64 编码 69 次 / 3.07 MB → 66 次 / 1.57 MB（省 1.50 MB = 49.0%）。
 *
 * ── 鉴别力（负控：故意改错后本文件必须失败）────────────────────────────
 * - NC1 删掉 `bytesToBase64DataUrl` 命中分支里的 `hit.format === format` 校验
 *   → 「同一视图按两种格式编码」用例失败（会串用 png 的 URL 给 jpeg）；
 * - NC2 把 `scans` 的键从对象身份换成「字节长度」
 *   → 「等长但内容不同的两个视图」用例失败（b 会拿到 a 的扫描结果）；
 * - NC3 删掉 `parseWithFormat` 开头的 `this.imageWorkCache.scans.clear()`
 *   → 「同一实例重复解析缓存不跨解析累积」用例失败（size 会翻倍）。
 * - 另有「命中即返回同一数组引用」断言：绕过缓存（每次都真扫）即失败。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  extractImagesFromStream,
  bytesToBase64DataUrl,
  imagesToDataUrls,
  createImageWorkCache,
} from '../src/utils/imageExtractor'
import type { ImageWorkCache } from '../src/utils/imageExtractor'
import { extractPicturesFromDataStream } from '../src/utils/pictureParser'
import { DocParser } from '../src/utils/docParser'

// ── 最小合法图片（与 imageExtractor.dispatch.test.ts 同源，独立声明避免耦合）──
/** PNG：签名 + 一个 length=0 的 IEND chunk（4 长度 + 4 类型 + 4 CRC）。 */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00,
  0x49, 0x45, 0x4e, 0x44,
  0x00, 0x00, 0x00, 0x00,
])
/** JPEG：SOI + EOI（`findJpegEnd` 在 start+2 处即命中 FFD9）。 */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
/** GIF：GIF87a + 7 字节逻辑屏幕描述符（无全局色表）+ 0x3B 结束符。 */
const GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x37, 0x61,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x3b,
])
/** BMP：'BM' + 文件大小 54（LE32）+ 填充到 54 字节。 */
const BMP = (() => {
  const a = new Uint8Array(54)
  a[0] = 0x42; a[1] = 0x4d
  a[2] = 0x36; a[3] = 0x00; a[4] = 0x00; a[5] = 0x00
  return a
})()

/** 0x20（空格）不是任何签名首字节，用作间隔填充。 */
const FILL = 0x20

function filler(n: number): number[] {
  return new Array(n).fill(FILL)
}

/** 由 PNG / JPEG / BMP / GIF 各一张 + 间隔填充拼成的混合流。 */
function buildMixedStream(): Uint8Array {
  return new Uint8Array([
    ...filler(16), ...PNG,
    ...filler(16), ...JPEG,
    ...filler(16), ...BMP,
    ...filler(16), ...GIF,
    ...filler(16),
  ])
}

/** 与 PNG 等长但内容全为填充（无任何图片）的流 —— NC2 的对照。 */
function buildSameLengthNoImage(): Uint8Array {
  return new Uint8Array(PNG.length).fill(FILL)
}

/** 只读比对两张图片（不比较数组引用 —— 两条路径必然产生不同 subarray 对象）。 */
function expectSameImage(
  got: { format: string; data: Uint8Array },
  want: { format: string; data: Uint8Array },
): void {
  expect(got.format).toBe(want.format)
  expect(got.data.length).toBe(want.data.length)
  expect(Array.from(got.data)).toEqual(Array.from(want.data))
}

describe('Round 139 ImageWorkCache 护栏', () => {
  describe('extractImagesFromStream 按视图身份去重', () => {
    it('cache 命中结果与不带 cache 的旧路径（oracle）逐字段相同', () => {
      const stream = buildMixedStream()
      const oracle = extractImagesFromStream(stream)
      // oracle 必须真的扫到了 4 张图，否则本用例是空转
      expect(oracle.map(i => i.format)).toEqual(['png', 'jpeg', 'bmp', 'gif'])

      const cache = createImageWorkCache()
      const first = extractImagesFromStream(stream, cache)
      const second = extractImagesFromStream(stream, cache)

      expect(first.length).toBe(oracle.length)
      for (let i = 0; i < oracle.length; i++) expectSameImage(first[i], oracle[i])
      for (let i = 0; i < oracle.length; i++) expectSameImage(second[i], oracle[i])
      // 同一视图只入缓存一次
      expect(cache.scans.size).toBe(1)
    })

    it('命中时返回同一数组引用（绕过缓存即失败）', () => {
      const cache = createImageWorkCache()
      const stream = buildMixedStream()
      const first = extractImagesFromStream(stream, cache)
      // 引用相等 = 第二次没有重新扫描，直接复用纯函数返回值
      expect(extractImagesFromStream(stream, cache)).toBe(first)
    })

    it('按对象身份键控：等长但内容不同的视图各自扫描（NC2）', () => {
      const cache = createImageWorkCache()
      const withImage = PNG
      const withoutImage = buildSameLengthNoImage()
      // 前置条件：两者等长，若缓存按「长度」键控就会串用
      expect(withoutImage.length).toBe(withImage.length)

      expect(extractImagesFromStream(withImage, cache).map(i => i.format)).toEqual(['png'])
      expect(extractImagesFromStream(withoutImage, cache)).toEqual([])
      expect(cache.scans.size).toBe(2)
    })

    it('子视图是新对象、与原视图各占一个键（预算截断路径）', () => {
      const stream = buildMixedStream()
      const cache = createImageWorkCache()
      const tail = stream.length - 1
      const sub = stream.subarray(0, tail)

      extractImagesFromStream(stream, cache)
      const subGot = extractImagesFromStream(sub, cache)

      expect(cache.scans.size).toBe(2)
      // 子视图结果必须等于「不带 cache 直接扫子视图」的结果
      const subOracle = extractImagesFromStream(stream.subarray(0, tail))
      expect(subGot.length).toBe(subOracle.length)
      for (let i = 0; i < subOracle.length; i++) expectSameImage(subGot[i], subOracle[i])
    })

    it('空 / 过短输入直接返回 []，且不写入缓存', () => {
      const cache = createImageWorkCache()
      expect(extractImagesFromStream(new Uint8Array(0), cache)).toEqual([])
      expect(extractImagesFromStream(new Uint8Array(7), cache)).toEqual([])
      expect(cache.scans.size).toBe(0)
    })
  })

  describe('bytesToBase64DataUrl / imagesToDataUrls 按视图身份去重', () => {
    it('同一视图同一格式命中缓存，payload 与旧实现一致', () => {
      const cache = createImageWorkCache()
      const bytes = PNG
      const oracle = bytesToBase64DataUrl(bytes, 'png')
      const got = bytesToBase64DataUrl(bytes, 'png', cache)

      expect(got).toBe(oracle)
      expect(got.startsWith('data:image/png;base64,')).toBe(true)
      expect(cache.dataUrls.size).toBe(1)
      // 再取一次仍命中
      expect(bytesToBase64DataUrl(bytes, 'png', cache)).toBe(oracle)
      expect(cache.dataUrls.size).toBe(1)
    })

    it('同一视图换格式必须重新编码，不能串用（NC1）', () => {
      const cache = createImageWorkCache()
      const bytes = PNG
      const pngUrl = bytesToBase64DataUrl(bytes, 'png', cache)
      const jpegUrl = bytesToBase64DataUrl(bytes, 'jpeg', cache)

      expect(jpegUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
      expect(jpegUrl).not.toBe(pngUrl)
      // 只有 MIME 前缀不同，base64 payload 必须一致（同一份字节）
      const payload = (u: string) => u.slice(u.indexOf(',') + 1)
      expect(payload(jpegUrl)).toBe(payload(pngUrl))
      expect(cache.dataUrls.size).toBe(1)
    })

    it('imagesToDataUrls 逐项与不带 cache 的旧路径相同', () => {
      const images = extractImagesFromStream(buildMixedStream())
      const oracle = imagesToDataUrls(images)
      const cache = createImageWorkCache()
      const got = imagesToDataUrls(images, cache)

      expect(got).toEqual(oracle)
      expect(got.length).toBe(4)
      expect(cache.dataUrls.size).toBe(4)
      // 第二轮全部命中，结果不变
      expect(imagesToDataUrls(images, cache)).toEqual(oracle)
    })

    it('不同格式的同一批字节各占一个键（4 张图 → 4 项）', () => {
      const cache = createImageWorkCache()
      imagesToDataUrls(extractImagesFromStream(buildMixedStream()), cache)
      expect(cache.dataUrls.size).toBe(4)
    })
  })

  describe('extractPicturesFromDataStream 透传 cache 后行为不变', () => {
    it('带 / 不带 cache 逐字段相同', () => {
      const stream = buildMixedStream()
      const oracle = extractPicturesFromDataStream(stream)
      const cache = createImageWorkCache()
      const got = extractPicturesFromDataStream(stream, cache)

      expect(got.length).toBe(oracle.length)
      expect(got.length).toBeGreaterThan(0)
      for (let i = 0; i < oracle.length; i++) {
        expect(got[i].format).toBe(oracle[i].format)
        expect(got[i].type).toBe(oracle[i].type)
        expect(got[i].dataOffset).toBe(oracle[i].dataOffset)
        expect(got[i].widthPx).toBe(oracle[i].widthPx)
        expect(got[i].heightPx).toBe(oracle[i].heightPx)
        expect(Array.from(got[i].data)).toEqual(Array.from(oracle[i].data))
      }
      // 底层扫描只发生一次
      expect(cache.scans.size).toBe(1)
    })

    it('先 extractImagesFromStream 再 extractPicturesFromDataStream 共用同一次扫描', () => {
      const stream = buildMixedStream()
      const cache = createImageWorkCache()
      const images = extractImagesFromStream(stream, cache)
      const pics = extractPicturesFromDataStream(stream, cache)

      // 两次调用共用同一个 key → 没有第二次扫描
      expect(cache.scans.size).toBe(1)
      expect(pics.length).toBeGreaterThan(0)
      // 图片对象身份被复用（这正是 dataUrls 缓存能命中的前提）
      expect(pics.some(p => p.data === images[0].data)).toBe(true)
    })
  })

  describe('DocParser 每次解析重置缓存（真实文档）', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const docPath = resolve(here, '../docs/doc-101.doc')
    const hasDoc = existsSync(docPath)
    const manyImagesPath = resolve(here, '../docs/unicode-02006-zia.doc')
    const hasManyImagesDoc = existsSync(manyImagesPath)

    /** 只读访问私有缓存（NC3 需要观测 size 是否跨解析累积）。 */
    function cacheOf(parser: DocParser): ImageWorkCache {
      return (parser as unknown as { imageWorkCache: ImageWorkCache }).imageWorkCache
    }

    it.runIf(hasDoc)('同一实例重复解析结果一致，且缓存不跨解析累积（NC3）', () => {
      const data = readFileSync(docPath)
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      const parser = new DocParser(ab)

      const r1 = parser.parseWithFormat()
      const size1 = cacheOf(parser).scans.size

      const r2 = parser.parseWithFormat()
      const size2 = cacheOf(parser).scans.size

      expect(r1.success).toBe(true)
      expect(size1).toBeGreaterThan(0)
      // 清空后才重新填充：同一份文档 → 同样的条目数，而不是翻倍
      expect(size2).toBe(size1)

      // 两次解析的可观察产出逐字段相同（含 data URL 字符串）
      expect(r2.document?.images).toEqual(r1.document?.images)
      expect(r2.document?.pictures).toEqual(r1.document?.pictures)
      expect(r2.text).toBe(r1.text)
      expect(r2.document?.paragraphs.length).toBe(r1.document?.paragraphs.length)
    })

    it.runIf(hasManyImagesDoc)('多图真实文档的产出不被去重逻辑改变（49 张全保留）', () => {
      const data = readFileSync(manyImagesPath)
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      const r = new DocParser(ab).parseWithFormat()

      const images = r.document?.images ?? []
      // 该样本真实嵌入 49 张图（< MAX_IMAGES=50，未被上限截断）。
      // 若缓存把不同偏移的图片误判为同一张，数量会掉下来 → 本断言失败。
      expect(images.length).toBe(49)
      for (const url of images) expect(url.startsWith('data:image/')).toBe(true)
      // 去重是「格式:长度:前16字节」键控的，49 张图应互不相同
      expect(new Set(images).size).toBe(49)
    })

    it.runIf(hasDoc)('真实文档的 images / pictures 在两次解析间稳定', () => {
      const data = readFileSync(docPath)
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      const r1 = new DocParser(ab).parseWithFormat()
      const r2 = new DocParser(ab).parseWithFormat()

      const images = r1.document?.images ?? []
      expect(images.length).toBeGreaterThan(0)
      for (const url of images) expect(url.startsWith('data:image/')).toBe(true)
      // 两个独立实例（各自持有独立缓存）产出必须逐字段相同
      expect(r2.document?.images).toEqual(images)
      expect(r2.document?.pictures).toEqual(r1.document?.pictures)
    })
  })
})
