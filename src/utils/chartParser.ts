import { logger } from './logger'
import { DirectoryEntry, StreamData } from './oleParser'

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
}

const CHART_NAME_PATTERNS: Record<string, { type: ChartType; subtype: ChartSubtype }> = {
  'MSGraph.Chart': { type: 'msgraph', subtype: 'chart' },
  'MSGraph.Chart.8': { type: 'msgraph', subtype: 'chart' },
  'Excel.Sheet': { type: 'excel', subtype: 'chart' },
  'Excel.Sheet.8': { type: 'excel', subtype: 'chart' },
  'Excel.Sheet.12': { type: 'excel', subtype: 'chart' },
  'Excel.Chart': { type: 'excel', subtype: 'chart' },
  'Excel.Chart.8': { type: 'excel', subtype: 'chart' },
  'SmartArt': { type: 'smartart', subtype: 'process' },
  'Microsoft.Office.SmartArt': { type: 'smartart', subtype: 'process' },
  'OrgChart': { type: 'smartart', subtype: 'orgchart' },
}

const OBJECT_NAME_PATTERN = /^Object\.\d+/

export function detectChartType(name: string): { type: ChartType; subtype: ChartSubtype } {
  const lowerName = name.toLowerCase()
  
  if (lowerName.includes('smartart')) {
    if (lowerName.includes('orgchart')) return { type: 'smartart', subtype: 'orgchart' }
    if (lowerName.includes('process')) return { type: 'smartart', subtype: 'process' }
    if (lowerName.includes('cycle')) return { type: 'smartart', subtype: 'cycle' }
    if (lowerName.includes('hierarchy')) return { type: 'smartart', subtype: 'hierarchy' }
    if (lowerName.includes('matrix')) return { type: 'smartart', subtype: 'matrix' }
    return { type: 'smartart', subtype: 'process' }
  }

  for (const [pattern, info] of Object.entries(CHART_NAME_PATTERNS)) {
    if (name.includes(pattern)) {
      return info
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

function hasPictureStream(directory: DirectoryEntry[], parentName: string): boolean {
  const pictureName = `${parentName}\x00Picture`
  return directory.some(e => e.name === pictureName && e.objectType === 2)
}

function getDataStream(directory: DirectoryEntry[], parentName: string): DirectoryEntry | undefined {
  const dataName = `${parentName}\x00Data`
  return directory.find(e => e.name === dataName && e.objectType === 2)
}

export function extractChartsFromDirectory(
  directory: DirectoryEntry[],
  _readStream?: (entry: DirectoryEntry) => StreamData | null
): ChartInfo[] {
  const charts: ChartInfo[] = []

  const chartEntries = directory.filter(e => {
    if (e.objectType !== 1) return false
    const name = e.name.trim()
    if (OBJECT_NAME_PATTERN.test(name)) return true
    for (const pattern of Object.keys(CHART_NAME_PATTERNS)) {
      if (name.includes(pattern)) return true
    }
    if (name.toLowerCase().includes('smartart')) return true
    if (name.toLowerCase().includes('chart') || name.toLowerCase().includes('graph')) return true
    return false
  })

  for (const entry of chartEntries) {
    try {
      const { type, subtype } = detectChartType(entry.name)
      const hasPic = hasPictureStream(directory, entry.name)
      const dataEntry = getDataStream(directory, entry.name)

      charts.push({
        id: charts.length + 1,
        name: entry.name,
        type: type,
        subtype: subtype,
        hasPicture: hasPic,
        hasData: !!dataEntry,
        dataSize: dataEntry?.size,
        pictureSize: hasPic ? entry.size : undefined,
        objectType: entry.objectType,
      })
    } catch (e) {
      logger.warn(`解析图表 ${entry.name} 失败: ${e}`)
    }
  }

  return charts
}

export function extractChartsFromWordDocumentStream(data: Uint8Array): ChartInfo[] {
  const charts: ChartInfo[] = []
  const chartMagicPatterns = [
    new Uint8Array([0xD0, 0xCF, 0x11, 0xE0]),
    new Uint8Array([0x50, 0x4B, 0x03, 0x04]),
  ]

  for (let offset = 0; offset < data.length - 100; offset++) {
    for (const magic of chartMagicPatterns) {
      let match = true
      for (let i = 0; i < magic.length; i++) {
        if (data[offset + i] !== magic[i]) {
          match = false
          break
        }
      }
      if (!match) continue

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
        const type = magic[0] === 0xD0 ? 'oleobject' : 'excel'
        
        charts.push({
          id: charts.length + 1,
          name: `Embedded ${type === 'excel' ? 'Excel' : 'OLE'} Object ${charts.length + 1}`,
          type: type as ChartType,
          subtype: 'chart',
          hasData: true,
          dataSize: chartSize,
        })

        offset = endOffset + 4
        break
      }
    }
  }

  return charts
}
