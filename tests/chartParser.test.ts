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
