/**
 * 页眉页脚位置表（PlcfHdd）解析器
 *
 * 对应 MS-DOC 规范 §2.4.4 PlcfHdd 结构。
 *
 * PlcfHdd 是一个位置表（Plcf），定义了 ccpHdd story 流中各页眉页脚
 * 子范围的 CP（character position）边界。子范围的顺序固定：
 *   1. 首页页眉 (titleHeader)   — 仅当 fTitlePage=1 时存在
 *   2. 首页页脚 (titleFooter)   — 仅当 fTitlePage=1 时存在
 *   3. 奇数页页眉 (oddHeader)   — 总是存在
 *   4. 奇数页页脚 (oddFooter)   — 总是存在
 *   5. 偶数页页眉 (evenHeader)  — 仅当 fFacingPages=1 时存在
 *   6. 偶数页页脚 (evenFooter)  — 仅当 fFacingPages=1 时存在
 *
 * 每节最多 6 个子范围，PlcfHdd 包含 (6*nSections + 1) 个 CP 和
 * (6*nSections) 个 SED 结构。本解析器仅提取第一节的子范围边界，
 * 用于将 headers story 文本拆分为独立的页眉页脚部分。
 *
 * PlcfHdd 二进制布局：
 *   aCp[0..n]      — (n+1) 个 CP，每个 4 字节（小端序）
 *   aSed[0..n-1]   — n 个 SED，每个 8 字节（本解析器不使用 SED）
 *
 * 其中 n = (lcbPlcfHdd - 4) / 12  (每个子范围: 4 字节 CP + 8 字节 SED)
 */

import { logger } from './logger'
import type { HeaderFooterPartType, HeaderFooterPartContent, HeaderFooterImage } from './docFormat'
import type { ParsedPicture } from './pictureParser'

/** 页眉页脚子范围定义 */
export interface HeaderFooterPart {
  /** 子范围类型 */
  type: HeaderFooterPartType
  /** 在 ccpHdd story 中的起始 CP（相对偏移） */
  startCp: number
  /** 在 ccpHdd story 中的结束 CP（exclusive） */
  endCp: number
}

/**
 * 将 ParsedPicture 转换为 HeaderFooterImage 格式。
 */
function pictureToHeaderFooterImage(pic: ParsedPicture): HeaderFooterImage | null {
  if (pic.format === 'unknown') return null
  
  let binary = ''
  const bytes = pic.data
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    binary += String.fromCharCode.apply(
      null,
      Array.from(slice) as unknown as number[],
    )
  }
  
  const mime =
    pic.format === 'png'
      ? 'image/png'
      : pic.format === 'jpeg'
        ? 'image/jpeg'
        : pic.format === 'gif'
          ? 'image/gif'
          : pic.format === 'bmp'
            ? 'image/bmp'
            : 'application/octet-stream'
  
  return {
    format: pic.format,
    dataUrl: `data:${mime};base64,${btoa(binary)}`,
    widthPx: pic.widthPx,
    heightPx: pic.heightPx,
    floating: pic.floating,
  }
}

/** 页眉页脚拆分结果 */
export interface HeaderFooterSplit {
  /** 所有子范围定义（仅包含有效的非空范围） */
  parts: HeaderFooterPart[]
}

/** 子范围类型的中文标签 */
const PART_LABELS: Record<HeaderFooterPartType, string> = {
  titleHeader: '首页页眉',
  titleFooter: '首页页脚',
  oddHeader: '奇数页页眉',
  oddFooter: '奇数页页脚',
  evenHeader: '偶数页页眉',
  evenFooter: '偶数页页脚',
}

/**
 * 获取页眉页脚子范围类型的中文标签。
 */
export function getPartLabel(type: HeaderFooterPartType): string {
  return PART_LABELS[type] || '未知'
}

/**
 * 根据 DOP 标志位确定有效的子范围类型列表。
 *
 * @param titlePage    — fTitlePage 标志（首页不同）
 * @param facingPages  — fFacingPages 标志（奇偶页不同）
 * @returns 有效子范围类型列表（按 PlcfHdd 固定顺序）
 */
