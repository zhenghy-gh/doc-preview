/**
 * 共享的小端序整数读取原语。
 *
 * 这些函数原先在 11 个解析器模块里各存一份（`readUint16` ×10、`readUint32` ×9、
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
