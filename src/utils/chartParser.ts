import { logger } from './logger'
import { DirectoryEntry, StreamData } from './oleParser'
import { extractImagesFromStream, imagesToDataUrls } from './imageExtractor'
import { nextMagicOffset, type MagicScanIndex } from './docparser/magicScanIndex'

// 图表类型族（ChartType / ChartSubtype / ChartInfo）原先在本模块与 docFormat.ts
// 各定义一份，结构逐字相同。现以 docFormat.ts 为唯一来源，此处按原符号名再导出，
// 保持既有导入契约不变（docParser.ts 仍从本模块导入 ChartInfo）。
import type { ChartType, ChartSubtype, ChartInfo } from './docFormat'
export type { ChartType, ChartSubtype, ChartInfo }

const CHART_NAME_PATTERNS: Record<string, { type: ChartType; subtype: ChartSubtype }> = {
  'MSGraph.Chart': { type: 'msgraph', subtype: 'chart' },
  'MSGraph.Chart.8': { type: 'msgraph', subtype: 'chart' },
  'Excel.Sheet': { type: 'excel', subtype: 'chart' },
  'Excel.Sheet.8': { type: 'excel', subtype: 'chart' },
  'Excel.Sheet.12': { type: 'excel', subtype: 'chart' },
  'Excel.Chart': { type: 'excel', subtype: 'chart' },
  'Excel.Chart.8': { type: 'excel', subtype: 'chart' },
  'Excel.Chart.12': { type: 'excel', subtype: 'chart' },
  'SmartArt': { type: 'smartart', subtype: 'process' },
  'Microsoft.Office.SmartArt': { type: 'smartart', subtype: 'process' },
  'OrgChart': { type: 'smartart', subtype: 'orgchart' },
  'LibreOffice.Chart': { type: 'chart', subtype: 'chart' },
  'LibreOffice.ChartDocument': { type: 'chart', subtype: 'chart' },
}

const CHART_NAME_PATTERNS_KEYS = Object.keys(CHART_NAME_PATTERNS)

const OBJECT_NAME_PATTERN = /^Object\.\d+/
// LibreOffice embeds charts with numeric storage names like _2147483647
const LIBREOFFICE_STORAGE_PATTERN = /^_\d+$/

export function detectChartType(name: string): { type: ChartType; subtype: ChartSubtype } {
  return detectChartTypeInternal(name)
}

function detectChartTypeInternal(name: string, matchedPattern?: string): { type: ChartType; subtype: ChartSubtype } {
  const lowerName = name.toLowerCase()
  
  // LibreOffice embedded objects (storage names like _2147483647)
  if (LIBREOFFICE_STORAGE_PATTERN.test(name)) {
    return { type: 'chart', subtype: 'chart' }
  }
  
  if (lowerName.includes('libreoffice') && (lowerName.includes('chart') || lowerName.includes('graphic'))) {
    return { type: 'chart', subtype: 'chart' }
  }

  if (lowerName.includes('smartart')) {
    if (lowerName.includes('orgchart')) return { type: 'smartart', subtype: 'orgchart' }
    if (lowerName.includes('process')) return { type: 'smartart', subtype: 'process' }
    if (lowerName.includes('cycle')) return { type: 'smartart', subtype: 'cycle' }
    if (lowerName.includes('hierarchy')) return { type: 'smartart', subtype: 'hierarchy' }
    if (lowerName.includes('matrix')) return { type: 'smartart', subtype: 'matrix' }
    return { type: 'smartart', subtype: 'process' }
  }

  if (matchedPattern !== undefined) {
    return CHART_NAME_PATTERNS[matchedPattern]
  }
  for (const pattern of CHART_NAME_PATTERNS_KEYS) {
    if (name.includes(pattern)) {
      return CHART_NAME_PATTERNS[pattern]
    }
  }

  if (lowerName.includes('excel') || lowerName.includes('sheet')) {
    return { type: 'excel', subtype: 'chart' }
  }

  if (lowerName.includes('graph') || lowerName.includes('chart')) {
    return { type: 'msgraph', subtype: 'chart' }
  }

  if (OBJECT_NAME_PATTERN.test(name)) {
    return { type: 'oleobject', subtype: 'unknown' }
  }

  return { type: 'unknown', subtype: 'unknown' }
}

