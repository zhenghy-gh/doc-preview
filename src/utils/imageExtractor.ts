/**
 * Image extraction from a .doc file's `Data` stream (and, as a fallback, the
 * WordDocument stream).
 *
 * Word 97-2003 stores embedded pictures as binary blobs inside the `Data`
 * stream. Each picture is referenced from the document text via a special
 * character (0x01 / 0x08) and a CHP `fcPic` pointer into a PICF structure
 * in the Data stream. Parsing PICF/FCPic requires the CHP table, which this
 * project does not yet read.
 *
 * As a pragmatic fallback, this module scans the Data stream for well-known
 * image-format magic numbers (PNG / JPEG / BMP / GIF) and slices out each
 * image using the format's own length / boundary markers. This recovers
 * most embedded raster images without touching the CHP table.
 *
 * WMF / EMF are intentionally skipped: their magic numbers are weak
 * (`01 00 00 00` for EMF is extremely common) and would produce many false
 * positives. They can be added later once PICF parsing is in place.
 */

import { bytesToBase64 } from './binaryReader'

/** MIME type / format tag for an extracted image. */
export type ImageFormat = 'png' | 'jpeg' | 'bmp' | 'gif'

/** An extracted image: format tag + raw bytes. */
export interface ExtractedImage {
  format: ImageFormat
  /** Raw image bytes (without any container wrapping). */
  data: Uint8Array
}

// 图片魔数签名。原先 imageExtractor 与 pictureParser 各存一份（后者还用了
// GIF87/GIF89/BMP_SIG 等不同名字），现以此为唯一来源由两处共用。
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
export const JPEG_SOI = [0xff, 0xd8]
export const GIF_SIGNATURE_87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] // GIF87a
export const GIF_SIGNATURE_89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] // GIF89a
export const BMP_SIGNATURE = [0x42, 0x4d] // 'BM'

export function bytesEqual(data: Uint8Array, offset: number, signature: number[]): boolean {
  if (offset + signature.length > data.length) return false
  for (let i = 0; i < signature.length; i++) {
    if (data[offset + i] !== signature[i]) return false
  }
  return true
}

/**
 * Slice a PNG starting at `start`. PNG is a sequence of chunks, each:
 *   length (4 bytes BE) + type (4 bytes) + data + crc (4 bytes)
 * The image ends with an IEND chunk. We scan chunks until IEND is found.
 * Returns the end offset (exclusive), or -1 if the structure looks invalid.
 */
function findPngEnd(data: Uint8Array, start: number): number {
  // Skip the 8-byte signature.
  let offset = start + PNG_SIGNATURE.length
  // Defensive cap to avoid infinite loops on corrupt data.
  const maxChunks = 10000
  for (let i = 0; i < maxChunks; i++) {
    if (offset + 8 > data.length) return -1
    const length = (data[offset] << 24) | (data[offset + 1] << 16) |
                   (data[offset + 2] << 8) | data[offset + 3]
    const type = String.fromCharCode(data[offset + 4], data[offset + 5],
                                     data[offset + 6], data[offset + 7])
    // Length is a 32-bit BE unsigned; sanity-check it.
    if (length < 0 || length > data.length) return -1
    // Each chunk: 4 (length) + 4 (type) + length (data) + 4 (crc)
    const chunkEnd = offset + 12 + length
    if (chunkEnd > data.length) return -1
    if (type === 'IEND') return chunkEnd
    offset = chunkEnd
  }
  return -1
}

/**
 * Slice a JPEG starting at `start`. JPEG begins with FFD8 (SOI) and ends
 * with FFD9 (EOI). We scan for the EOI marker; this handles the common
 * case where the JPEG is stored as a single self-contained stream.
 *
 * Key detail: inside the entropy-coded segment (after SOS), 0xFF00 is an
 * *escaped* literal 0xFF byte — NOT a marker. We must skip 0xFF00 pairs
 * so they don't confuse the marker parser.
 *
 * Fallback: some embedded JPEGs (especially in .doc files) are truncated
 * and lack an EOI marker. If we reach the end of the buffer after the SOS
 * segment without finding EOI, we return the last plausible offset.
 */
