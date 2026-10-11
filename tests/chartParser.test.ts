import { describe, it, expect } from 'vitest'
import { extractChartsFromDirectory, extractChartsFromWordDocumentStream, detectChartType } from '../src/utils/chartParser'
import type { DirectoryEntry } from '../src/utils/oleParser'

describe('chartParser', () => {
  describe('detectChartType', () => {
    it('should detect MSGraph.Chart', () => {
      expect(detectChartType('MSGraph.Chart')).toEqual({ type: 'msgraph', subtype: 'chart' })
      expect(detectChartType('MSGraph.Chart.8')).toEqual({ type: 'msgraph', subtype: 'chart' })
    })

    it('should detect Excel.Sheet', () => {
      expect(detectChartType('Excel.Sheet')).toEqual({ type: 'excel', subtype: 'chart' })
      expect(detectChartType('Excel.Sheet.8')).toEqual({ type: 'excel', subtype: 'chart' })
      expect(detectChartType('Excel.Sheet.12')).toEqual({ type: 'excel', subtype: 'chart' })
    })

    it('should detect Excel.Chart', () => {
      expect(detectChartType('Excel.Chart')).toEqual({ type: 'excel', subtype: 'chart' })
      expect(detectChartType('Excel.Chart.8')).toEqual({ type: 'excel', subtype: 'chart' })
      expect(detectChartType('Excel.Chart.12')).toEqual({ type: 'excel', subtype: 'chart' })
    })

    it('should detect SmartArt', () => {
      expect(detectChartType('SmartArt')).toEqual({ type: 'smartart', subtype: 'process' })
      expect(detectChartType('Microsoft.Office.SmartArt')).toEqual({ type: 'smartart', subtype: 'process' })
    })

    it('should detect OrgChart', () => {
      expect(detectChartType('OrgChart')).toEqual({ type: 'smartart', subtype: 'orgchart' })
    })

    it('should detect Object.N patterns', () => {
      expect(detectChartType('Object.1')).toEqual({ type: 'oleobject', subtype: 'unknown' })
      expect(detectChartType('Object.123')).toEqual({ type: 'oleobject', subtype: 'unknown' })
    })

    it('should detect chart/graph keywords', () => {
      expect(detectChartType('MyChart')).toEqual({ type: 'msgraph', subtype: 'chart' })
      expect(detectChartType('MyGraph')).toEqual({ type: 'msgraph', subtype: 'chart' })
    })

    it('should detect smartart subtypes', () => {
      expect(detectChartType('SmartArt_OrgChart')).toEqual({ type: 'smartart', subtype: 'orgchart' })
      expect(detectChartType('SmartArt_Process')).toEqual({ type: 'smartart', subtype: 'process' })
      expect(detectChartType('SmartArt_Cycle')).toEqual({ type: 'smartart', subtype: 'cycle' })
      expect(detectChartType('SmartArt_Hierarchy')).toEqual({ type: 'smartart', subtype: 'hierarchy' })
      expect(detectChartType('SmartArt_Matrix')).toEqual({ type: 'smartart', subtype: 'matrix' })
    })

    it('should return unknown for unrecognized names', () => {
      expect(detectChartType('Unknown')).toEqual({ type: 'unknown', subtype: 'unknown' })
      expect(detectChartType('SomeText')).toEqual({ type: 'unknown', subtype: 'unknown' })
    })
  })

  describe('extractChartsFromDirectory', () => {
    it('should extract MSGraph charts', () => {
      const directory: DirectoryEntry[] = [
        {
          name: 'MSGraph.Chart.8',
          objectType: 1,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 1,
          size: 1000,
        },
      ]

      const charts = extractChartsFromDirectory(directory, () => null)
      expect(charts.length).toBe(1)
      expect(charts[0].name).toBe('MSGraph.Chart.8')
      expect(charts[0].type).toBe('msgraph')
      expect(charts[0].subtype).toBe('chart')
    })

    it('should extract Excel charts', () => {
      const directory: DirectoryEntry[] = [
        {
          name: 'Excel.Sheet.8',
          objectType: 1,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 1,
          size: 2000,
        },
      ]

      const charts = extractChartsFromDirectory(directory, () => null)
      expect(charts.length).toBe(1)
      expect(charts[0].name).toBe('Excel.Sheet.8')
      expect(charts[0].type).toBe('excel')
    })

    it('should extract Object.N OLE objects', () => {
      const directory: DirectoryEntry[] = [
        {
          name: 'Object.1',
          objectType: 1,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 1,
          size: 500,
        },
      ]

      const charts = extractChartsFromDirectory(directory, () => null)
      expect(charts.length).toBe(1)
      expect(charts[0].type).toBe('oleobject')
    })

    it('should skip non-chart entries', () => {
      const directory: DirectoryEntry[] = [
        {
          name: 'WordDocument',
          objectType: 2,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 0,
          size: 10000,
        },
        {
          name: 'SummaryInformation',
          objectType: 2,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 2,
          size: 512,
        },
      ]

      const charts = extractChartsFromDirectory(directory, () => null)
      expect(charts.length).toBe(0)
    })

    it('should handle empty directory', () => {
      const charts = extractChartsFromDirectory([], () => null)
      expect(charts.length).toBe(0)
    })

    it('should detect Picture stream', () => {
      const directory: DirectoryEntry[] = [
        {
          name: 'MSGraph.Chart.8',
          objectType: 1,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 1,
          size: 1000,
        },
        {
          name: 'MSGraph.Chart.8\x00Picture',
          objectType: 2,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 2,
          size: 500,
        },
      ]

      const charts = extractChartsFromDirectory(directory, () => null)
      expect(charts.length).toBe(1)
      expect(charts[0].hasPicture).toBe(true)
    })

    it('should preserve the first matching stream when names are duplicated', () => {
      const directory = [
        { name: 'Excel.Sheet.8', objectType: 1, startSector: 0, size: 10, nameLength: 13 },
        { name: 'Excel.Sheet.8\x00Data', objectType: 2, startSector: 1, size: 100, nameLength: 18 },
        { name: 'Excel.Sheet.8\x00Data', objectType: 2, startSector: 2, size: 200, nameLength: 18 },
      ]
      const charts = extractChartsFromDirectory(directory as any)
      expect(charts[0].dataSize).toBe(100)
    })

    it('should detect Data stream', () => {
      const directory: DirectoryEntry[] = [
        {
          name: 'Excel.Sheet.8',
          objectType: 1,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 1,
          size: 2000,
        },
        {
          name: 'Excel.Sheet.8\x00Data',
          objectType: 2,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 3,
          size: 1500,
        },
      ]

      const charts = extractChartsFromDirectory(directory, () => null)
      expect(charts.length).toBe(1)
      expect(charts[0].hasData).toBe(true)
      expect(charts[0].dataSize).toBe(1500)
    })
  })

  describe('extractChartsFromWordDocumentStream', () => {
    it('should detect OLE object magic patterns', () => {
      const data = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
      const charts = extractChartsFromWordDocumentStream(data)
      expect(charts.length).toBe(0)
    })

    it('should detect Excel ZIP magic patterns', () => {
      const data = new Uint8Array([0x50, 0x4B, 0x03, 0x04])
      const charts = extractChartsFromWordDocumentStream(data)
      expect(charts.length).toBe(0)
    })

    it('should handle empty stream', () => {
      const data = new Uint8Array(0)
      const charts = extractChartsFromWordDocumentStream(data)
      expect(charts.length).toBe(0)
    })

    it('should handle small stream', () => {
      const data = new Uint8Array(100)
      const charts = extractChartsFromWordDocumentStream(data)
      expect(charts.length).toBe(0)
    })

    it('should skip large streams without complete magic patterns', () => {
      const data = new Uint8Array(12000).fill(0xAB)
      data.set([0xD0, 0xCF, 0x11, 0x00], 100)
      data.set([0x50, 0x4B, 0x03, 0x00], 5000)

      expect(extractChartsFromWordDocumentStream(data)).toEqual([])
    })

    it('should extract an embedded OLE object larger than 500 bytes', () => {
      // OLE magic at 0, non-zero payload until a 4-byte zero run
      const data = new Uint8Array(700)
      data.set([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], 0)
      data.fill(0xAB, 8, 560)
      // 4 zero bytes terminate the scan (at offset 560)

      const charts = extractChartsFromWordDocumentStream(data)
      expect(charts.length).toBe(1)
      expect(charts[0].type).toBe('oleobject')
      expect(charts[0].subtype).toBe('chart')
      expect(charts[0].hasData).toBe(true)
      expect(charts[0].dataSize).toBeGreaterThan(500)
      expect(charts[0].name).toContain('OLE Object')
    })

    it('should extract an embedded Excel object larger than 500 bytes', () => {
      const data = new Uint8Array(700)
      data.set([0x50, 0x4B, 0x03, 0x04], 0)
      data.fill(0xCD, 4, 560)

      const charts = extractChartsFromWordDocumentStream(data)
      expect(charts.length).toBe(1)
      expect(charts[0].type).toBe('excel')
      expect(charts[0].name).toContain('Excel Object')
    })

    it('should skip embedded objects smaller than 500 bytes', () => {
      const data = new Uint8Array(300)
      data.set([0xD0, 0xCF, 0x11, 0xE0], 0)
      data.fill(0xAB, 4, 200)

      const charts = extractChartsFromWordDocumentStream(data)
      expect(charts.length).toBe(0)
    })
  })

  describe('extractChartsFromDirectory picture preview', () => {
    function makeEntry(name: string, objectType: number, size: number): DirectoryEntry {
      return {
        name,
        objectType,
        leftSibling: -1,
        rightSibling: -1,
        child: -1,
        clsid: new Uint8Array(16),
        stateBits: 0,
        creationTime: 0,
        modificationTime: 0,
        startSector: 1,
        size,
      }
    }

    it('should extract a data URL from the Picture stream', () => {
      // Minimal PNG
      const png = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
        0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
        0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
        0x44, 0xae, 0x42, 0x60, 0x82,
      ])
      const directory = [
        makeEntry('MSGraph.Chart.8', 1, 1000),
        makeEntry('MSGraph.Chart.8\x00Picture', 2, png.length),
      ]
      const readStream = (entry: DirectoryEntry) => {
        if (entry.name.endsWith('Picture')) return { data: png }
        return null
      }

      const charts = extractChartsFromDirectory(directory, readStream)
      expect(charts).toHaveLength(1)
      expect(charts[0].dataUrl).toContain('data:image/png;base64,')
    })

    it('should skip picture preview when Picture stream is too small', () => {
      const directory = [
        makeEntry('MSGraph.Chart.8', 1, 1000),
        makeEntry('MSGraph.Chart.8\x00Picture', 2, 4),
      ]
      const charts = extractChartsFromDirectory(directory, () => ({ data: new Uint8Array(4) }))
      expect(charts[0].dataUrl).toBeUndefined()
    })

    it('should skip picture preview when stream contains no image', () => {
      const directory = [
        makeEntry('MSGraph.Chart.8', 1, 1000),
        makeEntry('MSGraph.Chart.8\x00Picture', 2, 500),
      ]
      const charts = extractChartsFromDirectory(directory, () => ({ data: new Uint8Array(100).fill(0xAB) }))
      expect(charts[0].dataUrl).toBeUndefined()
    })

    it('should skip picture preview when readStream is unavailable', () => {
      const directory = [
        makeEntry('MSGraph.Chart.8', 1, 1000),
        makeEntry('MSGraph.Chart.8\x00Picture', 2, 500),
      ]
      const charts = extractChartsFromDirectory(directory)
      expect(charts[0].dataUrl).toBeUndefined()
      expect(charts[0].hasPicture).toBe(true)
    })

    it('should extract LibreOffice numeric storage names', () => {
      const directory = [makeEntry('_2147483647', 1, 500)]
      const charts = extractChartsFromDirectory(directory, () => null)
      expect(charts).toHaveLength(1)
      expect(charts[0].type).toBe('chart')
    })
  })
})

