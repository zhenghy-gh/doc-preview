import { logger } from './logger'
import type { BookmarkRange } from './docFormat'

/**
 * 解析 PlcfBkf（书签起始位置表）。
 *
 * MS-DOC §2.8.9 PlcfBkf:
 *   - aFC[]: CP 数组（n+1 个），标记每个书签的起始位置
 *   - aBKF[]: BKF 结构数组（n 个），每个 4 字节，其中前 2 字节是 ibkl（书签结束索引）
 *
 * @param data 表流数据
 * @param fc PlcfBkf 在表流中的偏移
 * @param lcb PlcfBkf 长度
 * @returns 书签起始 CP 数组，每个元素包含 cpStart 和对应的 bklIndex
 */
function parsePlcfBkf(
  data: Uint8Array,
  fc: number,
  lcb: number,
): Array<{ cpStart: number; bklIndex: number }> {
  if (fc === 0 || lcb === 0 || fc + lcb > data.length) return []

  // BKF 结构为 4 字节（Word 97+），所以 n = lcb / (4 + 4) - 1... 实际上：
  // PlcfBkf = aFC[(n+1) * 4] + aBKF[n * 4]
  // lcb = (n+1) * 4 + n * 4 = 8n + 4 → n = (lcb - 4) / 8
  const n = Math.floor((lcb - 4) / 8)
  if (n <= 0) return []

  const results: Array<{ cpStart: number; bklIndex: number }> = []
  let offset = fc
  const cpStarts: number[] = []
  for (let i = 0; i <= n; i++) {
    cpStarts.push(data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24))
    offset += 4
  }
  // BKF 结构：前 2 字节 = ibkl（到 PlcfBkl 的索引）
  for (let i = 0; i < n; i++) {
    const bklIndex = data[offset] | (data[offset + 1] << 8)
    results.push({ cpStart: cpStarts[i], bklIndex })
    offset += 4 // BKF 总共 4 字节，跳过剩余 2 字节
  }

  return results
}

/**
 * 解析 PlcfBkl（书签结束位置表）。
 *
 * MS-DOC §2.8.11 PlcfBkl:
 *   - aFC[]: CP 数组（n+1 个），标记每个书签的结束位置
 *   - aBKL[]: BKL 结构数组（n 个），每个 4 字节（保留）
 *
 * @param data 表流数据
 * @param fc PlcfBkl 在表流中的偏移
 * @param lcb PlcfBkl 长度
 * @returns 书签结束 CP 数组
 */
function parsePlcfBkl(
  data: Uint8Array,
  fc: number,
  lcb: number,
): number[] {
  if (fc === 0 || lcb === 0 || fc + lcb > data.length) return []

  const n = Math.floor((lcb - 4) / 8)
  if (n <= 0) return []

  const cpEnds: number[] = []
  let offset = fc
  for (let i = 0; i <= n; i++) {
    cpEnds.push(data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24))
    offset += 4
  }

  return cpEnds
}

/**
 * 解析 SttbfBkmk（书签名称字符串表）。
 *
 * STTB 结构（MS-DOC §2.8.15）:
 *   - fExtend (2 bytes): 0xFFFF 表示 UTF-16LE，否则单字节
 *   - cbSttb (2 bytes): 字符串数量
 *   - 每个 String: cch (2 bytes, 含终止符) + 字符数据
 *
 * @param data 表流数据
 * @param fc SttbfBkmk 在表流中的偏移
 * @param lcb SttbfBkmk 长度
 * @returns 书签名称数组
 */
function parseSttbfBkmk(
  data: Uint8Array,
  fc: number,
  lcb: number,
): string[] {
  if (fc === 0 || lcb === 0 || fc + lcb > data.length) return []

  let offset = fc
  const fExtend = data[offset] | (data[offset + 1] << 8)
  offset += 2
  const isUtf16 = fExtend === 0xFFFF

  const count = data[offset] | (data[offset + 1] << 8)
  offset += 2

  const names: string[] = []
  for (let i = 0; i < count && offset < fc + lcb; i++) {
    const cch = data[offset] | (data[offset + 1] << 8)
    offset += 2
    if (cch === 0) {
      names.push('')
      continue
    }
    // cch 包含终止符，实际字符数 = cch - 1
    const actualLen = Math.max(0, cch - 1)
    if (isUtf16) {
      let str = ''
      for (let j = 0; j < actualLen && offset + 1 < fc + lcb; j++) {
        const charCode = data[offset] | (data[offset + 1] << 8)
        str += String.fromCharCode(charCode)
        offset += 2
      }
      // 跳过终止符
      offset += 2
      names.push(str)
    } else {
      let str = ''
      for (let j = 0; j < actualLen && offset < fc + lcb; j++) {
        str += String.fromCharCode(data[offset])
        offset += 1
      }
      // 跳过终止符
      offset += 1
      names.push(str)
    }
  }

  return names
}

/**
 * 从表流中提取书签信息。
 *
 * 书签由三部分组成：
 * 1. PlcfBkf — 书签起始位置 + 对应的 Bkl 索引
 * 2. PlcfBkl — 书签结束位置
 * 3. SttbfBkmk — 书签名称字符串表
 *
 * 通过 Bkf 中的 bklIndex 关联到 PlcfBkl 中的结束位置，
 * 通过书签在 PlcfBkf 中的顺序索引关联到 SttbfBkmk 中的名称。
 *
 * @param tableData 表流数据
 * @param fcPlcfBkf PlcfBkf 偏移
 * @param lcbPlcfBkf PlcfBkf 长度
 * @param fcPlcfBkl PlcfBkl 偏移
 * @param lcbPlcfBkl PlcfBkl 长度
 * @param fcSttbfBkmk SttbfBkmk 偏移
 * @param lcbSttbfBkmk SttbfBkmk 长度
 * @returns 书签范围数组
 */
export function extractBookmarks(
  tableData: Uint8Array,
  fcPlcfBkf: number,
  lcbPlcfBkf: number,
  fcPlcfBkl: number,
  lcbPlcfBkl: number,
  fcSttbfBkmk: number,
  lcbSttbfBkmk: number,
): BookmarkRange[] {
  if (!tableData || tableData.length === 0) return []

  const bkfEntries = parsePlcfBkf(tableData, fcPlcfBkf, lcbPlcfBkf)
  const bklCpEnds = parsePlcfBkl(tableData, fcPlcfBkl, lcbPlcfBkl)
  const bookmarkNames = parseSttbfBkmk(tableData, fcSttbfBkmk, lcbSttbfBkmk)

  if (bkfEntries.length === 0) return []

  logger.log(
    `书签解析: bkf=${bkfEntries.length} bkl=${bklCpEnds.length} names=${bookmarkNames.length}`
  )

  const bookmarks: BookmarkRange[] = []
  for (let i = 0; i < bkfEntries.length; i++) {
    const bkf = bkfEntries[i]
    const name = bookmarkNames[i] || `书签${i}`
    const cpEnd = bklCpEnds[bkf.bklIndex] ?? bkf.cpStart

    // 跳过无效书签（起始 >= 结束，或名称为空）
    if (bkf.cpStart >= cpEnd && bkf.cpStart !== cpEnd) continue
    if (!name) continue

    bookmarks.push({
      name,
      cpStart: bkf.cpStart,
      cpEnd,
    })
  }

  return bookmarks
}