function findJpegEnd(data: Uint8Array, start: number): number {
  let offset = start + JPEG_SOI.length
  let sosOffset = -1   // offset of SOS marker for fallback

  while (offset + 1 < data.length) {
    if (data[offset] === 0xFF) {
      // Skip filler 0xFF bytes.
      let marker = data[offset + 1]
      while (marker === 0xFF && offset + 2 < data.length) {
        offset++
        marker = data[offset + 1]
      }

      // 0xFF00 is a byte-stuffed 0xFF in scan data — skip it.
      if (marker === 0x00) {
        offset += 2
        continue
      }

      if (marker === 0xD9) {
        return offset + 2
      }

      // SOS marker: entropy-coded data follows.
      if (marker === 0xDA) {
        sosOffset = offset
        // SOS has a length field; skip it, then the scan data follows.
        if (offset + 3 >= data.length) break
        const segLen = (data[offset + 2] << 8) | data[offset + 3]
        if (segLen < 2) break
        offset += 2 + segLen
        // Now we're in the entropy-coded segment. We scan for the next
        // marker (0xFF followed by non-0x00 and non-0xFF).
        while (offset + 1 < data.length) {
          const markerOffset = data.indexOf(0xFF, offset)
          // 无可读的两字节标记时，旧逐字节循环停在末字节（或流尾）。
          if (markerOffset < 0 || markerOffset + 1 >= data.length) {
            offset = data.length - 1
            break
          }
          offset = markerOffset
          if (data[offset] === 0xFF) {
            let next = data[offset + 1]
            // Skip filler 0xFF
            while (next === 0xFF && offset + 2 < data.length) {
              offset++
              next = data[offset + 1]
            }
            // 0xFF00 = escaped 0xFF byte, not a marker
            if (next === 0x00) {
              offset += 2
              continue
            }
            // Found a real marker — break out to handle it
            break
          }
          offset++
        }
        // Loop will re-enter the marker handling on the next iteration
        continue
      }

      // Standalone markers (no length payload).
      if (marker === 0xD0 || marker === 0xD1 || marker === 0xD2 || marker === 0xD3 ||
          marker === 0xD4 || marker === 0xD5 || marker === 0xD6 || marker === 0xD7 ||
          marker === 0x01) {
        offset += 2
        continue
      }
      // Other markers carry a 2-byte length (including the length bytes).
      if (offset + 3 >= data.length) break
      const segLen = (data[offset + 2] << 8) | data[offset + 3]
      if (segLen < 2) break
      offset += 2 + segLen
    } else {
      offset++
    }
  }

  // Fallback: if we saw an SOS marker but no EOI, the JPEG is likely
  // truncated. Return the end of the data as a best-effort extraction.
  if (sosOffset >= 0) {
    return data.length
  }

  return -1
}

/**
 * Slice a BMP starting at `start`. The BMP file header stores the total
 * file size at offset +2..+5 (little-endian uint32). We trust it after a
 * sanity check.
 */
function findBmpEnd(data: Uint8Array, start: number): number {
  if (start + 6 > data.length) return -1
  const size = data[start + 2] | (data[start + 3] << 8) |
               (data[start + 4] << 16) | (data[start + 5] << 24)
  // Sanity: BMP files have a 14-byte file header + DIB header (≥40 bytes).
  if (size < 54 || size > data.length - start) return -1
  return start + size
}

/**
 * Slice a GIF starting at `start`. GIF logical screen descriptor stores
 * width/height at +6..+9 and a packed byte at +10. The actual end of the
 * stream is marked by a 0x3B trailer. We scan for the trailer, with a
 * defensive cap.
 */