describe('chartParser uncovered branches', () => {
  it('detectChartType: recognizes LibreOffice graphic storages', () => {
    expect(detectChartType('LibreOffice.Graphic')).toEqual({ type: 'chart', subtype: 'chart' })
  })

  it('detectChartType: falls through to excel/sheet keyword check', () => {
    expect(detectChartType('Excel.Addin')).toEqual({ type: 'excel', subtype: 'chart' })
    expect(detectChartType('MySheet')).toEqual({ type: 'excel', subtype: 'chart' })
  })

  it('extractChartsFromDirectory: reports a picture-stream read failure', () => {
    const directory = [
      { name: 'Object.7', objectType: 1, startSector: 0, size: 0, nameLength: 8 },
      { name: 'Object.7\x00Picture', objectType: 2, startSector: 0, size: 100, nameLength: 16 },
    ]
    const charts = extractChartsFromDirectory(directory as any, () => {
      throw new Error('stream read boom')
    })
    expect(charts.length).toBe(1)
    expect(charts[0].name).toBe('Object.7')
    expect(charts[0].dataUrl).toBeUndefined()
  })

  it('extractChartsFromDirectory: skips entries whose detection throws', () => {
    const directory = [
      { name: 'Object.9', objectType: 1, startSector: 0, size: 0, nameLength: 8 },
    ]
    // detectChartType cannot throw, but a throwing readStream inside
    // extractChartPictureDataUrl is already caught internally; this test
    // pins the outer catch as a no-op safety net.
    const charts = extractChartsFromDirectory(directory as any, () => ({ data: new Uint8Array(0), size: 0 }))
    expect(charts.length).toBe(1)
    expect(charts[0].dataUrl).toBeUndefined()
  })
})

