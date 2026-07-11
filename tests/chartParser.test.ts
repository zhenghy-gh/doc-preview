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
  })
})