function findGifEnd(data: Uint8Array, start: number): number {
  // GIF header is 6 bytes; logical screen descriptor is 7 bytes.
  let offset = start + 13
  // Skip the global color table if present.
  if (start + 10 < data.length) {
    const packed = data[start + 10]
    const hasGct = (packed & 0x80) !== 0
    if (hasGct) {
      const gctSize = 3 * (1 << ((packed & 0x07) + 1))
      offset += gctSize
    }
  }
  // Walk blocks until the trailer (0x3B).
  const maxIterations = 1000000
  for (let i = 0; i < maxIterations; i++) {
    if (offset >= data.length) return -1
    const block = data[offset]
    if (block === 0x3B) return offset + 1
    if (block === 0x21) {
      // Extension introducer: skip extension type + sub-blocks.
      offset += 2 // 0x21 + label
      while (offset < data.length) {
        const subLen = data[offset]
        offset++
        if (subLen === 0) break
        offset += subLen
      }
    } else if (block === 0x2C) {
      // Image descriptor: 10 bytes (0x2C + left/top/width/height/packed).
      offset += 10
      if (offset > data.length) return -1
      const packed = data[offset - 1]
      const hasLct = (packed & 0x80) !== 0
      if (hasLct) {
        const lctSize = 3 * (1 << ((packed & 0x07) + 1))
        offset += lctSize
      }
      // LZW minimum code size byte.
      offset++
      while (offset < data.length) {
        const subLen = data[offset]
        offset++
        if (subLen === 0) break
        offset += subLen
      }
    } else {
      // Unknown block — bail.
      return -1
    }
    // A well-formed GIF always reaches the 0x3B trailer long before this
    // cap. Unreachable in practice; kept as an anti-infinite-loop guard.
    /* v8 ignore start */
  }
  return -1
}
/* v8 ignore stop */

/**
 * Scan `data` for embedded images and return each as `{ format, data }`.
 *
 * The scan walks the buffer once, and at each position checks for one of
 * the supported magic signatures. When a match is found, the corresponding
 * end-finder is used to slice the image bytes; the scan then resumes from
 * the end offset (so overlapping images are not double-counted).
 *
 * Returns an empty array if no images are found.
 */
/**
 * 四个签名各自的**首字节**。四者互不相同（0x89 / 0xFF / 0x47 / 0x42），
 * 因此任一偏移至多只会命中其中一个签名。
 *
 * 用途见 `extractImagesFromStream`：原实现在每个字节上依次调用 4 次
 * `bytesEqual`（每次都是一次函数调用 + 长度检查 + 首字节比较），对 7.65 MB
 * 的真实样本合计约 3060 万次调用，而其中 98% 的字节根本不可能匹配任何签名。
 * 先按首字节分流后，绝大多数位置只需一次数组读取 + 一次跳转。
 */
const PNG_LEAD = PNG_SIGNATURE[0]
const JPEG_LEAD = JPEG_SOI[0]
const GIF_LEAD = GIF_SIGNATURE_87[0]
const BMP_LEAD = BMP_SIGNATURE[0]

/**
 * 256 项「首字节 → 分支号」查找表（Round 108）。0 表示不是任何签名的首字节。
 *
 * 原实现是 `switch (data[i]) { case 0x89: … case 0xFF: … case 0x47: … case 0x42: … }`，
 * 但四个 case 值在 `[0x42, 0xFF]` 上**极度稀疏**（66 / 71 / 137 / 255），V8 不会为它
 * 生成跳转表，而是退化成比较链 —— 7.14 MB 真实流实测：`switch` 与四个 case 标签
 * 合计吃掉 `extractImagesFromStream` 自耗时的 **66 %**。
 *
 * 换成「先查表拿稠密分支号（0 直接跳过），再按分支号分派」后，绝大多数字节只需
 * 一次数组读取 + 一次整数比较；实测整个扫描 **1.32x**。
 *
 * 顺带记一条被证伪的变体：在查表前再加一道 `data[i] < 0x42` 的范围守卫（真实流里
 * 59.66 % 的字节满足）**反而与旧实现打平**（375.6 vs 374.6 ms）—— 多出的那次比较
 * 正好抵消了省下的表读取。
 *
 * 等价性：表只把四个首字节映射到四个分支号，其余全为 0；四个首字节互不相同，
 * 因此任一偏移至多进入一个分支 —— 与 `switch` 逐位相同，且**无顺序依赖**。
 */