describe('chartParser filter branches', () => {
  it('accepts smartart-named storages and rejects unrelated entries', () => {
    const directory = [
      { name: 'Object.1', objectType: 1, startSector: 0, size: 0, nameLength: 8 },
      { name: 'smartartbox', objectType: 1, startSector: 0, size: 0, nameLength: 11 },
      { name: 'randomname', objectType: 1, startSector: 0, size: 0, nameLength: 10 },
      { name: 'someStream', objectType: 2, startSector: 0, size: 0, nameLength: 10 },
      { name: 'Root Entry', objectType: 5, startSector: 0, size: 0, nameLength: 10 },
    ]
    const charts = extractChartsFromDirectory(directory as any, undefined)
    expect(charts.length).toBe(2)
    expect(charts[0].name).toBe('Object.1')
    expect(charts[1].name).toBe('smartartbox')
    expect(charts[1].type).toBe('smartart')
  })
})

// Round 130：完整复制 git show HEAD:src/utils/chartParser.ts 的旧扫描函数。
// 仅移除 export 并重命名，不共享候选分支、游标消费或由 actual 生成 expected。
import { readFileSync, readdirSync } from 'node:fs'
import { deepStrictEqual } from 'node:assert'
import { OleParser } from '../src/utils/oleParser'
import type { ChartInfo } from '../src/utils/docFormat'

