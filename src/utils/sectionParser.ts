import { logger } from './logger'
import type { SectionInfo, SectionBreakType } from './docFormat'

// ==================== Section SPRM 定义 ====================
// MS-DOC §2.4.10 Section SPRM 列表。
// 高字节 0xB0 系列 = word 操作数 (spra=5)，0x30 系列 = byte 操作数 (spra=1)，
// 0x50 系列 = word 操作数 (spra=2)。均与 formatParser.getSprmOperandSize 兼容。
const SPRM_S_DYA_HDR_TOP = 0xB000      // 距页眉顶部 (word, twips)
const SPRM_S_DYA_HDR_BOTTOM = 0xB001   // 距页脚底部 (word, twips)
const SPRM_S_XA_PAGE = 0xB002          // 页面宽度 (word, twips)
const SPRM_S_YA_PAGE = 0xB003          // 页面高度 (word, twips)
const SPRM_S_DXA_LEFT = 0xB004         // 左页边距 (word, twips)
const SPRM_S_DXA_RIGHT = 0xB005        // 右页边距 (word, twips)
const SPRM_S_DYA_TOP = 0xB006          // 上页边距 (word, twips)
const SPRM_S_DYA_BOTTOM = 0xB007       // 下页边距 (word, twips)
const SPRM_S_DXA_GUTTER = 0xB008       // 装订线宽度 (word, twips)
const SPRM_S_B_ORIENTATION = 0x3009    // 页面方向 (byte: 0=纵向, 1=横向)
const SPRM_S_BKC = 0x300A              // 节中断类型 (byte: 0=next, 1=even, 2=odd, 3=continuous)
const SPRM_S_NFC_PGN = 0x300B          // 页码格式 (word)
const SPRM_S_PGN_START = 0x300C        // 起始页码 (word)
const SPRM_S_CCOLUMNS = 0x500B         // 分栏数 (word)
const SPRM_S_DXA_COLUMNS = 0x500C      // 栏间距 (word, twips)
const SPRM_S_F_EVENLY = 0x300F         // 均分栏 (toggle)

/** twips → 磅：1 磅 = 20 twips */
function twipsToPt(twips: number): number {
  return twips / 20
}

/**
 * 读取 little-endian word (2 bytes，无符号)。
 */
function readWordAt(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8)) >>> 0
}

/**
 * 读取 little-endian dword (4 bytes，无符号)。
 */
function readDwordAt(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) |
          (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}

/**
 * 根据 SPRM 高字节确定操作数长度（与 formatParser.getSprmOperandSize 一致）。
 * 仅依赖 spra (bits 15-13)，不依赖 sgc，因为项目约定的 SPRM 值已编码正确长度。
 */
function getSectionSprmOperandSize(sprm: number, data: Uint8Array, operandOffset: number): number {
  const spra = (sprm >> 13) & 0x7
  switch (spra) {
    case 0: return 1  // Toggle
    case 1: return 1  // 1-byte
    case 2: return 2  // 2-byte
    case 3: return 4  // 4-byte
    case 4: return 2  // 2-byte signed
    case 5: return 2  // 2-byte unsigned
    case 7: return 3  // 3-byte
    case 6: {
      // Variable length: first byte is length of the rest
      if (operandOffset >= data.length) return 0
      return 1 + data[operandOffset]
    }
    default: return 0
  }
}

/**
 * SED（Section Descriptor）解析结果。
 *
 * 每个 SED 8 字节，包含：
 *   - fn (2 bytes): 标志位（高位指示 SEPX 所在流，但通常在 WordDocument 流）
 *   - fcSepx (4 bytes): SEPX 偏移；0xFFFFFFFF 表示无 SEPX（使用默认值）
 *   - fnMpr (2 bytes): 保留
 */
interface SedEntry {
  /** 节起始 CP（来自 PlcfSed 的 aFC[i]） */
  cpStart: number
  /** 节结束 CP（来自 PlcfSed 的 aFC[i+1]） */
  cpEnd: number
  /** SEPX 偏移；0xFFFFFFFF 表示无 SEPX */
  fcSepx: number
  /** fn 标志（原始值） */
  fn: number
}

/**
 * 解析 PlcfSed（Section Descriptor 位置表）。
 *
 * MS-DOC §2.8.34 PlcfSed:
 *   - aFC[]: CP 数组（n+1 个），标记每个节的起始位置
 *   - aSED[]: SED 结构数组（n 个），每个 8 字节
 *
 * 总长度 = (n+1) * 4 + n * 8 = 12n + 4 → n = (lcb - 4) / 12
 *
 * @param data 表流数据
 * @param fc PlcfSed 偏移
 * @param lcb PlcfSed 长度
 * @returns SED 条目数组（包含 CP 范围和 fcSepx）
 */
function parsePlcfSed(
  data: Uint8Array,
  fc: number,
  lcb: number,
): SedEntry[] {
  if (fc === 0 || lcb === 0 || fc + lcb > data.length) return []

  const n = Math.floor((lcb - 4) / 12)
  if (n <= 0) return []

  const entries: SedEntry[] = []
  let offset = fc

  // aFC: n+1 个 CP
  const cpStarts: number[] = []
  for (let i = 0; i <= n; i++) {
    cpStarts.push(readDwordAt(data, offset))
    offset += 4
  }

  // aSED: n 个 SED (每个 8 字节)
  for (let i = 0; i < n; i++) {
    const fn = readWordAt(data, offset)
    const fcSepx = readDwordAt(data, offset + 2)
    // fnMpr (2 bytes) 保留，跳过
    entries.push({
      cpStart: cpStarts[i],
      cpEnd: cpStarts[i + 1],
      fcSepx,
      fn,
    })
    offset += 8
  }

  return entries
}