const LEAD_KIND = (() => {
  const t = new Uint8Array(256)
  t[PNG_LEAD] = 1
  t[JPEG_LEAD] = 2
  t[GIF_LEAD] = 3
  t[BMP_LEAD] = 4
  return t
})()

/**
 * 65536 项「字节对 → 该对内是否含签名的首字节」查找表（Round 109）。
 *
 * 索引是**高字节在前**拼出的 16 位值：`(data[i] << 8) | data[i + 1]`。值为 1 表示
 * 这两个字节里至少有一个是四个签名首字节之一，需要逐字节细看；为 0 表示两个都不是，
 * 于是可以直接 `i += 2` 整对跳过。
 *
 * ── 为什么值得 ────────────────────────────────────────────────────────
 * Round 108 已把「四个 `bytesEqual` 的线性尝试」换成 `LEAD_KIND` 首字节分流，
 * 但每字节仍需「一次数组读取 + 一次比较」。整对跳过把两字节的成本压到「两次字节读取
 * + 一次移位/或 + 一次表读取 + 一次比较」。真实流（72 条 / 7.49 MB）交错 9 轮取中位数：
 * 逐字节 **162.6 ms** → 整对跳过 **120.8 ms**，即 **1.346x**。
 *
 * ── 为什么不用 `Uint16Array` 视图（更快但要求对齐） ─────────────────────
 * 一次 `u16[i >> 1]` 读取代替两次字节读取，理论上更省。但 `data` 来自
 * `ole.readStream()` 的 `subarray`，`byteOffset` 奇偶取决于 OLE 扇区偏移，**没有保证**
 * （本次样本恰好 72/72 都是偶数，属于巧合）。加上 `(i & 1) === 0` 奇偶守卫后实测
 * **与不带视图的版本完全打平**（同为 118.7 ms）——守卫的比较正好抵消了少掉的那次读取。
 * 所以选没有对齐前提、也不需要 `try/catch` 回退的形态。
 *
 * ── 为什么索引用两次字节读取合成而不是 `Uint16Array` ───────────────────
 * 合成索引 `(hi << 8) | lo` 的语义与宿主字节序**无关**，因此表的内容是确定的；
 * 若改用 `Uint16Array` 视图，索引值会随平台字节序变化，表就得在启动时按
 * `new Uint8Array(new Uint16Array([0x0100]).buffer)[0]` 探测字节序后再填 —— 又多一份
 * 与端序耦合的代码，而收益已被奇偶守卫抵消。
 *
 * ── 等价性 ───────────────────────────────────────────────────────────
 * 只有「两个字节都**不是**首字节」时才会跳过；此时逐字节版本在这两个位置上
 * 都只会走 `kind === 0 → continue` 分支，不产生任何副作用。所以跳过的每一步都是
 * 逐字节版本的空转，扫到的位置集合与产出完全一致。表只映射「是否含首字节」，
 * 不含任何签名顺序依赖；且表对调换高低字节**对称**，所以索引的字节顺序也不影响结果。
 * 边界：末字节（`i + 1 === len`）没有配对，由循环后的单字节收尾处理，不会被漏掉。
 *
 * 另记一条**被证伪**的变体：把 `i + 1 < len` 守卫去掉，靠 `data[len]` 越界返回
 * `undefined`（按 `ToInt32` 参与位或得 0）来让末字节也能查表 —— 语义上确实等价，
 * 但实测 **只有 1.156x**（140.6 ms，比带守卫的 1.249x 还慢），越界读取并不便宜。
 */
const PAIR_HAS_LEAD = (() => {
  const t = new Uint8Array(65536)
  for (const lead of [PNG_LEAD, JPEG_LEAD, GIF_LEAD, BMP_LEAD]) {
    // 高字节 == lead 的全部字节对
    for (let lo = 0; lo < 256; lo++) t[(lead << 8) | lo] = 1
    // 低字节 == lead 的全部字节对
    for (let hi = 0; hi < 256; hi++) t[(hi << 8) | lead] = 1
  }
  return t
})()