function round130HeadOracle(data: Uint8Array): ChartInfo[] {
  const charts: ChartInfo[] = []

  const limit = data.length - 100
  if (limit <= 0) return charts

  // 耗尽哨兵：必须大于任何合法偏移与 limit。
  const EXHAUSTED = data.length + 1
  let oleAt = data.indexOf(0xD0, 0)
  if (oleAt < 0) oleAt = EXHAUSTED
  let zipAt = data.indexOf(0x50, 0)
  if (zipAt < 0) zipAt = EXHAUSTED
  let from = 0

  for (;;) {
    // 产出图表后 from 会跳到 endOffset + 5，落后的游标需要补齐。
    if (oleAt < from) {
      oleAt = data.indexOf(0xD0, from)
      if (oleAt < 0) oleAt = EXHAUSTED
    }
    if (zipAt < from) {
      zipAt = data.indexOf(0x50, from)
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
      oleAt = data.indexOf(0xD0, offset + 1)
      if (oleAt < 0) oleAt = EXHAUSTED
    }
    if (offset === zipAt) {
      zipAt = data.indexOf(0x50, offset + 1)
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

const round130Magic = {
  oleobject: [0xD0, 0xCF, 0x11, 0xE0],
  excel: [0x50, 0x4B, 0x03, 0x04],
}

function round130Chart(type: 'oleobject' | 'excel', dataSize: number, id = 1): ChartInfo {
  return {
    id,
    name: `Embedded ${type === 'excel' ? 'Excel' : 'OLE'} Object ${id}`,
    type,
    subtype: 'chart',
    hasData: true,
    dataSize,
  }
}

function round130Object(type: 'oleobject' | 'excel', size: number): Uint8Array {
  const data = new Uint8Array(size + 104).fill(0xAB)
  data.set(round130Magic[type])
  data.fill(0, size, size + 4)
  return data
}

function round130Assert(data: Uint8Array, expected?: ChartInfo[]): ChartInfo[] {
  const before = data.slice()
  const old = round130HeadOracle(data)
  const actual = extractChartsFromWordDocumentStream(data)
  deepStrictEqual(actual, old)
  if (expected !== undefined) deepStrictEqual(actual, expected)
  deepStrictEqual(data, before)
  return actual
}

const round130Kinds = ['oleobject', 'excel'] as const

describe('Round 130 互异首字节分支与HEAD旧oracle护栏', () => {
  it('27条真实WordDocument流逐条完整数组相等，真实图表零不能替代非空合成断言', () => {
    const docs = new URL('../docs/', import.meta.url)
    const files = readdirSync(docs).filter(name => /\.(doc|dot)$/.test(name)).sort()
    expect(files).toHaveLength(27)
    let streams = 0
    let charts = 0
    for (const name of files) {
      const bytes = readFileSync(new URL(name, docs))
      const parser = new OleParser(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const header = parser.parseHeader()
      const directory = parser.getDirectorySectors(header, parser.getFatSectors(header))
      const stream = parser.findWordDocumentStream(directory)
      expect(stream, name).not.toBeNull()
      if (!stream) throw new Error(`缺少 WordDocument 流：${name}`)
      charts += round130Assert(stream.data).length
      streams++
    }
    expect(streams).toBe(27)
    expect(charts).toBe(0)
  })

  it.each(round130Kinds)('%s 合成产出所有字段明确非空且输入不变', type => {
    round130Assert(round130Object(type, 560), [round130Chart(type, 560)])
  })

  it.each([0, 1, 3, 4, 99, 100, 101, 102])('长度%i尾界限及截断签名安全终止', length => {
    for (const type of round130Kinds) {
      const data = new Uint8Array(length).fill(0xAB)
      data.set(round130Magic[type].slice(0, length))
      round130Assert(data, [])
    }
  })

  it.each(round130Kinds)('%s 尾部剩100字节不扫描，101字节候选不产出', type => {
    for (const remaining of [100, 101]) {
      const data = new Uint8Array(800).fill(0xAB)
      data.set(round130Magic[type], data.length - remaining)
      round130Assert(data, [])
    }
  })

  it.each(round130Kinds)('%s 严格500阈值及499/500/501完整结果', type => {
    for (const size of [499, 500, 501]) {
      round130Assert(round130Object(type, size), size > 500 ? [round130Chart(type, size)] : [])
    }
  })

  it('密集不完整首字节交错消费后仍发现有效OLE和ZIP', () => {
    const data = new Uint8Array(1900).fill(0xAB)
    for (let offset = 0; offset < 600; offset += 2) {
      data[offset] = offset % 4 === 0 ? 0xD0 : 0x50
    }
    data.set(round130Magic.oleobject, 600)
    data.fill(0, 1150, 1154)
    data.set(round130Magic.excel, 1155)
    data.fill(0, 1710, 1714)
    round130Assert(data, [round130Chart('oleobject', 550), round130Chart('excel', 555, 2)])
  })

  it('不完整OLE不能错误消费待处理ZIP游标', () => {
    const data = new Uint8Array(800).fill(0xAB)
    data[0] = 0xD0
    data.set(round130Magic.excel, 10)
    data[20] = 0xD0
    data.fill(0, 570, 574)
    round130Assert(data, [round130Chart('excel', 560)])
  })

  it.each(round130Kinds)('%s 单游标耗尽后另一游标持续发现对象', type => {
    const data = new Uint8Array(1400).fill(0xAB)
    data.set(round130Magic[type], 0)
    data.fill(0, 550, 554)
    data.set(round130Magic[type], 555)
    data.fill(0, 1110, 1114)
    round130Assert(data, [round130Chart(type, 550), round130Chart(type, 555, 2)])
  })

  it('两个游标同时耗尽哨兵不进入else签名分支', () => {
    round130Assert(new Uint8Array(2000).fill(0xAB), [])
    const data = new Uint8Array(2000).fill(0xAB)
    data[0] = 0xD0
    data[1] = 0x50
    round130Assert(data, [])
  })

  it.each([4, 5, 6])('产出后仅跳过至end+5：下一签名在end+%i', gap => {
    const data = new Uint8Array(1400).fill(0xAB)
    data.set(round130Magic.oleobject)
    data.fill(0, 550, 554)
    const next = 550 + gap
    data.set(round130Magic.excel, next)
    data.fill(0, next + 560, next + 564)
    const expected = [round130Chart('oleobject', 550)]
    if (gap >= 5) expected.push(round130Chart('excel', 560, 2))
    round130Assert(data, expected)
  })

  it('嵌套签名被跳过且落后OLE/ZIP游标均补齐至下一对象', () => {
    const data = new Uint8Array(2000).fill(0xAB)
    data.set(round130Magic.oleobject)
    data.set(round130Magic.excel, 200)
    data.set(round130Magic.oleobject, 300)
    data.fill(0, 700, 704)
    data.set(round130Magic.excel, 705)
    data.fill(0, 1300, 1304)
    round130Assert(data, [round130Chart('oleobject', 700), round130Chart('excel', 595, 2)])
  })

  it.each(round130Kinds)('%s 10000扫描上限及上限后的另一对象', type => {
    const data = new Uint8Array(11000).fill(0xAB)
    data.set(round130Magic[type])
    const other = type === 'excel' ? 'oleobject' : 'excel'
    data.set(round130Magic[other], 10005)
    data.fill(0, 10560, 10564)
    round130Assert(data, [round130Chart(type, 10000), round130Chart(other, 555, 2)])
  })

  it.each(round130Kinds)('%s 截断1/2/3个零不作为四零终结符', type => {
    for (const zeros of [0, 1, 2, 3, 4]) {
      const data = new Uint8Array(560).fill(0xAB)
      data.set(round130Magic[type])
      if (zeros) data.fill(0, data.length - zeros)
      round130Assert(data, [round130Chart(type, zeros === 4 ? 556 : 560)])
    }
  })

  it.each(round130Kinds)('%s 签名末两字节256×256组合穷尽且仅唯一完整签名产出', type => {
    const data = round130Object(type, 550)
    let produced = 0
    for (let third = 0; third < 256; third++) {
      for (let fourth = 0; fourth < 256; fourth++) {
        data[2] = third
        data[3] = fourth
        const expected = third === round130Magic[type][2] && fourth === round130Magic[type][3]
          ? [round130Chart(type, 550)] : []
        deepStrictEqual(round130HeadOracle(data), expected)
        deepStrictEqual(extractChartsFromWordDocumentStream(data), expected)
        produced += expected.length
      }
    }
    expect(produced).toBe(1)
  })
})
