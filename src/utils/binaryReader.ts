/**
 * 共享的底层字节原语：小端序整数读取 + 字节转 base64。
 *
 * 四个读取函数原先在 11 个解析器模块里各存一份（`readUint16` ×10、`readUint32` ×9、
 * `readInt16` ×2、`readInt32` ×2，共 23 份定义），逐字节语义一致、只有注释与
 * 换行风格不同。统一到本模块后只保留一份实现，既消除重复，也避免各副本日后
 * 漂移出不一致的边界行为。
 *
 * 统一后的边界语义（所有调用方均以此为准）：
 *   - 越界（含负偏移）一律返回 0，绝不抛异常；
 *   - 调用方通常在调用前已用 `offset + n > data.length` 预检，越界分支不可达。
 *
 * 之所以能安全合并：唯一与"规范版"不同的两份实现是 `equationParser.ts`
 * （缺 `offset < 0` 检查）与 `propertyParser.ts`（完全无检查）。二者对**正偏移越界**
 * 的结果同样是 0（`Uint8Array` 越界读出 `undefined`，`undefined | x` 按位运算得 0），
 * 而所有调用点传入的偏移均 ≥ 0，故行为完全等价。
 *
 * `bytesToBase64` 是 Round 103 加进来的，理由同源：三处调用点各写了一份逐块
 * `String.fromCharCode.apply` + `btoa`，并且已经漂移（见该函数的注释）。
 */

/** 读取 1 个小端序 uint16。越界返回 0。 */
export function readUint16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.length) return 0
  return data[offset] | (data[offset + 1] << 8)
}

/** 读取 1 个小端序 uint32（结果按无符号解释）。越界返回 0。 */
export function readUint32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) return 0
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  )
}

/** 读取 1 个小端序 int16（带符号）。越界返回 0。 */
export function readInt16(data: Uint8Array, offset: number): number {
  const v = readUint16(data, offset)
  return v > 0x7fff ? v - 0x10000 : v
}

/** 读取 1 个小端序 int32（带符号）。越界返回 0。 */
export function readInt32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) return 0
  return (
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24)
  )
}

/**
 * 字节 → base64（**不含** `data:` 前缀）。
 *
 * 放在本模块的理由与上面四个原语相同：`imageExtractor.ts` / `pictureParser.ts` /
 * `headerFooterParser.ts` 各写了一份「逐块 `String.fromCharCode.apply` + `btoa`」的
 * 循环，而且已经漂移——`pictureParser` 那份多了一层 `Array.from`，比另外两份慢 4.8 倍。
 *
 * ── 分块为什么是 0x2000 ──────────────────────────────────────────────
 * 真实图片尺寸（2 KB / 20 KB / 100 KB / 500 KB / 2 MB，合计 2.6 MB）实测：
 * `0x1000` 5.97 ms、**`0x2000` 6.02 ms**、`0x4000` 8.17 ms、`0x8000` 7.71 ms。
 * 0x1000 与 0x2000 在噪声内，取 0x2000。`Function.prototype.apply` 的实参个数有上限，
 * 超过之后 V8 走慢路径——Round 102 在 `String.fromCharCode.apply` 上量到同一现象。
 * 一次 `parts.join('')` 与逐步 `binary +=` 实测无差异（6.02 vs 5.98 ms），故保留更简单的
 * 「短输入直接一次转换、长输入攒块再 join」。
 *
 * ── 为什么不用 `TextDecoder('latin1')` ──────────────────────────────
 * WHATWG 里 `latin1` 与 `iso-8859-1` **都是 `windows-1252` 的别名**，字节 0x80–0x9F 会
 * 解成 U+20AC 这类 > 0xFF 的码点，`btoa` 直接抛 `InvalidCharacterError`。
 * 规范里**没有**「真 Latin-1」解码器，所以这条捷径不存在。
 *
 * ── 为什么不能传 `Array.from(slice)` ────────────────────────────────
 * 36.67 ms vs 7.71 ms（**0.21x**）：每一块都多分配一个 JS 数字数组。
 * `apply` 接受类数组对象，`Uint8Array` 本身就够了。
 *
 * 浏览器与 Node 通用（不依赖 `Buffer`；Node 的 `Buffer.toString('base64')` 快 25 倍，
 * 但库要跑在浏览器里）。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x2000
  if (bytes.length <= CHUNK) {
    return btoa(String.fromCharCode.apply(null, bytes as unknown as number[]))
  }
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length)
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, end) as unknown as number[]))
  }
  return btoa(parts.join(''))
}