/**
 * 若 `data[i]` 处命中某个签名，把图片推入 `images` 并返回其**结束偏移**（`> i`）；
 * 否则返回 `-1`（不产生任何副作用）。
 *
 * 四个首字节互不相同，所以某个位置至多进入一个分支 —— 与原先「依次 `bytesEqual`
 * 四次、命中即 continue」的判定顺序等价。
 */
function pushImageAt(
  data: Uint8Array,
  i: number,
  len: number,
  images: ExtractedImage[],
): number {
  const kind = LEAD_KIND[data[i]]
  if (kind === 0) return -1

  if (kind === 1) {
    if (bytesEqual(data, i, PNG_SIGNATURE)) {
      const end = findPngEnd(data, i)
      if (end > i) {
        images.push({ format: 'png', data: data.subarray(i, end) })
        return end
      }
    }
  } else if (kind === 2) {
    if (bytesEqual(data, i, JPEG_SOI) && i + 2 < len && data[i + 2] === 0xff) {
      const end = findJpegEnd(data, i)
      if (end > i) {
        images.push({ format: 'jpeg', data: data.subarray(i, end) })
        return end
      }
    }
  } else if (kind === 3) {
    if (bytesEqual(data, i, GIF_SIGNATURE_87) || bytesEqual(data, i, GIF_SIGNATURE_89)) {
      const end = findGifEnd(data, i)
      if (end > i) {
        images.push({ format: 'gif', data: data.subarray(i, end) })
        return end
      }
    }
  } else {
    if (bytesEqual(data, i, BMP_SIGNATURE)) {
      const end = findBmpEnd(data, i)
      if (end > i) {
        images.push({ format: 'bmp', data: data.subarray(i, end) })
        return end
      }
    }
  }

  return -1
}

export function extractImagesFromStream(data: Uint8Array): ExtractedImage[] {
  if (!data || data.length < 8) return []

  const images: ExtractedImage[] = []
  const len = data.length
  let i = 0

  // 主循环只处理「有配对」的位置（i ≤ len - 2）；末字节在循环后单独收尾。
  // 这样配对判定可以放进 while 条件里，每轮少一次比较 —— 真实流实测比
  // 「while (i < len) + 循环内再判 i + 1 < len」快约 7.8%（130.2 → 120.8 ms）。
  while (i + 1 < len) {
    // 整对跳过：两个字节都不是任何签名的首字节时，一次查表前进 2 字节。
    if (PAIR_HAS_LEAD[(data[i] << 8) | data[i + 1]] === 0) {
      i += 2
      continue
    }
    // 命中时把 i 置为 end（subarray 的右端点，即下一个待检查位置）；
    // 未命中则前进一个字节。
    const end = pushImageAt(data, i, len, images)
    i = end > i ? end : i + 1
  }

  // 末字节：无论是否命中都没有「下一个待检查位置」了，返回值不需要。
  if (i < len) pushImageAt(data, i, len, images)

  return images
}

/** MIME type for each supported format. */
export function imageFormatMime(format: ImageFormat): string {
  switch (format) {
    case 'png': return 'image/png'
    case 'jpeg': return 'image/jpeg'
    case 'bmp': return 'image/bmp'
    case 'gif': return 'image/gif'
  }
}

/** Convert extracted images to data URLs for inline rendering. */
/**
 * PERF-T2：共享快速 base64 dataUrl 编码。
 *
 * 逐块编码的实现已统一到 `binaryReader.bytesToBase64`（那里也记了分块为什么是
 * 0x2000、为什么不能用 `TextDecoder('latin1')`、为什么不能传 `Array.from`）。
 * 本函数只负责加 `data:` 前缀。
 */
export function bytesToBase64DataUrl(bytes: Uint8Array, format: ImageFormat): string {
  return `data:${imageFormatMime(format)};base64,${bytesToBase64(bytes)}`
}

export function imagesToDataUrls(images: ExtractedImage[]): string[] {
  return images.map(img => bytesToBase64DataUrl(img.data, img.format))
}