function extractChartPictureDataUrl(
  parentName: string,
  picEntry: DirectoryEntry | undefined,
  readStream?: (entry: DirectoryEntry) => StreamData | null
): string | undefined {
  if (!readStream || !picEntry || picEntry.size < 8) return undefined
  try {
    const stream = readStream(picEntry)
    if (!stream || !stream.data || stream.data.length < 8) return undefined
    const images = extractImagesFromStream(stream.data)
    if (images.length > 0) {
      const urls = imagesToDataUrls(images)
      return urls[0]
    }
    return undefined
  } catch (e) {
    logger.warn(`提取图表 ${parentName} 预览图失败: ${e}`)
    return undefined
  }
}

export function extractChartsFromDirectory(
  directory: DirectoryEntry[],
  readStream?: (entry: DirectoryEntry) => StreamData | null
): ChartInfo[] {
  const charts: ChartInfo[] = []

  const chartEntries: Array<{ entry: DirectoryEntry; matchedPattern?: string }> = []
  const streamEntries = new Map<string, DirectoryEntry>()

  for (const entry of directory) {
    if (entry.objectType === 2) {
      if (!streamEntries.has(entry.name)) streamEntries.set(entry.name, entry)
      continue
    }
    if (entry.objectType === 5) continue

    const name = entry.name.trim()
    const lowerName = name.toLowerCase()
    if (OBJECT_NAME_PATTERN.test(name) || LIBREOFFICE_STORAGE_PATTERN.test(name)) {
      chartEntries.push({ entry, matchedPattern: undefined })
      continue
    }
    let matchedPattern: string | undefined
    for (const pattern of CHART_NAME_PATTERNS_KEYS) {
      if (name.includes(pattern)) {
        matchedPattern = pattern
        break
      }
    }
    if (matchedPattern !== undefined || lowerName.includes('smartart') || lowerName.includes('chart') || lowerName.includes('graph')) {
      chartEntries.push({ entry, matchedPattern })
    }
  }

  for (const { entry, matchedPattern } of chartEntries) {
    try {
      const { type, subtype } = detectChartTypeInternal(entry.name, matchedPattern)
      const pictureEntry = streamEntries.get(`${entry.name}\x00Picture`)
      const dataEntry = streamEntries.get(`${entry.name}\x00Data`)
      const pictureDataUrl = extractChartPictureDataUrl(entry.name, pictureEntry, readStream)

      charts.push({
        id: charts.length + 1,
        name: entry.name,
        type: type,
        subtype: subtype,
        hasPicture: !!pictureEntry,
        hasData: !!dataEntry,
        dataSize: dataEntry?.size,
        pictureSize: pictureEntry ? entry.size : undefined,
        objectType: entry.objectType,
        dataUrl: pictureDataUrl,
      })
    } catch (e) {
      // Unreachable: detectChartType is pure and extractChartPictureDataUrl
      // already catches readStream failures internally. Defense-in-depth.
      /* v8 ignore start */
      logger.warn(`解析图表 ${entry.name} 失败: ${e}`)
    }
  }

  return charts
}
/* v8 ignore stop */

/**
 * 在 WordDocument 流里扫描内嵌的 OLE / Excel 对象（图表容器）。
 *
 * Round 107：原实现逐字节遍历整条流（真实语料 5.50 MB/轮），每个偏移都要读一次
 * `data[offset]` 再做两次比较。两个签名 `D0 CF 11 E0`（OLE）与 `50 4B 03 04`（ZIP）
 * 的**首字节互不相同**（0xD0 / 0x50），因此任何不是这两个字节之一的偏移都不可能命中。
 * 改为用 `Uint8Array.prototype.indexOf` 直接跳到下一个候选首字节：
 *
 * - 两个游标**只在被消费后**才刷新（`indexOf(byte, offset + 1)`），所以整趟仍是
 *   线性扫描；若每次重新取两者最小值就会退化成二次方（Round 100 的教训）。
 * - 「已耗尽」用 `data.length + 1` 而非 `-1` 表示，否则 `-1 < cursor` 恒真会让
 *   每次迭代都重扫到末尾。
 * - 命中并成功产出图表时，原实现把 `offset` 设为 `endOffset + 4`（for 的 `offset++`
 *   再前进一格，即下一个考察位置是 `endOffset + 5`），这里用 `from` 表达同一跳过语义，
 *   并在循环开头把落后的游标补齐到 `from`。
 *
 * 真实语料实测：0xD0 密度 0.115 %、0x50 密度 0.528 %（合计 0.64 %），
 * 即约 99.4 % 的偏移被 `indexOf` 原生搜索一次性跨过。
 */