export function getActivePartTypes(
  titlePage: boolean,
  facingPages: boolean
): HeaderFooterPartType[] {
  const types: HeaderFooterPartType[] = []
  if (titlePage) {
    types.push('titleHeader')
    types.push('titleFooter')
  }
  // 奇数页页眉/页脚总是存在
  types.push('oddHeader')
  types.push('oddFooter')
  if (facingPages) {
    types.push('evenHeader')
    types.push('evenFooter')
  }
  return types
}

/**
 * 解析 PlcfHdd 数据，提取第一节的页眉页脚子范围边界。
 *
 * @param data          — PlcfHdd 字节数据（来自 table 流 fcPlcfHdd 偏移处）
 * @param titlePage     — fTitlePage 标志
 * @param facingPages   — fFacingPages 标志
 * @returns             — 页眉页脚拆分结果；如果数据无效返回 null
 */
export function parsePlcfHdd(
  data: Uint8Array,
  titlePage: boolean,
  facingPages: boolean
): HeaderFooterSplit | null {
  if (!data || data.length < 8) {
    logger.warn('PlcfHdd 数据太短，无法解析')
    return null
  }

  try {
    // 计算子范围数量：n = (lcbPlcfHdd - 4) / 12
    // 每个子范围: 4 字节 CP + 8 字节 SED，外加末尾 1 个额外 CP
    const n = Math.floor((data.length - 4) / 12)
    if (n <= 0) {
      logger.warn(`PlcfHdd 子范围数量无效 (n=${n})`)
      return null
    }

    // 读取所有 CP 值（n+1 个，每个 4 字节小端序）
    const cps: number[] = []
    for (let i = 0; i <= n && i * 4 + 3 < data.length; i++) {
      const cp =
        (data[i * 4] |
          (data[i * 4 + 1] << 8) |
          (data[i * 4 + 2] << 16) |
          (data[i * 4 + 3] << 24)) >>>
        0
      cps.push(cp)
    }

    if (cps.length < 2) {
      logger.warn('PlcfHdd CP 数量不足')
      return null
    }

    // 获取第一节的有效子范围类型
    const activeTypes = getActivePartTypes(titlePage, facingPages)
    const partsPerSection = activeTypes.length

    if (partsPerSection === 0) {
      return { parts: [] }
    }

    // 提取第一节的子范围（前 partsPerSection 个）
    const parts: HeaderFooterPart[] = []
    for (let i = 0; i < partsPerSection && i < cps.length - 1; i++) {
      const startCp = cps[i]
      const endCp = cps[i + 1]

      // 跳过空范围（startCp >= endCp 表示该子范围不存在/为空）
      if (startCp >= endCp) {
        continue
      }

      parts.push({
        type: activeTypes[i],
        startCp,
        endCp,
      })
    }

    logger.log(
      `PlcfHdd: n=${n} cps=${cps.length} activeTypes=${activeTypes.length} ` +
      `parts=${parts.length} (titlePage=${titlePage} facingPages=${facingPages})`
    )

    return { parts }
  } catch (error) {
    logger.error(`PlcfHdd 解析错误: ${error}`)
    return null
  }
}

/**
 * 将 headers story 文本按 PlcfHdd 子范围拆分。
 *
 * @param headersText  — ccpHdd story 的完整文本
 * @param split        — PlcfHdd 解析结果
 * @returns            — 各子范围类型到文本的映射；如果拆分失败返回 null
 */
export function splitHeaderText(
  headersText: string,
  split: HeaderFooterSplit
): Partial<Record<HeaderFooterPartType, string>> | null {
  if (!headersText || headersText.length === 0) {
    return null
  }

  if (!split || split.parts.length === 0) {
    return null
  }

  try {
    const result: Partial<Record<HeaderFooterPartType, string>> = {}

    for (const part of split.parts) {
      // CP 是字符位置，直接作为字符串索引使用
      const start = Math.max(0, Math.min(part.startCp, headersText.length))
      const end = Math.max(start, Math.min(part.endCp, headersText.length))

      if (end > start) {
        const text = headersText.substring(start, end).trim()
        if (text) {
          result[part.type] = text
        }
      }
    }

    return Object.keys(result).length > 0 ? result : null
  } catch (error) {
    logger.error(`页眉页脚文本拆分错误: ${error}`)
    return null
  }
}

