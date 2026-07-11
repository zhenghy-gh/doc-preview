/**
 * DOP (Document Properties) 解析器
 *
 * 对应 MS-DOC 规范 §2.8.55 DOP 结构。
 * DOP 存储文档级别的属性，包括：
 * - 页眉页脚变体（首页不同、奇偶页不同）
 * - 修订标记状态（fRMW）
 * - 脚注/尾注设置
 * - 文档保护设置
 *
 * 本解析器仅提取与预览相关的关键字段，不解析完整 DOP 结构。
 *
 * DOP 位域布局（前 2 字节，参考 Apache POI HWPF 与 LibreOffice 实现）：
 *   byte 0 (bits 0-7):
 *     bit 0 (0x01): fFacingPages — 奇偶页不同（facing pages）
 *     bit 1 (0x02): fTitlePage  — 首页有独立标题/页眉页脚
 *     bit 2 (0x04): fPMHMain    — 主文档页眉存在
 *     bit 3 (0x08): reserved
 *     bit 4 (0x10): fFtnRestart — 脚注每页/每节重新编号
 *     bit 5 (0x20): fFtnEnd     — 脚注在节末
 *     bit 6 (0x40): fFtnAtEnd   — 脚注在文档末尾
 *     bit 7 (0x80): reserved
 *   byte 1 (bits 8-15):
 *     bit 8  (0x0100): fRMW        — 修订模式（记录修改）
 *     bit 9  (0x0200): fAutobackup
 *     bit 10 (0x0400): fBackup
 *     ...
 */

import { logger } from './logger'

/** DOP 解析结果，仅包含预览关心的关键字段。 */
export interface DopData {
  /** 奇偶页不同（fFacingPages）。 */
  facingPages: boolean
  /** 首页有独立标题/页眉页脚（fTitlePage）。 */
  titlePage: boolean
  /** 主文档有页眉（fPMHMain）。 */
  pmhMain: boolean
  /** 修订模式开启（fRMW）。 */
  trackChanges: boolean
  /** 脚注每页/每节重新编号（fFtnRestart）。 */
  ftnRestart: boolean
  /** 脚注在节末（fFtnEnd）。 */
  ftnEnd: boolean
  /** 脚注在文档末尾（fFtnAtEnd）。 */
  ftnAtEnd: boolean
}

/** 空 DOP 数据，用于回退。 */
export const EMPTY_DOP: DopData = {
  facingPages: false,
  titlePage: false,
  pmhMain: false,
  trackChanges: false,
  ftnRestart: false,
  ftnEnd: false,
  ftnAtEnd: false,
}

/**
 * 解析 DOP (Document Properties) 数据。
 *
 * @param data  DOP 字节数据（来自 0Table/1Table 流中 fcDop 偏移处）
 * @returns      解析结果；如果数据无效返回 null
 */
export function parseDop(data: Uint8Array): DopData | null {
  if (!data || data.length < 2) {
    logger.warn('DOP 数据太短，无法解析')
    return null
  }

  try {
    // DOP 前 2 字节是位域
    const byte0 = data[0]
    const byte1 = data[1]

    const result: DopData = {
      facingPages: (byte0 & 0x01) !== 0,
      titlePage: (byte0 & 0x02) !== 0,
      pmhMain: (byte0 & 0x04) !== 0,
      ftnRestart: (byte0 & 0x10) !== 0,
      ftnEnd: (byte0 & 0x20) !== 0,
      ftnAtEnd: (byte0 & 0x40) !== 0,
      // fRMW 在 byte 1 的 bit 0 (整体 bit 8)
      trackChanges: (byte1 & 0x01) !== 0,
    }

    logger.log(
      `DOP: facingPages=${result.facingPages} titlePage=${result.titlePage} ` +
      `pmhMain=${result.pmhMain} trackChanges=${result.trackChanges} ` +
      `ftnRestart=${result.ftnRestart} ftnEnd=${result.ftnEnd} ftnAtEnd=${result.ftnAtEnd}`
    )

    return result
  } catch (error) {
    logger.error(`DOP 解析错误: ${error}`)
    return null
  }
}