/**
 * 解析 SEPX（Section Properties）grpprl，提取节属性。
 *
 * SEPX 结构:
 *   - cb (2 bytes): grpprl 的字节长度
 *   - grpprl: SPRM 数组
 *
 * SEPX 通常存储在 WordDocument 流（非 Table 流）。fcSepx 是 WordDocument 流中的偏移。
 *
 * @param wordDocData WordDocument 流数据
 * @param fcSepx SEPX 偏移（0xFFFFFFFF 表示无 SEPX）
 * @returns 部分填充的 SectionInfo（不含 cpStart/cpEnd/index）
 */
function parseSepx(
  wordDocData: Uint8Array,
  fcSepx: number,
): Partial<SectionInfo> {
  const result: Partial<SectionInfo> = {}

  // 0xFFFFFFFF 表示无 SEPX，使用默认值
  if (fcSepx === 0xFFFFFFFF || fcSepx === 0 || fcSepx + 2 > wordDocData.length) {
    return result
  }

  const cb = readWordAt(wordDocData, fcSepx)
  if (cb === 0 || fcSepx + 2 + cb > wordDocData.length) return result

  const grpprlStart = fcSepx + 2
  const grpprlEnd = grpprlStart + cb
  let offset = grpprlStart

  while (offset + 2 <= grpprlEnd) {
    const sprm = readWordAt(wordDocData, offset)
    offset += 2
    if (offset > grpprlEnd) break

    const operandSize = getSectionSprmOperandSize(sprm, wordDocData, offset)
    if (operandSize === 0 || offset + operandSize > grpprlEnd) break

    switch (sprm) {
      case SPRM_S_XA_PAGE:
        result.pageWidthPt = twipsToPt(readWordAt(wordDocData, offset))
        break
      case SPRM_S_YA_PAGE:
        result.pageHeightPt = twipsToPt(readWordAt(wordDocData, offset))
        break
      case SPRM_S_DXA_LEFT:
        result.marginLeftPt = twipsToPt(readWordAt(wordDocData, offset))
        break
      case SPRM_S_DXA_RIGHT:
        result.marginRightPt = twipsToPt(readWordAt(wordDocData, offset))
        break
      case SPRM_S_DYA_TOP:
        result.marginTopPt = twipsToPt(readWordAt(wordDocData, offset))
        break
      case SPRM_S_DYA_BOTTOM:
        result.marginBottomPt = twipsToPt(readWordAt(wordDocData, offset))
        break
      case SPRM_S_DXA_GUTTER:
        result.gutterPt = twipsToPt(readWordAt(wordDocData, offset))
        break
      case SPRM_S_B_ORIENTATION: {
        const val = wordDocData[offset]
        result.orientation = val === 1 ? 'landscape' : 'portrait'
        break
      }
      case SPRM_S_BKC: {
        const val = wordDocData[offset]
        // 0=nextPage, 1=evenPage, 2=oddPage, 3=continuous
        const breakMap: SectionBreakType[] = ['nextPage', 'evenPage', 'oddPage', 'continuous']
        result.breakType = breakMap[val] || 'nextPage'
        break
      }
      case SPRM_S_PGN_START:
        result.pageStart = readWordAt(wordDocData, offset)
        break
      case SPRM_S_CCOLUMNS:
        result.columnCount = readWordAt(wordDocData, offset)
        break
      case SPRM_S_DXA_COLUMNS:
        result.columnSpacingPt = twipsToPt(readWordAt(wordDocData, offset))
        break
      // 以下属性暂不提取，仅跳过
      case SPRM_S_DYA_HDR_TOP:
      case SPRM_S_DYA_HDR_BOTTOM:
      case SPRM_S_NFC_PGN:
      case SPRM_S_F_EVENLY:
      default:
        break
    }

    offset += operandSize
  }

  return result
}

/**
 * 从表流和 WordDocument 流中提取所有节的页面布局信息。
 *
 * 流程:
 * 1. 解析 PlcfSed 获取每个节的 CP 范围和 fcSepx 偏移
 * 2. 对每个节，通过 fcSepx 定位 SEPX 并解析 grpprl 恢复页面属性
 *
 * @param tableData 表流数据（0Table/1Table）
 * @param wordDocData WordDocument 流数据
 * @param fcPlcfSed PlcfSed 在表流中的偏移
 * @param lcbPlcfSed PlcfSed 长度
 * @returns 节信息数组（按文档顺序）
 */
export function extractSections(
  tableData: Uint8Array,
  wordDocData: Uint8Array,
  fcPlcfSed: number,
  lcbPlcfSed: number,
): SectionInfo[] {
  if (!tableData || tableData.length === 0) return []
  if (!wordDocData || wordDocData.length === 0) return []
  if (fcPlcfSed === 0 || lcbPlcfSed === 0) return []

  const sedEntries = parsePlcfSed(tableData, fcPlcfSed, lcbPlcfSed)
  if (sedEntries.length === 0) return []

  logger.log(`分节解析: PlcfSed 解析到 ${sedEntries.length} 个节`)

  const sections: SectionInfo[] = []
  for (let i = 0; i < sedEntries.length; i++) {
    const sed = sedEntries[i]
    const sectionProps = parseSepx(wordDocData, sed.fcSepx)
    sections.push({
      cpStart: sed.cpStart,
      cpEnd: sed.cpEnd,
      index: i,
      ...sectionProps,
    })
  }

  logger.info(`解析到 ${sections.length} 个节`)
  return sections
}
