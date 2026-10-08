import { logger } from './logger'
import { DirectoryEntry, StreamData } from './oleParser'
import { extractImagesFromStream, imagesToDataUrls } from './imageExtractor'

export type ChartType = 'msgraph' | 'excel' | 'smartart' | 'oleobject' | 'chart' | 'unknown'

export type ChartSubtype = 
  | 'column' | 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'doughnut'
  | 'radar' | 'surface' | 'bubble' | 'stock' | 'cone' | 'cylinder' | 'pyramid'
  | 'orgchart' | 'process' | 'cycle' | 'hierarchy' | 'matrix' | 'relationship' | 'list'
  | 'picture' | 'chart' | 'unknown'

export interface ChartInfo {
  id: number
  name: string
  type: ChartType
  subtype: ChartSubtype
  hasPicture?: boolean
  hasData?: boolean
  dataSize?: number
  pictureSize?: number
  objectType?: number
  format?: string
  /** Data URL of the chart preview image (from the OLE Picture stream), if available. */
  dataUrl?: string
}

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

export function extractChartsFromWordDocumentStream(data: Uint8Array): ChartInfo[] {
  const charts: ChartInfo[] = []

  for (let offset = 0; offset < data.length - 100; offset++) {
    const firstByte = data[offset]
    let type: 'oleobject' | 'excel' | undefined
    if (firstByte === 0xD0 && data[offset + 1] === 0xCF && data[offset + 2] === 0x11 && data[offset + 3] === 0xE0) {
      type = 'oleobject'
    } else if (firstByte === 0x50 && data[offset + 1] === 0x4B && data[offset + 2] === 0x03 && data[offset + 3] === 0x04) {
      type = 'excel'
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

      offset = endOffset + 4
    }
  }

  return charts
}