/**
 * 将 headers story 文本和图片按 PlcfHdd 子范围拆分，返回包含图片的结果。
 *
 * @param headersText     — ccpHdd story 的完整文本
 * @param split           — PlcfHdd 解析结果
 * @param headerPictures  — 页眉页脚区域中的图片列表（按 cp 位置关联）
 * @returns               — 各子范围类型到内容的映射；如果拆分失败返回 null
 */
export function splitHeaderTextWithImages(
  headersText: string,
  split: HeaderFooterSplit,
  headerPictures: ParsedPicture[] = []
): Partial<Record<HeaderFooterPartType, HeaderFooterPartContent>> | null {
  if (!headersText || headersText.length === 0) {
    return null
  }

  if (!split || split.parts.length === 0) {
    return null
  }

  try {
    const result: Partial<Record<HeaderFooterPartType, HeaderFooterPartContent>> = {}

    for (const part of split.parts) {
      const start = Math.max(0, Math.min(part.startCp, headersText.length))
      const end = Math.max(start, Math.min(part.endCp, headersText.length))

      if (end <= start) {
        continue
      }

      const text = headersText.substring(start, end).trim()
      const images: HeaderFooterImage[] = []

      for (const pic of headerPictures) {
        if (pic.dataOffset !== undefined) {
          const imageCp = pic.dataOffset
          if (imageCp >= start && imageCp < end) {
            const img = pictureToHeaderFooterImage(pic)
            if (img) {
              images.push(img)
            }
          }
        }
      }

      if (text || images.length > 0) {
        result[part.type] = {
          text,
          images: images.length > 0 ? images : undefined,
        }
      }
    }

    return Object.keys(result).length > 0 ? result : null
  } catch (error) {
    logger.error(`页眉页脚文本和图片拆分错误: ${error}`)
    return null
  }
}

/**
 * 启发式拆分：当 PlcfHdd 不可用时，按段落标记（0x0D → \n）拆分 headers story。
 *
 * 根据 DOP 标志位推断子范围数量，将拆分后的段落按顺序分配给各子范围类型。
 * 这是一种不精确的回退方案，仅用于无法读取 PlcfHdd 的情况。
 *
 * @param headersText  — ccpHdd story 的完整文本
 * @param titlePage    — fTitlePage 标志
 * @param facingPages  — fFacingPages 标志
 * @returns            — 各子范围类型到文本的映射；如果无法拆分返回 null
 */
export function splitHeaderTextHeuristic(
  headersText: string,
  titlePage: boolean,
  facingPages: boolean
): Partial<Record<HeaderFooterPartType, string>> | null {
  if (!headersText || headersText.trim().length === 0) {
    return null
  }

  try {
    const activeTypes = getActivePartTypes(titlePage, facingPages)
    // 按段落标记拆分（0x0D 在文本中表现为 \n 或 \r）
    const paragraphs = headersText
      .split(/[\r\n]+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)

    if (paragraphs.length === 0) {
      return null
    }

    const result: Partial<Record<HeaderFooterPartType, string>> = {}

    // 将段落按顺序分配给各子范围类型
    // 如果段落数 > 子范围数，多余的段落附加到最后一个子范围
    for (let i = 0; i < activeTypes.length && i < paragraphs.length; i++) {
      result[activeTypes[i]] = paragraphs[i]
    }

    // 如果段落数多于子范围数，将剩余段落附加到奇数页页眉（通常是主要内容）
    if (paragraphs.length > activeTypes.length) {
      const oddHeaderIdx = activeTypes.indexOf('oddHeader')
      if (oddHeaderIdx >= 0) {
        const existing = result[activeTypes[oddHeaderIdx]] || ''
        const extra = paragraphs.slice(activeTypes.length).join('\n')
        result[activeTypes[oddHeaderIdx]] = existing + '\n' + extra
      }
    }

    logger.log(
      `页眉页脚启发式拆分: paragraphs=${paragraphs.length} ` +
      `activeTypes=${activeTypes.length} result=${Object.keys(result).length}`
    )

    return Object.keys(result).length > 0 ? result : null
  } catch (error) {
    logger.error(`页眉页脚启发式拆分错误: ${error}`)
    return null
  }
}