/**
 * 从 `WordDocument` 流里找 OLE / ZIP 两种容器签名。
 *
 * Round 142：可选的 `magicIndex` 由调用方在同一次 parse 内为同一条流构建一次，
 * 供本函数与 shapes / equations / wordart 三个扫描器共用（原先四个扫描器合计
 * 要在这条流上跑 5 趟原生 `indexOf`）。`magicIndex` 省略或不属于 `data` 时
 * `nextMagicOffset` 自动退回原生 `indexOf`，逐字节等价旧实现。
 */
export function extractChartsFromWordDocumentStream(data: Uint8Array, magicIndex?: MagicScanIndex): ChartInfo[] {
  const charts: ChartInfo[] = []

  const limit = data.length - 100
  if (limit <= 0) return charts

  // 耗尽哨兵：必须大于任何合法偏移与 limit。
  const EXHAUSTED = data.length + 1
  let oleAt = nextMagicOffset(magicIndex, data, 0xD0, 0)
  if (oleAt < 0) oleAt = EXHAUSTED
  let zipAt = nextMagicOffset(magicIndex, data, 0x50, 0)
  if (zipAt < 0) zipAt = EXHAUSTED
  let from = 0

  for (;;) {
    // 产出图表后 from 会跳到 endOffset + 5，落后的游标需要补齐。
    if (oleAt < from) {
      oleAt = nextMagicOffset(magicIndex, data, 0xD0, from)
      if (oleAt < 0) oleAt = EXHAUSTED
    }
    if (zipAt < from) {
      zipAt = nextMagicOffset(magicIndex, data, 0x50, from)
      if (zipAt < 0) zipAt = EXHAUSTED
    }

    const offset = oleAt < zipAt ? oleAt : zipAt
    if (offset >= limit) break

    let type: 'oleobject' | 'excel' | undefined
    if (offset === oleAt && data[offset + 1] === 0xCF && data[offset + 2] === 0x11 && data[offset + 3] === 0xE0) {
      type = 'oleobject'
    } else if (offset === zipAt && data[offset + 1] === 0x4B && data[offset + 2] === 0x03 && data[offset + 3] === 0x04) {
      type = 'excel'
    }

    // 消费游标（两个首字节不同，故至多命中一个分支）。
    if (offset === oleAt) {
      oleAt = nextMagicOffset(magicIndex, data, 0xD0, offset + 1)
      if (oleAt < 0) oleAt = EXHAUSTED
    }
    if (offset === zipAt) {
      zipAt = nextMagicOffset(magicIndex, data, 0x50, offset + 1)
      if (zipAt < 0) zipAt = EXHAUSTED
    }

    if (!type) continue

    let endOffset = offset + 100
    while (endOffset < data.length && endOffset - offset < 10000) {
      if (data[endOffset] === 0 && data[endOffset + 1] === 0 &&
          data[endOffset + 2] === 0 && data[endOffset + 3] === 0) {
        break
      }
      endOffset++
    }

    const chartSize = endOffset - offset
    if (chartSize > 500) {
      charts.push({
        id: charts.length + 1,
        name: `Embedded ${type === 'excel' ? 'Excel' : 'OLE'} Object ${charts.length + 1}`,
        type,
        subtype: 'chart',
        hasData: true,
        dataSize: chartSize,
      })

      from = endOffset + 5
    }
  }

  return charts
}
